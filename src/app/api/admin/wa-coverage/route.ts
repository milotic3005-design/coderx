import { gunzipSync } from "node:zlib";
import { revalidateTag } from "next/cache";
import { bearerMatches } from "@/lib/api/auth";
import { fail, handle, ok } from "@/lib/api/envelope";
import { issues } from "@/lib/api/validation";
import { DATA_TAG } from "@/lib/data/cached";
import { getDb } from "@/lib/db/client";
import { importWaUpload, WA_UPLOAD_MAX_BYTES, waUploadSchema } from "@/ingest/wa-formularies";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/admin/wa-coverage   Authorization: Bearer $CODERX_ADMIN_TOKEN   (Content-Encoding: gzip allowed)
 * Body: one Washington formulary dataset built on the operator's Mac by scripts/refresh-wa-coverage.ts:
 * the Apple Health PDL, one insurer's exchange formularies, or one week of NADAC (see src/ingest/wa-formularies.ts).
 * Replaces the current release in its scope; identical data (same SHA-256) is skipped unless force is set.
 */
export async function POST(request: Request) {
  return handle(request, "api.admin.wa-coverage", async () => {
    if (!process.env.CODERX_ADMIN_TOKEN) return fail("NOT_FOUND", "Not found.", { request });
    if (!bearerMatches(request, process.env.CODERX_ADMIN_TOKEN)) {
      return fail("UNAUTHORIZED", "A valid administrator token is required.", { request, headers: { "WWW-Authenticate": "Bearer" } });
    }
    let body: unknown;
    try {
      const raw = Buffer.from(await request.arrayBuffer());
      const gzipped = (request.headers.get("content-encoding") ?? "").toLowerCase().includes("gzip");
      if (!gzipped && raw.byteLength > WA_UPLOAD_MAX_BYTES) return fail("INVALID_PARAMETER", "Body is too large.", { request });
      const text = (gzipped ? gunzipSync(raw, { maxOutputLength: WA_UPLOAD_MAX_BYTES }) : raw).toString("utf8");
      body = JSON.parse(text);
    } catch {
      return fail("INVALID_PARAMETER", "Body must be JSON (optionally gzip-compressed) under the size limit.", { request });
    }
    const parsed = waUploadSchema.safeParse(body);
    if (!parsed.success) return fail("INVALID_PARAMETER", "Invalid Washington formulary upload.", { request, details: issues(parsed.error).slice(0, 20) });
    const result = await importWaUpload(await getDb(), parsed.data);
    if (result.status === "imported") revalidateTag(DATA_TAG, "max");
    return ok(result, {}, { request, cache: false });
  });
}
