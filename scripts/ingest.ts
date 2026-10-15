/**
 * Data ingestion CLI.
 *
 *   npm run ingest -- --source all                 import every source (manifest + discovery)
 *   npm run ingest -- --source cms_hcpcs           one source
 *   npm run ingest -- --source all --quarters 4    limit CMS history to the last N quarters
 *   npm run ingest -- --discover                   print releases found on CMS/FDA pages (no import)
 *   npm run ingest -- --derive-only                rebuild derived tables
 *   flags: --force (re-import identical files), --no-discover, --cache-dir <dir>, --refresh-cache
 *
 * Writes to DATABASE_URL when set, otherwise to local PGlite (.data/pglite).
 */
import { createDbHandle } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { discoverReleases } from "@/ingest/discover";
import { importRelease, IMPORT_ORDER, runDerive, type ImportOutcome } from "@/ingest/pipeline";
import { manifestFor, SOURCE_KEYS, type ReleaseCandidate, type SourceKey } from "@/ingest/sources";
import * as t from "@/lib/db/schema";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);

function mergeCandidates(manifest: ReleaseCandidate[], discovered: ReleaseCandidate[], quarters?: number): ReleaseCandidate[] {
  const byKey = new Map<string, ReleaseCandidate>();
  for (const c of manifest) byKey.set(`${c.sourceKey}|${c.period ?? c.url}`, c);
  for (const c of discovered) {
    if (c.sourceKey === "fda_purple_book") continue;
    const k = `${c.sourceKey}|${c.period}`;
    // A discovered URL/label for a known quarter replaces the pinned one (CMS re-posts revised files).
    byKey.set(k, { ...byKey.get(k), ...c });
  }
  const latestPurple = discovered.filter((c) => c.sourceKey === "fda_purple_book").at(-1);
  if (latestPurple) {
    for (const k of [...byKey.keys()]) if (k.startsWith("fda_purple_book|")) byKey.delete(k);
    byKey.set(`fda_purple_book|${latestPurple.period}`, latestPurple);
  }
  const all = [...byKey.values()];
  const out: ReleaseCandidate[] = [];
  for (const key of IMPORT_ORDER) {
    let list = all.filter((c) => c.sourceKey === key).sort((a, b) => (a.period ?? "").localeCompare(b.period ?? ""));
    if (quarters && (key === "cms_hcpcs" || key === "cms_payment_limits" || key === "cms_ndc_hcpcs")) list = list.slice(-quarters);
    out.push(...list);
  }
  return out;
}

async function main() {
  const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
  const sourceArg = arg("--source") ?? "all";
  const quarters = arg("--quarters") ? Number(arg("--quarters")) : 8;
  const cacheDir = arg("--cache-dir") ?? ".cache/sources";

  if (has("--discover")) {
    const { candidates, errors } = await discoverReleases();
    console.table(candidates.map((c) => ({ source: c.sourceKey, period: c.period, label: c.publicationLabel, url: c.url })));
    if (errors.length) console.error(errors);
    return;
  }

  const handle = await createDbHandle();
  try {
    await runMigrations(handle);
    if (has("--derive-only")) {
      const report = await runDerive(handle.db, log);
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    const keys: SourceKey[] = sourceArg === "all" ? SOURCE_KEYS : (sourceArg.split(",") as SourceKey[]);
    for (const k of keys) if (!SOURCE_KEYS.includes(k)) throw new Error(`Unknown source '${k}'. Use one of: ${SOURCE_KEYS.join(", ")}, all`);

    let discovered: ReleaseCandidate[] = [];
    if (!has("--no-discover")) {
      const res = await discoverReleases();
      discovered = res.candidates;
      for (const e of res.errors) log(`discovery warning: ${e}`);
    }
    const manifest = keys.flatMap((k) => manifestFor(k));
    const candidates = mergeCandidates(manifest, discovered.filter((c) => keys.includes(c.sourceKey)), quarters);

    const [run] = await handle.db.insert(t.importRuns).values({ trigger: "cli", status: "running" }).returning({ id: t.importRuns.id });
    const outcomes: ImportOutcome[] = [];
    for (const candidate of candidates) {
      outcomes.push(
        await importRelease(handle.db, candidate, {
          force: has("--force"),
          skipDerive: true,
          download: { cacheDir, cacheMode: has("--refresh-cache") ? "refresh" : "use" },
          log,
        }),
      );
    }
    const changed = outcomes.some((o) => o.status === "imported");
    let derive = null;
    if (changed || has("--force")) {
      log("deriving drugs, relationships, and search index");
      derive = await runDerive(handle.db, log);
      log(`derive complete in ${derive.ms} ms: ${derive.drugs} drugs, ${derive.searchDocuments} search documents`);
    }
    const failed = outcomes.filter((o) => o.status === "failed");
    await handle.db
      .update(t.importRuns)
      .set({
        status: failed.length ? (failed.length === outcomes.length ? "failed" : "partial") : "succeeded",
        finishedAt: new Date().toISOString(),
        summary: { outcomes: outcomes.map(({ report, ...o }) => ({ ...o, records: report?.recordCount })), derive },
      })
      .where((await import("drizzle-orm")).eq(t.importRuns.id, run.id));

    console.table(outcomes.map((o) => ({ source: o.sourceKey, period: o.period, status: o.status, release: o.releaseId, records: o.report?.recordCount, note: o.reason ?? "" })));
    if (derive?.warnings.length) console.log("warnings:", derive.warnings);
    if (failed.length) process.exitCode = 1;
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  console.error("ingest: failed —", error instanceof Error ? error.stack : error);
  process.exit(1);
});
