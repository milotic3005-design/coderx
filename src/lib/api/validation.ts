/** zod schemas for every API and page parameter. */
import { z } from "zod";
import { SOURCE_KEYS } from "@/ingest/sources";
import { CODE_FAMILIES, normalizeHcpcs } from "@/lib/hcpcs";
import { parseNdc } from "@/lib/ndc";
import { MAX_QUERY_LENGTH } from "@/lib/search/parse";
import type { SearchFilters, SearchKind, SortOrder } from "@/lib/search/engine";

const csv = (allowed: readonly string[]) =>
  z
    .string()
    .max(200)
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .refine((list) => list.every((x) => allowed.includes(x)), { message: `Allowed values: ${allowed.join(", ")}` });

const KINDS = ["drug", "hcpcs", "ndc", "manufacturer"] as const;
const FAMILY_LETTERS = Object.keys(CODE_FAMILIES);

export const searchParamsSchema = z.object({
  q: z.string().trim().min(1, "Enter a search term.").max(MAX_QUERY_LENGTH, `Search terms are limited to ${MAX_QUERY_LENGTH} characters.`),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["relevance", "name", "code", "newest"]).default("relevance"),
  kind: csv(KINDS).optional(),
  family: z
    .string()
    .max(60)
    .transform((s) => s.toUpperCase().split(",").map((x) => x.trim()).filter(Boolean))
    .refine((l) => l.every((x) => FAMILY_LETTERS.includes(x)), { message: "Unknown code family." })
    .optional(),
  status: z.enum(["active", "inactive", "all"]).default("all"),
  manufacturer: z.string().max(120).regex(/^[a-z0-9-]+$/, "Manufacturer must be a slug.").optional(),
  form: z.string().max(120).optional(),
  route: z.string().max(80).optional(),
  brand: z.enum(["brand", "generic"]).optional(),
  biosimilar: z.enum(["biosimilar", "interchangeable", "reference", "any"]).optional(),
  payment: z.enum(["yes", "no"]).optional(),
  noc: z.enum(["1", "true"]).optional(),
  effectiveOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.").optional(),
});

export type SearchParamsInput = z.infer<typeof searchParamsSchema>;

export function toSearchOptions(p: SearchParamsInput): { page: number; pageSize: number; sort: SortOrder; filters: SearchFilters } {
  return {
    page: p.page,
    pageSize: p.pageSize,
    sort: p.sort,
    filters: {
      kinds: p.kind as SearchKind[] | undefined,
      families: p.family,
      status: p.status,
      manufacturer: p.manufacturer,
      form: p.form,
      route: p.route,
      brand: p.brand,
      biosimilar: p.biosimilar,
      payment: p.payment,
      noc: !!p.noc,
      effectiveOn: p.effectiveOn,
    },
  };
}

export const suggestParamsSchema = z.object({
  q: z.string().trim().min(1).max(MAX_QUERY_LENGTH),
});

export const slugSchema = z.string().min(1).max(160).regex(/^[a-z0-9-]+$/, "Invalid slug.");

export const hcpcsCodeSchema = z
  .string()
  .trim()
  .transform((s, ctx) => {
    const code = normalizeHcpcs(s);
    if (!code) {
      ctx.addIssue({ code: "custom", message: "A HCPCS Level II code is one letter followed by four digits (for example J9271)." });
      return z.NEVER;
    }
    return code;
  });

export const ndcSchema = z
  .string()
  .trim()
  .max(20)
  .transform((s, ctx) => {
    const parsed = parseNdc(decodeURIComponent(s));
    if (parsed.kind === "package") return parsed.ndc11;
    ctx.addIssue({
      code: "custom",
      message:
        parsed.kind === "ambiguous"
          ? "A 10-digit NDC without hyphens is ambiguous. Use the hyphenated form (4-4-2, 5-3-2, or 5-4-1) or the 11-digit form."
          : parsed.kind === "product"
            ? "This is a product NDC (labeler-product). Provide a full package NDC, or use /api/search?q=."
            : parsed.reason,
    });
    return z.NEVER;
  });

export const manufacturerIdSchema = z.string().min(1).max(160).regex(/^([0-9]+|[a-z0-9-]+)$/, "Use a numeric id or a slug.");

export const importBodySchema = z.object({
  source: z.enum(["all", ...SOURCE_KEYS] as [string, ...string[]]).default("all"),
  force: z.boolean().default(false),
  /** Only the newest release of each quarterly source (faster). */
  latestOnly: z.boolean().default(true),
});

export function issues(error: z.ZodError) {
  return error.issues.map((i) => ({ field: i.path.join(".") || "value", message: i.message }));
}

export function searchParamsToObject(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of url.searchParams) if (v !== "") out[k] = v;
  return out;
}
