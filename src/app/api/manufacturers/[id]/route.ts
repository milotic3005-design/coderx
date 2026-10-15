import { fail, handle, ok } from "@/lib/api/envelope";
import { issues, manufacturerIdSchema } from "@/lib/api/validation";
import { cachedManufacturerDetail } from "@/lib/data/cached";

export const dynamic = "force-dynamic";

/** id = numeric manufacturer id or slug. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, "api.manufacturer", async () => {
    const parsed = manufacturerIdSchema.safeParse((await params).id);
    if (!parsed.success) return fail("INVALID_PARAMETER", "Invalid manufacturer identifier.", { request, details: issues(parsed.error) });
    const detail = await cachedManufacturerDetail(parsed.data);
    if (!detail) return fail("NOT_FOUND", `No manufacturer '${parsed.data}'.`, { request });
    const { provenance, ...data } = detail;
    return ok(data, { provenance }, { request });
  });
}
