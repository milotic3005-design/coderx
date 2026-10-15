import { revalidateTag } from "next/cache";
import { bearerMatches } from "@/lib/api/auth";
import { fail, handle, ok } from "@/lib/api/envelope";
import { DATA_TAG } from "@/lib/data/cached";
import { getDb } from "@/lib/db/client";
import { refreshSources } from "@/ingest/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Invoked daily by Vercel Cron (vercel.json). Vercel sends `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: Request) {
  return handle(request, "api.cron.refresh", async () => {
    if (!bearerMatches(request, process.env.CRON_SECRET, 16)) return fail("UNAUTHORIZED", "Unauthorized.", { request });
    const result = await refreshSources(await getDb(), { trigger: "cron", budgetMs: 240_000 });
    if (result.derived) revalidateTag(DATA_TAG, "max");
    return ok(
      {
        runId: result.runId,
        imported: result.outcomes.filter((o) => o.status === "imported").map((o) => `${o.sourceKey} ${o.period}`),
        failed: result.outcomes.filter((o) => o.status === "failed").map((o) => ({ source: o.sourceKey, period: o.period, reason: o.reason })),
        skipped: result.skipped,
        durationMs: result.durationMs,
      },
      {},
      { request, cache: false },
    );
  });
}
