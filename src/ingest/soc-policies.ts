/**
 * Payer site-of-care policies (for /tools/soc-check), refreshed monthly on the operator's Mac by
 * scripts/refresh-soc-policies.ts and uploaded to POST /api/admin/soc-policies.
 *
 * For each payer: the policy document (criteria text, effective date) and its drug list, read from the
 * payer's own public files. Drug codes and dates update automatically. The criteria text is kept with a
 * fingerprint; when it changes, the page shows a "changed since review" warning until a pharmacist
 * reviews it (src/lib/soc/rules.ts). Nothing is matched by drug name: each payer's list is shown in its
 * own words (codes for UHC, Premera and Regence; names for Aetna).
 */
import { createHash } from "node:crypto";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { insertBatches } from "./batch";
import { SOURCES } from "./sources";

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

export const SOC_PAYERS = {
  uhc: {
    name: "UnitedHealthcare (commercial)",
    organization: "UnitedHealthcare",
    policy: { url: "https://www.uhcprovider.com/content/dam/provider/docs/public/policies/comm-medical-drug/provider-administered-drugs-soc.pdf", kind: "pdf" },
    list: { url: "https://www.uhcprovider.com/content/dam/provider/docs/public/policies/attachments/commercial/provider-administered-drugs-soc-code-list.pdf", kind: "uhc-code-list" },
    hosts: ["www.uhcprovider.com"],
  },
  premera: {
    name: "Premera Blue Cross",
    organization: "Premera Blue Cross",
    policy: { url: "https://www.premera.com/medicalpolicies/11.01.523.pdf", kind: "pdf" },
    list: { url: null, kind: "premera-codes" },
    hosts: ["www.premera.com"],
  },
  regence: {
    name: "Regence BlueShield (incl. UMP/PEBB/SEBB)",
    organization: "Regence BlueShield",
    policy: { url: "https://regence.myprime.com/content/dam/prime/memberportal/forms/AuthorForms/Cambia/Program_Summaries/dru408reg.pdf", kind: "pdf" },
    list: { url: null, kind: "regence-table" },
    hosts: ["regence.myprime.com"],
  },
  aetna: {
    name: "Aetna (commercial)",
    organization: "Aetna",
    policy: { url: "https://www.aetna.com/health-care-professionals/utilization-management/drug-infusion-site-of-care-policy.html", kind: "html" },
    list: { url: "https://www.aetna.com/content/dam/aetna/xml/aetnacom/health-care-professionals/soc-drug-therapies.xml/jcr:content/renditions/original", kind: "aetna-xml" },
    hosts: ["www.aetna.com"],
  },
  cigna: {
    name: "Cigna",
    organization: "Cigna",
    policy: { url: "https://static.cigna.com/assets/chcp/pdf/coveragePolicies/pharmacy/ph_1605_coveragepositioncriteria_site_of_care.pdf", kind: "pdf" },
    // The drug list is under /assets/chcp/secure/, which Cigna's robots.txt disallows, so it is not fetched.
    list: { url: null, kind: "none" },
    hosts: ["static.cigna.com"],
  },
  anthem: {
    name: "Anthem / Wellpoint (CG-MED-83)",
    organization: "Anthem (Elevance Health)",
    policy: { url: "https://www.anthem.com/medpolicies/abc/active/gl_pw_c183201.html", kind: "html" },
    // No public Washington (Wellpoint Apple Health) drug list for CG-MED-83 was found.
    list: { url: null, kind: "none" },
    hosts: ["www.anthem.com"],
  },
} as const;
export type SocPayerKey = keyof typeof SOC_PAYERS;
export const SOC_PAYER_KEYS = Object.keys(SOC_PAYERS) as [SocPayerKey, ...SocPayerKey[]];

/** Premera posts a policy's next version ahead of time on its monthly "policy updates" pages. */
export const premeraUpdatePages = (today: Date): string[] =>
  [0, 1, 2].map((ahead) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + ahead, 1));
    const month = d.toLocaleString("en-US", { month: "long", timeZone: "UTC" }).toLowerCase();
    return `https://www.premera.com/wa/provider/news/medical-policies/policy-updates/${month}-${d.getUTCFullYear()}/`;
  });
/** "/medicalpolicies/11.01.523_2026-11-06.pdf" links on those pages, with their effective dates. */
export function premeraFutureLinks(html: string): { url: string; effectiveDate: string }[] {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/href="(\/medicalpolicies\/11\.01\.523_(\d{4}-\d{2}-\d{2})\.pdf)"/g)) out.set(`https://www.premera.com${m[1]}`, m[2]);
  return [...out].map(([url, effectiveDate]) => ({ url, effectiveDate }));
}

/* ------------------------------------------------------------------ */
/* Reading the documents                                               */
/* ------------------------------------------------------------------ */

export interface SocEntry {
  /** HCPCS Level II code as the payer lists it; null for payers that list names only (Aetna). CPT rows are not kept. */
  code: string | null;
  /** The payer's own wording for the drug. */
  label: string;
  /** When the drug became subject to the policy, where the payer states it (Aetna, Regence). */
  addedDate: string | null;
  /** UHC's asterisk: oncology drugs, where the policy applies after 2 hospital infusions as monotherapy. */
  oncologyStar: boolean;
  /** Regence's "Home infusion eligible" column, as printed. */
  homeInfusionEligible: "Yes" | "No" | null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");
/** "October 1, 2026", "Nov. 6, 2026", "6/15/2026", "4/1/26" -> "2026-10-01"; null when it is none of these. */
export function parseDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const named = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s*(\d{4})/.exec(s);
  if (named) {
    const month = MONTHS[named[1].toLowerCase()] ?? MONTHS[named[1].toLowerCase().slice(0, 3)];
    return month ? `${named[3]}-${pad(month)}-${pad(Number(named[2]))}` : null;
  }
  const numeric = /(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/.exec(s);
  if (numeric) {
    const year = numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
    return `${year}-${pad(Number(numeric[1]))}-${pad(Number(numeric[2]))}`;
  }
  return null;
}

/** Visible text of an HTML page, one block per line (scripts and styles removed). */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&#8217;/g, "’")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

const clean = (s: string) => s.replace(/[®™]/g, "").replace(/\s+/g, " ").replace(/\s+([),])/g, "$1").trim();

/** UHC's Applicable Medications list: "J0129 Orencia® (abatacept) Injection, …"; a brand split over lines is joined. CPT rows are skipped. */
export function parseUhcCodeList(text: string): SocEntry[] {
  const lines = text.split("\n").map((l) => l.trim());
  const out: SocEntry[] = [];
  lines.forEach((line, i) => {
    const m = /^([A-Z]\d{4})(\*?)\s+(.+)$/.exec(line);
    if (!m) return;
    let label = m[3].split(/\s+(?:Injection\b|N\/A\b)/)[0];
    // "Fabrazyme® (agalsidase" continues on the next lines until the parenthesis closes.
    for (let j = i + 1; j < Math.min(i + 4, lines.length) && (label.match(/\(/g)?.length ?? 0) > (label.match(/\)/g)?.length ?? 0); j++) {
      if (/^([A-Z]\d{4}|\d{5})\b/.test(lines[j])) break;
      label += ` ${lines[j].split(/\s+(?:Injection\b|N\/A\b)/)[0]}`;
    }
    const closed = label.includes("(") ? label.slice(0, label.indexOf(")", label.indexOf("(")) + 1 || undefined) : label;
    out.push({ code: m[1], label: clean(closed), addedDate: null, oncologyStar: m[2] === "*", homeInfusionEligible: null });
  });
  return out;
}

/** Premera's coding tables: "J0129 Injection, abatacept (Orencia)" (CMS descriptor wording). */
export function parsePremeraCodes(text: string): SocEntry[] {
  const seen = new Map<string, SocEntry>();
  for (const line of text.split("\n")) {
    const m = /^([A-Z]\d{4})\s+(\S.+)$/.exec(line.trim());
    if (m && !seen.has(m[1])) seen.set(m[1], { code: m[1], label: clean(m[2]), addedDate: null, oncologyStar: false, homeInfusionEligible: null });
  }
  return [...seen.values()];
}

/**
 * Regence dru408 Appendix 1: "Medication | Effective Date | Policy Number | Home infusion eligible | HCPCS Code" rows,
 * which the PDF wraps over lines. One entry per code; a row can list several codes.
 */
export function parseRegenceTable(text: string): SocEntry[] {
  const start = text.search(/Medication\s+Effective Date\s+Policy Number/);
  if (start === -1) return [];
  const end = text.slice(start).search(/\n\s*Appendix 2\b/);
  const region = text
    .slice(start, end === -1 ? undefined : start + end)
    .replace(/Medication\s+Effective Date\s+Policy Number\s+Home\s+infusion\s+eligible\s*[a-z]?\s+HCPCS Code/g, " ")
    .replace(/©[^\n]*|dru408\.\d+\s+Page \d+ of \d+/g, " ")
    .replace(/\s+/g, " ");
  const row = /\s*(.+?)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+((?:dru\d+(?:\s*\([A-Z]+\))?\s*,?\s*)+)\s*(Yes|No)\s+((?:[A-Z]\d{4}\s*,?\s*)+)/g;
  const out = new Map<string, SocEntry>();
  for (const m of region.matchAll(row)) {
    const label = clean(m[1].replace(/\s+[a-c]$/, ""));
    // A label holding a date or a policy number means a cell was empty and two rows ran together.
    if (/\d{1,2}\/\d{1,2}\/\d{4}|\bdru\d+/.test(label)) throw new Error(`Regence table layout changed: a row reads "${label.slice(0, 80)}"`);
    for (const code of m[5].match(/[A-Z]\d{4}/g) ?? []) out.set(`${code}|${label}`, { code, label, addedDate: parseDate(m[2]), oncologyStar: false, homeInfusionEligible: m[4] as "Yes" | "No" });
  }
  return [...out.values()];
}

/** Aetna's drug-therapy list (the XML behind its policy page): name and the date it became part of the policy. */
export function parseAetnaXml(xml: string): { entries: SocEntry[]; generated: string | null } {
  const cdata = (row: string, tag: string) => new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`).exec(row)?.[1]?.trim() ?? "";
  const entries = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)]
    .map((m) => ({ code: null, label: clean(cdata(m[1], "drug-name")), addedDate: parseDate(cdata(m[1], "effective-date")), oncologyStar: false, homeInfusionEligible: null }))
    .filter((e) => e.label);
  const generated = /date-generated="[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2}) [\d:]+ [A-Z]+ (\d{4})"/.exec(xml);
  return { entries, generated: generated ? parseDate(`${generated[1]} ${generated[2]}, ${generated[3]}`) : null };
}

/* ------------------------------------------------------------------ */
/* Criteria text and its fingerprint                                   */
/* ------------------------------------------------------------------ */

/** Where each payer's criteria start and stop in its policy text. */
const CRITERIA: Record<SocPayerKey, { start: RegExp; end: RegExp }> = {
  uhc: { start: /^Coverage Rationale\s*$/m, end: /^Definitions\s*$/m },
  premera: { start: /^Policy Coverage Criteria\s*$/m, end: /^Pharmacologic \/\s*$/m },
  regence: { start: /^Policy\/Criteria\s*$/m, end: /^Medication\s+Effective Date\s+Policy Number/m },
  aetna: { start: /^Criteria for medical need\s*$/m, end: /^References\s*$/m },
  cigna: { start: /^Coverage Policy\s*$/m, end: /^(General Background|Coding Information|References)\s*$/m },
  anthem: { start: /^Clinical Indications\s*$/m, end: /^(Summary for Members and Families|Discussion\/General Information)\s*$/m },
};

/** Page furniture that repeats on every page and says nothing about the criteria. */
const FURNITURE = /Page \|? ?\d+ of \d+|^©|Copyright \d{4}|Proprietary Information|^dru408\.\d+|Coverage Policy Number: \d+|Last Updated|Effective \d{2}\/\d{2}\/\d{4}|UnitedHealthcare Commercial Medical Benefit|^\u000c$/i;

/** The criteria section of a payer's policy text, without page headers and footers; null when the layout moved. */
export function criteriaSection(payer: SocPayerKey, text: string): string | null {
  const { start, end } = CRITERIA[payer];
  const s = text.search(start);
  if (s === -1) return null;
  const rest = text.slice(s);
  const e = rest.slice(1).search(end);
  const section = (e === -1 ? rest : rest.slice(0, e + 1))
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l && !FURNITURE.test(l));
  return section.length > 3 ? section.join("\n") : null;
}

/** A fingerprint of the wording that ignores spacing, case and line breaks. */
export function criteriaFingerprint(section: string): string {
  return createHash("sha256").update(section.toLowerCase().replace(/[^a-z0-9%<>≤≥]+/g, " ").trim()).digest("hex").slice(0, 16);
}

/** Effective date and policy number from a policy's text, by payer. */
export function policyFacts(payer: SocPayerKey, text: string): { effectiveDate: string | null; policyNumber: string | null; title: string } {
  const after = (re: RegExp) => re.exec(text)?.[1] ?? null;
  switch (payer) {
    case "uhc":
      return { effectiveDate: parseDate(after(/Effective Date:\s*([A-Za-z]+ \d{1,2}, \d{4})/)), policyNumber: after(/Policy Number:\s*(\S+)/), title: "Provider Administered Drugs – Site of Care" };
    case "premera":
      return { effectiveDate: parseDate(after(/Effective Date:\s*([A-Za-z]{3,9}\.? \d{1,2}, \d{4})/)), policyNumber: "11.01.523", title: "Site of Service: Drugs and Biologic Agents" };
    case "regence":
      return { effectiveDate: parseDate(after(/Effective Date:\s*([A-Za-z]+ \d{1,2}, \d{4})/)), policyNumber: after(/Policy No:\s*(\S+)/), title: "Site of Care Review" };
    case "aetna":
      return { effectiveDate: null, policyNumber: null, title: "Drug infusion/injection site-of-care policy" };
    case "cigna":
      return { effectiveDate: parseDate(after(/Effective Date[.…\s]*(\d{1,2}\/\d{1,2}\/\d{4})/)), policyNumber: "1605", title: "Medication Administration Site of Care" };
    case "anthem":
      return { effectiveDate: parseDate(after(/Publish Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/)), policyNumber: "CG-MED-83", title: "Site of Care: Specialty Pharmaceuticals" };
  }
}

/** Minimum rows each list must yield; fewer means the layout changed and the refresh stops for that payer. */
export const MIN_ENTRIES: Partial<Record<SocPayerKey, number>> = { uhc: 80, premera: 60, regence: 50, aetna: 80 };

/**
 * Whether a quotation (parts joined by "…") still appears in a document's text. Letters and digits only, so line
 * breaks, curly quotes and dashes from the PDF reader do not matter.
 */
export function quoteInText(quote: string, text: string): boolean {
  const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const haystack = norm(text);
  return quote.split("…").map(norm).filter(Boolean).every((part) => haystack.includes(part));
}

/* ------------------------------------------------------------------ */
/* Upload and import                                                   */
/* ------------------------------------------------------------------ */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const entrySchema = z.object({
  code: z.string().regex(/^[A-Z]\d{4}$/).nullable(),
  label: z.string().min(1).max(300),
  addedDate: isoDate.nullable(),
  oncologyStar: z.boolean(),
  homeInfusionEligible: z.enum(["Yes", "No"]).nullable(),
});
const onHost = (u: string, hosts: readonly string[]) => {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && hosts.includes(url.hostname);
  } catch {
    return false;
  }
};
const documentSchema = z.object({
  /** policy: the version in force when fetched; future: a version the payer posted ahead of its effective date; list: a separate drug list. */
  role: z.enum(["policy", "future", "list"]),
  url: z.string().max(500),
  title: z.string().min(1).max(300),
  policyNumber: z.string().max(40).nullable(),
  effectiveDate: isoDate.nullable(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  criteriaText: z.string().max(200_000).nullable(),
  criteriaHash: z.string().regex(/^[0-9a-f]{16}$/).nullable(),
  entries: z.array(entrySchema).max(2000),
});

export const socUploadSchema = z
  .object({
    payerKey: z.enum(SOC_PAYER_KEYS),
    /** SHA-256 of the documents' data, to skip an identical upload. */
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    documents: z.array(documentSchema).min(1).max(6),
    force: z.boolean().default(false),
  })
  .superRefine((u, ctx) => {
    const hosts = SOC_PAYERS[u.payerKey].hosts;
    u.documents.forEach((d, i) => {
      if (!onHost(d.url, hosts)) ctx.addIssue({ code: "custom", path: ["documents", i, "url"], message: `The URL must be on ${hosts.join(" or ")}.` });
    });
    if (!u.documents.some((d) => d.role === "policy")) ctx.addIssue({ code: "custom", path: ["documents"], message: "A policy document is required." });
  });
export type SocUpload = z.input<typeof socUploadSchema>;
type Parsed = z.output<typeof socUploadSchema>;

export const SOC_UPLOAD_MAX_BYTES = 10_000_000;

/** What changed since the payer's previous release: list entries in and out, and criteria wording. */
export interface SocChanges {
  added: { code: string | null; label: string; addedDate: string | null }[];
  removed: { code: string | null; label: string }[];
  criteriaChanged: boolean;
  /** Versions posted ahead of their effective date. */
  upcoming: { effectiveDate: string | null; url: string }[];
}

const entryKey = (e: { code: string | null; label: string }) => `${e.code ?? ""}|${e.label.toLowerCase()}`;

export function diffEntries(
  before: { code: string | null; label: string; addedDate?: string | null }[],
  after: { code: string | null; label: string; addedDate: string | null }[],
): Pick<SocChanges, "added" | "removed"> {
  const was = new Set(before.map(entryKey));
  const now = new Set(after.map(entryKey));
  return {
    added: after.filter((e) => !was.has(entryKey(e))).map((e) => ({ code: e.code, label: e.label, addedDate: e.addedDate })),
    removed: before.filter((e) => !now.has(entryKey(e))).map((e) => ({ code: e.code, label: e.label })),
  };
}

/** An upload that would drop more than this share of the list in force is held until it is sent again with force. */
export const SOC_MAX_REMOVED_SHARE = 0.1;

/**
 * Imports one payer's upload. "held": nothing was written, because the upload would remove more than
 * SOC_MAX_REMOVED_SHARE of the current list (a partial read must not replace good data); check the payer's list
 * and send it again with force.
 */
export async function importSocUpload(db: Database, upload: Parsed): Promise<{ status: "imported" | "skipped" | "held"; releaseId: number; changes: SocChanges | null }> {
  const source = SOURCES.payer_soc_policies;
  const scope = and(eq(t.sourceReleases.sourceKey, source.key), eq(t.sourceReleases.periodLabel, upload.payerKey));
  const same = await db.select({ id: t.sourceReleases.id }).from(t.sourceReleases).where(and(scope, eq(t.sourceReleases.checksumSha256, upload.sha256), eq(t.sourceReleases.status, "succeeded")));
  if (same.length && !upload.force) return { status: "skipped", releaseId: same[0].id, changes: null };

  // The previous release's entries and criteria, to report what changed.
  const previous = await db.select({ id: t.sourceReleases.id }).from(t.sourceReleases).where(and(scope, eq(t.sourceReleases.isCurrent, true)));
  const prevIds = previous.map((p) => p.id);
  const [prevEntries, prevDocs] = prevIds.length
    ? await Promise.all([
        db.select().from(t.socListEntries).where(inArray(t.socListEntries.sourceReleaseId, prevIds)),
        db.select().from(t.socDocuments).where(inArray(t.socDocuments.sourceReleaseId, prevIds)),
      ])
    : [[], []];
  const inForce = <T extends { role: string }>(docs: T[]) => docs.filter((d) => d.role !== "future");
  const entriesOf = (docs: { entries: Parsed["documents"][number]["entries"] }[]) => docs.flatMap((d) => d.entries);
  const prevDocIds = new Set(inForce(prevDocs).map((d) => d.id));
  const prevPolicy = prevDocs.find((d) => d.role === "policy");
  const newPolicy = upload.documents.find((d) => d.role === "policy")!;
  const changes: SocChanges = {
    ...(prevIds.length ? diffEntries(prevEntries.filter((e) => prevDocIds.has(e.documentId)), entriesOf(inForce(upload.documents))) : { added: [], removed: [] }),
    criteriaChanged: !!prevPolicy && prevPolicy.criteriaHash !== newPolicy.criteriaHash,
    upcoming: upload.documents.filter((d) => d.role === "future").map((d) => ({ effectiveDate: d.effectiveDate, url: d.url })),
  };

  const prevCount = prevEntries.filter((e) => prevDocIds.has(e.documentId)).length;
  if (!upload.force && prevCount > 0 && changes.removed.length > prevCount * SOC_MAX_REMOVED_SHARE) return { status: "held", releaseId: prevIds[0], changes };

  const payer = SOC_PAYERS[upload.payerKey];
  const releaseId = await db.transaction(async (tx) => {
    if (same.length) await tx.update(t.sourceReleases).set({ status: "superseded", isCurrent: false }).where(inArray(t.sourceReleases.id, same.map((s) => s.id)));
    const [release] = await tx
      .insert(t.sourceReleases)
      .values({
        sourceKey: source.key,
        organization: payer.organization,
        dataset: `${newPolicy.title}${newPolicy.policyNumber ? ` (${newPolicy.policyNumber})` : ""}: ${payer.name}`,
        periodLabel: upload.payerKey,
        fileName: decodeURIComponent(new URL(newPolicy.url).pathname.split("/").pop() || "") || null,
        downloadUrl: newPolicy.url,
        landingPageUrl: source.landingPageUrl,
        publicationDate: newPolicy.effectiveDate,
        publicationLabel: newPolicy.effectiveDate ? `policy effective ${newPolicy.effectiveDate}` : "policy page as fetched",
        effectiveStart: newPolicy.effectiveDate,
        effectiveEnd: null,
        checksumSha256: upload.sha256,
        byteSize: null,
        recordCount: upload.documents.reduce((n, d) => n + d.entries.length, 0),
        status: "processing",
        isCurrent: false,
      })
      .returning({ id: t.sourceReleases.id });
    for (const d of upload.documents) {
      const [doc] = await tx
        .insert(t.socDocuments)
        .values({ payerKey: upload.payerKey, role: d.role, url: d.url, title: d.title, policyNumber: d.policyNumber, effectiveDate: d.effectiveDate, sha256: d.sha256, criteriaText: d.criteriaText, criteriaHash: d.criteriaHash, sourceReleaseId: release.id })
        .returning({ id: t.socDocuments.id });
      await insertBatches(tx, t.socListEntries, d.entries.map((e) => ({ ...e, documentId: doc.id, payerKey: upload.payerKey, sourceReleaseId: release.id })), 8);
    }
    const older = await tx.select({ id: t.sourceReleases.id }).from(t.sourceReleases).where(and(scope, ne(t.sourceReleases.id, release.id), ne(t.sourceReleases.status, "failed")));
    const olderIds = older.map((o) => o.id);
    if (olderIds.length) {
      await tx.delete(t.socListEntries).where(inArray(t.socListEntries.sourceReleaseId, olderIds));
      await tx.delete(t.socDocuments).where(inArray(t.socDocuments.sourceReleaseId, olderIds));
      await tx.update(t.sourceReleases).set({ status: "superseded", isCurrent: false }).where(inArray(t.sourceReleases.id, olderIds));
    }
    await tx.update(t.sourceReleases).set({ status: "succeeded", isCurrent: true, report: { details: { changes } } }).where(eq(t.sourceReleases.id, release.id));
    return release.id;
  });
  return { status: "imported", releaseId, changes };
}
