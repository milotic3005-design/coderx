/**
 * Monthly payer site-of-care refresh, run on the operator's Mac (scripts/soc-policies-launchd.sh).
 *
 *   npm run refresh:soc-policies -- [--base-url https://<domain>] [--only uhc,premera] [--force] [--dry-run]
 *
 * For each payer in src/ingest/soc-policies.ts: downloads its public policy document and drug list (only the files
 * listed there, which the payers' robots.txt allow; Cigna's drug list is not fetched), reads the effective date,
 * criteria wording and drug list, and for Premera any version posted ahead of its effective date. Checks the lists
 * against minimum sizes, then uploads gzip-compressed to /api/admin/soc-policies with CODERX_ADMIN_TOKEN (from the
 * environment or .env.production.local). Prints what changed, and which payers' criteria wording now differs from
 * the wording the rules in src/lib/soc/rules.ts were written from (those need a pharmacist's review).
 *
 * Exit 0 when every payer was imported or skipped, 1 otherwise. Exit 0 with "REVIEW NEEDED" lines when wording changed.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { gzipSync } from "node:zlib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { USER_AGENT } from "@/ingest/fetch";
import {
  criteriaFingerprint,
  criteriaSection,
  htmlText,
  MIN_ENTRIES,
  parseAetnaXml,
  parseDate,
  parsePremeraCodes,
  parseRegenceTable,
  parseUhcCodeList,
  policyFacts,
  premeraFutureLinks,
  premeraUpdatePages,
  quoteInText,
  SOC_PAYER_KEYS,
  SOC_PAYERS,
  socUploadSchema,
  type SocChanges,
  type SocEntry,
  type SocPayerKey,
  type SocUpload,
} from "@/ingest/soc-policies";
import { SOC_RULES } from "@/lib/soc/rules";

const UPLOAD_MAX_BYTES = 4_000_000;
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (name: string) => process.argv.includes(name);
const log = (m: string) => console.log(`soc-policies: ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

/**
 * One request at a time, a second apart, with CodeRx's identifying user agent. Redirects are not followed: only the
 * listed URLs (checked against each site's robots.txt) are fetched, so a moved file is reported for a person to check.
 */
async function fetchBytes(url: string): Promise<{ bytes: Uint8Array; status: number; location: string | null }> {
  await sleep(1000);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "*/*" }, redirect: "manual", signal: AbortSignal.timeout(60_000) });
  return { bytes: new Uint8Array(await res.arrayBuffer()), status: res.status, location: res.headers.get("location") };
}
async function fetchOk(url: string): Promise<Uint8Array> {
  const { bytes, status, location } = await fetchBytes(url);
  if (status >= 300 && status < 400) throw new Error(`${url}: moved (HTTP ${status}) to ${location ?? "an unstated address"}; check that robots.txt allows it, then update the URL in src/ingest/soc-policies.ts.`);
  if (status !== 200) throw new Error(`${url}: HTTP ${status}`);
  return bytes;
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const c = await (await doc.getPage(n)).getTextContent();
    pages.push(c.items.map((i) => ("str" in i ? i.str + (i.hasEOL ? "\n" : "") : "")).join(""));
  }
  return pages.join("\n\f\n");
}

type Doc = SocUpload["documents"][number];

async function policyDocument(payer: SocPayerKey, url: string, role: "policy" | "future"): Promise<{ doc: Doc; text: string }> {
  const source = SOC_PAYERS[payer].policy;
  const bytes = await fetchOk(url);
  const text = source.kind === "pdf" ? await pdfText(bytes) : htmlText(new TextDecoder().decode(bytes));
  const facts = policyFacts(payer, text);
  const criteria = criteriaSection(payer, text);
  if (!criteria) throw new Error(`${payer}: the criteria section was not found in ${url}; the layout may have changed.`);
  const entries: SocEntry[] = payer === "premera" ? parsePremeraCodes(text) : payer === "regence" ? parseRegenceTable(text) : [];
  return { doc: { role, url, title: facts.title, policyNumber: facts.policyNumber, effectiveDate: facts.effectiveDate, sha256: sha(bytes), criteriaText: criteria, criteriaHash: criteriaFingerprint(criteria), entries }, text };
}

async function listDocument(payer: SocPayerKey): Promise<Doc | null> {
  const list = SOC_PAYERS[payer].list;
  if (!list.url) return null;
  const bytes = await fetchOk(list.url);
  if (list.kind === "uhc-code-list") {
    const text = await pdfText(bytes);
    const date = parseDate(/Last Updated:\s*([A-Za-z]+ \d{1,2}, \d{4})/.exec(text)?.[1]);
    return { role: "list", url: list.url, title: "Provider Administered Drugs – Site of Care: Applicable Medications", policyNumber: null, effectiveDate: date, sha256: sha(bytes), criteriaText: null, criteriaHash: null, entries: parseUhcCodeList(text) };
  }
  if (list.kind === "aetna-xml") {
    const { entries, generated } = parseAetnaXml(new TextDecoder().decode(bytes));
    return { role: "list", url: list.url, title: "Aetna site-of-care drug therapies", policyNumber: null, effectiveDate: generated, sha256: sha(bytes), criteriaText: null, criteriaHash: null, entries };
  }
  return null;
}

/** Premera versions linked from its monthly "policy updates" pages whose effective date is still ahead. */
async function premeraFuture(today: string): Promise<Doc[]> {
  const links = new Map<string, string>();
  for (const page of premeraUpdatePages(new Date(`${today}T00:00:00Z`))) {
    const { bytes, status } = await fetchBytes(page);
    if (status !== 200) continue; // next month's page may not exist yet
    for (const l of premeraFutureLinks(new TextDecoder().decode(bytes))) if (l.effectiveDate > today) links.set(l.url, l.effectiveDate);
  }
  const out: Doc[] = [];
  for (const [url, effectiveDate] of links) {
    const { doc } = await policyDocument("premera", url, "future");
    out.push({ ...doc, effectiveDate: doc.effectiveDate ?? effectiveDate });
  }
  return out;
}

function adminToken(): string {
  if (process.env.CODERX_ADMIN_TOKEN) return process.env.CODERX_ADMIN_TOKEN;
  const file = ".env.production.local";
  const token = existsSync(file) ? parseEnv(readFileSync(file, "utf8")).CODERX_ADMIN_TOKEN : undefined;
  if (!token) throw new Error("Set CODERX_ADMIN_TOKEN or add it to .env.production.local.");
  return token;
}

async function main() {
  const base = (arg("--base-url") ?? "https://coderxnsl.vercel.app").replace(/\/$/, "");
  const only = arg("--only") ? (arg("--only")!.split(",") as SocPayerKey[]) : SOC_PAYER_KEYS;
  const dryRun = has("--dry-run");
  const today = new Date().toISOString().slice(0, 10);
  const token = dryRun ? "" : adminToken();
  let failed = 0;
  const review: string[] = [];
  const changed: string[] = [];

  for (const payer of only) {
    if (!SOC_PAYERS[payer]) throw new Error(`Unknown payer "${payer}". Use: ${SOC_PAYER_KEYS.join(", ")}`);
    try {
      const { doc: policy, text: policyText } = await policyDocument(payer, SOC_PAYERS[payer].policy.url, "policy");
      const list = await listDocument(payer);
      const future = payer === "premera" ? await premeraFuture(today) : [];
      const documents = [policy, ...(list ? [list] : []), ...future];
      const listed = (list ?? policy).entries.length;
      const minimum = MIN_ENTRIES[payer];
      if (minimum && listed < minimum) throw new Error(`read only ${listed} drug-list entries (expected at least ${minimum}); the layout may have changed. Nothing uploaded.`);
      for (const f of future) if (minimum && f.entries.length < minimum) throw new Error(`read only ${f.entries.length} entries from the version effective ${f.effectiveDate} (expected at least ${minimum}); the layout may have changed. Nothing uploaded.`);
      const fingerprint = sha(JSON.stringify(documents.map(({ role, url, effectiveDate, criteriaHash, entries }) => ({ role, url, effectiveDate, criteriaHash, entries }))));
      const body: SocUpload = { payerKey: payer, sha256: fingerprint, documents, force: has("--force") };
      const parsed = socUploadSchema.safeParse(body);
      if (!parsed.success) throw new Error(`does not match the upload schema: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      const rule = SOC_RULES[payer];
      if (policy.criteriaHash !== rule.writtenFrom.criteriaHash) review.push(`${rule.name}: criteria wording differs from the version the rule was written from (${rule.writtenFrom.effectiveDate ?? "page"}); now ${policy.effectiveDate ?? "page"}.`);
      for (const f of future) if (f.criteriaHash !== rule.writtenFrom.criteriaHash) review.push(`${rule.name}: a version effective ${f.effectiveDate} changes the criteria wording.`);
      // The quoted words must still be in the policy, even if the criteria section read the same as before.
      for (const quote of [rule.window.quote, rule.exceptionLimit?.quote]) if (quote && !quoteInText(quote, policyText)) review.push(`${rule.name}: the policy no longer contains the words quoted in src/lib/soc/rules.ts ("${quote.slice(0, 60)}…").`);
      log(`${payer}: policy ${policy.policyNumber ?? ""} effective ${policy.effectiveDate ?? "n/a"}, ${listed} list entries${future.length ? `, ${future.length} future version(s)` : ""}`);
      if (dryRun) continue;
      const gz = gzipSync(JSON.stringify(body));
      if (gz.byteLength > UPLOAD_MAX_BYTES) throw new Error(`upload too large (${gz.byteLength} bytes)`);
      const res = await fetch(`${base}/api/admin/soc-policies`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Content-Encoding": "gzip", "User-Agent": USER_AGENT }, body: gz });
      const text = await res.text();
      if (!res.ok) throw new Error(`upload HTTP ${res.status} ${text.slice(0, 300)}`);
      const result = (JSON.parse(text) as { data: { status: string; releaseId: number; changes: SocChanges | null } }).data;
      log(`${payer}: ${result.status} (release ${result.releaseId})`);
      const c = result.changes;
      if (result.status === "held") {
        review.push(`${rule.name}: upload held, because it would remove ${c?.removed.length ?? "many"} drugs from the list in force (${(c?.removed ?? []).slice(0, 5).map((e) => e.code ?? e.label).join(", ")}). Check the payer's list; if the removals are real, run: npm run refresh:soc-policies -- --only ${payer} --force`);
        continue;
      }
      if (c && (c.added.length || c.removed.length || c.criteriaChanged)) {
        changed.push(`${rule.name}: ${[c.added.length ? `+${c.added.length} (${c.added.slice(0, 5).map((e) => e.code ?? e.label).join(", ")})` : "", c.removed.length ? `-${c.removed.length} (${c.removed.slice(0, 5).map((e) => e.code ?? e.label).join(", ")})` : "", c.criteriaChanged ? "criteria wording changed" : ""].filter(Boolean).join("; ")}`);
      }
    } catch (error) {
      failed++;
      log(`${payer}: FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const c of changed) log(`CHANGED ${c}`);
  for (const r of review) log(`REVIEW NEEDED ${r}`);
  if (!changed.length && !review.length) log("no list or wording changes");
  process.exit(failed ? 1 : 0);
}

if (process.argv[1]?.endsWith("refresh-soc-policies.ts")) {
  main().catch((error) => {
    console.error(`soc-policies: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
