import { fail, handle, ok } from "@/lib/api/envelope";
import { issues, searchParamsToObject, suggestParamsSchema } from "@/lib/api/validation";
import { suggest } from "@/lib/search/engine";

export const dynamic = "force-dynamic";

/** GET /api/suggest?q=… — grouped type-ahead suggestions (Drugs, HCPCS codes, NDC packages, Manufacturers). */
export async function GET(request: Request) {
  return handle(request, "api.suggest", async () => {
    const parsed = suggestParamsSchema.safeParse(searchParamsToObject(new URL(request.url)));
    if (!parsed.success) return fail("INVALID_PARAMETER", "Invalid query.", { request, details: issues(parsed.error) });
    const result = await suggest(parsed.data.q);
    return ok(
      { groups: result.groups, notices: result.notices },
      { match: { query: result.query.display, queryType: result.query.type, tookMs: result.tookMs } },
      { request },
    );
  });
}
