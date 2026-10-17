/**
 * Search engine over `search_documents` / `search_terms` plus direct NDC lookups.
 *
 * Ranking (see docs/03-architecture.md §6):
 *   exact code/NDC (100) → exact brand/generic (90) → exact manufacturer name (88)
 *   → exact alias / abbreviation (80) → prefix (70) → related via CMS crosswalk (65)
 *   → ingredient/descriptor word (60) → manufacturer (50) → all words (40) → fuzzy (30);
 *   inactive/historical records sort after active ones (exact code matches excepted).
 */
import { sql, type SQL } from "drizzle-orm";
import { todayUs } from "@/lib/dates";
import { getDb, rowsOf, type Database } from "@/lib/db/client";
import { formatNdc11 } from "@/lib/ndc";
import { escapeLike } from "@/lib/text";
import { parseQuery, type ParsedQuery } from "./parse";

export type SearchKind = "drug" | "hcpcs" | "ndc" | "manufacturer";

export type MatchType =
  | "exact_code"
  | "exact_ndc"
  | "exact_name"
  | "exact_manufacturer"
  | "alias"
  | "abbreviation"
  | "prefix"
  | "related"
  | "ingredient"
  | "manufacturer"
  | "all_words"
  | "fuzzy";

export const TIERS: Record<MatchType, number> = {
  exact_code: 100,
  exact_ndc: 100,
  exact_name: 90,
  exact_manufacturer: 88,
  alias: 80,
  abbreviation: 80,
  prefix: 70,
  related: 65,
  ingredient: 60,
  manufacturer: 50,
  all_words: 40,
  fuzzy: 30,
};

export interface SearchFilters {
  kinds?: SearchKind[];
  families?: string[];
  status?: "active" | "inactive" | "all";
  manufacturer?: string;
  form?: string;
  route?: string;
  brand?: "brand" | "generic";
  biosimilar?: "biosimilar" | "interchangeable" | "reference" | "any";
  payment?: "yes" | "no";
  effectiveOn?: string;
  noc?: boolean;
}

export type SortOrder = "relevance" | "name" | "code" | "newest";

export interface SearchOptions {
  page?: number;
  pageSize?: number;
  sort?: SortOrder;
  filters?: SearchFilters;
}

export interface SearchHit {
  kind: SearchKind;
  key: string;
  title: string;
  subtitle: string | null;
  href: string;
  family: string | null;
  codes: string[];
  manufacturerNames: string[];
  routes: string[];
  dosageForms: string[];
  productClass: string | null;
  isBrand: boolean | null;
  biosimilarStatus: string | null;
  hasPayment: boolean;
  isNoc: boolean;
  isActive: boolean;
  statusEndDate: string | null;
  effectiveDate: string | null;
  match: { type: MatchType; label: string; matched?: string };
  tier: number;
  similarity: number;
  /** NDC hits only. */
  ndc?: { ndc11: string; formatted: string; listing: "listed" | "excluded" | "cms-only"; packageDescription: string | null; drugSlug: string | null };
}

export interface FacetValue {
  value: string;
  label: string;
  count: number;
}

export interface Facets {
  kinds: Record<string, number>;
  families: Record<string, number>;
  status: { active: number; inactive: number };
  payment: number;
  manufacturers: FacetValue[];
  forms: FacetValue[];
  routes: FacetValue[];
}

export interface SearchResult {
  query: ParsedQuery;
  hits: SearchHit[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  ambiguous: boolean;
  notices: string[];
  facets: Facets;
  tookMs: number;
}

function hrefFor(kind: SearchKind, key: string): string {
  switch (kind) {
    case "drug":
      return `/drugs/${key}`;
    case "hcpcs":
      return `/hcpcs/${key}`;
    case "manufacturer":
      return `/manufacturers/${key}`;
    case "ndc":
      return `/ndc/${formatNdc11(key)}`;
  }
}

const TERM_TYPE_LABEL: Record<string, string> = {
  code: "code",
  brand: "brand name",
  generic: "generic name",
  alias: "alias",
  ingredient: "active ingredient",
  descriptor: "HCPCS descriptor word",
  manufacturer: "manufacturer",
  manufacturer_name: "manufacturer name",
};

function matchFromTier(tier: number, termType: string | null, term: string | null, viaExpansion: string | null): SearchHit["match"] {
  const what = termType ? (TERM_TYPE_LABEL[termType] ?? termType) : "text";
  if (viaExpansion && tier >= 60) return { type: "abbreviation", label: `Abbreviation expanded to “${viaExpansion}”`, matched: term ?? undefined };
  if (tier >= 100) return { type: "exact_code", label: termType === "code" ? "Exact code match" : "Exact match", matched: term ?? undefined };
  if (tier >= 90) return { type: "exact_name", label: `Exact ${what} match`, matched: term ?? undefined };
  if (tier >= 88) return { type: "exact_manufacturer", label: "Exact manufacturer name", matched: term ?? undefined };
  if (tier >= 80) return { type: "alias", label: termType === "alias" ? "Matched an alias or CMS drug name" : `Exact ${what}`, matched: term ?? undefined };
  if (tier >= 70) return { type: "prefix", label: `Starts with your search (${what})`, matched: term ?? undefined };
  if (tier >= 60) return { type: "ingredient", label: termType === "descriptor" ? "Word in the HCPCS descriptor" : "Active ingredient match", matched: term ?? undefined };
  if (tier >= 50) return { type: "manufacturer", label: "Manufacturer match", matched: term ?? undefined };
  if (tier >= 40) return { type: "all_words", label: "All of your words matched", matched: term ?? undefined };
  return { type: "fuzzy", label: term ? `Similar spelling: “${term}”` : "Similar spelling", matched: term ?? undefined };
}

interface DocRow {
  id: number;
  kind: SearchKind;
  key: string;
  title: string;
  subtitle: string | null;
  family: string | null;
  codes: string[];
  manufacturer_names: string[];
  routes: string[];
  dosage_forms: string[];
  product_class: string | null;
  is_brand: boolean | null;
  biosimilar_status: string | null;
  has_payment: boolean;
  is_noc: boolean;
  status_end_date: string | null;
  effective_date: string | null;
  weight: number;
  is_active: boolean;
  tier: number;
  sim: number;
  term: string | null;
  term_type: string | null;
  via: string | null;
  total: string | number;
}

function filterSql(f: SearchFilters | undefined): SQL {
  const parts: SQL[] = [sql`TRUE`];
  if (!f) return parts[0];
  if (f.kinds?.length) parts.push(sql`d.kind IN (${sql.join(f.kinds.map((k) => sql`${k}`), sql`, `)})`);
  if (f.families?.length) parts.push(sql`(d.kind <> 'hcpcs' OR d.family IN (${sql.join(f.families.map((k) => sql`${k}`), sql`, `)}))`);
  if (f.status === "active") parts.push(sql`(d.is_listed AND (d.status_end_date IS NULL OR d.status_end_date >= CURRENT_DATE))`);
  if (f.status === "inactive") parts.push(sql`NOT (d.is_listed AND (d.status_end_date IS NULL OR d.status_end_date >= CURRENT_DATE))`);
  if (f.manufacturer) parts.push(sql`${f.manufacturer} = ANY(d.manufacturer_slugs)`);
  if (f.form) parts.push(sql`${f.form} = ANY(d.dosage_forms)`);
  if (f.route) parts.push(sql`${f.route} = ANY(d.routes)`);
  if (f.brand === "brand") parts.push(sql`(d.kind <> 'drug' OR d.is_brand)`);
  if (f.brand === "generic") parts.push(sql`(d.kind <> 'drug' OR NOT d.is_brand)`);
  if (f.biosimilar === "any") parts.push(sql`d.biosimilar_status IN ('biosimilar','interchangeable')`);
  else if (f.biosimilar) parts.push(sql`d.biosimilar_status = ${f.biosimilar}`);
  if (f.payment === "yes") parts.push(sql`d.has_payment`);
  if (f.payment === "no") parts.push(sql`NOT d.has_payment`);
  if (f.noc) parts.push(sql`d.is_noc`);
  if (f.effectiveOn)
    parts.push(sql`((d.effective_date IS NULL OR d.effective_date <= ${f.effectiveOn}::date) AND (d.status_end_date IS NULL OR d.status_end_date >= ${f.effectiveOn}::date))`);
  return sql.join(parts, sql` AND `);
}

function orderSql(sort: SortOrder): SQL {
  switch (sort) {
    case "name":
      return sql`lower(x.title) ASC, x.key ASC`;
    case "code":
      return sql`(x.kind = 'hcpcs') DESC, x.key ASC`;
    case "newest":
      return sql`x.effective_date DESC NULLS LAST, x.tier DESC, x.key ASC`;
    default:
      return sql`(x.tier >= 100) DESC, x.is_active DESC, x.tier DESC, x.sim DESC, x.weight DESC, lower(x.title) ASC, x.key ASC`;
  }
}

/** Whole-phrase candidate SQL for one query variant. */
function phraseSql(variant: string, via: string | null): SQL {
  const pre = `${escapeLike(variant)}%`;
  const fuzzy = variant.length >= 4;
  const capAbbrev = via ? sql`LEAST(80, ` : sql`(`;
  return sql`
    SELECT t.doc_id, t.term, t.term_type, ${via}::text AS via,
      ${capAbbrev}CASE
        WHEN t.term = ${variant} AND t.term_type = 'code' THEN 100
        WHEN t.term = ${variant} AND t.term_type IN ('brand','generic') THEN 90
        WHEN t.term = ${variant} AND t.term_type = 'manufacturer_name' THEN 88
        WHEN t.term = ${variant} AND t.term_type = 'alias' THEN 80
        WHEN t.term LIKE ${pre} AND t.term_type IN ('code','brand','generic','alias','manufacturer_name') THEN 70
        WHEN t.term LIKE ${pre} AND t.term_type IN ('ingredient','descriptor') THEN 60
        WHEN t.term LIKE ${pre} AND t.term_type = 'manufacturer' THEN 50
        WHEN ${sql.raw(fuzzy ? "TRUE" : "FALSE")} AND similarity(t.term, ${variant}) >= 0.35 THEN 30
        ELSE 0 END) AS tier,
      similarity(t.term, ${variant}) AS sim
    FROM search_terms t
    WHERE t.term LIKE ${pre} ${fuzzy ? sql`OR t.term % ${variant}` : sql``}`;
}

/** Every token must match a term of the same document (exact, prefix, or fuzzy). */
function tokensSql(tokens: string[]): SQL {
  const parts = tokens.map((tok, i) => {
    const pre = `${escapeLike(tok)}%`;
    const fuzzy = tok.length >= 4;
    return sql`
      SELECT t.doc_id, ${i}::int AS ti, MAX(CASE WHEN t.term = ${tok} THEN 3 WHEN t.term LIKE ${pre} THEN 2 ELSE 1 END) AS s, MIN(t.term) AS term
      FROM search_terms t
      WHERE t.term LIKE ${pre} ${fuzzy ? sql`OR (t.term % ${tok} AND similarity(t.term, ${tok}) >= 0.4)` : sql``}
      GROUP BY t.doc_id`;
  });
  return sql`
    SELECT doc_id, NULL::text AS term, NULL::text AS term_type, NULL::text AS via, 40 AS tier, SUM(s)::float / ${tokens.length * 3} AS sim
    FROM (${sql.join(parts, sql` UNION ALL `)}) tm
    GROUP BY doc_id
    HAVING COUNT(DISTINCT ti) = ${tokens.length}`;
}

async function textSearch(db: Database, q: ParsedQuery, opts: Required<Pick<SearchOptions, "page" | "pageSize" | "sort">> & { filters?: SearchFilters }) {
  const variants: { text: string; via: string | null }[] = [{ text: q.normalized, via: null }, ...q.expansions.map((e) => ({ text: e.to, via: e.to }))];
  const candidateParts: SQL[] = variants.map((v) => phraseSql(v.text, v.via));
  if (q.tokens.length >= 2) candidateParts.push(tokensSql(q.tokens.slice(0, 6)));
  if (q.type === "hcpcs_prefix" && q.hcpcsPrefix) candidateParts.push(phraseSql(q.hcpcsPrefix.toLowerCase(), null));

  const statement = sql`
    WITH cand AS (${sql.join(candidateParts, sql` UNION ALL `)}),
    ranked AS (
      SELECT DISTINCT ON (doc_id) doc_id, tier, sim, term, term_type, via
      FROM cand WHERE tier > 0
      ORDER BY doc_id, tier DESC, sim DESC
    ),
    -- Fuzzy-only matches are a fallback: drop them when anything matched more directly.
    best AS (SELECT * FROM ranked WHERE tier > 30 OR (SELECT MAX(tier) FROM ranked) <= 30),
    x AS (
      SELECT d.id, d.kind, d.key, d.title, d.subtitle, d.family, d.codes, d.manufacturer_names, d.routes, d.dosage_forms,
        d.product_class, d.is_brand, d.biosimilar_status, d.has_payment, d.is_noc, d.status_end_date::text, d.effective_date::text, d.weight,
        (d.is_listed AND (d.status_end_date IS NULL OR d.status_end_date >= CURRENT_DATE)) AS is_active,
        b.tier, b.sim, b.term, b.term_type, b.via
      FROM best b JOIN search_documents d ON d.id = b.doc_id
      WHERE ${filterSql(opts.filters)}
    )
    SELECT x.*, COUNT(*) OVER () AS total FROM x
    ORDER BY ${orderSql(opts.sort)}
    LIMIT ${opts.pageSize} OFFSET ${(opts.page - 1) * opts.pageSize}`;

  const facetStatement = sql`
    WITH cand AS (${sql.join(candidateParts, sql` UNION ALL `)}),
    ranked AS (SELECT doc_id, MAX(tier) AS tier FROM cand WHERE tier > 0 GROUP BY doc_id),
    best AS (SELECT doc_id FROM ranked WHERE tier > 30 OR (SELECT MAX(tier) FROM ranked) <= 30)
    SELECT d.kind, d.family,
      (d.is_listed AND (d.status_end_date IS NULL OR d.status_end_date >= CURRENT_DATE)) AS is_active,
      d.has_payment, COUNT(*)::int AS n
    FROM best b JOIN search_documents d ON d.id = b.doc_id
    GROUP BY 1, 2, 3, 4`;

  const valueFacetStatement = sql`
    WITH cand AS (${sql.join(candidateParts, sql` UNION ALL `)}),
    ranked AS (SELECT doc_id, MAX(tier) AS tier FROM cand WHERE tier > 0 GROUP BY doc_id),
    docs AS (
      SELECT d.manufacturer_slugs, d.manufacturer_names, d.dosage_forms, d.routes
      FROM ranked b JOIN search_documents d ON d.id = b.doc_id
      WHERE b.tier > 30 OR (SELECT MAX(tier) FROM ranked) <= 30
    ),
    f AS (
      SELECT 'manufacturer' AS facet, m.slug AS value, m.name AS label FROM docs, unnest(docs.manufacturer_slugs, docs.manufacturer_names) AS m(slug, name)
      UNION ALL SELECT 'form', x, x FROM docs, unnest(docs.dosage_forms) AS x
      UNION ALL SELECT 'route', x, x FROM docs, unnest(docs.routes) AS x
    )
    SELECT facet, value, MIN(label) AS label, COUNT(*)::int AS n FROM f WHERE value IS NOT NULL GROUP BY facet, value ORDER BY facet, n DESC, value`;

  const [rows, facetRows, valueRows] = await Promise.all([db.execute(statement), db.execute(facetStatement), db.execute(valueFacetStatement)]);
  return {
    rows: rowsOf<DocRow>(rows),
    facetRows: rowsOf<{ kind: string; family: string | null; is_active: boolean; has_payment: boolean; n: number }>(facetRows),
    valueRows: rowsOf<{ facet: string; value: string; label: string; n: number }>(valueRows),
  };
}

async function docsByIds(db: Database, where: SQL, tier: number, filters: SearchFilters | undefined, limit = 50): Promise<DocRow[]> {
  const result = await db.execute(sql`
    SELECT d.id, d.kind, d.key, d.title, d.subtitle, d.family, d.codes, d.manufacturer_names, d.routes, d.dosage_forms,
      d.product_class, d.is_brand, d.biosimilar_status, d.has_payment, d.is_noc, d.status_end_date::text, d.effective_date::text, d.weight,
      (d.is_listed AND (d.status_end_date IS NULL OR d.status_end_date >= CURRENT_DATE)) AS is_active,
      ${tier}::int AS tier, 1::float AS sim, NULL::text AS term, 'code'::text AS term_type, NULL::text AS via, 0 AS total
    FROM search_documents d
    WHERE (${where}) AND ${filterSql(filters)}
    ORDER BY d.weight DESC, d.title ASC
    LIMIT ${limit}`);
  return rowsOf<DocRow>(result);
}

interface NdcRow {
  ndc11: string;
  package_ndc: string | null;
  description: string | null;
  listing_status: string | null;
  marketing_end: string | null;
  product_name: string | null;
  generic_name: string | null;
  labeler: string | null;
  drug_slug: string | null;
  cms_drug_name: string | null;
  cms_codes: string[] | null;
}

async function ndcLookup(db: Database, ndc11s: string[], productNdc9s: string[]): Promise<NdcRow[]> {
  if (!ndc11s.length && !productNdc9s.length) return [];
  const ndcCond = ndc11s.length ? sql`k.ndc11 IN (${sql.join(ndc11s.map((n) => sql`${n}`), sql`, `)})` : sql`FALSE`;
  const prodCond = productNdc9s.length ? sql`p.product_ndc9 IN (${sql.join(productNdc9s.map((n) => sql`${n}`), sql`, `)})` : sql`FALSE`;
  const xwCond = ndc11s.length ? sql`x.ndc11 IN (${sql.join(ndc11s.map((n) => sql`${n}`), sql`, `)})` : sql`FALSE`;
  const xwProdCond = productNdc9s.length ? sql`substr(x.ndc11, 1, 9) IN (${sql.join(productNdc9s.map((n) => sql`${n}`), sql`, `)})` : sql`FALSE`;
  const result = await db.execute(sql`
    WITH fda AS (
      SELECT k.ndc11, k.package_ndc, k.description, k.listing_status, k.marketing_end::text,
        concat_ws(' ', p.proprietary_name, p.proprietary_name_suffix) AS product_name, p.nonproprietary_name AS generic_name,
        p.labeler_name AS labeler, dr.slug AS drug_slug
      FROM ndc_packages k
      JOIN ndc_products p ON p.product_id = k.product_id
      LEFT JOIN drugs dr ON dr.id = p.drug_id
      WHERE ${ndcCond} OR ${prodCond}
    ),
    xw AS (
      SELECT x.ndc11, MAX(x.drug_name) AS cms_drug_name, MAX(x.labeler_name) AS labeler,
        array_agg(DISTINCT x.hcpcs_code) FILTER (WHERE x.hcpcs_code IS NOT NULL) AS cms_codes
      FROM ndc_hcpcs_crosswalk x
      JOIN source_releases r ON r.id = x.source_release_id AND r.is_current
      WHERE x.ndc11 IS NOT NULL AND (${xwCond} OR ${xwProdCond})
      GROUP BY x.ndc11
    )
    SELECT COALESCE(f.ndc11, xw.ndc11) AS ndc11, f.package_ndc, f.description, f.listing_status, f.marketing_end,
      f.product_name, f.generic_name, COALESCE(f.labeler, xw.labeler) AS labeler, f.drug_slug, xw.cms_drug_name, xw.cms_codes
    FROM fda f FULL OUTER JOIN xw ON xw.ndc11 = f.ndc11
    ORDER BY 1
    LIMIT 100`);
  return rowsOf<NdcRow>(result);
}

function toHit(r: DocRow): SearchHit {
  const match = matchFromTier(Number(r.tier), r.term_type, r.term, r.via);
  return {
    kind: r.kind,
    key: r.key,
    title: r.title,
    subtitle: r.subtitle,
    href: hrefFor(r.kind, r.key),
    family: r.family,
    codes: r.codes ?? [],
    manufacturerNames: r.manufacturer_names ?? [],
    routes: r.routes ?? [],
    dosageForms: r.dosage_forms ?? [],
    productClass: r.product_class,
    isBrand: r.is_brand,
    biosimilarStatus: r.biosimilar_status,
    hasPayment: !!r.has_payment,
    isNoc: !!r.is_noc,
    isActive: !!r.is_active,
    statusEndDate: r.status_end_date,
    effectiveDate: r.effective_date,
    match,
    tier: Number(r.tier),
    similarity: Number(r.sim),
  };
}

function emptyFacets(): Facets {
  return { kinds: {}, families: {}, status: { active: 0, inactive: 0 }, payment: 0, manufacturers: [], forms: [], routes: [] };
}

export async function search(rawQuery: string, options: SearchOptions = {}, dbArg?: Database): Promise<SearchResult> {
  const started = performance.now();
  const db = dbArg ?? (await getDb());
  const q = parseQuery(rawQuery);
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize ?? 20)));
  const sort = options.sort ?? "relevance";
  const filters = options.filters;
  const notices: string[] = [];
  let facets = emptyFacets();
  let hits: SearchHit[] = [];
  let total = 0;

  const wantKind = (k: SearchKind) => !filters?.kinds?.length || filters.kinds.includes(k);

  if (q.type === "empty") {
    return { query: q, hits: [], total: 0, page, pageSize, totalPages: 0, ambiguous: false, notices, facets, tookMs: 0 };
  }
  if (q.truncated) notices.push("Your search was shortened to 100 characters.");

  if (q.type === "ndc" || q.type === "ndc_ambiguous" || q.type === "product_ndc") {
    const ndcRows = wantKind("ndc") ? await ndcLookup(db, q.ndc11Candidates, q.productNdc9Candidates) : [];
    const today = todayUs();
    const ndcHits: SearchHit[] = ndcRows.map((r) => {
      const listing: "listed" | "excluded" | "cms-only" = r.listing_status === "listed" ? "listed" : r.listing_status === "excluded" ? "excluded" : "cms-only";
      const isActive = listing === "listed" && (!r.marketing_end || r.marketing_end >= today);
      const exact = q.ndc11Candidates.includes(r.ndc11);
      return {
        kind: "ndc",
        key: r.ndc11,
        title: formatNdc11(r.ndc11),
        subtitle: [r.product_name?.trim() || r.cms_drug_name, r.generic_name && r.product_name && r.generic_name.toLowerCase() !== r.product_name.toLowerCase() ? `(${r.generic_name})` : null, r.labeler ? `— ${r.labeler}` : null]
          .filter(Boolean)
          .join(" "),
        href: hrefFor("ndc", r.ndc11),
        family: null,
        codes: r.cms_codes ?? [],
        manufacturerNames: r.labeler ? [r.labeler] : [],
        routes: [],
        dosageForms: [],
        productClass: null,
        isBrand: null,
        biosimilarStatus: null,
        hasPayment: false,
        isNoc: false,
        isActive,
        statusEndDate: r.marketing_end,
        effectiveDate: null,
        match: exact
          ? { type: "exact_ndc", label: q.type === "ndc_ambiguous" ? "Exact NDC match (one of the possible 11-digit forms)" : "Exact NDC match" }
          : { type: "prefix", label: "Package of this product NDC" },
        tier: exact ? 100 : 70,
        similarity: 1,
        ndc: { ndc11: r.ndc11, formatted: formatNdc11(r.ndc11), listing, packageDescription: r.description, drugSlug: r.drug_slug },
      };
    });
    if (q.type === "ndc_ambiguous") {
      notices.push(
        `A 10-digit NDC without hyphens can map to three 11-digit forms (${q.ndc11Candidates.map(formatNdc11).join(", ")}). Results include any form that exists; add hyphens to remove the ambiguity.`,
      );
    }
    const drugSlugs = [...new Set(ndcHits.map((h) => h.ndc?.drugSlug).filter((s): s is string => !!s))];
    const codes = [...new Set(ndcHits.flatMap((h) => h.codes))];
    const related: DocRow[] = [];
    if (drugSlugs.length && wantKind("drug"))
      related.push(...(await docsByIds(db, sql`d.kind = 'drug' AND d.key IN (${sql.join(drugSlugs.map((s) => sql`${s}`), sql`, `)})`, 65, filters)));
    if (codes.length && wantKind("hcpcs"))
      related.push(...(await docsByIds(db, sql`d.kind = 'hcpcs' AND d.key IN (${sql.join(codes.map((s) => sql`${s}`), sql`, `)})`, 65, filters)));
    const relatedHits = related.map((r) => ({ ...toHit(r), match: { type: "related" as const, label: "Linked to this NDC by the CMS crosswalk or FDA listing" } }));
    hits = [...ndcHits, ...relatedHits];
    total = hits.length;
    facets.kinds = { ndc: ndcHits.length, drug: relatedHits.filter((h) => h.kind === "drug").length, hcpcs: relatedHits.filter((h) => h.kind === "hcpcs").length };
    hits = hits.slice((page - 1) * pageSize, page * pageSize);
  } else if (q.type === "hcpcs_code" && q.hcpcsCode) {
    const exact = await docsByIds(db, sql`d.kind = 'hcpcs' AND d.key = ${q.hcpcsCode}`, 100, filters, 1);
    const relatedDrugs = wantKind("drug") ? await docsByIds(db, sql`d.kind = 'drug' AND ${q.hcpcsCode} = ANY(d.codes)`, 65, filters, 60) : [];
    const relatedMfrs = wantKind("manufacturer") ? await docsByIds(db, sql`d.kind = 'manufacturer' AND ${q.hcpcsCode} = ANY(d.codes)`, 64, filters, 30) : [];
    const all = [
      ...exact.map((r) => ({ ...toHit(r), match: { type: "exact_code" as const, label: "Exact HCPCS code match" } })),
      ...relatedDrugs.map((r) => ({ ...toHit(r), match: { type: "related" as const, label: `NDCs crosswalked by CMS to ${q.hcpcsCode}` } })),
      ...relatedMfrs.map((r) => ({ ...toHit(r), match: { type: "related" as const, label: `Labeler of NDCs crosswalked to ${q.hcpcsCode}` } })),
    ].sort((a, b) => b.tier - a.tier || Number(b.isActive) - Number(a.isActive));
    total = all.length;
    facets.kinds = { hcpcs: exact.length, drug: relatedDrugs.length, manufacturer: relatedMfrs.length };
    hits = all.slice((page - 1) * pageSize, page * pageSize);
    if (!exact.length) notices.push(`${q.hcpcsCode} is not in the CMS HCPCS Level II files CodeRx has imported.`);
  } else if (q.type === "invalid_ndc") {
    notices.push(q.ndc?.kind === "invalid" ? q.ndc.reason : "That number is not a valid NDC.");
  } else {
    if (q.type === "cpt_like") notices.push("CPT® codes are maintained by the AMA and are not included in CodeRx. Search a HCPCS Level II code, drug name, or NDC instead.");
    if (q.type === "labeler_code") notices.push(`Showing FDA labelers with code ${q.labelerCode}. If you meant a CPT® code, note that CPT content is not included in CodeRx.`);
    const { rows, facetRows, valueRows } = await textSearch(db, q, { page, pageSize, sort, filters });
    hits = rows.map(toHit);
    total = rows.length ? Number(rows[0].total) : 0;
    facets = emptyFacets();
    for (const f of facetRows) {
      facets.kinds[f.kind] = (facets.kinds[f.kind] ?? 0) + f.n;
      if (f.kind === "hcpcs" && f.family) facets.families[f.family] = (facets.families[f.family] ?? 0) + f.n;
      if (f.is_active) facets.status.active += f.n;
      else facets.status.inactive += f.n;
      if (f.has_payment) facets.payment += f.n;
    }
    const pick = (name: string) =>
      valueRows
        .filter((v) => v.facet === name)
        .slice(0, 15)
        .map((v) => ({ value: v.value, label: v.label, count: v.n }));
    facets.manufacturers = pick("manufacturer");
    facets.forms = pick("form");
    facets.routes = pick("route");
  }

  const topDrugs = hits.filter((h) => h.kind === "drug" && h.isActive);
  const ambiguous =
    q.type === "text" && page === 1 && sort === "relevance" && topDrugs.length >= 2 && topDrugs[0].tier >= 80 && topDrugs[1].tier === topDrugs[0].tier;
  if (ambiguous) {
    const n = topDrugs.filter((h) => h.tier === topDrugs[0].tier).length;
    notices.push(`“${q.display}” matches ${n} different drugs equally well. Check the route, dosage form, and manufacturer before choosing a code.`);
  }

  return {
    query: q,
    hits,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    ambiguous,
    notices,
    facets,
    tookMs: Math.round(performance.now() - started),
  };
}

export interface SuggestGroup {
  kind: SearchKind;
  label: string;
  items: { title: string; subtitle: string | null; href: string; badge: string | null; isActive: boolean; matchLabel: string }[];
}

const GROUP_LABELS: Record<SearchKind, string> = { drug: "Drugs", hcpcs: "HCPCS codes", ndc: "NDC packages", manufacturer: "Manufacturers" };

/** Grouped type-ahead suggestions (top few per group). */
export async function suggest(rawQuery: string, dbArg?: Database): Promise<{ query: ParsedQuery; groups: SuggestGroup[]; notices: string[]; tookMs: number }> {
  const result = await search(rawQuery, { pageSize: 40 }, dbArg);
  const limits: Record<SearchKind, number> = { drug: 5, hcpcs: 5, ndc: 5, manufacturer: 3 };
  const order: SearchKind[] = ["drug", "hcpcs", "ndc", "manufacturer"];
  const exactFirst = result.hits[0]?.kind;
  if (exactFirst && result.hits[0].tier >= 100) order.sort((a, b) => (a === exactFirst ? -1 : b === exactFirst ? 1 : 0));
  const groups = order
    .map((kind) => ({
      kind,
      label: GROUP_LABELS[kind],
      items: result.hits
        .filter((h) => h.kind === kind)
        .slice(0, limits[kind])
        .map((h) => ({
          title: h.title,
          subtitle: h.subtitle,
          href: h.href,
          badge: h.kind === "hcpcs" ? h.family : h.kind === "drug" ? (h.codes[0] ?? null) : null,
          isActive: h.isActive,
          matchLabel: h.match.label,
        })),
    }))
    .filter((g) => g.items.length);
  return { query: result.query, groups, notices: result.notices, tookMs: result.tookMs };
}
