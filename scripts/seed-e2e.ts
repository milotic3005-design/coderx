/**
 * Seed the database used by Playwright from the real CMS/FDA fixture excerpts.
 *   CODERX_PGLITE_DIR=.data/e2e-pglite npm run e2e:db
 */
import { rmSync } from "node:fs";
import { createDbHandle } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { importRelease, runDerive } from "@/ingest/pipeline";
import { FIXTURE_RELEASES, fixtureFetcher } from "../tests/helpers/fixtures";

async function main() {
  const dir = process.env.CODERX_PGLITE_DIR ?? ".data/e2e-pglite";
  rmSync(dir, { recursive: true, force: true });
  const handle = await createDbHandle({ url: "", pgliteDir: dir });
  try {
    await runMigrations(handle);
    const fetcher = fixtureFetcher();
    for (const release of FIXTURE_RELEASES) {
      const o = await importRelease(handle.db, release, { fetcher, skipDerive: true, plausibility: "relaxed" });
      if (o.status !== "imported") throw new Error(`${release.sourceKey}: ${o.reason}`);
    }
    const report = await runDerive(handle.db);
    console.log(`seed-e2e: ${dir} ready (${report.drugs} drugs, ${report.hcpcsCodes} codes, ${report.searchDocuments} search documents)`);
  } finally {
    await handle.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
