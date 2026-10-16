/**
 * Parse pasted or uploaded chargemaster / formulary lines into HCPCS and NDC tokens.
 * Runs in the browser (nothing is uploaded until the user runs the audit) and again
 * on the server for validation. Lines without a code or NDC are reported, not guessed.
 */
import { normalizeHcpcs } from "./hcpcs";
import { parseNdc } from "./ndc";

export const MAX_AUDIT_ITEMS = 500;

export interface AuditInputLine {
  line: number;
  raw: string;
  hcpcs: string | null;
  ndcRaw: string | null;
  ndc11: string | null;
  /** First numeric cell after the code/NDC, e.g. an acquisition cost (used by the margin analyzer). */
  amount: number | null;
  problems: string[];
}

const HCPCS_TOKEN = /^[A-Za-z]\d{4}$/;
const NDC_TOKEN = /^\d{4,5}-\d{3,4}-\d{1,2}$|^\d{10,11}$/;
const AMOUNT_TOKEN = /^\$?\d{1,9}(,\d{3})*(\.\d+)?$/;

/** Split on commas, tabs, semicolons, or pipes; keep quoted cells together. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && /[,\t;|]/.test(ch)) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

export function parseAuditText(text: string): AuditInputLine[] {
  const out: AuditInputLine[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (!raw.trim()) return;
    const tokens = cells(raw).flatMap((c) => (/\s/.test(c) && !/[A-Za-z]{2,}/.test(c) ? c.split(/\s+/) : [c]));
    let hcpcs: string | null = null;
    let ndcRaw: string | null = null;
    let ndc11: string | null = null;
    let amount: number | null = null;
    const problems: string[] = [];
    for (const t of tokens) {
      if (!hcpcs && HCPCS_TOKEN.test(t)) {
        hcpcs = normalizeHcpcs(t);
        if (!hcpcs) problems.push(`“${t}” is not a HCPCS Level II code.`);
        continue;
      }
      if (!ndcRaw && NDC_TOKEN.test(t)) {
        ndcRaw = t;
        const p = parseNdc(t);
        if (p.kind === "package") ndc11 = p.ndc11;
        else if (p.kind === "ambiguous") problems.push(`NDC “${t}” is ambiguous without hyphens; use the 10-digit form with hyphens or the 11-digit form.`);
        else if (p.kind === "invalid") problems.push(`NDC “${t}”: ${p.reason}`);
        else problems.push(`“${t}” is a product NDC; use the full package NDC.`);
        continue;
      }
      if (amount == null && (hcpcs || ndcRaw) && AMOUNT_TOKEN.test(t)) amount = Number(t.replace(/[$,]/g, ""));
    }
    if (!hcpcs && !ndcRaw) return; // header or descriptive line
    out.push({ line: i + 1, raw: raw.slice(0, 200), hcpcs, ndcRaw, ndc11, amount, problems });
  });
  return out;
}
