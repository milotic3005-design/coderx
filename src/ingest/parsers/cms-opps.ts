/**
 * Parsers for the CMS OPPS quarterly addenda, from the tab-delimited Section 508 text
 * file in each zip. A notes block precedes the header row.
 *
 * - Addendum B (payment by HCPCS code): only HCPCS Level II rows are kept, without
 *   descriptors (those come from the HCPCS file). CPT rows (AMA copyright) and CDT
 *   dental rows (ADA copyright) are counted and dropped, so no CPT content is stored.
 * - Addendum A (payment by APC): every APC with CMS's group title and rates.
 */
import Papa from "papaparse";
import { HCPCS_LEVEL2_RE, isCptLike } from "@/lib/hcpcs";
import { cell, columnFinder, findHeaderRow, isBlankRow } from "../csv";
import type { Rejected } from "./hcpcs";

export interface OppsRates {
  statusIndicator: string | null;
  relativeWeight: string | null;
  paymentRate: string | null;
  nationalCopay: string | null;
  minimumCopay: string | null;
  /** Inflation-adjusted (IRA) coinsurance percentage, e.g. "17.885". */
  iraCoinsurancePct: string | null;
  adjustedCopay: string | null;
  passThroughExpiration: string | null;
  note: string | null;
}

export interface OppsCodeRow extends OppsRates {
  hcpcsCode: string;
  apc: string | null;
}

export interface OppsApcRow extends OppsRates {
  apc: string;
  title: string | null;
}

export interface OppsRemedyOffset {
  /** Ratio CMS says to apply to payments and copayments (e.g. 0.9951). */
  ratio: number;
  statusIndicators: string[];
  /** The notes-block sentence, verbatim. */
  text: string;
}

interface Common {
  /** "CY 2026" from the title line. */
  calendarYear: string | null;
  remedyOffset: OppsRemedyOffset | null;
  rejected: Rejected[];
}

export interface OppsAddendumB extends Common {
  rows: OppsCodeRow[];
  excludedCpt: number;
  excludedDental: number;
}

export interface OppsAddendumA extends Common {
  rows: OppsApcRow[];
}

/** "$1,234.56" → "1234.56"; "17.885%" → "17.885"; "." or "" → null. */
function amount(raw: string): string | null {
  const s = raw.replace(/[$,%\s]/g, "");
  if (!s || s === ".") return null;
  return /^-?\d*\.?\d+$/.test(s) ? s : null;
}

function readTable(text: string, firstColumn: string) {
  const rows = Papa.parse<string[]>(text, { delimiter: "\t", skipEmptyLines: false }).data.map((r) => r.map((c) => (c ?? "").replace(/ /g, " ")));
  const headerIdx = findHeaderRow(rows, (k) => k[0] === firstColumn && k.includes("si") && k.includes("payment rate"));
  if (headerIdx < 0) throw new Error(`OPPS addendum: header row starting '${firstColumn}' with 'SI' and 'Payment Rate' not found.`);
  const notes = rows.slice(0, headerIdx).map((r) => r.filter(Boolean).join(" ").trim()).filter(Boolean);
  const calendarYear = notes.map((n) => n.match(/for (CY \d{4})/i)?.[1]).find(Boolean) ?? null;
  const offsetNote = notes.find((n) => /340B remedy offset/i.test(n)) ?? null;
  const m = offsetNote?.match(/ratio\s+(\d*\.\d+)\s+to payments and copayments associated with status indicators\s+([A-Z0-9 ,]+)/i);
  const remedyOffset = m
    ? {
        ratio: Number(m[1]),
        statusIndicators: m[2]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        text: offsetNote!.replace(/^"|"$/g, ""),
      }
    : null;
  const col = columnFinder(rows[headerIdx]);
  const c = {
    si: col("si"),
    weight: col("relative weight"),
    rate: col("payment rate"),
    national: col("national unadjusted copayment"),
    minimum: col("minimum unadjusted copayment"),
    ira: col("ira coinsurance percentage"),
    adjusted: col("adjusted beneficiary copayment"),
    passThrough: col("drug and device pass-through expiration during calendar year"),
    note: col("note"),
  };
  const rates = (row: string[]): OppsRates => ({
    statusIndicator: cell(row, c.si) || null,
    relativeWeight: amount(cell(row, c.weight)),
    paymentRate: amount(cell(row, c.rate)),
    nationalCopay: amount(cell(row, c.national)),
    minimumCopay: amount(cell(row, c.minimum)),
    iraCoinsurancePct: amount(cell(row, c.ira)),
    adjustedCopay: amount(cell(row, c.adjusted)),
    passThroughExpiration: cell(row, c.passThrough) || null,
    note: cell(row, c.note) || null,
  });
  return { rows, headerIdx, col, rates, calendarYear, remedyOffset };
}

export function parseOppsAddendumB(text: string): OppsAddendumB {
  const { rows, headerIdx, col, rates, calendarYear, remedyOffset } = readTable(text, "hcpcs code");
  const codeIdx = col("hcpcs code");
  const apcIdx = col("apc");
  const out: OppsCodeRow[] = [];
  const rejected: Rejected[] = [];
  let excludedCpt = 0;
  let excludedDental = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (isBlankRow(row)) continue;
    const code = cell(row, codeIdx).toUpperCase();
    if (!HCPCS_LEVEL2_RE.test(code)) {
      if (isCptLike(code) || /^\d{4}[A-Z]$/.test(code)) excludedCpt++;
      else if (/^D\d{4}$/.test(code)) excludedDental++;
      else rejected.push({ line: i + 1, reason: "Not a HCPCS code", sample: code.slice(0, 20) });
      continue;
    }
    out.push({ hcpcsCode: code, apc: cell(row, apcIdx) || null, ...rates(row) });
  }
  return { calendarYear, rows: out, excludedCpt, excludedDental, remedyOffset, rejected };
}

export function parseOppsAddendumA(text: string): OppsAddendumA {
  const { rows, headerIdx, col, rates, calendarYear, remedyOffset } = readTable(text, "apc");
  const apcIdx = col("apc");
  const titleIdx = col("group title");
  const out: OppsApcRow[] = [];
  const rejected: Rejected[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (isBlankRow(row)) continue;
    const apc = cell(row, apcIdx);
    if (!/^\d{4}$/.test(apc)) {
      rejected.push({ line: i + 1, reason: "Not an APC number", sample: apc.slice(0, 20) });
      continue;
    }
    out.push({ apc, title: cell(row, titleIdx) || null, ...rates(row) });
  }
  return { calendarYear, rows: out, remedyOffset, rejected };
}
