/**
 * Parser for the CMS NCCI Medically Unlikely Edit (MUE) tables (Practitioner,
 * Facility Outpatient Hospital, and DME Supplier services). The CSV opens with the
 * AMA copyright notice, then a header row; CPT rows (AMA-copyrighted) are counted
 * and dropped, so only HCPCS Level II values are kept.
 */
import { HCPCS_LEVEL2_RE, isCptLike } from "@/lib/hcpcs";
import { cell, columnFinder, findHeaderRow, isBlankRow, parseCsvRows } from "../csv";
import type { Rejected } from "./hcpcs";

export interface MueRow {
  hcpcsCode: string;
  mueValue: number;
  adjudicationIndicator: number | null;
  adjudicationText: string | null;
  rationale: string | null;
}

export interface MueFile {
  rows: MueRow[];
  excludedCpt: number;
  rejected: Rejected[];
  /** Column header as published, e.g. "Practitioner Services MUE Values". */
  valueColumn: string;
}

/** "MCR_MUE_PractitionerServices_Eff_10-01-2026.csv" → "2026-10-01". */
export function mueEffectiveDate(fileName: string): string | null {
  const m = fileName.match(/Eff_(\d{2})-(\d{2})-(\d{4})/i);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

export function parseMueCsv(text: string): MueFile {
  const rows = parseCsvRows(text);
  const headerIdx = findHeaderRow(rows, (k) => /^hcpcs\/?\s*cpt code$/.test(k[0] ?? "") && k.some((x) => x.endsWith("mue values")));
  if (headerIdx < 0) throw new Error("MUE table: header row with 'HCPCS/CPT Code' and '… MUE Values' not found.");
  const header = rows[headerIdx];
  const col = columnFinder(header);
  const valueIdx = header.findIndex((h) => /mue values$/i.test(h.trim().replace(/\s+/g, " ")));
  const c = { code: 0, value: valueIdx, mai: col("mue adjudication indicator"), rationale: col("mue rationale") };

  const out: MueRow[] = [];
  const rejected: Rejected[] = [];
  const seen = new Set<string>();
  let excludedCpt = 0;

  rows.slice(headerIdx + 1).forEach((row, i) => {
    if (isBlankRow(row)) return;
    const lineNo = headerIdx + 2 + i;
    const code = cell(row, c.code).toUpperCase();
    if (!code) return;
    if (isCptLike(code)) {
      excludedCpt++;
      return;
    }
    if (!HCPCS_LEVEL2_RE.test(code)) {
      rejected.push({ line: lineNo, reason: `Not a HCPCS Level II code: '${code.slice(0, 20)}'`, sample: row.slice(0, 3).join(",") });
      return;
    }
    const valueRaw = cell(row, c.value);
    if (!/^\d+$/.test(valueRaw)) {
      rejected.push({ line: lineNo, reason: `MUE value is not a whole number: '${valueRaw}' for ${code}`, sample: row.slice(0, 4).join(",") });
      return;
    }
    if (seen.has(code)) {
      rejected.push({ line: lineNo, reason: `Duplicate code ${code}`, sample: row.slice(0, 3).join(",") });
      return;
    }
    seen.add(code);
    const maiText = cell(row, c.mai).replace(/\s+/g, " ") || null;
    const mai = maiText?.match(/^([123])\b/);
    out.push({
      hcpcsCode: code,
      mueValue: Number(valueRaw),
      adjudicationIndicator: mai ? Number(mai[1]) : null,
      adjudicationText: maiText,
      rationale: cell(row, c.rationale).replace(/\s+/g, " ") || null,
    });
  });

  return { rows: out, excludedCpt, rejected, valueColumn: header[valueIdx]?.trim() ?? "" };
}
