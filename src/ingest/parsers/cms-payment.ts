/**
 * Parsers for the CMS Medicare Part B Drug Payment Limit File (Section 508 CSV;
 * named "ASP Pricing File" through 2025) and the "Drugs Not Payable Under Part B"
 * list. CPT rows (AMA-copyrighted) are counted and dropped.
 */
import { HCPCS_LEVEL2_RE, isCptLike } from "@/lib/hcpcs";
import { cell, columnFinder, findHeaderRow, isBlankRow, parseCsvRows } from "../csv";
import { numericText, parseEffectiveRange, parseNumber } from "../values";
import type { Rejected } from "./hcpcs";

export interface PaymentLimitRow {
  hcpcsCode: string;
  shortDescription: string | null;
  dosageDescriptor: string | null;
  paymentLimit: string | null;
  /** The published cell when it is not a number (e.g. "N/A"); shown verbatim. */
  paymentLimitText: string | null;
  coinsurancePct: string | null;
  vaccineAwpPct: string | null;
  vaccineLimit: string | null;
  bloodAwpPct: string | null;
  bloodLimit: string | null;
  clottingFactor: string | null;
  notes: string | null;
  methodology: string;
}

export interface PaymentLimitFile {
  effectiveStart: string | null;
  effectiveEnd: string | null;
  aspDataPeriod: string | null;
  rows: PaymentLimitRow[];
  excludedCpt: number;
  rejected: Rejected[];
}

/**
 * A plain-language label for how CMS set the limit, read only from the file's own
 * columns and notes. The CMS note text is always shown verbatim next to it.
 */
export function deriveMethodology(row: {
  vaccineAwpPct: string | null;
  bloodAwpPct: string | null;
  notes: string | null;
}): string {
  const notes = (row.notes ?? "").toLowerCase();
  if (row.vaccineAwpPct) return `${row.vaccineAwpPct}% of AWP (vaccine; per CMS file)`;
  if (row.bloodAwpPct) return `${row.bloodAwpPct}% of AWP (blood product; per CMS file)`;
  if (notes.includes("amp-based")) return "AMP-based payment limit (per CMS note)";
  if (notes.includes("wac")) return "WAC-based payment limit (per CMS note)";
  if (notes.includes("lesser of")) return "“Lesser of” methodology applied (per CMS note)";
  if (notes.includes("8% of reference")) return "Biosimilar: 8% of reference product add-on applied (per CMS note)";
  return "ASP methodology (per CMS file)";
}

export function parsePaymentLimitCsv(text: string): PaymentLimitFile {
  const rows = parseCsvRows(text);
  const headerIdx = findHeaderRow(rows, (k) => k[0] === "hcpcs code" && k.includes("payment limit"));
  if (headerIdx < 0) throw new Error("Payment limit file: header row with 'HCPCS Code' and 'Payment Limit' not found.");

  const preamble = rows.slice(0, headerIdx).map((r) => r.join(" ")).join("\n");
  const effective = parseEffectiveRange(preamble);
  const aspMatch = preamble.match(/based on\s+([1-4])Q(\d{2})\s+ASP data/i);
  const aspDataPeriod = aspMatch ? `20${aspMatch[2]}-Q${aspMatch[1]}` : null;

  const col = columnFinder(rows[headerIdx]);
  const c = {
    code: col("hcpcs code"),
    short: col("short description", "short descriptor"),
    dosage: col("hcpcs code dosage", "hcpcs dosage"),
    limit: col("payment limit"),
    coins: col("co-insurance percentage", "coinsurance percentage"),
    vAwp: col("vaccine awp%", "vaccine awp %"),
    vLimit: col("vaccine limit"),
    bAwp: col("blood awp%", "blood awp %"),
    bLimit: col("blood limit"),
    clot: col("clotting factor"),
    notes: col("notes"),
  };

  const out: PaymentLimitRow[] = [];
  const rejected: Rejected[] = [];
  let excludedCpt = 0;
  const seen = new Set<string>();

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
    if (seen.has(code)) {
      rejected.push({ line: lineNo, reason: `Duplicate code ${code}`, sample: row.slice(0, 3).join(",") });
      return;
    }
    const limitRaw = cell(row, c.limit);
    const limitNum = parseNumber(limitRaw);
    if (limitNum !== null && !Number.isNaN(limitNum) && limitNum < 0) {
      rejected.push({ line: lineNo, reason: `Negative payment limit '${limitRaw}' for ${code}`, sample: row.slice(0, 4).join(",") });
      return;
    }
    // Non-numeric cells such as "N/A" are kept as published text, never coerced to a number.
    const paymentLimitText = limitNum !== null && Number.isNaN(limitNum) ? limitRaw : null;
    seen.add(code);
    const partial = {
      vaccineAwpPct: numericText(cell(row, c.vAwp)),
      bloodAwpPct: numericText(cell(row, c.bAwp)),
      notes: cell(row, c.notes).replace(/\s+/g, " ") || null,
    };
    out.push({
      hcpcsCode: code,
      shortDescription: cell(row, c.short) || null,
      dosageDescriptor: cell(row, c.dosage) || null,
      paymentLimit: numericText(limitRaw),
      paymentLimitText,
      coinsurancePct: numericText(cell(row, c.coins)),
      vaccineLimit: numericText(cell(row, c.vLimit)),
      bloodLimit: numericText(cell(row, c.bLimit)),
      clottingFactor: cell(row, c.clot) || null,
      ...partial,
      methodology: deriveMethodology(partial),
    });
  });

  return {
    effectiveStart: effective?.start ?? null,
    effectiveEnd: effective?.end ?? null,
    aspDataPeriod,
    rows: out,
    excludedCpt,
    rejected,
  };
}

export interface NotPayableRow {
  hcpcsCode: string;
  description: string | null;
  manufacturer: string | null;
}

export function parseNotPayableCsv(text: string): { effectiveStart: string | null; effectiveEnd: string | null; rows: NotPayableRow[] } {
  const rows = parseCsvRows(text);
  const headerIdx = findHeaderRow(rows, (k) => k[0] === "hcpcs code" && k.includes("manufacturer"));
  if (headerIdx < 0) throw new Error("Not-payable file: header row not found.");
  const preamble = rows.slice(0, headerIdx).map((r) => r.join(" ")).join("\n");
  const effective = parseEffectiveRange(preamble);
  const col = columnFinder(rows[headerIdx]);
  const ci = { code: col("hcpcs code"), desc: col("long description", "short description"), mfr: col("manufacturer") };
  const out: NotPayableRow[] = [];
  for (const row of rows.slice(headerIdx + 1)) {
    const code = cell(row, ci.code).toUpperCase();
    if (!HCPCS_LEVEL2_RE.test(code)) continue;
    out.push({ hcpcsCode: code, description: cell(row, ci.desc) || null, manufacturer: cell(row, ci.mfr).replace(/\s+/g, " ") || null });
  }
  return { effectiveStart: effective?.start ?? null, effectiveEnd: effective?.end ?? null, rows: out };
}
