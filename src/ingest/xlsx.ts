/**
 * Minimal XLSX reader for the small, single-sheet spreadsheets CMS publishes
 * (e.g. the HCPCS "NOC codes" list). It reads shared strings, inline strings,
 * and numeric cells from the first worksheet. Avoids the unmaintained npm `xlsx`
 * package, which has unpatched advisories.
 */
import { unzipVerified } from "./zip";

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function textOf(fragment: string): string {
  return [...fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join("");
}

function columnIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function readFirstSheet(bytes: Uint8Array): string[][] {
  const entries = unzipVerified(bytes, (n) => n === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const decoder = new TextDecoder("utf-8");
  const shared: string[] = [];
  const sst = entries.find((e) => e.name === "xl/sharedStrings.xml");
  if (sst) {
    for (const m of decoder.decode(sst.data).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));
  }
  const sheet = entries.filter((e) => e.name.startsWith("xl/worksheets/")).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))[0];
  if (!sheet) throw new Error("XLSX has no worksheet.");
  const xml = decoder.decode(sheet.data);
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s" && v !== undefined) value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = textOf(body);
      else if (v !== undefined) value = decodeXml(v);
      const idx = ref ? columnIndex(ref) : row.length;
      row[idx] = value;
    }
    rows.push(Array.from(row, (c) => c ?? ""));
  }
  return rows;
}
