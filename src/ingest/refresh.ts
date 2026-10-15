/**
 * Scheduled / administrator-triggered refresh. Checks each source against its real
 * publication cadence and imports only what changed, within a time budget.
 */
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { discoverReleases } from "./discover";
import { headInfo } from "./fetch";
import { importRelease, runDerive, type ImportOutcome } from "./pipeline";
import { manifestFor, type ReleaseCandidate, type SourceKey } from "./sources";
import { parseHttpDate } from "./values";

export interface RefreshOptions {
  trigger: "cron" | "admin" | "cli";
  sources?: SourceKey[];
  force?: boolean;
  /** Stop starting new imports after this many milliseconds. */
  budgetMs?: number;
  /** Re-check every known quarter (slower) instead of the newest + any re-posted ones. */
  fullHistory?: boolean;
  log?: (m: string) => void;
}

export interface RefreshResult {
  runId: number;
  outcomes: ImportOutcome[];
  skipped: { sourceKey: string; reason: string }[];
  derived: boolean;
  discoveryErrors: string[];
  durationMs: number;
}

const QUARTERLY: SourceKey[] = ["cms_hcpcs", "cms_payment_limits", "cms_ndc_hcpcs"];

async function currentReleases(db: Database, sourceKey: SourceKey) {
  return db
    .select()
    .from(t.sourceReleases)
    .where(and(eq(t.sourceReleases.sourceKey, sourceKey), eq(t.sourceReleases.isCurrent, true)))
    .orderBy(desc(t.sourceReleases.periodLabel));
}

export async function refreshSources(db: Database, options: RefreshOptions): Promise<RefreshResult> {
  const started = Date.now();
  const log = options.log ?? (() => {});
  const budget = options.budgetMs ?? 240_000;
  const wanted = new Set<SourceKey>(options.sources ?? ["cms_hcpcs", "cms_payment_limits", "cms_ndc_hcpcs", "fda_ndc", "fda_ndc_excluded", "fda_purple_book"]);
  const [run] = await db.insert(t.importRuns).values({ trigger: options.trigger, status: "running" }).returning({ id: t.importRuns.id });

  const outcomes: ImportOutcome[] = [];
  const skipped: RefreshResult["skipped"] = [];
  const queue: ReleaseCandidate[] = [];
  const { candidates, errors } = await discoverReleases();

  // Quarterly CMS sources: newest quarter, any quarter not yet imported, and any quarter whose posting label changed (CMS re-posts revisions).
  for (const key of QUARTERLY) {
    if (!wanted.has(key)) continue;
    const found = candidates.filter((c) => c.sourceKey === key);
    const pool = found.length ? found : manifestFor(key);
    const current = await currentReleases(db, key);
    const byPeriod = new Map(current.map((r) => [r.periodLabel, r]));
    const newest = [...pool].sort((a, b) => (b.period ?? "").localeCompare(a.period ?? ""))[0];
    const oldestKept = current.at(-1)?.periodLabel ?? "";
    for (const c of pool) {
      if (c.period && current.length && c.period < oldestKept && !options.fullHistory) continue; // outside the retained history window
      const existing = c.period ? byPeriod.get(c.period) : undefined;
      const relabeled = !!existing && !!c.publicationLabel && existing.publicationLabel !== c.publicationLabel;
      if (options.force || options.fullHistory || !existing || relabeled) queue.push(c);
      else if (c === newest) skipped.push({ sourceKey: key, reason: `${c.period} already imported (${existing.publicationLabel ?? "no label"})` });
    }
  }

  // FDA NDC directory (daily publisher cadence): import when Last-Modified moved and the configured interval has passed.
  const fdaIntervalDays = Number(process.env.CODERX_FDA_REFRESH_DAYS ?? 7);
  for (const key of ["fda_ndc", "fda_ndc_excluded"] as const) {
    if (!wanted.has(key)) continue;
    const c = manifestFor(key)[0];
    const [cur] = await currentReleases(db, key);
    try {
      const head = await headInfo(c.url);
      const remoteDate = parseHttpDate(head.lastModified);
      const ageDays = cur ? (Date.now() - Date.parse(cur.importedAt)) / 86_400_000 : Infinity;
      const crosswalkChanged = queue.some((q) => q.sourceKey === "cms_ndc_hcpcs");
      if (options.force || !cur || crosswalkChanged || (remoteDate && remoteDate > (cur.periodLabel ?? "") && ageDays >= fdaIntervalDays)) queue.push(c);
      else skipped.push({ sourceKey: key, reason: `Up to date or within the ${fdaIntervalDays}-day refresh interval (remote ${remoteDate ?? "unknown"}, imported ${cur.periodLabel})` });
    } catch (error) {
      skipped.push({ sourceKey: key, reason: `HEAD check failed: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  // Purple Book (monthly).
  if (wanted.has("fda_purple_book")) {
    const latestPb = candidates.filter((c) => c.sourceKey === "fda_purple_book").at(-1) ?? manifestFor("fda_purple_book")[0];
    const [cur] = await currentReleases(db, "fda_purple_book");
    if (options.force || !cur || (latestPb.period ?? "") > (cur.periodLabel ?? "")) queue.push(latestPb);
    else skipped.push({ sourceKey: "fda_purple_book", reason: `${cur.periodLabel} is current` });
  }

  const order: SourceKey[] = ["cms_hcpcs", "cms_payment_limits", "cms_ndc_hcpcs", "fda_ndc", "fda_ndc_excluded", "fda_purple_book"];
  queue.sort((a, b) => order.indexOf(a.sourceKey) - order.indexOf(b.sourceKey) || (a.period ?? "").localeCompare(b.period ?? ""));

  for (const candidate of queue) {
    if (Date.now() - started > budget) {
      skipped.push({ sourceKey: candidate.sourceKey, reason: `Time budget reached; ${candidate.period ?? "release"} deferred to the next run` });
      continue;
    }
    outcomes.push(await importRelease(db, candidate, { force: options.force, skipDerive: true, log }));
  }

  let derived = false;
  if (outcomes.some((o) => o.status === "imported")) {
    log("refresh: rebuilding derived tables");
    await runDerive(db, log);
    derived = true;
  }

  const failed = outcomes.filter((o) => o.status === "failed").length;
  const status = failed ? (failed === outcomes.length ? "failed" : "partial") : "succeeded";
  await db
    .update(t.importRuns)
    .set({
      status,
      finishedAt: new Date().toISOString(),
      summary: { outcomes: outcomes.map(({ report, ...o }) => ({ ...o, records: report?.recordCount })), skipped, derived, discoveryErrors: errors },
    })
    .where(eq(t.importRuns.id, run.id));

  return { runId: run.id, outcomes, skipped, derived, discoveryErrors: errors, durationMs: Date.now() - started };
}
