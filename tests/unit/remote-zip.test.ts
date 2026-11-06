import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { byteSourceFromBytes, entryBytes, entryStream, firstMemberStream, lines, listRemoteZip } from "@/ingest/remote-zip";
import { ZipIntegrityError } from "@/ingest/zip";

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of items) out.push(item);
  return out;
}

async function* chunked(bytes: Uint8Array, size: number) {
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
}

/** Marks the first central-directory entry the way a ZIP64 archive does. */
function zip64Marked(zip: Uint8Array): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  let eocd = out.length - 22;
  while (view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  view.setUint32(view.getUint32(eocd + 16, true) + 20, 0xffffffff, true);
  return out;
}

const body = "A|B\nC|D\n";
const outer = zipSync({
  "notes.txt": [strToU8("hello"), { level: 0 }],
  "pricing.zip": zipSync({ "pricing.txt": strToU8(body) }),
  "stored.zip": [zipSync({ "stored.txt": [strToU8(body), { level: 0 }] }), { level: 0 }],
});

describe("byte-range ZIP reading", () => {
  const src = byteSourceFromBytes(outer);

  it("lists entries from the central directory", async () => {
    expect((await listRemoteZip(src)).map((e) => e.name).sort()).toEqual(["notes.txt", "pricing.zip", "stored.zip"]);
  });
  it("reads a stored entry with its CRC checked", async () => {
    const entry = (await listRemoteZip(src)).find((e) => e.name === "notes.txt")!;
    expect(new TextDecoder().decode(await entryBytes(src, entry))).toBe("hello");
    await expect(entryBytes(src, { ...entry, crc: entry.crc ^ 1 })).rejects.toThrow(ZipIntegrityError);
  });
  it("streams a compressed zip nested in the archive", async () => {
    const entry = (await listRemoteZip(src)).find((e) => e.name === "pricing.zip")!;
    expect(await collect(lines(firstMemberStream(entryStream(src, entry))))).toEqual(["A|B", "C|D"]);
  });
  it("streams a stored zip nested in the archive", async () => {
    const entry = (await listRemoteZip(src)).find((e) => e.name === "stored.zip")!;
    expect(await collect(lines(firstMemberStream(entryStream(src, entry))))).toEqual(["A|B", "C|D"]);
  });
  it("rejects ZIP64 archives clearly", async () => {
    await expect(listRemoteZip(byteSourceFromBytes(zip64Marked(outer)))).rejects.toThrow(ZipIntegrityError);
  });
});

describe("lines", () => {
  it("keeps lines intact across chunk boundaries and CRLF", async () => {
    expect(await collect(lines(chunked(strToU8("a|1\r\nb|2\r\nc|3"), 3)))).toEqual(["a|1", "b|2", "c|3"]);
  });
  it("handles a chunk boundary between CR and LF", async () => {
    expect(await collect(lines(chunked(strToU8("a\r\nb\r\n"), 2)))).toEqual(["a", "b"]);
  });
  it("yields nothing for an empty stream", async () => {
    expect(await collect(lines(chunked(new Uint8Array(0), 3)))).toEqual([]);
  });
});
