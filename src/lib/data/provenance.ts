import { inArray } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { SOURCES, type SourceKey } from "@/ingest/sources";

import type { DataStatus } from "./status";

export { STATUS_LABELS, type DataStatus } from "./status";

export interface Provenance {
  releaseId: number;
  sourceKey: string;
  organization: string;
  dataset: string;
  period: string | null;
  publicationDate: string | null;
  publicationLabel: string | null;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  importedAt: string;
  url: string;
  landingPageUrl: string | null;
  checksum: string | null;
  isCurrent: boolean;
  status: DataStatus;
}

export type ReleaseRow = typeof t.sourceReleases.$inferSelect;

export function toProvenance(r: ReleaseRow, status?: DataStatus): Provenance {
  const def = SOURCES[r.sourceKey as SourceKey];
  return {
    releaseId: r.id,
    sourceKey: r.sourceKey,
    organization: r.organization,
    dataset: r.dataset,
    period: r.periodLabel,
    publicationDate: r.publicationDate,
    publicationLabel: r.publicationLabel,
    effectiveStart: r.effectiveStart,
    effectiveEnd: r.effectiveEnd,
    importedAt: r.importedAt,
    url: r.downloadUrl,
    landingPageUrl: r.landingPageUrl ?? def?.landingPageUrl ?? null,
    checksum: r.checksumSha256,
    isCurrent: r.isCurrent,
    status: status ?? (def?.badge ?? "verification-needed"),
  };
}

/** All successful releases keyed by id, plus the newest current release per source. */
export async function loadReleases(db: Database) {
  const all = await db.select().from(t.sourceReleases).where(inArray(t.sourceReleases.status, ["succeeded", "superseded"]));
  const rows = all.filter((r) => r.status === "succeeded");
  const byId = new Map<number, ReleaseRow>(all.map((r) => [r.id, r]));
  const latest = new Map<string, ReleaseRow>();
  for (const r of rows) {
    if (!r.isCurrent) continue;
    const prev = latest.get(r.sourceKey);
    if (!prev || (r.periodLabel ?? "") > (prev.periodLabel ?? "")) latest.set(r.sourceKey, r);
  }
  return { byId, latest };
}
