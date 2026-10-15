import { revalidateTag } from "next/cache";
import { bearerMatches } from "@/lib/api/auth";
import { fail, handle, ok } from "@/lib/api/envelope";
import { importBodySchema, issues } from "@/lib/api/validation";
import { DATA_TAG } from "@/lib/data/cached";
import { getDb } from "@/lib/db/client";
import { refreshSources } from "@/ingest/refresh";
import type { SourceKey } from "@/ingest/sources";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/admin/import   Authorization: Bearer $CODERX_ADMIN_TOKEN
 * Body: { "source": "all" | "<source key>", "force": false, "latestOnly": true }
 */
export async function POST(request: Request) {
  return handle(request, "api.admin.import", async () => {
    if (!process.env.CODERX_ADMIN_TOKEN) return fail("NOT_FOUND", "Not found.", { request });
    if (!bearerMatches(request, process.env.CODERX_ADMIN_TOKEN)) {
      return fail("UNAUTHORIZED", "A valid administrator token is required.", { request, headers: { "WWW-Authenticate": "Bearer" } });
    }
    let body: unknown = {};
    try {
      const text = await request.text();
      body = text ? JSON.parse(text) : {};
    } catch {
      return fail("INVALID_PARAMETER", "Body must be JSON.", { request });
    }
    const parsed = importBodySchema.safeParse(body);
    if (!parsed.success) return fail("INVALID_PARAMETER", "Invalid import request.", { request, details: issues(parsed.error) });
    const result = await refreshSources(await getDb(), {
      trigger: "admin",
      sources: parsed.data.source === "all" ? undefined : [parsed.data.source as SourceKey],
      force: parsed.data.force,
      fullHistory: !parsed.data.latestOnly,
      budgetMs: 250_000,
    });
    if (result.derived) revalidateTag(DATA_TAG, "max");
    return ok(
      {
        runId: result.runId,
        outcomes: result.outcomes.map((o) => ({ ...o, report: o.report ? { ...o.report, rejectedSamples: o.report.rejectedSamples.slice(0, 5) } : undefined })),
        skipped: result.skipped,
        derived: result.derived,
        discoveryErrors: result.discoveryErrors,
        durationMs: result.durationMs,
      },
      {},
      { request, cache: false },
    );
  });
}

export async function GET(request: Request) {
  return fail("METHOD_NOT_ALLOWED", "Use POST.", { request, headers: { Allow: "POST" } });
}
