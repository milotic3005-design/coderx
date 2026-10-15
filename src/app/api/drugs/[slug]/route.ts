import { fail, handle, ok } from "@/lib/api/envelope";
import { issues, slugSchema } from "@/lib/api/validation";
import { cachedDrugDetail } from "@/lib/data/cached";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(request, "api.drug", async () => {
    const parsed = slugSchema.safeParse((await params).slug);
    if (!parsed.success) return fail("INVALID_PARAMETER", "Invalid drug identifier.", { request, details: issues(parsed.error) });
    const detail = await cachedDrugDetail(parsed.data);
    if (!detail) return fail("NOT_FOUND", `No drug with slug '${parsed.data}'.`, { request });
    const { provenance, ...data } = detail;
    return ok(data, { provenance }, { request });
  });
}
