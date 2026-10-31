import { fail, handle, ok } from "@/lib/api/envelope";
import { hcpcsCodeSchema, issues } from "@/lib/api/validation";
import { cachedHcpcsDetail } from "@/lib/data/cached";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  return handle(request, "api.hcpcs", async () => {
    const parsed = hcpcsCodeSchema.safeParse((await params).code);
    if (!parsed.success) return fail("INVALID_PARAMETER", "Invalid HCPCS code.", { request, details: issues(parsed.error) });
    const detail = await cachedHcpcsDetail(parsed.data);
    if (!detail) return fail("NOT_FOUND", `${parsed.data} is not in the CMS HCPCS Level II files imported by CodeRx.`, { request });
    // MultiCare benchmark rows are password protected on the site and never served by the API.
    const { provenance, hospitalRates, ...data } = detail;
    void hospitalRates;
    return ok(data, { provenance, match: { code: parsed.data } }, { request });
  });
}
