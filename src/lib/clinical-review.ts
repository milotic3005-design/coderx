/**
 * Review round trip for the clinical reference (pure functions; file I/O lives in scripts/clinical-review.ts).
 *
 *   drafts (data/clinical-drafts/*.json) → review CSV (one row per indication) → reviewer marks APPROVE/REJECT,
 *   signs, dates, and may edit the text → import → data/clinical-reference.json (shown on the site).
 *
 * Nothing reaches the reviewed file without a decision, a reviewer, and a date on the row, and an import with any
 * invalid row changes nothing.
 */
import Papa from "papaparse";
import { columnFinder, cell, isBlankRow } from "@/ingest/csv";
import { HCPCS_LEVEL2_RE } from "./hcpcs";
import { ICD10CM_RE, reviewedEntrySchema, type ClinicalEntry, type DraftEntry } from "./clinical";

export const REVIEW_COLUMNS = {
  id: "Entry ID",
  drug: "Drug",
  hcpcs: "HCPCS codes",
  condition: "Indication (FDA label)",
  icd10: "ICD-10-CM codes",
  dose: "Typical adult dose",
  draftNotes: "Draft notes (not published)",
  evidence: "Evidence URL",
  decision: "Decision (APPROVE or REJECT)",
  reviewer: "Reviewer name and credentials",
  reviewedOn: "Review date (YYYY-MM-DD)",
  comment: "Reviewer comment (optional, published)",
} as const;

type Column = keyof typeof REVIEW_COLUMNS;
const ORDER = Object.keys(REVIEW_COLUMNS) as Column[];

/** "A41.01 — Sepsis due to MSSA; A41.02 — …" */
export function formatIcd10List(codes: { code: string; description?: string }[]): string {
  return codes.map((c) => (c.description ? `${c.code} — ${c.description}` : c.code)).join("; ");
}

/** Inverse of formatIcd10List; tolerant of en/em dashes, hyphens, lower case, and line breaks. Throws on a bad code. */
export function parseIcd10List(text: string): { code: string; description?: string }[] {
  return text
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const m = item.match(/^([A-Za-z][0-9][0-9A-Za-z](?:\.[0-9A-Za-z]{1,4})?)(?:\s*[—–-]\s*|\s+|$)(.*)$/);
      const code = m?.[1].toUpperCase();
      if (!m || !code || !ICD10CM_RE.test(code)) throw new Error(`“${item}” does not start with an ICD-10-CM code (e.g. A41.9)`);
      const description = m[2].trim();
      return description ? { code, description } : { code };
    });
}

/** Accepts YYYY-MM-DD and the US M/D/YYYY that Excel writes back; returns YYYY-MM-DD or null. */
export function normalizeReviewDate(text: string): string | null {
  const t = text.trim();
  let y: number, m: number, d: number;
  let match = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Review CSV text (UTF-8 with BOM so Excel on Windows and Mac shows µ, ², and dashes correctly). */
export function toReviewCsv(drafts: DraftEntry[]): string {
  const rows: string[][] = [ORDER.map((k) => REVIEW_COLUMNS[k])];
  for (const e of drafts) {
    for (const ind of e.indications) {
      const values: Record<Column, string> = {
        id: e.id,
        drug: e.drug,
        hcpcs: e.hcpcs.join(", "),
        condition: ind.condition,
        icd10: formatIcd10List(ind.icd10),
        dose: ind.dose,
        draftNotes: e.notes ?? "",
        evidence: e.evidence.map((x) => x.url).join(" "),
        decision: "",
        reviewer: "",
        reviewedOn: "",
        comment: "",
      };
      rows.push(ORDER.map((k) => values[k]));
    }
  }
  return "﻿" + Papa.unparse(rows, { newline: "\r\n" });
}

export interface ImportResult {
  entries: ClinicalEntry[];
  approved: number;
  rejected: number;
  skipped: number;
  errors: string[];
}

/**
 * Turn a reviewed CSV into reviewed entries. Rows must belong to a known draft (by Entry ID); evidence labels come
 * from the draft, so a reviewer can only swap in another https URL, not invent a label. `today` bounds the review date.
 */
export function fromReviewCsv(text: string, drafts: DraftEntry[], today: string): ImportResult {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: false }).data;
  const result: ImportResult = { entries: [], approved: 0, rejected: 0, skipped: 0, errors: [] };
  if (!parsed.length) return { ...result, errors: ["The file is empty."] };
  const col = columnFinder(parsed[0]);
  const idx = Object.fromEntries(ORDER.map((k) => [k, col(REVIEW_COLUMNS[k].toLowerCase())])) as Record<Column, number>;
  const missing = ORDER.filter((k) => k !== "draftNotes" && k !== "comment" && idx[k] < 0).map((k) => `“${REVIEW_COLUMNS[k]}”`);
  if (missing.length) return { ...result, errors: [`Missing column(s): ${missing.join(", ")}. Export a fresh file and keep the header row as is.`] };

  const draftById = new Map(drafts.map((d) => [d.id, d]));
  const grouped = new Map<string, { draft: DraftEntry; hcpcs: string; drug: string; evidence: string; reviewers: Set<string>; dates: string[]; comments: string[]; indications: ClinicalEntry["indications"] }>();

  parsed.slice(1).forEach((row, i) => {
    if (isBlankRow(row)) return;
    const line = i + 2; // 1-based, after the header — matches the row number Excel shows
    const get = (k: Column) => cell(row, idx[k]);
    const decision = get("decision").toUpperCase();
    if (!decision) return void result.skipped++;
    if (decision === "REJECT") return void result.rejected++;
    if (decision !== "APPROVE") return void result.errors.push(`Row ${line}: decision must be APPROVE, REJECT, or blank (found “${get("decision")}”).`);

    const id = get("id");
    const draft = draftById.get(id);
    if (!draft) return void result.errors.push(`Row ${line}: Entry ID “${id}” is not in any draft file.`);
    const reviewer = get("reviewer");
    if (reviewer.length < 3) return void result.errors.push(`Row ${line}: approved rows need the reviewer's name and credentials.`);
    const date = normalizeReviewDate(get("reviewedOn"));
    if (!date) return void result.errors.push(`Row ${line}: review date “${get("reviewedOn")}” is not a date (use YYYY-MM-DD).`);
    if (date > today) return void result.errors.push(`Row ${line}: review date ${date} is in the future.`);

    const hcpcs = get("hcpcs").toUpperCase().split(/[\s,;]+/).filter(Boolean);
    const badHcpcs = hcpcs.filter((c) => !HCPCS_LEVEL2_RE.test(c));
    if (!hcpcs.length || badHcpcs.length) return void result.errors.push(`Row ${line}: “${badHcpcs.join(", ") || "(empty)"}” is not a HCPCS Level II code.`);
    let icd10: ClinicalEntry["indications"][number]["icd10"];
    try {
      icd10 = parseIcd10List(get("icd10"));
    } catch (err) {
      return void result.errors.push(`Row ${line}: ${(err as Error).message}.`);
    }
    if (!icd10.length) return void result.errors.push(`Row ${line}: at least one ICD-10-CM code is required.`);
    const evidence = get("evidence");
    if (!/^https:\/\/\S+$/.test(evidence.split(/\s+/)[0] ?? "")) return void result.errors.push(`Row ${line}: evidence must be an https URL.`);

    const g = grouped.get(id) ?? { draft, hcpcs: hcpcs.join(","), drug: get("drug"), evidence, reviewers: new Set(), dates: [], comments: [], indications: [] };
    if (g.hcpcs !== hcpcs.join(",")) return void result.errors.push(`Row ${line}: HCPCS codes differ from an earlier row of “${id}”; one entry has one code list.`);
    g.reviewers.add(reviewer);
    g.dates.push(date);
    if (get("comment")) g.comments.push(get("comment"));
    g.indications.push({ condition: get("condition"), icd10, dose: get("dose") });
    grouped.set(id, g);
    result.approved++;
  });

  for (const [id, g] of grouped) {
    const urls = g.evidence.split(/\s+/).filter(Boolean);
    const candidate = {
      id,
      drug: g.drug,
      hcpcs: g.hcpcs.split(","),
      indications: g.indications,
      evidence: urls.map((url) => ({ label: g.draft.evidence.find((x) => x.url === url)?.label ?? "Evidence cited by the reviewer", url })),
      ...(g.comments.length ? { notes: [...new Set(g.comments)].join(" ") } : {}),
      reviewer: [...g.reviewers].join("; "),
      reviewedAt: g.dates.sort().at(-1)!,
    };
    const checked = reviewedEntrySchema.safeParse(candidate);
    if (checked.success) result.entries.push(checked.data);
    else result.errors.push(`Entry “${id}”: ${checked.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}.`);
  }
  return result;
}

/** Replace entries with the same id; keep the rest; stable order by id. */
export function mergeReviewed(existing: ClinicalEntry[], incoming: ClinicalEntry[]): ClinicalEntry[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Billable codes from the CMS ICD-10-CM release: either the codes file (“A000    Cholera …”, billable only) or the
 * order file (“00001 A00     0 Cholera …”, where the header flag 1 marks billable). Codes are stored without the dot.
 */
export function parseIcd10CodeFile(text: string): Set<string> {
  const codes = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const order = line.match(/^\d{5}\s+([A-Z0-9]{3,7})\s+([01])\s/);
    if (order) {
      if (order[2] === "1") codes.add(order[1]);
      continue;
    }
    const plain = line.match(/^([A-Z][0-9][0-9A-Z][0-9A-Z]{0,4})\s/);
    if (plain) codes.add(plain[1]);
  }
  return codes;
}

/** ICD-10-CM codes in these entries that are not billable codes in the given CMS release. */
export function unknownIcd10(entries: { id: string; indications: { icd10: { code: string }[] }[] }[], billable: Set<string>): string[] {
  const out: string[] = [];
  for (const e of entries) for (const ind of e.indications) for (const c of ind.icd10) if (!billable.has(c.code.replace(".", ""))) out.push(`${e.id}: ${c.code}`);
  return [...new Set(out)];
}
