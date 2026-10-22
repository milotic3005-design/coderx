/**
 * Parser for state Medicaid fee schedules published as spreadsheets, starting with
 * the Washington HCA "Home Infusion Therapy/Parenteral Nutrition Program" schedule:
 * a title block ("Effective July 1, 2026"), then a header row with Code, Modifier,
 * one "Maximum Allowable Fee <area>" column per payment area, PA/EPA, and Comments.
 * CPT rows (AMA-copyrighted) are counted and dropped.
 */
import { HCPCS_LEVEL2_RE, isCptLike } from "@/lib/hcpcs";
import type { Rejected } from "./hcpcs";

export interface StateFee {
  area: string;
  /** Normalized decimal string, or null when the cell is text such as "BR" or "N/A". */
  amount: string | null;
  /** The cell as published (amounts rounded to 4 decimals to drop float artifacts). */
  text: string;
}

export interface StateFeeRow {
  hcpcsCode: string;
  modifier: string | null;
  statusIndicator: string | null;
  fees: StateFee[];
  priorAuth: string | null;
  comments: string | null;
}

export interface StateFeeSchedule {
  program: string | null;
  effectiveDate: string | null;
  rows: StateFeeRow[];
  excludedCpt: number;
  rejected: Rejected[];
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "Effective July 1, 2026" → "2026-07-01". */
export function effectiveDateOf(text: string): string | null {
  const m = text.match(/effective\s+([a-z]+)\s+(\d{1,2}),\s*(\d{4})/i);
  const month = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  return m && month >= 0 ? `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

/** "Maximum Allowable Fee NonRural *" → "Non-rural"; "Maximum Allowable Fee Seattle CBA*" → "Seattle CBA". */
function areaLabel(header: string): string {
  const area = header.replace(/maximum allowable fee/i, "").replace(/\*/g, "").replace(/\s+/g, " ").trim();
  return /^non-?rural$/i.test(area) ? "Non-rural" : area || "Statewide";
}

function feeCell(raw: string): Pick<StateFee, "amount" | "text"> {
  const text = raw.trim();
  if (/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(text)) {
    const amount = String(Number(Number(text).toFixed(4)));
    return { amount, text: amount };
  }
  return { amount: null, text };
}

const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

export function parseStateFeeSchedule(rows: string[][]): StateFeeSchedule {
  const titleRows = rows.slice(0, 10).map((r) => r.filter(Boolean).join(" "));
  const effectiveDate = titleRows.map(effectiveDateOf).find(Boolean) ?? null;
  const program = titleRows.find((t) => /program/i.test(t) && !/effective/i.test(t))?.trim() ?? null;

  const headerIdx = rows.findIndex((r) => r.some((c) => norm(c) === "code") && r.some((c) => norm(c) === "modifier"));
  if (headerIdx < 0) throw new Error("Fee schedule: header row with 'Code' and 'Modifier' not found.");
  const header = rows[headerIdx];
  const find = (test: (h: string) => boolean) => header.findIndex((h) => test(norm(h)));
  const c = {
    status: find((h) => h.includes("status indicator")),
    code: find((h) => h === "code"),
    modifier: find((h) => h === "modifier"),
    auth: find((h) => h === "pa/epa" || h.startsWith("pa required")),
    comments: find((h) => h === "comments"),
  };
  const feeCols = header.flatMap((h, i) => (/^maximum allowable fee/i.test(h.trim()) ? [{ i, area: areaLabel(h) }] : []));
  if (!feeCols.length) throw new Error("Fee schedule: no 'Maximum Allowable Fee' columns found.");

  const out: StateFeeRow[] = [];
  const rejected: Rejected[] = [];
  const seen = new Set<string>();
  let excludedCpt = 0;

  rows.slice(headerIdx + 1).forEach((row, i) => {
    const lineNo = headerIdx + 2 + i;
    const code = (row[c.code] ?? "").trim().toUpperCase();
    if (!code) return;
    if (isCptLike(code)) {
      excludedCpt++;
      return;
    }
    if (!HCPCS_LEVEL2_RE.test(code)) {
      rejected.push({ line: lineNo, reason: `Not a HCPCS Level II code: '${code.slice(0, 20)}'`, sample: row.slice(0, 4).join(",") });
      return;
    }
    const modifier = (row[c.modifier] ?? "").trim().toUpperCase() || null;
    const key = `${code}|${modifier ?? ""}`;
    if (seen.has(key)) {
      rejected.push({ line: lineNo, reason: `Duplicate code and modifier ${code}${modifier ? `-${modifier}` : ""}`, sample: row.slice(0, 4).join(",") });
      return;
    }
    seen.add(key);
    const text = (idx: number) => (idx >= 0 ? (row[idx] ?? "").replace(/\s+/g, " ").trim() || null : null);
    out.push({
      hcpcsCode: code,
      modifier,
      statusIndicator: text(c.status),
      fees: feeCols.map(({ i: idx, area }) => ({ area, ...feeCell(row[idx] ?? "") })),
      priorAuth: text(c.auth),
      comments: text(c.comments),
    });
  });

  return { program, effectiveDate, rows: out, excludedCpt, rejected };
}
