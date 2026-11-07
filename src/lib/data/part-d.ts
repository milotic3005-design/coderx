/**
 * Links a drug's NDCs to CMS's Washington Part D data. CMS lists one proxy NDC per RxNorm
 * concept, so a drug is matched three ways and the matches are combined: exact NDC, product
 * NDC, and product NDC to RxCUI. Plan counts are a union of formularies, because a plan listing
 * two strengths of a drug is still one plan. Identifiers only; nothing is matched by name.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import type { CostRow } from "@/lib/part-b-d-dollars";

export interface PartDListing {
  plansListing: { pdp: number; mapd: number };
  plansTotal: { pdp: number; mapd: number };
  tierMin: number | null;
  tierMax: number | null;
  priorAuth: number;
  stepTherapy: number;
  quantityLimit: number;
  selectedDrug: boolean;
  linkedBy: ("ndc" | "product" | "rxcui")[];
  costs: CostRow[];
}

const productOf = (ndc11: string) => ndc11.slice(0, 9);

/**
 * Null means nothing can be said: the Part D source is not imported, or no identifier ties the
 * drug to RxNorm. Zero plans means the drug's RxCUI is known and CMS's file does not list it.
 */
export async function partDListing(db: Database, ndc11s: string[], code: string | null): Promise<PartDListing | null> {
  const formularies = await db.select().from(t.partdWaFormularies);
  if (!formularies.length) return null;
  const plansIn = (ids: Iterable<string>) => {
    const chosen = new Set(ids);
    const rows = formularies.filter((f) => chosen.has(f.formularyId));
    return { pdp: rows.reduce((n, f) => n + f.pdpPlans, 0), mapd: rows.reduce((n, f) => n + f.mapdPlans, 0) };
  };
  const planCount = (ids: Iterable<string>) => {
    const { pdp, mapd } = plansIn(ids);
    return pdp + mapd;
  };
  const empty: PartDListing = { plansListing: { pdp: 0, mapd: 0 }, plansTotal: plansIn(formularies.map((f) => f.formularyId)), tierMin: null, tierMax: null, priorAuth: 0, stepTherapy: 0, quantityLimit: 0, selectedDrug: false, linkedBy: [], costs: [] };
  if (!ndc11s.length) return null;

  const products = [...new Set(ndc11s.map(productOf))];
  const productColumn = sql<string>`left(${t.partdWaFormularyDrugs.proxyNdc}, 9)`;
  const [byNdc, byProduct, byRxcui] = await Promise.all([
    db.selectDistinct({ rxcui: t.partdWaFormularyDrugs.rxcui }).from(t.partdWaFormularyDrugs).where(inArray(t.partdWaFormularyDrugs.proxyNdc, ndc11s)),
    db.selectDistinct({ rxcui: t.partdWaFormularyDrugs.rxcui }).from(t.partdWaFormularyDrugs).where(inArray(productColumn, products)),
    db.selectDistinct({ rxcui: t.ndcRxcui.rxcui }).from(t.ndcRxcui).where(inArray(t.ndcRxcui.productNdc9, products)),
  ]);
  const rxcuis = [...new Set([...byNdc, ...byProduct, ...byRxcui].map((r) => r.rxcui))];
  if (!rxcuis.length) return null;

  const rows = await db.select().from(t.partdWaFormularyDrugs).where(inArray(t.partdWaFormularyDrugs.rxcui, rxcuis));
  if (!rows.length) return empty;

  const linkedBy: PartDListing["linkedBy"] = [];
  if (byNdc.length) linkedBy.push("ndc");
  if (byProduct.length) linkedBy.push("product");
  if (byRxcui.some((r) => rows.some((row) => row.rxcui === r.rxcui))) linkedBy.push("rxcui");

  const tiers = rows.flatMap((r) => (r.tier == null ? [] : [r.tier]));
  const costs = await db.select().from(t.partdWaCosts).where(inArray(t.partdWaCosts.rxcui, rxcuis));
  return {
    plansListing: plansIn(rows.map((r) => r.formularyId)),
    plansTotal: empty.plansTotal,
    tierMin: tiers.length ? Math.min(...tiers) : null,
    tierMax: tiers.length ? Math.max(...tiers) : null,
    priorAuth: planCount(rows.filter((r) => r.priorAuth).map((r) => r.formularyId)),
    stepTherapy: planCount(rows.filter((r) => r.stepTherapy).map((r) => r.formularyId)),
    quantityLimit: planCount(rows.filter((r) => r.quantityLimit).map((r) => r.formularyId)),
    selectedDrug: rows.some((r) => r.selectedDrug),
    linkedBy,
    costs: await costRows(db, costs, ndc11s, code),
  };
}

/** Pairs each cost with the crosswalk row for its NDC, or for the same product, and with its FDA dosage form. */
async function costRows(db: Database, costs: (typeof t.partdWaCosts.$inferSelect)[], ndc11s: string[], code: string | null): Promise<CostRow[]> {
  if (!costs.length) return [];
  const proxies = costs.map((c) => c.proxyNdc);
  const proxyProducts = [...new Set(proxies.map(productOf))];
  const [crosswalk, forms] = await Promise.all([
    db
      .select({ ndc11: t.ndcHcpcsCrosswalk.ndc11, packageSize: t.ndcHcpcsCrosswalk.packageSize, billUnitsPerItem: t.ndcHcpcsCrosswalk.billUnitsPerItem })
      .from(t.ndcHcpcsCrosswalk)
      .innerJoin(t.sourceReleases, and(eq(t.sourceReleases.id, t.ndcHcpcsCrosswalk.sourceReleaseId), eq(t.sourceReleases.isCurrent, true)))
      .where(and(inArray(t.ndcHcpcsCrosswalk.ndc11, [...new Set([...proxies, ...ndc11s])]), code ? eq(t.ndcHcpcsCrosswalk.hcpcsCode, code) : undefined))
      .orderBy(desc(t.ndcHcpcsCrosswalk.period)),
    db.select({ product: t.ndcProducts.productNdc9, dosageForm: t.ndcProducts.dosageForm }).from(t.ndcProducts).where(inArray(t.ndcProducts.productNdc9, proxyProducts)),
  ]);
  const number = (v: string | null | undefined) => (v == null ? null : Number(v));
  return costs.map((c) => {
    const match = crosswalk.find((x) => x.ndc11 === c.proxyNdc) ?? crosswalk.find((x) => x.ndc11 != null && productOf(x.ndc11) === productOf(c.proxyNdc));
    return {
      unitCostMedian: Number(c.unitCostMedian),
      packageSize: number(match?.packageSize),
      billUnitsPerItem: number(match?.billUnitsPerItem),
      dosageForm: forms.find((f) => f.product === productOf(c.proxyNdc))?.dosageForm ?? null,
    };
  });
}
