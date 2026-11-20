import { gunzipSync } from "node:zlib";
import { revalidateTag } from "next/cache";
import { bearerMatches } from "@/lib/api/auth";
import { fail, handle, ok } from "@/lib/api/envelope";
import { issues } from "@/lib/api/validation";
import { DATA_TAG } from "@/lib/data/cached";
import { getDb } from "@/lib/db/client";
import { importSocUpload, SOC_UPLOAD_MAX_BYTES, socUploadSchema } from "@/ingest/soc-policies";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/admin/soc-policies   Authorization: Bearer $CODERX_ADMIN_TOKEN   (Content-Encoding: gzip allowed)
 * Body: one payer's site-of-care policy, any future version, and its drug list, read on the operator's Mac by
 * scripts/refresh-soc-policies.ts. Replaces the payer's current release; identical data is skipped unless force.
 */
export async function POST(request: Request) {
  return handle(request, "api.admin.soc-policies", async () => {
    if (!process.env.CODERX_ADMIN_TOKEN) return fail("NOT_FOUND", "Not found.", { request });
    if (!bearerMatches(request, process.env.CODERX_ADMIN_TOKEN)) {
      return fail("UNAUTHORIZED", "A valid administrator token is required.", { request, headers: { "WWW-Authenticate": "Bearer" } });
    }
    let body: unknown;
    try {
      const raw = Buffer.from(await request.arrayBuffer());
      const gzipped = (request.headers.get("content-encoding") ?? "").toLowerCase().includes("gzip");
      if (!gzipped && raw.byteLength > SOC_UPLOAD_MAX_BYTES) return fail("INVALID_PARAMETER", "Body is too large.", { request });
      body = JSON.parse((gzipped ? gunzipSync(raw, { maxOutputLength: SOC_UPLOAD_MAX_BYTES }) : raw).toString("utf8"));
    } catch {
      return fail("INVALID_PARAMETER", "Body must be JSON (optionally gzip-compressed) under the size limit.", { request });
    }
    const parsed = socUploadSchema.safeParse(body);
    if (!parsed.success) return fail("INVALID_PARAMETER", "Invalid site-of-care policy upload.", { request, details: issues(parsed.error).slice(0, 20) });
    const result = await importSocUpload(await getDb(), parsed.data);
    if (result.status === "imported") revalidateTag(DATA_TAG, "max");
    return ok(result, {}, { request, cache: false });
  });
}
