/**
 * Facts for the Part B vs Part D tool, read from CMS tables. The rules live in
 * src/lib/part-b-d.ts. MultiCare benchmark data is deliberately not loaded here.
 */
import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { NORIDIAN_JF_SAD_ARTICLE } from "@/ingest/parsers/cms-mcd";
import type { DmePolicy } from "@/ingest/parsers/cms-lcd";
import type { SourceKey } from "@/ingest/sources";
import { getDb, type Database } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { todayUs } from "@/lib/dates";
import { isCodeActive, normalizeHcpcs } from "@/lib/hcpcs";
import { looksLikeNdc, toNdc11 } from "@/lib/ndc";
import type { BenefitFacts, SadFact } from "@/lib/part-b-d";
import { search } from "@/lib/search/engine";
import { partDListing, type PartDListing } from "./part-d";
import { loadReleases, toProvenance, type Provenance, type ReleaseRow } from "./provenance";

const TOOL_SOURCES: SourceKey[] = ["cms_mcd_articles", "cms_mcd_lcds", "cms_partd_wa", "fda_ndc_rxcui", "cms_opps_addendum_b", "cms_payment_limits", "cms_ndc_hcpcs", "fda_ndc", "cms_hcpcs"];

export interface BenefitData {
  found: boolean;
  code: string | null;
  description: string | null;
  drug: { slug: string; displayName: string } | null;
  codes: string[];
  facts: BenefitFacts;
  partD: PartDListing | null;
  asp: { limit: number | null; dosage: string | null; period: string } | null;
  opps: { statusIndicator: string | null; paymentRate: number | null; copayPerUnit: number | null; period: string } | null;
  inpatientDeductible: number | null;
  missingSources: SourceKey[];
  provenance: Provenance[];
  sadArticleId: string | null;
  policyLinks: { policy: DmePolicy; displayId: string; title: string }[];
}

const number = (v: string | null | undefined) => (v == null ? null : Number(v));

async function sadFact(db: Database, code: string | null, isNoc: boolean): Promise<SadFact | null> {
  const lists = await db.select({ articleId: t.mcdSadLists.articleId }).from(t.mcdSadLists);
  if (!lists.length) return null;
  const contractorsTotal = new Set(lists.map((l) => l.articleId)).size;
  const displayId = `A${NORIDIAN_JF_SAD_ARTICLE}`;
  if (!code) return { status: "not_listed", products: [], contractorsListing: 0, contractorsTotal, displayId };
  const today = todayUs();
  const entries = await db
    .select()
    .from(t.mcdSadEntries)
    .where(and(eq(t.mcdSadEntries.hcpcsCode, code), or(isNull(t.mcdSadEntries.endDate), gt(t.mcdSadEntries.endDate, today)), or(isNull(t.mcdSadEntries.effectiveDate), lte(t.mcdSadEntries.effectiveDate, today))));
  const noridian = entries.filter((e) => e.articleId === NORIDIAN_JF_SAD_ARTICLE);
  const contractorsListing = new Set(entries.map((e) => e.articleId)).size;
  const products = noridian.map((e) => e.productText);
  const status: SadFact["status"] = !noridian.length ? "not_listed" : isNoc ? "catch_all" : noridian.some((e) => e.routeFlag === "double") ? "double_route" : noridian.some((e) => e.routeFlag === "single") ? "route_specific" : "listed";
  return { status, products, contractorsListing, contractorsTotal, displayId };
}

/** NDCs for a code from the newest crosswalk quarter. */
async function ndcsFor(db: Database, code: string | null, crosswalkPeriod: string | null): Promise<string[]> {
  if (code && crosswalkPeriod) {
    const rows = await db
      .selectDistinct({ ndc11: t.ndcHcpcsCrosswalk.ndc11 })
      .from(t.ndcHcpcsCrosswalk)
      .where(and(eq(t.ndcHcpcsCrosswalk.hcpcsCode, code), eq(t.ndcHcpcsCrosswalk.period, crosswalkPeriod)));
    const ndcs = rows.flatMap((r) => (r.ndc11 ? [r.ndc11] : []));
    if (ndcs.length) return ndcs;
  }
  return [];
}

export async function benefitData(query: { code?: string; slug?: string }, dbArg?: Database): Promise<BenefitData> {
  const db = dbArg ?? (await getDb());
  const { latest } = await loadReleases(db);
  const [drug] = query.slug ? await db.select().from(t.drugs).where(eq(t.drugs.slug, query.slug)) : [];
  const codes = drug?.hcpcsCodes ?? (query.code ? [query.code] : []);
  const code = query.code ?? (codes.length === 1 ? codes[0] : null);

  const payRelease = latest.get("cms_payment_limits");
  const oppsRelease = latest.get("cms_opps_addendum_b");
  const [hcpcs] = code ? await db.select().from(t.hcpcsCodes).where(eq(t.hcpcsCodes.code, code)) : [];
  const isNoc = hcpcs?.isNoc ?? false;

  // A code can be linked to a drug through an older quarter even when the current crosswalk has no row for it.
  const linkedDrugs = drug ? [drug] : code ? await db.select().from(t.drugs).where(sql`${t.drugs.hcpcsCodes} @> ARRAY[${code}]::text[]`) : [];
  const [ndc11s, sad, policies, notPayable, payment, opps] = await Promise.all([
    ndcsFor(db, code, latest.get("cms_ndc_hcpcs")?.periodLabel ?? null),
    sadFact(db, code, isNoc),
    latest.get("cms_mcd_lcds") && code ? db.select().from(t.dmePolicyCodes).where(eq(t.dmePolicyCodes.hcpcsCode, code)) : [],
    code && payRelease?.periodLabel ? db.select({ code: t.partBNotPayable.hcpcsCode }).from(t.partBNotPayable).where(and(eq(t.partBNotPayable.hcpcsCode, code), eq(t.partBNotPayable.period, payRelease.periodLabel))) : [],
    code && payRelease?.periodLabel ? db.select().from(t.paymentLimits).where(and(eq(t.paymentLimits.hcpcsCode, code), eq(t.paymentLimits.period, payRelease.periodLabel))) : [],
    code && oppsRelease ? db.select().from(t.oppsRates).where(and(eq(t.oppsRates.hcpcsCode, code), eq(t.oppsRates.sourceReleaseId, oppsRelease.id))) : [],
  ]);

  const drugIds = linkedDrugs.map((d) => d.id);
  const drugProducts = !ndc11s.length && drugIds.length ? await db.select({ ndc11: t.ndcPackages.ndc11, routes: t.ndcProducts.routes, productType: t.ndcProducts.productType }).from(t.ndcPackages).innerJoin(t.ndcProducts, eq(t.ndcProducts.productId, t.ndcPackages.productId)).where(inArray(t.ndcProducts.drugId, drugIds)) : [];
  const codeProducts = ndc11s.length ? await db.select({ routes: t.ndcProducts.routes, productType: t.ndcProducts.productType }).from(t.ndcProducts).innerJoin(t.ndcPackages, eq(t.ndcPackages.productId, t.ndcProducts.productId)).where(inArray(t.ndcPackages.ndc11, ndc11s)) : [];
  const products = [...codeProducts, ...drugProducts];
  // With a code and no crosswalk row, the drug's other packages may belong to a different code, so Part D says nothing.
  const partDNdcs = code ? ndc11s : [...new Set(drugProducts.map((p) => p.ndc11))];
  const routes = [...new Set([...linkedDrugs.flatMap((d) => d.routes), ...products.flatMap((p) => p.routes)])];
  const productType = products.find((p) => p.productType === "VACCINE")?.productType ?? products[0]?.productType ?? null;
  const o = opps[0] ?? null;
  const p = payment[0] ?? null;
  const details = (oppsRelease?.report as { details?: { inpatientDeductible?: number | null } } | null)?.details;

  return {
    found: code ? !!hcpcs?.isDrug : !!drug,
    code,
    description: hcpcs?.longDescription ?? null,
    drug: drug ? { slug: drug.slug, displayName: drug.displayName } : null,
    codes,
    facts: {
      code,
      isActive: code ? !!hcpcs && isCodeActive(hcpcs.terminationDate, todayUs()) : true,
      isNoc,
      routes,
      productType,
      sad,
      dmePolicies: latest.get("cms_mcd_lcds") ? ([...new Set(policies.map((r) => r.policy))] as DmePolicy[]) : null,
      notPayable: payRelease?.periodLabel ? notPayable.length > 0 : null,
      oppsLoaded: !!oppsRelease,
      oppsStatus: o?.statusIndicator ?? null,
    },
    partD: latest.get("cms_partd_wa") && latest.get("fda_ndc_rxcui") ? await partDListing(db, partDNdcs, code) : null,
    asp: p ? { limit: number(p.paymentLimit), dosage: p.dosageDescriptor, period: p.period } : null,
    opps: o ? { statusIndicator: o.statusIndicator, paymentRate: number(o.paymentRate), copayPerUnit: number(o.adjustedCopay) ?? number(o.nationalCopay) ?? number(o.minimumCopay), period: o.period } : null,
    inpatientDeductible: details?.inpatientDeductible ?? null,
    missingSources: TOOL_SOURCES.filter((k) => !latest.get(k)),
    provenance: TOOL_SOURCES.map((k) => latest.get(k))
      .filter((r): r is ReleaseRow => !!r)
      .map((r) => toProvenance(r)),
    sadArticleId: sad?.displayId ?? null,
    policyLinks: [...new Map(policies.map((r) => [r.policy, { policy: r.policy as DmePolicy, displayId: r.displayId, title: r.title }])).values()],
  };
}

/** Turns what the user typed into one code, a drug, or a choice of codes. */
export async function resolveBenefitQuery(q: string, dbArg?: Database): Promise<{ code: string | null; slug: string | null; choices: { code: string; label: string }[] }> {
  const db = dbArg ?? (await getDb());
  const none = { code: null, slug: null, choices: [] };
  const input = q.trim();
  if (!input) return none;
  const hcpcs = normalizeHcpcs(input);
  if (hcpcs) return { code: hcpcs, slug: null, choices: [] };

  const fromCodes = async (codes: string[], slug: string | null) => {
    if (codes.length === 1) return { code: codes[0], slug, choices: [] };
    if (!codes.length) return { code: null, slug, choices: [] };
    const rows = await db.select({ code: t.hcpcsCodes.code, label: t.hcpcsCodes.shortDescription }).from(t.hcpcsCodes).where(inArray(t.hcpcsCodes.code, codes));
    return { code: null, slug, choices: codes.map((code) => ({ code, label: rows.find((r) => r.code === code)?.label ?? code })) };
  };

  const ndc11 = looksLikeNdc(input) ? toNdc11(input) : null;
  if (ndc11) {
    const rows = await db.selectDistinct({ code: t.ndcHcpcsCrosswalk.hcpcsCode, period: t.ndcHcpcsCrosswalk.period }).from(t.ndcHcpcsCrosswalk).where(eq(t.ndcHcpcsCrosswalk.ndc11, ndc11)).orderBy(desc(t.ndcHcpcsCrosswalk.period));
    const newest = rows[0]?.period;
    const codes = [...new Set(rows.filter((r) => r.period === newest).flatMap((r) => (r.code ? [r.code] : [])))];
    if (codes.length) return fromCodes(codes, null);
    const [packaged] = await db.select({ slug: t.drugs.slug, codes: t.drugs.hcpcsCodes }).from(t.ndcPackages).innerJoin(t.ndcProducts, eq(t.ndcProducts.productId, t.ndcPackages.productId)).innerJoin(t.drugs, eq(t.drugs.id, t.ndcProducts.drugId)).where(eq(t.ndcPackages.ndc11, ndc11)).limit(1);
    if (packaged) return { code: null, slug: packaged.slug, choices: [] };
  }

  const { hits } = await search(input, { pageSize: 8 }, db);
  const drugs = hits.filter((h) => h.kind === "drug");
  const exact = drugs.filter((h) => h.match.type === "exact_name");
  const chosen = exact.length === 1 ? exact[0] : drugs.length === 1 ? drugs[0] : null;
  if (chosen) return fromCodes(chosen.codes, chosen.key);
  // Several drugs match, such as a generic name with biosimilars: picking one would answer for the wrong product.
  if (drugs.length) return fromCodes([...new Set(drugs.flatMap((h) => h.codes))], null);
  const fromNdc = hits.find((h) => h.kind === "ndc");
  if (fromNdc?.codes.length) return fromCodes(fromNdc.codes, null);
  const code = hits.find((h) => h.kind === "hcpcs");
  return code ? { code: code.key, slug: null, choices: [] } : none;
}

export type { BenefitFacts };
