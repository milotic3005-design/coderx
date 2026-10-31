import { revalidateTag } from "next/cache";
import { bearerMatches } from "@/lib/api/auth";
import { fail, handle, ok } from "@/lib/api/envelope";
import { issues } from "@/lib/api/validation";
import { DATA_TAG } from "@/lib/data/cached";
import { getDb } from "@/lib/db/client";
import { hospitalRatesSchema, importHospitalRates } from "@/ingest/hospital-import";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/admin/hospital-rates   Authorization: Bearer $CODERX_ADMIN_TOKEN
 * Body: one hospital's anonymized drug rates, built on the operator's Mac by
 * scripts/refresh-price-benchmark.ts (no payer or plan names). Replaces that hospital's
 * current release; an identical file (same SHA-256) is skipped unless force is set.
 */
export async function POST(request: Request) {
  return handle(request, "api.admin.hospital-rates", async () => {
    if (!process.env.CODERX_ADMIN_TOKEN) return fail("NOT_FOUND", "Not found.", { request });
    if (!bearerMatches(request, process.env.CODERX_ADMIN_TOKEN)) {
      return fail("UNAUTHORIZED", "A valid administrator token is required.", { request, headers: { "WWW-Authenticate": "Bearer" } });
    }
    let body: unknown;
    try {
      body = JSON.parse(await request.text());
    } catch {
      return fail("INVALID_PARAMETER", "Body must be JSON.", { request });
    }
    const parsed = hospitalRatesSchema.safeParse(body);
    if (!parsed.success) return fail("INVALID_PARAMETER", "Invalid hospital rates upload.", { request, details: issues(parsed.error).slice(0, 20) });
    const result = await importHospitalRates(await getDb(), parsed.data);
    if (result.status === "imported") revalidateTag(DATA_TAG, "max");
    return ok(result, {}, { request, cache: false });
  });
}
