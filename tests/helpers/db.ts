import { createDbHandle, type DbHandle } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { importRelease, runDerive } from "@/ingest/pipeline";
import { importHospitalRates, hospitalRatesSchema } from "@/ingest/hospital-import";
import { FIXTURE_RELEASES, fixtureFetcher, hospitalRatesFixtureUpload } from "./fixtures";

/** Fresh in-memory PostgreSQL (PGlite) with migrations applied. */
export async function freshDb(): Promise<DbHandle> {
  const handle = await createDbHandle({ pgliteDir: "memory://", url: "" });
  await runMigrations(handle);
  return handle;
}

/** Fresh database loaded with every fixture release and derived tables. */
export async function seededDb(): Promise<DbHandle> {
  const handle = await freshDb();
  const fetcher = fixtureFetcher();
  for (const release of FIXTURE_RELEASES) {
    const outcome = await importRelease(handle.db, release, { fetcher, skipDerive: true, plausibility: "relaxed" });
    if (outcome.status !== "imported") throw new Error(`Fixture import failed for ${release.sourceKey}: ${outcome.reason}`);
  }
  await runDerive(handle.db);
  await importHospitalRates(handle.db, hospitalRatesSchema.parse(await hospitalRatesFixtureUpload()));
  return handle;
}

/** Make route handlers (which call getDb()) use this handle. */
export function useAsGlobalDb(handle: DbHandle) {
  (globalThis as { __coderxDb?: Promise<DbHandle> }).__coderxDb = Promise.resolve(handle);
}
