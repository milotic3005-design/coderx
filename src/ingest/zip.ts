/**
 * ZIP extraction with integrity checks.
 *
 * fflate inflates entries; we read the central directory ourselves so every
 * extracted entry can be verified against its stored CRC-32 and size. A truncated
 * or corrupted download fails here, before any parsing or database work.
 */
import { inflateSync } from "fflate";

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  crc32: number;
  size: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export class ZipIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipIntegrityError";
  }
}

interface CentralEntry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

function readCentralDirectory(buf: Uint8Array): CentralEntry[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // End of central directory record: signature 0x06054b50, searched from the end (comment ≤ 65535 bytes).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipIntegrityError("Not a ZIP archive (end-of-central-directory record not found).");
  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (cdOffset >= buf.length) throw new ZipIntegrityError("ZIP central directory offset is outside the file (truncated download?).");

  const entries: CentralEntry[] = [];
  let p = cdOffset;
  const decoder = new TextDecoder("utf-8");
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new ZipIntegrityError(`Corrupt ZIP central directory at entry ${i}.`);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const compressedSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(buf.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, crc, compressedSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extract(buf: Uint8Array, entry: CentralEntry): Uint8Array {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const lo = entry.localOffset;
  if (view.getUint32(lo, true) !== 0x04034b50) throw new ZipIntegrityError(`Corrupt local header for ${entry.name}.`);
  const nameLen = view.getUint16(lo + 26, true);
  const extraLen = view.getUint16(lo + 28, true);
  const start = lo + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compressedSize);
  if (raw.length !== entry.compressedSize) throw new ZipIntegrityError(`Entry ${entry.name} is truncated.`);
  let data: Uint8Array;
  if (entry.method === 0) data = raw;
  else if (entry.method === 8) {
    try {
      data = inflateSync(raw, { out: new Uint8Array(entry.size) });
    } catch (error) {
      throw new ZipIntegrityError(`Entry ${entry.name} could not be decompressed; the archive is corrupted (${error instanceof Error ? error.message : String(error)}).`);
    }
  }
  else throw new ZipIntegrityError(`Unsupported compression method ${entry.method} for ${entry.name}.`);
  if (data.length !== entry.size) throw new ZipIntegrityError(`Size mismatch for ${entry.name}.`);
  if (crc32(data) !== entry.crc) throw new ZipIntegrityError(`CRC-32 mismatch for ${entry.name}; the archive is corrupted.`);
  return data;
}

/** List entry names without extracting. */
export function listZip(buf: Uint8Array): string[] {
  return readCentralDirectory(buf)
    .filter((e) => !e.name.endsWith("/"))
    .map((e) => e.name);
}

/** Extract (and verify) entries whose name passes the filter. */
export function unzipVerified(buf: Uint8Array, filter: (name: string) => boolean = () => true): ZipEntry[] {
  return readCentralDirectory(buf)
    .filter((e) => !e.name.endsWith("/") && filter(e.name))
    .map((e) => ({ name: e.name, data: extract(buf, e), crc32: e.crc, size: e.size }));
}

/** Base file name without folders. */
export function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}
