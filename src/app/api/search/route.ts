import { fail, handle, ok } from "@/lib/api/envelope";
import { issues, searchParamsSchema, searchParamsToObject, toSearchOptions } from "@/lib/api/validation";
import { search } from "@/lib/search/engine";
import { QUERY_TYPE_LABELS } from "@/lib/search/parse";

export const dynamic = "force-dynamic";

/** GET /api/search?q=…&page=&pageSize=&sort=&kind=&family=&status=&manufacturer=&form=&route=&brand=&biosimilar=&payment=&noc=&effectiveOn= */
export async function GET(request: Request) {
  return handle(request, "api.search", async () => {
    const parsed = searchParamsSchema.safeParse(searchParamsToObject(new URL(request.url)));
    if (!parsed.success) return fail("INVALID_PARAMETER", "Invalid search parameters.", { request, details: issues(parsed.error) });
    const result = await search(parsed.data.q, toSearchOptions(parsed.data));
    return ok(
      { hits: result.hits, facets: result.facets, notices: result.notices },
      {
        pagination: { page: result.page, pageSize: result.pageSize, total: result.total, totalPages: result.totalPages },
        match: {
          query: result.query.display,
          queryType: result.query.type,
          queryTypeLabel: QUERY_TYPE_LABELS[result.query.type],
          normalized: result.query.hcpcsCode ?? result.query.normalized,
          ndc11Candidates: result.query.ndc11Candidates,
          expansions: result.query.expansions,
          ambiguous: result.ambiguous,
          tookMs: result.tookMs,
        },
      },
      { request },
    );
  });
}
