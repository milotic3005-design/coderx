/**
 * Washington coverage rules (pure; no database or network): is a drug on each plan's formulary,
 * at what tier, with what restrictions and cost-sharing rule. Ported from the checker in
 * wa-coverage-check/ (src/check-coverage.ts), where the same rules are tested against real files.
 *
 * Formularies state tiers and cost-sharing rules, not what a patient will pay. Whenever a source
 * cannot answer, the field is "unknown" and `reason` says why. Drugs are matched by RxNorm
 * identifiers: NDCs for Apple Health and NADAC, RxCUIs for Part D and exchange plans. Nothing is
 * matched by name.
 */

export type YesNoUnknown = "yes" | "no" | "unknown";

export interface DrugMatch {
  /** How RxNorm read the name, for example "adalimumab" or "Humira". */
  matchedName: string;
  /** Product-level RxCUIs (every strength and form). */
  rxcuis: string[];
  /** RxNorm's name for each product, so a reader can see exactly what was matched. */
  products: { rxcui: string; name: string }[];
  /** 11-digit NDCs for those RxCUIs, as RxNorm currently lists them. */
  ndcs: string[];
}

export interface CoverageRow {
  plan: string;
  covered: YesNoUnknown;
  /** For a row that sums up many plans: how many list the drug ("98 of 125 plans"). */
  coveredNote?: string;
  tier: string | null;
  priorAuth: YesNoUnknown;
  stepTherapy: YesNoUnknown;
  quantityLimit: YesNoUnknown;
  /** The plan's stated rule for this tier, not a patient's price. */
  costSharing: string | null;
  benefitType: "pharmacy" | "medical" | "unknown";
  /** Why any field is "unknown" or empty, and anything else a reader needs. */
  reason: string;
}

/** Yes only when every listed form has the restriction, no when none does, unknown when it is mixed. */
export const restriction = (values: boolean[]): YesNoUnknown => (values.every(Boolean) ? "yes" : values.some(Boolean) ? "unknown" : "no");
const mixedNote = (rows: { pa: boolean; st: boolean; ql: boolean }[]) => {
  const mixed = (["pa", "st", "ql"] as const).filter((k) => restriction(rows.map((r) => r[k])) === "unknown").map((k) => ({ pa: "PA", st: "step therapy", ql: "quantity limit" })[k]);
  return mixed.length ? `${mixed.join(", ")} applies to some forms only, so it shows as unknown. ` : "";
};
const notListed = (match: DrugMatch, extra: string) =>
  `Not on this plan's formulary: no listing matched ${match.rxcuis.length} current RxNorm product IDs (a listing under a retired ID would not be found). ${extra}`;
const PUBLISHED = "As published in the plan's file; confirm with the plan before relying on it.";

/* ------------------------------------------------------------------ */
/* Apple Health (Medicaid) PDL                                         */
/* ------------------------------------------------------------------ */

/** One PDL row per NDC; codes are the PDL's own (its KEY sheet). */
export interface PdlRow {
  ndc11: string;
  label: string;
  /** CP pharmacy only, CM medical only, CA both, NC not covered */
  coverage: string;
  nonCoveredReason: string;
  pharmacyPreferred: string;
  pharmacyPa: string;
  medicalPreferred: string;
  medicalPa: string;
  paPolicy: string;
}

/** The Apple Health PDL's KEY sheet: reasons a product is not covered. */
const NOT_COVERED_REASON: Record<string, string> = {
  COLD: "cough and cold product",
  COSM: "cosmetic product",
  DESI: "ineffective as determined by FDA",
  FERT: "fertility product",
  NCFO: "medical food",
  NFDA: "not FDA-approved",
  OTCS: "over-the-counter product",
  SDYS: "sexual dysfunction product",
  VITA: "vitamin product",
  WGHT: "weight loss product",
};

const PDL_LIMITS = "The PDL does not list step therapy or quantity limits, and it states no cost sharing.";
export const APPLE_HEALTH_PLAN = "Apple Health (Medicaid, all plans)";

/** One Apple Health row from the PDL rows for this drug's NDCs. */
export function appleHealthRow(match: DrugMatch, listed: PdlRow[]): CoverageRow {
  const ndcs = new Set(match.ndcs);
  listed = listed.filter((r) => ndcs.has(r.ndc11));
  // Some PDL rows have a blank coverage code. Those say nothing, so they are set aside rather than read as covered.
  const rows = listed.filter((r) => ["CP", "CM", "CA", "NC"].includes(r.coverage));
  const blank = listed.length - rows.length;
  const base = { plan: APPLE_HEALTH_PLAN, costSharing: null, stepTherapy: "unknown" as const, quantityLimit: "unknown" as const };
  if (!rows.length) {
    const why = !match.ndcs.length
      ? "RxNorm lists no NDCs for this drug, so the PDL (which lists NDCs) could not be checked."
      : blank
        ? `This drug's NDCs in the Apple Health PDL (${blank}) all have a blank coverage code.`
        : "None of this drug's NDCs appear in the Apple Health PDL. Managed care plans may make their own decisions about unlisted products.";
    return { ...base, covered: "unknown", tier: null, priorAuth: "unknown", benefitType: "unknown", reason: `${why} ${PDL_LIMITS}` };
  }
  const covered = rows.filter((r) => r.coverage !== "NC");
  if (!covered.length) {
    const why = [...new Set(rows.map((r) => NOT_COVERED_REASON[r.nonCoveredReason] ?? r.nonCoveredReason).filter(Boolean))].join(", ");
    return { ...base, covered: "no", tier: null, priorAuth: "unknown", benefitType: "unknown", reason: `The PDL lists every NDC as not covered${why ? ` (${why})` : ""}.` };
  }
  const pharmacy = covered.filter((r) => r.coverage === "CP" || r.coverage === "CA");
  const notes: string[] = ["Apple Health has no tiers in the PDL; preferred status is shown instead.", PDL_LIMITS];
  if (rows.length > covered.length) notes.push(`${rows.length - covered.length} of ${rows.length} NDCs are not covered.`);
  if (blank) notes.push(`${blank} NDCs with a blank coverage code were ignored.`);
  /** Y on every NDC is yes, N on every NDC is no; anything else (mixed, blank, or decided by each plan) is unknown. */
  const allOrNothing = (codes: string[]): YesNoUnknown => (codes.every((c) => c === "Y") ? "yes" : codes.every((c) => c === "N") ? "no" : "unknown");

  if (!pharmacy.length) {
    const priorAuth = allOrNothing(covered.map((r) => r.medicalPa));
    if (priorAuth === "unknown") notes.push("Medical PA differs by NDC, is not stated, or is set by each managed care plan.");
    const pref = [...new Set(covered.map((r) => ({ P: "Preferred", N: "Non-preferred", M: "Set by each managed care plan" })[r.medicalPreferred] ?? "Not stated"))];
    return { ...base, covered: "yes", tier: pref.join(" / "), priorAuth, benefitType: "medical", reason: `Covered through the medical benefit only. ${notes.join(" ")}` };
  }
  const priorAuth = allOrNothing(pharmacy.map((r) => r.pharmacyPa));
  if (priorAuth === "unknown") {
    const policies = [...new Set(pharmacy.map((r) => r.paPolicy).filter(Boolean))];
    const labels = (code: string) => [...new Set(pharmacy.filter((r) => r.pharmacyPa === code).map((r) => r.label))].slice(0, 5).join(", ");
    const needs = labels("Y");
    const not = labels("N");
    notes.push(`PA varies by product, is not stated, or depends on criteria${policies.length ? ` in policy ${policies.join(", ")}` : ""}.${needs ? ` PA required: ${needs}.` : ""}${not ? ` Not required: ${not}.` : ""}`);
  }
  // CA means covered through both benefits. There is no "both" here, so this stays unknown rather than picking one.
  const both = covered.some((r) => r.coverage === "CA" || r.coverage === "CM");
  if (both) notes.push("Covered through both the pharmacy and medical benefits, for the same NDC or for different ones; which applies depends on the product and where it is given. Pharmacy preferred status and PA are shown.");
  const pref = [...new Set(pharmacy.map((r) => ({ P: "Preferred", N: "Non-preferred" })[r.pharmacyPreferred] ?? "Not stated"))];
  return { ...base, covered: "yes", tier: pref.join(" / "), priorAuth, benefitType: both ? "unknown" : "pharmacy", reason: notes.join(" ") };
}

/* ------------------------------------------------------------------ */
/* Medicare Part D (Washington plans, per formulary)                   */
/* ------------------------------------------------------------------ */

export interface PartDFormulary {
  formularyId: string;
  pdpPlans: number;
  mapdPlans: number;
}
export interface PartDListingRow {
  formularyId: string;
  rxcui: string;
  tier: number | null;
  priorAuth: boolean;
  stepTherapy: boolean;
  quantityLimit: boolean;
}
export const PART_D_PLAN = "Medicare Part D (all Washington PDP and MA-PD plans)";

/**
 * One row that sums up every Washington Part D plan. CMS's file gives formularies and how many plans
 * use each, not plan names, so restrictions are counted per plan: "yes" only when every plan that
 * lists the drug has the restriction on every form.
 */
export function partDRow(match: DrugMatch, formularies: PartDFormulary[], listings: PartDListingRow[]): CoverageRow {
  const plans = (f: PartDFormulary) => f.pdpPlans + f.mapdPlans;
  const total = formularies.reduce((n, f) => n + plans(f), 0);
  const rxcuis = new Set(match.rxcuis);
  const byFormulary = new Map<string, PartDListingRow[]>();
  for (const l of listings) if (rxcuis.has(l.rxcui)) byFormulary.set(l.formularyId, [...(byFormulary.get(l.formularyId) ?? []), l]);
  const listing = formularies.filter((f) => byFormulary.has(f.formularyId));
  const listingPlans = listing.reduce((n, f) => n + plans(f), 0);
  const base = { plan: PART_D_PLAN, coveredNote: `${listingPlans} of ${total} plans`, costSharing: null };
  if (!listing.length) {
    return { ...base, covered: "no", tier: null, priorAuth: "unknown", stepTherapy: "unknown", quantityLimit: "unknown", benefitType: "unknown", reason: notListed(match, "It may still be paid by Part B (for example, a drug given in a clinic) or by a formulary exception.") };
  }
  const count = (key: "priorAuth" | "stepTherapy" | "quantityLimit") => {
    const per = listing.map((f) => ({ plans: plans(f), value: restriction(byFormulary.get(f.formularyId)!.map((r) => r[key])) }));
    const sum = (v: YesNoUnknown) => per.filter((p) => p.value === v).reduce((n, p) => n + p.plans, 0);
    return { yes: sum("yes"), mixed: sum("unknown"), no: sum("no") };
  };
  const summary = (key: "priorAuth" | "stepTherapy" | "quantityLimit", label: string) => {
    const c = count(key);
    const value: YesNoUnknown = c.yes === listingPlans ? "yes" : c.no === listingPlans ? "no" : "unknown";
    const note = value === "unknown" ? `${label}: ${c.yes} of ${listingPlans} listing plans on every form${c.mixed ? `, ${c.mixed} on some forms only` : ""}.` : "";
    return { value, note };
  };
  const pa = summary("priorAuth", "PA");
  const st = summary("stepTherapy", "Step therapy");
  const ql = summary("quantityLimit", "Quantity limit");
  const tiers = [...new Set(listing.flatMap((f) => byFormulary.get(f.formularyId)!.map((r) => r.tier)).filter((t): t is number => t != null))].sort((a, b) => a - b);
  const notes = [
    listingPlans < total ? `Listed by ${listingPlans} of ${total} Washington plans; the others do not list it under ${match.rxcuis.length} current RxNorm product IDs.` : `Listed by all ${total} Washington plans.`,
    pa.note,
    st.note,
    ql.note,
    tiers.length > 1 ? "Tier differs by plan, strength, or form." : "",
    "CMS's file gives tiers and restrictions; each plan's cost sharing is on Medicare Plan Finder.",
    PUBLISHED,
  ];
  return {
    ...base,
    covered: listingPlans === total ? "yes" : "unknown",
    tier: tiers.length ? (tiers.length === 1 ? `Tier ${tiers[0]}` : `Tier ${tiers[0]}–${tiers[tiers.length - 1]}`) : null,
    priorAuth: pa.value,
    stepTherapy: st.value,
    quantityLimit: ql.value,
    benefitType: "pharmacy",
    reason: notes.filter(Boolean).join(" "),
  };
}

/* ------------------------------------------------------------------ */
/* Exchange plans (one insurer's machine-readable files)               */
/* ------------------------------------------------------------------ */

export interface ExchangePlan {
  planId: string;
  name: string;
  costs: Record<string, string>;
}
export interface ExchangeListing {
  planId: string;
  tier: string;
  pa: boolean;
  st: boolean;
  ql: boolean;
}

/**
 * The plan's cost-sharing rule for a tier. Some files spell the same CMS tier two ways ("PREFERREDBRAND" on the
 * drug, "PREFERRED-BRAND" in the plan), so names that differ only in hyphens or case match; nothing looser does.
 */
export function tierCost(costs: Record<string, string>, tier: string): string | null {
  const key = (t: string) => t.replace(/-/g, "").toUpperCase();
  return costs[tier] ?? Object.entries(costs).find(([k]) => key(k) === key(tier))?.[1] ?? null;
}

/** One row per plan of this insurer. `listings` are every listing of the drug's RxCUIs. */
export function exchangeRows(match: DrugMatch, plans: ExchangePlan[], listings: ExchangeListing[]): CoverageRow[] {
  return plans.map((plan) => {
    const rows = listings.filter((l) => l.planId === plan.planId);
    const base = { plan: `${plan.name} (${plan.planId})` };
    if (!rows.length) {
      return { ...base, covered: "no", tier: null, priorAuth: "unknown", stepTherapy: "unknown", quantityLimit: "unknown", costSharing: null, benefitType: "unknown", reason: notListed(match, "Drugs given in a clinic are often paid under the medical benefit instead.") };
    }
    const tiers = [...new Set(rows.map((r) => r.tier))];
    const uncosted = tiers.filter((t) => !tierCost(plan.costs, t));
    return {
      ...base,
      covered: "yes",
      tier: tiers.join(" / "),
      priorAuth: restriction(rows.map((r) => r.pa)),
      stepTherapy: restriction(rows.map((r) => r.st)),
      quantityLimit: restriction(rows.map((r) => r.ql)),
      // With several tiers, each rule is labeled so a tier without a rule cannot shift the others.
      costSharing:
        tiers
          .map((t) => [t, tierCost(plan.costs, t)] as const)
          .filter(([, c]) => c)
          .map(([t, c]) => (tiers.length > 1 ? `${t}: ${c}` : c))
          .join(" | ") || null,
      benefitType: "pharmacy",
      reason: `${tiers.length > 1 ? "Tier varies by strength or form. " : ""}${mixedNote(rows)}${uncosted.length ? `The plan's file gives no cost-sharing rule for tier ${uncosted.join(", ")} (its rules cover ${Object.keys(plan.costs).join(", ") || "no tiers"}). ` : ""}${PUBLISHED}`,
    } satisfies CoverageRow;
  });
}

/* ------------------------------------------------------------------ */
/* NADAC reference price                                               */
/* ------------------------------------------------------------------ */

export interface NadacRow {
  ndc11: string;
  description: string;
  perUnit: number;
  unit: string;
  effectiveDate: string;
  classification: string;
}

/** Kept apart from coverage on purpose: it is what pharmacies pay, not what a patient pays. */
export interface ReferencePrice {
  /** One entry per product description, lowest and highest NADAC per unit across its NDCs. */
  prices: { product: string; brandOrGeneric: "brand" | "generic" | "unknown"; nadacClass?: string; low: number; high: number; unit: string; ndcCount: number; effectiveDate: string }[];
  reason: string;
}

export const NADAC_LABEL = "Reference price (NADAC): the national average price retail pharmacies pay to buy the drug. It is not patient cost and not what any plan pays.";

export function referencePrice(match: DrugMatch, rows: NadacRow[]): ReferencePrice {
  const ndcs = new Set(match.ndcs);
  const groups = new Map<string, ReferencePrice["prices"][number]>();
  let priced = 0;
  for (const n of rows) {
    if (!ndcs.has(n.ndc11)) continue;
    priced++;
    const key = `${n.description}|${n.unit}|${n.classification}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { product: n.description, brandOrGeneric: n.classification === "B" ? "brand" : n.classification === "G" ? "generic" : "unknown", ...(n.classification !== "B" && n.classification !== "G" ? { nadacClass: n.classification } : {}), low: n.perUnit, high: n.perUnit, unit: n.unit, ndcCount: 1, effectiveDate: n.effectiveDate });
    } else {
      g.low = Math.min(g.low, n.perUnit);
      g.high = Math.max(g.high, n.perUnit);
      g.ndcCount++;
      if (n.effectiveDate > g.effectiveDate) g.effectiveDate = n.effectiveDate;
    }
  }
  const prices = [...groups.values()].sort((a, b) => a.product.localeCompare(b.product));
  const other = [...new Set(prices.map((p) => p.nadacClass).filter(Boolean))];
  const reason = !match.ndcs.length
    ? "RxNorm lists no NDCs for this drug, so no NADAC could be looked up."
    : prices.length
      ? `Price per pricing unit (EA = each, ML = milliliter, GM = gram). ${priced} of this drug's ${match.ndcs.length} NDCs have a NADAC; the rest are not surveyed.${other.length ? ` Brand or generic shows as unknown for NADAC class ${other.join(", ")}, which is neither plain B nor G.` : ""}`
      : `No NADAC this week for any of this drug's NDCs (${match.ndcs.length} checked). NADAC surveys retail community pharmacies, so drugs bought mainly by clinics, hospitals, or specialty pharmacies (many infusion and specialty drugs) are often absent.`;
  return { prices, reason };
}
