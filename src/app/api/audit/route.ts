import { z } from "zod";
import { fail, handle, ok } from "@/lib/api/envelope";
import { issues } from "@/lib/api/validation";
import { MAX_AUDIT_ITEMS } from "@/lib/audit-input";
import { auditItems } from "@/lib/data/tools";
import { normalizeHcpcs } from "@/lib/hcpcs";
import { parseNdc } from "@/lib/ndc";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 128 * 1024;

const bodySchema = z.object({
  items: z
    .array(z.object({ hcpcs: z.string().trim().max(10).nullish(), ndc: z.string().trim().max(24).nullish() }).refine((i) => !!(i.hcpcs || i.ndc), "Each item needs a HCPCS code or an NDC."))
    .min(1)
    .max(MAX_AUDIT_ITEMS, `Send at most ${MAX_AUDIT_ITEMS} items per request.`),
});

/**
 * POST /api/audit  { items: [{ hcpcs?: "J9312", ndc?: "50242-0051-21" }, …] }
 * Checks each code / NDC (and each pair) against the imported CMS and FDA data.
 * Codes and NDCs only — never send patient information.
 */
export async function POST(request: Request) {
  return handle(request, "api.audit", async () => {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return fail("INVALID_PARAMETER", "Request body is too large.", { request });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail("INVALID_PARAMETER", 'Send a JSON body: { "items": [{ "hcpcs": "J9312", "ndc": "50242-0051-21" }] }.', { request });
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return fail("INVALID_PARAMETER", "Invalid audit request.", { request, details: issues(parsed.error) });
    const invalid: { index: number; field: string; message: string }[] = [];
    const items = parsed.data.items.map((item, index) => {
      const hcpcs = item.hcpcs ? normalizeHcpcs(item.hcpcs) : null;
      if (item.hcpcs && !hcpcs) invalid.push({ index, field: "hcpcs", message: `“${item.hcpcs}” is not a HCPCS Level II code.` });
      let ndc11: string | null = null;
      if (item.ndc) {
        const p = parseNdc(item.ndc);
        if (p.kind === "package") ndc11 = p.ndc11;
        else invalid.push({ index, field: "ndc", message: p.kind === "invalid" ? p.reason : `“${item.ndc}” is not an unambiguous package NDC.` });
      }
      return { hcpcs, ndc11 };
    });
    const result = await auditItems(items);
    return ok(result.rows, { provenance: result.provenance, paymentPeriod: result.paymentPeriod, crosswalkPeriod: result.crosswalkPeriod, invalid }, { request, cache: false });
  });
}
