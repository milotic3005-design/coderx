/**
 * Reads individual entries of a very large ZIP without downloading it, using HTTP range
 * requests. CMS's quarterly Part D archive is 2.5 GB, nearly all of it pharmacy network
 * files CodeRx does not need, and its entries are themselves ZIP files, so entries are
 * inflated as streams and a nested archive's first member can be read the same way.
 */
import { Readable } from "node:stream";
import { createInflateRaw } from "node:zlib";
import { fetchWithRetry, headInfo, USER_AGENT } from "./fetch";
import { crc32, ZipIntegrityError } from "./zip";

/** `end` is exclusive in both methods. */
export interface ByteSource {
  size: number;
  read(start: number, end: number): Promise<Uint8Array>;
  stream(start: number, end: number): AsyncIterable<Uint8Array>;
}

export function byteSourceFromBytes(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.length,
    read: async (start, end) => bytes.subarray(start, end),
    stream: async function* (start, end) {
      yield bytes.subarray(start, end);
    },
  };
}

export async function byteSourceFromUrl(url: string): Promise<ByteSource & { lastModified: string | null; etag: string | null }> {
  const info = await headInfo(url);
  if (!info.contentLength) throw new Error(`${url} did not report a size, so it cannot be read by byte range.`);
  const ranged = async (start: number, end: number) => {
    const res = await fetchWithRetry(url, { headers: { "User-Agent": USER_AGENT, Accept: "*/*", "Accept-Encoding": "identity", Range: `bytes=${start}-${end - 1}` } }, 2, 600_000);
    if (res.status !== 206 || !res.body) throw new Error(`Range request failed for ${url}: HTTP ${res.status}`);
    return res;
  };
  return {
    size: info.contentLength,
    lastModified: info.lastModified,
    etag: info.etag,
    read: async (start, end) => new Uint8Array(await (await ranged(start, end)).arrayBuffer()),
    stream: async function* (start, end) {
      const res = await ranged(start, end);
      yield* res.body as unknown as AsyncIterable<Uint8Array>;
    },
  };
}

export interface RemoteEntry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

const ZIP64_MARKER = 0xffffffff;
const TAIL_BYTES = 1024 * 1024;

export async function listRemoteZip(src: ByteSource): Promise<RemoteEntry[]> {
  const tailStart = Math.max(0, src.size - TAIL_BYTES);
  const tail = await src.read(tailStart, src.size);
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipIntegrityError("Not a ZIP archive (end-of-central-directory record not found).");
  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (cdOffset === ZIP64_MARKER || cdSize === ZIP64_MARKER || count === 0xffff) throw new ZipIntegrityError("ZIP64 archives are not supported.");

  const cd = cdOffset >= tailStart ? tail.subarray(cdOffset - tailStart, cdOffset - tailStart + cdSize) : await src.read(cdOffset, cdOffset + cdSize);
  const cdView = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const decoder = new TextDecoder("utf-8");
  const entries: RemoteEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (cdView.getUint32(p, true) !== 0x02014b50) throw new ZipIntegrityError(`Corrupt ZIP central directory at entry ${i}.`);
    const compressedSize = cdView.getUint32(p + 20, true);
    const size = cdView.getUint32(p + 24, true);
    const localOffset = cdView.getUint32(p + 42, true);
    if (compressedSize === ZIP64_MARKER || size === ZIP64_MARKER || localOffset === ZIP64_MARKER) throw new ZipIntegrityError("ZIP64 archives are not supported.");
    const nameLen = cdView.getUint16(p + 28, true);
    entries.push({ name: decoder.decode(cd.subarray(p + 46, p + 46 + nameLen)), method: cdView.getUint16(p + 10, true), crc: cdView.getUint32(p + 16, true), compressedSize, size, localOffset });
    p += 46 + nameLen + cdView.getUint16(p + 30, true) + cdView.getUint16(p + 32, true);
  }
  return entries;
}

/** Inflates a raw deflate stream, which ends itself; anything after it in `chunks` is ignored. */
async function* inflate(chunks: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array> {
  const input = Readable.from(chunks, { objectMode: false });
  const inflater = createInflateRaw();
  input.on("error", (error) => inflater.destroy(error));
  input.pipe(inflater);
  try {
    yield* inflater as AsyncIterable<Uint8Array>;
  } finally {
    input.destroy();
  }
}

function unsupported(method: number): never {
  throw new ZipIntegrityError(`Unsupported ZIP compression method ${method}.`);
}

/** The inflated bytes of an entry. */
export async function* entryStream(src: ByteSource, e: RemoteEntry): AsyncIterable<Uint8Array> {
  const header = await src.read(e.localOffset, e.localOffset + 30);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50) throw new ZipIntegrityError(`Corrupt local header for ${e.name}.`);
  const start = e.localOffset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
  const body = src.stream(start, start + e.compressedSize);
  if (e.method === 0) yield* body;
  else if (e.method === 8) yield* inflate(body);
  else unsupported(e.method);
}

export async function entryBytes(src: ByteSource, e: RemoteEntry): Promise<Uint8Array> {
  const out = new Uint8Array(e.size);
  let offset = 0;
  for await (const chunk of entryStream(src, e)) {
    if (offset + chunk.length > e.size) throw new ZipIntegrityError(`${e.name} is larger than its ZIP entry says.`);
    out.set(chunk, offset);
    offset += chunk.length;
  }
  if (offset !== e.size || crc32(out) !== e.crc) throw new ZipIntegrityError(`CRC or size mismatch for ${e.name}.`);
  return out;
}

/** The first member of a ZIP read as a stream, as when one ZIP is nested in another. */
export async function* firstMemberStream(zip: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array> {
  const iterator = zip[Symbol.asyncIterator]();
  let head = new Uint8Array(0);
  const fill = async (needed: number) => {
    while (head.length < needed) {
      const next = await iterator.next();
      if (next.done) throw new ZipIntegrityError("Nested ZIP ended inside its first header.");
      const joined = new Uint8Array(head.length + next.value.length);
      joined.set(head);
      joined.set(next.value, head.length);
      head = joined;
    }
  };
  await fill(30);
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50) throw new ZipIntegrityError("Nested file is not a ZIP.");
  const flags = view.getUint16(6, true);
  const method = view.getUint16(8, true);
  const compressedSize = view.getUint32(18, true);
  const dataStart = 30 + view.getUint16(26, true) + view.getUint16(28, true);
  await fill(dataStart);
  const rest = (async function* () {
    yield head.subarray(dataStart);
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) yield next.value;
  })();
  if (method === 8) {
    yield* inflate(rest);
  } else if (method === 0 && !(flags & 8)) {
    let left = compressedSize;
    for await (const chunk of rest) {
      yield chunk.subarray(0, left);
      left -= Math.min(left, chunk.length);
      if (!left) break;
    }
  } else {
    unsupported(method);
  }
}

/** Lines of Latin-1 text, without line endings. */
export async function* lines(chunks: AsyncIterable<Uint8Array>): AsyncIterable<string> {
  let pending = "";
  for await (const chunk of chunks) {
    const text = pending + Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString("latin1");
    let start = 0;
    for (let nl = text.indexOf("\n"); nl !== -1; nl = text.indexOf("\n", start)) {
      yield text.slice(start, nl > start && text.charCodeAt(nl - 1) === 13 ? nl - 1 : nl);
      start = nl + 1;
    }
    pending = text.slice(start);
  }
  if (pending) yield pending.endsWith("\r") ? pending.slice(0, -1) : pending;
}
