import type { PgTable } from "drizzle-orm/pg-core";
import type { Database } from "@/lib/db/client";

/** Transaction or database handle — a Drizzle transaction is a `PgDatabase` subclass. */
export type Tx = Database;

export function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Insert in batches that stay well under PostgreSQL's 65,535 bind-parameter limit.
 * `columns` is the number of columns per row being inserted.
 */
export async function insertBatches<T extends object>(tx: Tx, table: PgTable, rows: T[], columns: number): Promise<number> {
  if (rows.length === 0) return 0;
  const size = Math.max(1, Math.floor(30_000 / Math.max(1, columns)));
  for (const part of chunk(rows, size)) {
    await tx.insert(table).values(part as never);
  }
  return rows.length;
}
