/**
 * Parser for CMS NDC–HCPCS crosswalk CSVs (ASP, OPPS, AWP, PrEP, and the 2025
 * NOC crosswalk). These rows are the only basis CodeRx uses for NDC→HCPCS links.
 */
import { HCPCS_LEVEL2_RE, isCptLike } from "@/lib/hcpcs";
import { parseNdc } from "@/lib/ndc";
import { cell, columnFinder, findHeaderRow, isBlankRow, parseCsvRows } from "../csv";
import { numericText, parseEffectiveRange } from "../values";
import type { Rejected } from "./hcpcs";

export type CrosswalkType = "ASP" | "OPPS" | "AWP" | "PREP" | "NOC";

export const CROSSWALK_LABELS: Record<CrosswalkType, string> = {
  ASP: "ASP NDC-HCPCS Crosswalk",
  OPPS: "OPPS NDC-HCPCS Crosswalk",
  AWP: "AWP NDC-HCPCS Crosswalk (vaccines and blood products)",
  PREP: "PrEP NDC-HCPCS Crosswalk",
  NOC: "NOC NDC-HCPCS Crosswalk",
};

/** Classify a crosswalk CSV by its file name; null for files that are not crosswalk tables. */
export function crosswalkTypeFromFileName(name: string): CrosswalkType | null {
  const n = name.toLowerCase();
  if (!n.endsWith(".csv") || !n.includes("crosswalk") || n.includes("introduction")) return null;
  if (/\bprep\b/.test(n)) return "PREP";
  if (/\bopps\b/.test(n)) return "OPPS";
  if (/\bawp\b/.test(n)) return "AWP";
  if (/\bnoc\b/.test(n)) return "NOC";
  if (/\basp\b/.test(n)) return "ASP";
  return null;
}

export interface CrosswalkRowInput {
  crosswalkType: CrosswalkType;
  hcpcsCode: string | null;
  shortDescription: string | null;
  nocGenericName: string | null;
  labelerName: string | null;
  ndcRaw: string;
  ndc11: string | null;
  drugName: string | null;
  hcpcsDosage: string | null;
  packageSize: string | null;
  packageQuantity: string | null;
  billUnitsPerItem: string | null;
  billUnitsPerPackage: string | null;
}

export interface CrosswalkFile {
  type: CrosswalkType;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  rows: CrosswalkRowInput[];
  excludedCpt: number;
  alternateIds: number;
  rejected: Rejected[];
}

export function parseCrosswalkCsv(text: string, type: CrosswalkType): CrosswalkFile {
  const rows = parseCsvRows(text);
  const headerIdx = findHeaderRow(
    rows,
    (k) => (/^_\d{4}_code$/.test(k[0]) || k[0] === "hcpcs code" || k[0] === "drug generic name") && k.includes("labeler name"),
  );
  if (headerIdx < 0) throw new Error(`${CROSSWALK_LABELS[type]}: header row not found.`);
  const preamble = rows.slice(0, headerIdx).map((r) => r.join(" ")).join("\n");
  const effective = parseEffectiveRange(preamble);

  const header = rows[headerIdx];
  const col = columnFinder(header);
  const codeCol = header.findIndex((h) => /^_\d{4}_code$/i.test(h.trim()) || h.trim().toLowerCase() === "hcpcs code");
  const c = {
    code: codeCol,
    generic: col("drug generic name"),
    short: col("short description", "short descriptor"),
    labeler: col("labeler name"),
    ndc: col("ndc", "ndc2", "ndc or alternate id", "11-digit ndc"),
    drug: col("drug name"),
    dosage: col("hcpcs dosage", "dosage"),
    size: col("pkg size"),
    qty: col("pkg qty"),
    units: col("billunits"),
    unitsPkg: col("billunitspkg"),
  };
  if (c.ndc < 0) throw new Error(`${CROSSWALK_LABELS[type]}: NDC column not found.`);

  const out: CrosswalkRowInput[] = [];
  const rejected: Rejected[] = [];
  let excludedCpt = 0;
  let alternateIds = 0;
  const seen = new Set<string>();

  rows.slice(headerIdx + 1).forEach((row, i) => {
    if (isBlankRow(row)) return;
    const lineNo = headerIdx + 2 + i;
    const rawCode = cell(row, c.code).toUpperCase();
    const ndcRaw = cell(row, c.ndc);
    // Repeated header rows appear in some files.
    if (rawCode.startsWith("_20") || rawCode === "HCPCS CODE" || cell(row, c.generic).toLowerCase() === "drug generic name") return;
    if (!ndcRaw) {
      rejected.push({ line: lineNo, reason: "Missing NDC", sample: row.slice(0, 4).join(",") });
      return;
    }
    let hcpcsCode: string | null = null;
    if (type !== "NOC") {
      if (isCptLike(rawCode)) {
        excludedCpt++;
        return;
      }
      if (!HCPCS_LEVEL2_RE.test(rawCode)) {
        rejected.push({ line: lineNo, reason: `Not a HCPCS Level II code: '${rawCode.slice(0, 20)}'`, sample: row.slice(0, 4).join(",") });
        return;
      }
      hcpcsCode = rawCode;
    }
    // Only unambiguous NDC layouts are normalized; anything else is kept verbatim as a CMS alternate ID.
    const parsed = parseNdc(ndcRaw);
    const ndc11 = parsed.kind === "package" ? parsed.ndc11 : null;
    if (!ndc11) alternateIds++;
    const key = `${hcpcsCode ?? cell(row, c.generic)}|${ndcRaw}`;
    if (seen.has(key)) {
      rejected.push({ line: lineNo, reason: `Duplicate row for ${key}`, sample: row.slice(0, 4).join(",") });
      return;
    }
    seen.add(key);
    out.push({
      crosswalkType: type,
      hcpcsCode,
      shortDescription: cell(row, c.short) || null,
      nocGenericName: type === "NOC" ? cell(row, c.generic) || null : null,
      labelerName: cell(row, c.labeler).replace(/\s+/g, " ") || null,
      ndcRaw,
      ndc11,
      drugName: cell(row, c.drug).replace(/\s+/g, " ") || null,
      hcpcsDosage: cell(row, c.dosage) || null,
      packageSize: numericText(cell(row, c.size)),
      packageQuantity: numericText(cell(row, c.qty)),
      billUnitsPerItem: numericText(cell(row, c.units)),
      billUnitsPerPackage: numericText(cell(row, c.unitsPkg)),
    });
  });

  return {
    type,
    effectiveStart: effective?.start ?? null,
    effectiveEnd: effective?.end ?? null,
    rows: out,
    excludedCpt,
    alternateIds,
    rejected,
  };
}
