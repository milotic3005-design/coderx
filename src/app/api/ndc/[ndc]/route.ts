import { fail, handle, ok } from "@/lib/api/envelope";
import { issues, ndcSchema } from "@/lib/api/validation";
import { cachedNdcDetail } from "@/lib/data/cached";
import { formatNdc11 } from "@/lib/ndc";

export const dynamic = "force-dynamic";

/** Accepts any unambiguous NDC format (4-4-2, 5-3-2, 5-4-1, 5-4-2, 11 digits). */
export async function GET(request: Request, { params }: { params: Promise<{ ndc: string }> }) {
  return handle(request, "api.ndc", async () => {
    const parsed = ndcSchema.safeParse((await params).ndc);
    if (!parsed.success) return fail("INVALID_PARAMETER", "Invalid NDC.", { request, details: issues(parsed.error) });
    const detail = await cachedNdcDetail(parsed.data);
    if (!detail) {
      return fail("NOT_FOUND", `NDC ${formatNdc11(parsed.data)} is not in the CodeRx index (FDA-listed clinician-administered products and CMS-crosswalked NDCs).`, { request });
    }
    const { provenance, ...data } = detail;
    return ok(data, { provenance, match: { ndc11: parsed.data, formatted: formatNdc11(parsed.data) } }, { request });
  });
}
