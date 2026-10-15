import { handle, ok } from "@/lib/api/envelope";
import { cachedSources } from "@/lib/data/cached";
import { SOURCES } from "@/ingest/sources";

export const dynamic = "force-dynamic";

/** Every import attempt (succeeded, superseded, failed) with checksums and effective dates. */
export async function GET(request: Request) {
  return handle(request, "api.sources", async () => {
    const { releases } = await cachedSources();
    return ok(
      { sources: Object.values(SOURCES), releases: releases.map(({ report, ...r }) => ({ ...r, reportSummary: report ? { warnings: (report.warnings as unknown[] | undefined)?.length ?? 0, rejected: report.rejected ?? 0 } : null })) },
      { pagination: { page: 1, pageSize: releases.length, total: releases.length, totalPages: 1 } },
      { request },
    );
  });
}
