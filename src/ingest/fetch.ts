/**
 * Downloader for government source files: honest User-Agent, timeout, size cap,
 * retries with backoff, SHA-256, and an optional on-disk cache for reproducible
 * local runs (`.cache/sources`).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const USER_AGENT = "CodeRx-ingest/1.0 (+https://github.com/milotic3005-design/coderx; public-data importer)";

export interface Downloaded {
  url: string;
  bytes: Uint8Array;
  sha256: string;
  byteSize: number;
  lastModified: string | null;
  etag: string | null;
  contentType: string | null;
  fromCache: boolean;
}

export interface DownloadOptions {
  cacheDir?: string;
  /** use: read cache if present; refresh: always download and overwrite; off: never touch disk. */
  cacheMode?: "use" | "refresh" | "off";
  maxBytes?: number;
  timeoutMs?: number;
  retries?: number;
  /** follow (default) or refuse: refuse fails on any 3xx, e.g. a bot-detection redirect instead of the file. */
  redirects?: "follow" | "refuse";
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function cacheKey(url: string): string {
  return createHash("sha1").update(url).digest("hex");
}

async function fetchWithRetry(url: string, init: RequestInit, retries: number, timeoutMs: number): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { redirect: "follow", ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status >= 500 && attempt < retries) {
        lastError = new Error(`HTTP ${res.status}`);
      } else {
        return res;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  throw new Error(`Download failed for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function download(url: string, options: DownloadOptions = {}): Promise<Downloaded> {
  const { cacheDir, cacheMode = cacheDir ? "use" : "off", maxBytes = 400 * 1024 * 1024, timeoutMs = 180_000, retries = 2, redirects = "follow" } = options;
  const key = cacheKey(url);

  if (cacheDir && cacheMode === "use") {
    try {
      const [bytes, metaText] = await Promise.all([readFile(join(cacheDir, `${key}.bin`)), readFile(join(cacheDir, `${key}.json`), "utf8")]);
      const meta = JSON.parse(metaText) as { lastModified: string | null; etag: string | null; contentType: string | null };
      const data = new Uint8Array(bytes);
      return { url, bytes: data, sha256: sha256(data), byteSize: data.length, ...meta, fromCache: true };
    } catch {
      // cache miss
    }
  }

  const res = await fetchWithRetry(url, { headers: { "User-Agent": USER_AGENT, Accept: "*/*" }, redirect: redirects === "refuse" ? "manual" : "follow" }, retries, timeoutMs);
  if (res.status >= 300 && res.status < 400) throw new Error(`Refusing ${url}: redirected (HTTP ${res.status}) to ${res.headers.get("location") ?? "an unknown location"}.`);
  if (!res.ok) throw new Error(`Download failed for ${url}: HTTP ${res.status}`);
  // With Content-Encoding (gzip/br) fetch decodes the body, so Content-Length describes the encoded size only.
  const encoded = !!res.headers.get("content-encoding") && res.headers.get("content-encoding") !== "identity";
  const declared = encoded ? 0 : Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new Error(`Refusing ${url}: ${declared} bytes exceeds the ${maxBytes}-byte limit.`);
  const buffer = new Uint8Array(await res.arrayBuffer());
  if (buffer.length > maxBytes) throw new Error(`Refusing ${url}: body exceeds the ${maxBytes}-byte limit.`);
  if (declared && buffer.length !== declared) throw new Error(`Truncated download for ${url}: ${buffer.length} of ${declared} bytes.`);
  if (buffer.length === 0) throw new Error(`Empty download for ${url}.`);

  const result: Downloaded = {
    url,
    bytes: buffer,
    sha256: sha256(buffer),
    byteSize: buffer.length,
    lastModified: res.headers.get("last-modified"),
    etag: res.headers.get("etag"),
    contentType: res.headers.get("content-type"),
    fromCache: false,
  };

  if (cacheDir && cacheMode !== "off") {
    await mkdir(cacheDir, { recursive: true });
    await Promise.all([
      writeFile(join(cacheDir, `${key}.bin`), buffer),
      writeFile(
        join(cacheDir, `${key}.json`),
        JSON.stringify({ url, lastModified: result.lastModified, etag: result.etag, contentType: result.contentType, sha256: result.sha256 }, null, 2),
      ),
    ]);
  }
  return result;
}

export interface StreamedDownload {
  url: string;
  lastModified: string | null;
  etag: string | null;
  contentType: string | null;
  /** Body chunks; hashing and size limits are applied as they arrive. Iterate once. */
  chunks: AsyncIterable<Uint8Array>;
  /** Available after `chunks` has been fully consumed. */
  result(): { sha256: string; byteSize: number };
}

/** Wrap bytes already in memory (tests, uploads) as a single-chunk stream. */
export function streamFromBytes(file: Downloaded): StreamedDownload {
  return {
    url: file.url,
    lastModified: file.lastModified,
    etag: file.etag,
    contentType: file.contentType,
    chunks: (async function* () {
      yield file.bytes;
    })(),
    result: () => ({ sha256: file.sha256, byteSize: file.byteSize }),
  };
}

/**
 * Streaming download for very large files (hundreds of MB): the body is never held in
 * memory, so a serverless function can filter it on the fly.
 */
export async function streamDownload(url: string, options: Pick<DownloadOptions, "maxBytes" | "timeoutMs" | "retries"> = {}): Promise<StreamedDownload> {
  const { maxBytes = 800 * 1024 * 1024, timeoutMs = 600_000, retries = 2 } = options;
  const res = await fetchWithRetry(url, { headers: { "User-Agent": USER_AGENT, Accept: "*/*" } }, retries, timeoutMs);
  if (!res.ok || !res.body) throw new Error(`Download failed for ${url}: HTTP ${res.status}`);
  const encoded = !!res.headers.get("content-encoding") && res.headers.get("content-encoding") !== "identity";
  const declared = encoded ? 0 : Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new Error(`Refusing ${url}: ${declared} bytes exceeds the ${maxBytes}-byte limit.`);
  const hash = createHash("sha256");
  let size = 0;
  let done = false;
  const body = res.body;
  return {
    url,
    lastModified: res.headers.get("last-modified"),
    etag: res.headers.get("etag"),
    contentType: res.headers.get("content-type"),
    chunks: (async function* () {
      for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        if (size > maxBytes) throw new Error(`Refusing ${url}: body exceeds the ${maxBytes}-byte limit.`);
        hash.update(chunk);
        yield chunk;
      }
      if (size === 0) throw new Error(`Empty download for ${url}.`);
      if (declared && size !== declared) throw new Error(`Truncated download for ${url}: ${size} of ${declared} bytes.`);
      done = true;
    })(),
    result: () => {
      if (!done) throw new Error("Stream not fully consumed.");
      return { sha256: hash.digest("hex"), byteSize: size };
    },
  };
}

export async function headInfo(url: string, timeoutMs = 30_000): Promise<{ lastModified: string | null; etag: string | null; contentLength: number | null }> {
  const res = await fetchWithRetry(url, { method: "HEAD", headers: { "User-Agent": USER_AGENT } }, 1, timeoutMs);
  if (!res.ok) throw new Error(`HEAD ${url}: HTTP ${res.status}`);
  const len = res.headers.get("content-length");
  return { lastModified: res.headers.get("last-modified"), etag: res.headers.get("etag"), contentLength: len ? Number(len) : null };
}

export async function fetchPage(url: string, timeoutMs = 60_000): Promise<string> {
  const res = await fetchWithRetry(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" } }, 2, timeoutMs);
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return res.text();
}
