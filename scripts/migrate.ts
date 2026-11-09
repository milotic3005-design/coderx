/**
 * Apply database migrations.
 *   npm run db:migrate                      (uses DATABASE_URL, or local PGlite when unset)
 *   npm run db:migrate -- --if-database-url (no-op when DATABASE_URL is unset; used by the Vercel build)
 */
import { isDatabaseUnavailable } from "@/lib/db/availability";
import { createDbHandle } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

async function main() {
  if (process.argv.includes("--if-database-url") && !process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    console.log("migrate: DATABASE_URL not set — skipping.");
    return;
  }
  const handle = await createDbHandle();
  try {
    await runMigrations(handle);
    console.log(`migrate: up to date (${handle.driver}).`);
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  // The Vercel build runs this before `next build`. A database that is down or over its plan quota must not also
  // block deploys (it stopped the fix for that very outage from shipping), so the build carries on without
  // migrating. Real migration errors still fail the build, and so does any run without --if-database-url.
  if (process.argv.includes("--if-database-url") && isDatabaseUnavailable(error)) {
    console.warn("migrate: SKIPPED — the database is unavailable (down or over its plan quota). Migrations were NOT applied; redeploy once it is back if this commit adds a migration.");
    return;
  }
  console.error("migrate: failed —", error instanceof Error ? error.message : error);
  process.exit(1);
});
