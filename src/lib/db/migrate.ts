import path from "node:path";
import type { DbHandle } from "./client";

/** Apply pending SQL migrations from ./drizzle with the driver-specific migrator. */
export async function runMigrations(handle: DbHandle, migrationsFolder = path.join(process.cwd(), "drizzle")): Promise<void> {
  if (handle.driver === "pg") {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(handle.db as never, { migrationsFolder });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(handle.db as never, { migrationsFolder });
  }
}
