/**
 * Reads single files out of a large ZIP on a web server without downloading the whole
 * thing. CMS's quarterly Part D archive is about 2.5 GB, almost all of it pharmacy
 * network data this project does not need. HTTP "range" requests fetch just the bytes
 * for the few files we want.
 */
import { inflateRawSync } from "node:zlib";

const UA = "wa-coverage-check/0.1 (public-data research tool)";

async function readRange(url: string, start: number, end: number): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}`, "User-Agent": UA } });
  if (res.status !== 206) throw new Error(`Range request to ${url} failed: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

/** Lists the files in a remote ZIP by reading its central directory from the end of the file. */
export async function listRemoteZip(url: string): Promise<{ entries: ZipEntry[]; lastModified: string | null }> {
  const head = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA } });
  const size = Number(head.headers.get("content-length"));
  if (!size) throw new Error(`${url} did not report its size.`);
  const tailStart = Math.max(0, size - 1024 * 1024);
  const tail = await readRange(url, tailStart, size);
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a ZIP file (no end-of-directory record).");
  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff) throw new Error("ZIP64 archives are not supported.");
  const cd = cdOffset >= tailStart ? tail.subarray(cdOffset - tailStart, cdOffset - tailStart + cdSize) : await readRange(url, cdOffset, cdOffset + cdSize);
  const cv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    const nameLen = cv.getUint16(p + 28, true);
    entries.push({
      name: new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nameLen)),
      method: cv.getUint16(p + 10, true),
      compressedSize: cv.getUint32(p + 20, true),
      localOffset: cv.getUint32(p + 42, true),
    });
    p += 46 + nameLen + cv.getUint16(p + 30, true) + cv.getUint16(p + 32, true);
  }
  return { entries, lastModified: head.headers.get("last-modified") };
}

/** Downloads and decompresses one file from the remote ZIP. */
export async function readRemoteEntry(url: string, e: ZipEntry): Promise<Uint8Array> {
  const header = await readRange(url, e.localOffset, e.localOffset + 30);
  const hv = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const start = e.localOffset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
  const data = await readRange(url, start, start + e.compressedSize);
  if (e.method === 0) return data;
  if (e.method === 8) return inflateRawSync(data);
  throw new Error(`Unsupported compression in ${e.name}.`);
}
