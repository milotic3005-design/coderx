/**
 * Read model for /tools/soc-check: each payer's current site-of-care policy, any version posted ahead of its
 * effective date, its drug list, and what the monthly refreshes changed.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { diffEntries, type SocChanges } from "@/ingest/soc-policies";
import { getDb, type Database } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { SOC_RULES, type SocListEntryView, type SocPayerKey, type SocPayerRule } from "@/lib/soc/rules";
import { toProvenance, type Provenance } from "./provenance";

export interface SocPayerView {
  key: SocPayerKey;
  rule: SocPayerRule;
  policy: { title: string; policyNumber: string | null; effectiveDate: string | null; url: string; criteriaText: string | null; criteriaHash: string | null } | null;
  /** A version the payer posted ahead of its effective date, and how its list differs from the one in force. */
  future: { effectiveDate: string | null; url: string; added: { code: string | null; label: string }[]; removed: { code: string | null; label: string }[]; criteriaChanged: boolean } | null;
  /** Null when the payer publishes no list this tool can load. */
  list: { date: string | null; url: string; entries: SocListEntryView[] } | null;
  /** The payer's criteria wording differs from the wording the rule here was written from. */
  changedSinceReview: boolean;
  provenance: Provenance[];
  /** Monthly refreshes that changed something, newest first. */
  history: { importedAt: string; changes: SocChanges }[];
}

const ORDER: SocPayerKey[] = ["uhc", "premera", "regence", "aetna", "cigna", "anthem"];

/**
 * Attaches the hand-written rule from code. Pages call this again after reading the Data Cache,
 * so an edited rule shows at once instead of when the cached copy expires.
 */
export function withRule(p: SocPayerView): SocPayerView {
  const rule = SOC_RULES[p.key];
  return { ...p, rule, changedSinceReview: !!p.policy?.criteriaHash && p.policy.criteriaHash !== rule.writtenFrom.criteriaHash };
}

export async function socData(db?: Database): Promise<{ payers: SocPayerView[]; loaded: boolean }> {
  db ??= await getDb();
  // Current releases are read on their own, so a long history can never push one out.
  const [current, releases] = await Promise.all([
    db.select().from(t.sourceReleases).where(and(eq(t.sourceReleases.sourceKey, "payer_soc_policies"), eq(t.sourceReleases.isCurrent, true), eq(t.sourceReleases.status, "succeeded"))),
    db
      .select()
      .from(t.sourceReleases)
      .where(and(eq(t.sourceReleases.sourceKey, "payer_soc_policies"), inArray(t.sourceReleases.status, ["succeeded", "superseded"])))
      .orderBy(desc(t.sourceReleases.importedAt))
      .limit(200),
  ]);
  const ids = current.map((r) => r.id);
  const [docs, entries] = ids.length
    ? await Promise.all([db.select().from(t.socDocuments).where(inArray(t.socDocuments.sourceReleaseId, ids)), db.select().from(t.socListEntries).where(inArray(t.socListEntries.sourceReleaseId, ids))])
    : [[], []];
  const view = (e: typeof t.socListEntries.$inferSelect): SocListEntryView => ({ code: e.code, label: e.label, addedDate: e.addedDate, oncologyStar: e.oncologyStar, homeInfusionEligible: e.homeInfusionEligible === "Yes" || e.homeInfusionEligible === "No" ? e.homeInfusionEligible : null });

  const payers = ORDER.map((key): SocPayerView => {
    const rule = SOC_RULES[key];
    const release = current.find((r) => r.periodLabel === key);
    const payerDocs = release ? docs.filter((d) => d.sourceReleaseId === release.id) : [];
    const policy = payerDocs.find((d) => d.role === "policy") ?? null;
    const futureDoc = payerDocs.find((d) => d.role === "future") ?? null;
    // The list in force: a separate list document, or the codes printed in the policy itself.
    const listDoc = payerDocs.find((d) => d.role === "list") ?? policy;
    const listEntries = listDoc ? entries.filter((e) => e.documentId === listDoc.id) : [];
    const futureEntries = futureDoc ? entries.filter((e) => e.documentId === futureDoc.id) : [];
    const history = releases
      .filter((r) => r.periodLabel === key)
      .map((r) => ({ importedAt: r.importedAt, changes: (r.report as { details?: { changes?: SocChanges } } | null)?.details?.changes }))
      .filter((h): h is { importedAt: string; changes: SocChanges } => !!h.changes && (h.changes.added.length > 0 || h.changes.removed.length > 0 || h.changes.criteriaChanged || h.changes.upcoming.length > 0))
      .slice(0, 12);
    return withRule({
      key,
      rule,
      policy: policy ? { title: policy.title, policyNumber: policy.policyNumber, effectiveDate: policy.effectiveDate, url: policy.url, criteriaText: policy.criteriaText, criteriaHash: policy.criteriaHash } : null,
      future: futureDoc
        ? { effectiveDate: futureDoc.effectiveDate, url: futureDoc.url, ...diffEntries(listEntries, futureEntries.map((e) => ({ code: e.code, label: e.label, addedDate: e.addedDate }))), criteriaChanged: futureDoc.criteriaHash !== policy?.criteriaHash }
        : null,
      list: listDoc && listEntries.length ? { date: listDoc.effectiveDate, url: listDoc.url, entries: listEntries.map(view).sort((a, b) => (a.code ?? a.label).localeCompare(b.code ?? b.label)) } : null,
      changedSinceReview: false,
      provenance: release ? [toProvenance(release)] : [],
      history,
    });
  });
  return { payers, loaded: current.length > 0 };
}
