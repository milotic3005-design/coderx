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
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
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
  const { cacheDir, cacheMode = cacheDir ? "use" : "off", maxBytes = 400 * 1024 * 1024, timeoutMs = 180_000, retries = 2 } = options;
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

  const res = await fetchWithRetry(url, { headers: { "User-Agent": USER_AGENT, Accept: "*/*" } }, retries, timeoutMs);
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
