/**
 * Streaming parser for CMS "Drug Products in the Medicaid Drug Rebate Program"
 * (download.medicaid.gov/data/drugproducts-qN-YYYY.csv, ~330 MB, every quarter since
 * 2022). Only rows for the requested quarter and for NDCs CodeRx indexes are kept.
 */
import { parseUsDate } from "../values";
import type { Rejected } from "./hcpcs";

export interface MdrpRow {
  ndc11: string;
  labelerName: string | null;
  fdaProductName: string | null;
  unitType: string | null;
  unitsPerPackage: string | null;
  drugCategory: string | null;
  drugType: string | null;
  codStatus: string | null;
  terminationDate: string | null;
  reactivationDate: string | null;
  marketDate: string | null;
  clottingFactor: boolean | null;
  lineExtension: string | null;
  applicationNumber: string | null;
}

export interface MdrpParse {
  rows: MdrpRow[];
  /** Rows for the requested quarter, before scope filtering. */
  quarterRows: number;
  totalRows: number;
  quartersSeen: string[];
  rejected: Rejected[];
}

/** Split one CSV record into fields (RFC 4180 quoting). */
export function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Logical CSV records from a byte stream; a record may span lines inside quotes. */
async function* records(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  let pending = "";
  let quotes = 0;
  const flushLines = function* (text: string) {
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) !== 10) continue;
      const line = text.slice(start, i).replace(/\r$/, "");
      start = i + 1;
      for (let k = 0; k < line.length; k++) if (line.charCodeAt(k) === 34) quotes++;
      pending = pending ? `${pending}\n${line}` : line;
      if (quotes % 2 === 0) {
        yield pending;
        pending = "";
        quotes = 0;
      }
    }
    return text.slice(start);
  };
  for await (const chunk of chunks) {
    buf += decoder.decode(chunk, { stream: true });
    const gen = flushLines(buf);
    let r = gen.next();
    while (!r.done) {
      yield r.value;
      r = gen.next();
    }
    buf = r.value;
  }
  buf += decoder.decode();
  if (buf) {
    for (let k = 0; k < buf.length; k++) if (buf.charCodeAt(k) === 34) quotes++;
    pending = pending ? `${pending}\n${buf}` : buf;
  }
  if (pending.trim()) yield pending.replace(/\r$/, "");
}

const blank = (v: string | undefined) => {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
};

export async function parseMdrpStream(chunks: AsyncIterable<Uint8Array>, opts: { year: number; quarter: number; keep: (ndc11: string) => boolean }): Promise<MdrpParse> {
  let header: string[] | null = null;
  const col: Record<string, number> = {};
  const rows: MdrpRow[] = [];
  const rejected: Rejected[] = [];
  const quarters = new Set<string>();
  let quarterRows = 0;
  let totalRows = 0;
  let lineNo = 0;
  const seen = new Set<string>();
  for await (const rec of records(chunks)) {
    lineNo++;
    if (!rec.trim()) continue;
    const f = csvFields(rec);
    if (!header) {
      header = f.map((h) => h.trim().toLowerCase());
      for (const name of ["year", "quarter", "ndc", "labeler name", "unit type", "units per pkg size", "fda product name", "drug category", "drug type indicator", "termination date", "reactivation date", "market date", "clotting factor indicator", "line extension drug indicator", "fda application number", "cod status"]) {
        const i = header.indexOf(name);
        if (i < 0 && ["year", "quarter", "ndc", "unit type"].includes(name)) throw new Error(`Medicaid drug product file: column '${name}' not found.`);
        col[name] = i;
      }
      continue;
    }
    totalRows++;
    const get = (name: string) => (col[name] >= 0 ? f[col[name]] : undefined);
    const year = get("year")?.trim();
    const quarter = get("quarter")?.trim();
    if (year && quarter) quarters.add(`${year}-Q${quarter}`);
    if (Number(year) !== opts.year || Number(quarter) !== opts.quarter) continue;
    quarterRows++;
    const ndc = (get("ndc") ?? "").trim();
    if (!/^\d{11}$/.test(ndc)) {
      if (rejected.length < 50) rejected.push({ line: lineNo, reason: `NDC is not 11 digits: '${ndc.slice(0, 20)}'`, sample: rec.slice(0, 80) });
      continue;
    }
    if (!opts.keep(ndc) || seen.has(ndc)) continue;
    seen.add(ndc);
    const units = blank(get("units per pkg size"));
    const clot = blank(get("clotting factor indicator"));
    rows.push({
      ndc11: ndc,
      labelerName: blank(get("labeler name")),
      fdaProductName: blank(get("fda product name")),
      unitType: blank(get("unit type"))?.toUpperCase() ?? null,
      unitsPerPackage: units && /^\d*\.?\d+$/.test(units) ? String(Number(units)) : null,
      drugCategory: blank(get("drug category")),
      drugType: blank(get("drug type indicator")),
      codStatus: blank(get("cod status"))?.padStart(2, "0") ?? null,
      terminationDate: parseUsDate(get("termination date")),
      reactivationDate: parseUsDate(get("reactivation date")),
      marketDate: parseUsDate(get("market date")),
      clottingFactor: clot === "Y" ? true : clot === "N" ? false : null,
      lineExtension: blank(get("line extension drug indicator")),
      applicationNumber: blank(get("fda application number")),
    });
  }
  if (!header) throw new Error("Medicaid drug product file is empty.");
  return { rows, quarterRows, totalRows, quartersSeen: [...quarters].sort(), rejected };
}
