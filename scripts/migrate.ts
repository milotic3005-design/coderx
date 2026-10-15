/**
 * Apply database migrations.
 *   npm run db:migrate                      (uses DATABASE_URL, or local PGlite when unset)
 *   npm run db:migrate -- --if-database-url (no-op when DATABASE_URL is unset; used by the Vercel build)
 */
import { createDbHandle } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

async function main() {
  if (process.argv.includes("--if-database-url") && !process.env.DATABASE_URL) {
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
  console.error("migrate: failed —", error instanceof Error ? error.message : error);
  process.exit(1);
});
