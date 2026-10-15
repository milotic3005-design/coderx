/**
 * Database connection factory.
 *
 * - `DATABASE_URL` set → PostgreSQL via node-postgres (Neon, Supabase, RDS, local Postgres).
 * - otherwise → embedded PGlite (real PostgreSQL compiled to WASM) for local
 *   development and tests, persisted in `CODERX_PGLITE_DIR` (default `.data/pglite`)
 *   or in memory when the directory is `memory://`.
 *
 * Both drivers expose the same Drizzle `PgDatabase` API, so queries and migrations
 * are identical everywhere.
 */
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Database = PgDatabase<PgQueryResultHKT, Schema>;

export interface DbHandle {
  db: Database;
  driver: "pg" | "pglite";
  close(): Promise<void>;
}

export interface CreateDbOptions {
  url?: string;
  pgliteDir?: string;
}

export async function createDbHandle(options: CreateDbOptions = {}): Promise<DbHandle> {
  const url = options.url ?? process.env.DATABASE_URL;

  if (url) {
    const [{ Pool }, { drizzle }] = await Promise.all([import("pg"), import("drizzle-orm/node-postgres")]);
    const pool = new Pool({
      connectionString: url,
      max: Number(process.env.CODERX_DB_POOL_MAX ?? 5),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    if (process.env.VERCEL) {
      const { attachDatabasePool } = await import("@vercel/functions");
      attachDatabasePool(pool);
    }
    const db = drizzle(pool, { schema }) as unknown as Database;
    return { db, driver: "pg", close: () => pool.end() };
  }

  if (process.env.VERCEL) {
    throw new Error("DATABASE_URL is not configured for this deployment.");
  }

  const [{ PGlite }, { pg_trgm }, { drizzle }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("@electric-sql/pglite/contrib/pg_trgm"),
    import("drizzle-orm/pglite"),
  ]);
  const dir = options.pgliteDir ?? process.env.CODERX_PGLITE_DIR ?? ".data/pglite";
  if (dir !== "memory://") {
    const { mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(dir), { recursive: true });
  }
  // Pass "memory://" through as-is: `new PGlite(undefined, opts)` selects the options-only overload and drops `extensions`.
  const client = new PGlite(dir, { extensions: { pg_trgm } });
  await client.waitReady;
  const db = drizzle(client, { schema }) as unknown as Database;
  return { db, driver: "pglite", close: () => client.close() };
}

type GlobalWithDb = typeof globalThis & { __coderxDb?: Promise<DbHandle> };

/** Process-wide shared handle (survives dev-server hot reloads). */
export function getDbHandle(): Promise<DbHandle> {
  const g = globalThis as GlobalWithDb;
  if (!g.__coderxDb) {
    g.__coderxDb = createDbHandle().catch((error: unknown) => {
      g.__coderxDb = undefined;
      throw error;
    });
  }
  return g.__coderxDb;
}

export async function getDb(): Promise<Database> {
  return (await getDbHandle()).db;
}

/** Normalize `db.execute()` results across drivers. */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown[] } | null)?.rows;
  return (rows ?? []) as T[];
}
