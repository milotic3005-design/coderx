/**
 * Clinical reference review workflow (indications, ICD-10-CM codes, typical dose). See docs/05-operations.md#clinical-reference.
 *
 *   npm run clinical -- export [draft.json …] [--out review.csv] [--all] [--icd10-file icd10cm-codes-2027.txt]
 *       Writes one CSV row per indication from the drafts (default: every file in data/clinical-drafts/).
 *       Entries already in data/clinical-reference.json are left out unless --all.
 *
 *   npm run clinical -- import <reviewed.csv> [--dry-run] [--icd10-file …]
 *       Adds every APPROVE row (with reviewer and date) to data/clinical-reference.json, replacing entries with the
 *       same Entry ID. Any invalid row aborts the whole import; nothing is written.
 *
 *   npm run clinical -- check [--icd10-file …]
 *       Validates the drafts and the reviewed file; with the CMS code file, also lists codes that are not billable.
 *
 * Exit 0 on success, 1 on any error.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { draftFileSchema, referenceFileSchema, type DraftEntry } from "@/lib/clinical";
import { fromReviewCsv, mergeReviewed, parseIcd10CodeFile, toReviewCsv, unknownIcd10 } from "@/lib/clinical-review";
import { todayUs } from "@/lib/dates";

const ROOT = path.resolve(__dirname, "..");
const DRAFT_DIR = path.join(ROOT, "data/clinical-drafts");
const REFERENCE = path.join(ROOT, "data/clinical-reference.json");

const argv = process.argv.slice(2);
const command = argv[0];
function arg(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const has = (name: string) => argv.includes(name);
const positional = argv.slice(1).filter((a, i, all) => !a.startsWith("--") && !["--out", "--icd10-file"].includes(all[i - 1] ?? ""));

function fail(message: string): never {
  console.error(`clinical: ${message}`);
  process.exit(1);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    fail(`cannot read ${file}: ${(err as Error).message}`);
  }
}

function loadDrafts(files: string[]): DraftEntry[] {
  const all: DraftEntry[] = [];
  for (const file of files) {
    const parsed = draftFileSchema.safeParse(readJson(file));
    if (!parsed.success) fail(`${file}: ${parsed.error.issues.slice(0, 5).map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
    all.push(...parsed.data.entries);
  }
  const ids = all.map((e) => e.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) fail(`duplicate Entry IDs across drafts: ${[...new Set(dupes)].join(", ")}`);
  return all;
}

const allDraftFiles = () =>
  readdirSync(DRAFT_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => path.join(DRAFT_DIR, f));

function loadReference() {
  const parsed = referenceFileSchema.safeParse(readJson(REFERENCE));
  if (!parsed.success) fail(`${REFERENCE} is invalid: ${parsed.error.issues.slice(0, 5).map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
  return parsed.data;
}

function icd10Warnings(entries: Parameters<typeof unknownIcd10>[0]): string[] {
  const file = arg("--icd10-file");
  if (!file) return [];
  const billable = parseIcd10CodeFile(readFileSync(file, "utf8"));
  if (billable.size < 50_000) fail(`${file} lists only ${billable.size} codes; expected the full CMS ICD-10-CM codes or order file`);
  return unknownIcd10(entries, billable);
}

if (command === "export") {
  const drafts = loadDrafts(positional.length ? positional : allDraftFiles());
  const reviewed = new Set(loadReference().entries.map((e) => e.id));
  const pending = has("--all") ? drafts : drafts.filter((d) => !reviewed.has(d.id));
  const out = arg("--out") ?? "clinical-review.csv";
  writeFileSync(out, toReviewCsv(pending));
  const rows = pending.reduce((n, e) => n + e.indications.length, 0);
  console.log(`clinical: wrote ${rows} rows (${pending.length} drugs) to ${out}${drafts.length > pending.length ? `; ${drafts.length - pending.length} already reviewed (use --all to include)` : ""}`);
  for (const w of icd10Warnings(pending)) console.warn(`clinical: not a billable ICD-10-CM code — ${w}`);
} else if (command === "import") {
  const csvFile = positional[0] ?? fail("usage: npm run clinical -- import <reviewed.csv> [--dry-run]");
  const result = fromReviewCsv(readFileSync(csvFile, "utf8"), loadDrafts(allDraftFiles()), todayUs());
  const unknown = icd10Warnings(result.entries);
  const errors = [...result.errors, ...unknown.map((u) => `not a billable ICD-10-CM code — ${u}`)];
  if (errors.length) {
    for (const e of errors) console.error(`clinical: ${e}`);
    fail(`${errors.length} problem(s); nothing was imported. Fix the rows above and run the import again.`);
  }
  const reference = loadReference();
  const merged = mergeReviewed(reference.entries, result.entries);
  console.log(`clinical: ${result.approved} approved, ${result.rejected} rejected, ${result.skipped} not yet reviewed → ${result.entries.length} drug entries (${merged.length} in the reviewed file after import)`);
  if (has("--dry-run")) console.log("clinical: dry run — nothing written");
  else {
    writeFileSync(REFERENCE, JSON.stringify({ ...reference, entries: merged }, null, 2) + "\n");
    console.log(`clinical: wrote ${path.relative(ROOT, REFERENCE)}`);
  }
} else if (command === "check") {
  const drafts = loadDrafts(allDraftFiles());
  const reference = loadReference();
  const unknown = icd10Warnings([...drafts, ...reference.entries]);
  for (const u of unknown) console.warn(`clinical: not a billable ICD-10-CM code — ${u}`);
  console.log(`clinical: ${drafts.length} draft entries and ${reference.entries.length} reviewed entries are valid${arg("--icd10-file") ? `; ${unknown.length} code(s) not in the CMS file` : ""}`);
  if (unknown.length) process.exit(1);
} else {
  fail("usage: npm run clinical -- export|import|check (see scripts/clinical-review.ts)");
}
