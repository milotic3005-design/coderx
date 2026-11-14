/**
 * checkCoverage("Humira") answers, for each Washington plan the cached sources cover:
 * is the drug on the formulary, at what tier, with what restrictions and cost sharing.
 * Formularies state tiers and cost-sharing rules, not what a given patient will pay.
 * Whenever a source cannot answer, the field is "unknown" and `reason` says why.
 */
import { matchDrug, type DrugMatch } from "./rxnorm.ts";
import { existsSync } from "node:fs";
import { EXCHANGE_INSURERS, cachePath, readJson, type ExchangeIndex, type AppleHealthRow, type Manifest, type NadacIndex, type PartDIndex, type SourceInfo } from "./sources.ts";
import type { UmpEntry, UmpIndex } from "./ump.ts";

export type YesNoUnknown = "yes" | "no" | "unknown";

export interface CoverageRow {
  plan: string;
  covered: YesNoUnknown;
  tier: string | null;
  priorAuth: YesNoUnknown;
  stepTherapy: YesNoUnknown;
  quantityLimit: YesNoUnknown;
  /** The plan's stated rule for this tier, not a patient's price. */
  costSharing: string | null;
  benefitType: "pharmacy" | "medical" | "unknown";
  sourceUrl: string;
  asOfDate: string;
  /** Why any field is "unknown" or null, and anything else a reader needs. */
  reason: string;
}

/** Kept apart from the coverage rows on purpose: it is what pharmacies pay, not what a patient pays. */
export interface ReferencePrice {
  label: string;
  /** One entry per product description, lowest and highest NADAC per unit across its NDCs. */
  prices: { product: string; brandOrGeneric: "brand" | "generic" | "unknown"; nadacClass?: string; low: number; high: number; unit: string; ndcCount: number; effectiveDate: string }[];
  sourceUrl: string;
  asOfDate: string;
  reason: string;
}

export interface CoverageResult {
  query: string;
  match: DrugMatch | null;
  rows: CoverageRow[];
  /** Null only when RxNorm did not recognize the drug. */
  referencePrice: ReferencePrice | null;
}

export const NADAC_LABEL = "Reference price (NADAC): the national average price retail pharmacies pay to buy the drug. It is not patient cost and not what any plan pays.";

/** Exported so the rules can be tested on small examples. */
export function referencePrice(match: DrugMatch, index: NadacIndex, info: Manifest["nadac"]): ReferencePrice {
  const groups = new Map<string, ReferencePrice["prices"][number]>();
  let priced = 0;
  for (const ndc of match.ndcs) {
    const n = index[ndc];
    if (!n) continue;
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
  return { label: NADAC_LABEL, prices, sourceUrl: info.url, asOfDate: info.asOf, reason };
}

/** Yes only when every listed form has the restriction, no when none does, unknown when it is mixed. Same rule for every plan. */
const restriction = (values: boolean[]): YesNoUnknown => (values.every(Boolean) ? "yes" : values.some(Boolean) ? "unknown" : "no");
const mixedNote = (rows: { pa: boolean; st: boolean; ql: boolean }[]) => {
  const mixed = (["pa", "st", "ql"] as const).filter((k) => restriction(rows.map((r) => r[k])) === "unknown").map((k) => ({ pa: "PA", st: "step therapy", ql: "quantity limit" })[k]);
  return mixed.length ? `${mixed.join(", ")} applies to some forms only, so it shows as unknown. ` : "";
};
const notListed = (match: DrugMatch, extra: string) =>
  `Not on this plan's formulary: no listing matched ${match.rxcuis.length} current RxNorm product IDs (a listing under a retired ID would not be found). ${extra}`;
const PUBLISHED = "As published in the plan's file; confirm with the plan before relying on it.";

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

/** One Apple Health row from the PDL's NDC rows. Exported so the rules can be tested on small examples. */
export function appleHealthRow(match: DrugMatch, pdl: Record<string, AppleHealthRow>, info: Manifest["appleHealth"]): CoverageRow {
  const listed = match.ndcs.map((n) => pdl[n]).filter((r): r is AppleHealthRow => !!r);
  // Some PDL rows have a blank coverage code. Those say nothing, so they are set aside rather than read as covered.
  const rows = listed.filter((r) => ["CP", "CM", "CA", "NC"].includes(r.coverage));
  const blank = listed.length - rows.length;
  const base = { plan: "Apple Health (Medicaid, all plans)", sourceUrl: info.url, asOfDate: info.asOf, costSharing: null, stepTherapy: "unknown" as const, quantityLimit: "unknown" as const };
  if (!rows.length) {
    const why = blank ? `This drug's NDCs in the Apple Health PDL (${blank}) all have a blank coverage code.` : "None of this drug's NDCs appear in the Apple Health PDL. Managed care plans may make their own decisions about unlisted products.";
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
  // CA means covered through both benefits. The schema has no "both", so this stays unknown rather than picking one.
  const both = covered.some((r) => r.coverage === "CA" || r.coverage === "CM");
  if (both) notes.push("Covered through both the pharmacy and medical benefits, for the same NDC or for different ones; which applies depends on the product and where it is given. Pharmacy preferred status and PA are shown.");
  const pref = [...new Set(pharmacy.map((r) => ({ P: "Preferred", N: "Non-preferred" })[r.pharmacyPreferred] ?? "Not stated"))];
  return { ...base, covered: "yes", tier: pref.join(" / "), priorAuth, benefitType: both ? "unknown" : "pharmacy", reason: notes.join(" ") };
}

export function partDRows(match: DrugMatch, index: PartDIndex, info: Manifest["partD"]): CoverageRow[] {
  const listings = match.rxcuis.flatMap((r) => Object.entries(index.drugs[r] ?? {}));
  return index.plans.map((plan) => {
    const rows = listings.filter(([formularyId]) => formularyId === plan.formularyId).map(([, v]) => v);
    const base = { plan: `Medicare Part D: ${plan.name} (${plan.key}, ${plan.type})`, sourceUrl: info.url, asOfDate: info.asOf };
    if (!rows.length) {
      return { ...base, covered: "no", tier: null, priorAuth: "unknown", stepTherapy: "unknown", quantityLimit: "unknown", costSharing: null, benefitType: "unknown", reason: notListed(match, "It may still be paid by Part B (for example, a drug given in a clinic) or by a formulary exception.") };
    }
    const tiers = [...new Set(rows.map((r) => r.tier))].sort();
    const costs = tiers.map((t) => index.costs[plan.key]?.[String(t)]).filter(Boolean);
    return {
      ...base,
      covered: "yes",
      tier: tiers.map((t) => `Tier ${t}`).join(" / "),
      priorAuth: restriction(rows.map((r) => r.pa)),
      stepTherapy: restriction(rows.map((r) => r.st)),
      quantityLimit: restriction(rows.map((r) => r.ql)),
      costSharing: costs.length ? costs.join(" | ") : null,
      benefitType: "pharmacy",
      reason: `${tiers.length > 1 ? "Tier varies by strength or form. " : ""}${mixedNote(rows)}${costs.length ? "" : "CMS's cost file gives no 30-day retail cost for this tier. "}${PUBLISHED}`,
    } satisfies CoverageRow;
  });
}

export function exchangeRows(match: DrugMatch, index: ExchangeIndex, info: SourceInfo, insurer: string): CoverageRow[] {
  const listings = match.rxcuis.flatMap((r) => index.drugs[r] ?? []);
  return Object.entries(index.plans).map(([planId, plan]) => {
    const rows = listings.filter((l) => l.planId === planId);
    const base = { plan: `Exchange (${insurer}): ${plan.name} (${planId})`, sourceUrl: info.url, asOfDate: info.asOf };
    if (!rows.length) {
      return { ...base, covered: "no", tier: null, priorAuth: "unknown", stepTherapy: "unknown", quantityLimit: "unknown", costSharing: null, benefitType: "unknown", reason: notListed(match, "Drugs given in a clinic are often paid under the medical benefit instead.") };
    }
    const tiers = [...new Set(rows.map((r) => r.tier))];
    return {
      ...base,
      covered: "yes",
      tier: tiers.join(" / "),
      priorAuth: restriction(rows.map((r) => r.pa)),
      stepTherapy: restriction(rows.map((r) => r.st)),
      quantityLimit: restriction(rows.map((r) => r.ql)),
      costSharing: tiers.map((t) => plan.costs[t]).filter(Boolean).join(" | ") || null,
      benefitType: "pharmacy",
      reason: `${tiers.length > 1 ? "Tier varies by strength or form. " : ""}${mixedNote(rows)}${PUBLISHED}`,
    } satisfies CoverageRow;
  });
}

/** true = has it, false = does not, null = the source is unclear. Yes or no only when every entry agrees. */
const triState = (values: (boolean | null)[]): YesNoUnknown => (values.every((v) => v === true) ? "yes" : values.every((v) => v === false) ? "no" : "unknown");
/** Salt words RxNorm keeps in ingredient names that the UMP PDL usually leaves off. */
const SALT = /\s+(hydrochloride|hcl|sodium|potassium|calcium|magnesium|sulfate|maleate|mesylate|besylate|phosphate|bromide|acetate|citrate|fumarate)$/;

/** The UMP PDL's legend for codes other than PA, ST and QL. */
const UMP_CODES: Record<string, string> = {
  AMSP: "specialty drug, Ardon specialty pharmacy only",
  LMSP: "Lumicera specialty pharmacy only",
  LD: "limited distribution",
  RDX: "restricted to diagnosis",
  SF: "split fill for the first 3 months",
  OTC: "over the counter, prescription needed",
  VAC: "vaccine program",
  SMKG: "smoking cessation",
};

/**
 * UMP's PDL lists drug names, not drug codes, so this matches by name: an entry matches when it
 * starts with a brand name from RxNorm, or with the ingredient when the search included generics.
 * "atorvastatin/ezetimibe" and "ADALIMUMAB-ADAZ" do not match "atorvastatin" or "adalimumab".
 */
export function umpRow(match: DrugMatch, index: UmpIndex, info: SourceInfo): CoverageRow {
  const brands = new Set<string>();
  const ingredients = new Set<string>();
  for (const p of match.products) {
    const brand = /\[([^\]]+)\]/.exec(p.name)?.[1];
    if (brand) brands.add(brand.toLowerCase());
    // Packs ("{3 (0.8 ML adalimumab ...) } Pack") repeat their contents' names, so they add no new term.
    else if (p.name.startsWith("{")) continue;
    // "amlodipine 5 MG / atorvastatin 10 MG Oral Tablet" -> "amlodipine/atorvastatin"
    // Some names lead with a duration or volume ("24 HR metoprolol succinate ...", "0.4 ML adalimumab ..."); that prefix is dropped.
    else ingredients.add(p.name.split(" / ").map((part) => part.replace(/^(?:[\d.]+\s+(?:HR|ML|ACTUAT|DAY)\s+)+/i, "").split(/\s+(?=\d|\{)/)[0].trim().toLowerCase()).join("/"));
  }
  // A combined entry such as "OZEMPIC TAB, RYBELSUS TAB (QL= ...)" names each drug before the first "(".
  const drugNames = (name: string) => name.split(" (")[0].split(", ").map((n) => n.trim().toLowerCase());
  const startsWith = (name: string, t: string) => drugNames(name).some((n) => n.startsWith(t) && /^($|[\s(,])/.test(n.slice(t.length)));
  const terms: string[] = [];
  const matched = new Set<UmpEntry>();
  let fellBack = false;
  for (const term of [...brands, ...ingredients].filter(Boolean)) {
    let found = index.entries.filter((e) => startsWith(e.name, term));
    // RxNorm may name the salt ("metformin hydrochloride") where the PDL uses the base ("metformin tab").
    // The base name is tried only when the full name finds nothing. Salts that mark a different product
    // (metoprolol succinate vs tartrate) are not in SALT, so those never fall back.
    // A base that is itself a salt word ("calcium citrate" -> "calcium") would match other products, so it is not tried.
    const baseName = term.replace(SALT, "");
    if (!found.length && baseName !== term && !SALT.test(` ${baseName}`)) {
      found = index.entries.filter((e) => startsWith(e.name, baseName));
      if (found.length) fellBack = true;
      terms.push(`${term} (as ${baseName})`);
    } else terms.push(term);
    found.forEach((e) => matched.add(e));
  }
  const all = [...matched];
  const base = { plan: "PEBB/SEBB: Uniform Medical Plan (UMP)", sourceUrl: info.url, asOfDate: info.asOf };
  const byName = `Matched by name, since the PDL has no drug codes (searched: ${terms.join(", ")}).${fellBack ? " Some matches use the name without its salt; check that the listed entries are the same product." : ""}`;

  if (!all.length) {
    const equivalents = [...brands].flatMap((b) => index.entries.filter((e) => e.name.toLowerCase().includes(`(${b} equiv`)).map((e) => e.name)).slice(0, 3);
    return {
      ...base, covered: "unknown", tier: null, priorAuth: "unknown", stepTherapy: "unknown", quantityLimit: "unknown", costSharing: null, benefitType: "unknown",
      reason: `No UMP PDL entry starts with this name. ${byName} It may be listed under another name, not covered, or billed to the medical benefit (common for drugs given in a clinic).${equivalents.length ? ` Generic equivalents are listed: ${equivalents.join("; ")}.` : ""}`,
    };
  }
  // The PDL legend also defines EXC (plan exclusion), NC (not covered) and M (medical benefit). None appear today, but they must not read as covered.
  const excluded = (e: UmpEntry) => e.codes.includes("EXC") || e.codes.includes("NC");
  if (all.every(excluded)) {
    return {
      ...base, covered: "no", tier: null, priorAuth: "unknown", stepTherapy: "unknown", quantityLimit: "unknown", costSharing: null, benefitType: "unknown",
      reason: `${byName} Every matching entry is marked plan exclusion (EXC) or not covered (NC): ${all.slice(0, 3).map((e) => e.name).join("; ")}.`,
    };
  }
  const entries = all.filter((e) => !excluded(e));
  const medical = entries.map((e) => e.codes.includes("M"));
  const benefitType = medical.every(Boolean) ? "medical" : medical.some(Boolean) ? "unknown" : "pharmacy";
  // The PDL legend: LD and LMSP drugs always need preauthorization; AMSP drugs "most" do, so AMSP without PA is not a clear no.
  const pa = entries.map((e) => (e.codes.some((c) => ["PA", "LD", "LMSP"].includes(c)) ? true : e.codes.includes("AMSP") ? null : false));
  const priorAuth = triState(pa);
  // A few names state "(QL= ...)" while the code column shows no QL; the two disagree, so that entry counts as unknown.
  const ql = entries.map((e) => (e.codes.includes("QL") ? true : /\(QL=/.test(e.name) ? null : false));
  const quantityLimit = triState(ql);
  const tiers = [...new Set(entries.map((e) => e.tier))];
  // The PDL caps some Tier 2 drugs (covered insulins, certain inhalers and autoinjectors, "certain Tier 2 drugs") at $35
  // without listing which ones, so Tier 2 cost sharing carries that caveat instead of a guess.
  const capNotes = tiers.includes("Tier 2") ? (index.costNotes ?? []) : [];
  const costs = tiers.filter((t) => index.costs[t]).map((t) => `${t}: ${index.costs[t]}${t === "Tier 2" && capNotes.length ? " (some Tier 2 drugs are capped at $35; see note)" : ""}`);
  const other = [...new Set(entries.flatMap((e) => e.codes))].filter((c) => UMP_CODES[c]).map((c) => `${c} (${UMP_CODES[c]})`);
  const notes = [
    byName,
    `Entries: ${entries.slice(0, 3).map((e) => e.name).join("; ")}${entries.length > 3 ? `; and ${entries.length - 3} more` : ""}.`,
    other.length ? `Other codes: ${other.join(", ")}.` : "",
    priorAuth === "unknown" ? (pa.includes(null) ? "PA shows as unknown: specialty drugs (AMSP) without a PA code may still need preauthorization, as the PDL says most do." : "PA applies to some entries only.") : "",
    quantityLimit === "unknown" ? (ql.includes(null) ? "Quantity limit shows as unknown: an entry's name states a limit (QL=) but its code column does not." : "Quantity limit applies to some entries only.") : "",
    all.length > entries.length ? `${all.length - entries.length} matching entries are marked plan exclusion or not covered and were left out.` : "",
    benefitType === "medical" ? "The PDL marks this drug as covered under the medical benefit (M)." : medical.some(Boolean) ? "Some entries are marked medical benefit (M) and some are not." : "",
    capNotes.length ? `The PDL also says: ${capNotes.join(" ")} It does not list which drugs these are.` : "",
    tiers.some((t) => !index.costs[t]) ? "The PDL's cost table does not list specialty tiers, so their cost sharing is not shown." : "",
    "Cost sharing is per 30-day supply at network pharmacies for UMP Classic, Select, Achieve 1 and 2; CDHP and High Deductible plans differ.",
  ];
  return {
    ...base,
    covered: "yes",
    tier: tiers.join(" / "),
    priorAuth,
    stepTherapy: restriction(entries.map((e) => e.codes.includes("ST"))),
    quantityLimit,
    costSharing: costs.length === tiers.length ? costs.join(" | ") : null,
    benefitType,
    reason: notes.filter(Boolean).join(" "),
  };
}

/** A source missing from an older cache gives one "unknown" row instead of failing the whole check. */
function cached<T>(file: string, info: SourceInfo | undefined, plan: string, rows: (index: T, info: SourceInfo) => CoverageRow[]): CoverageRow[] {
  if (info && existsSync(cachePath(file))) return rows(readJson<T>(file), info);
  return [{ plan, covered: "unknown", tier: null, priorAuth: "unknown", stepTherapy: "unknown", quantityLimit: "unknown", costSharing: null, benefitType: "unknown", sourceUrl: "", asOfDate: "not cached", reason: "This source is not in the cache yet. Run `npm run refresh`." }];
}

/** An older cache made before NADAC was added has no nadac.json; coverage still works and the price says why it is missing. */
function nadacPrice(match: DrugMatch, manifest: Manifest): ReferencePrice {
  if (!manifest.nadac || !existsSync(cachePath("nadac.json"))) {
    return { label: NADAC_LABEL, prices: [], sourceUrl: "https://data.medicaid.gov/", asOfDate: "not cached", reason: "NADAC is not in the cache yet. Run `npm run refresh`." };
  }
  return referencePrice(match, readJson<NadacIndex>("nadac.json"), manifest.nadac);
}

/**
 * planFilter keeps rows whose plan name contains it, ignoring case: "Apple Health", "Part D",
 * "Ambetter", "Regence/BridgeSpan" (one combined file, so either word returns all 20 Cambia plans;
 * use a plan-name word such as "Cascade Silver" to narrow), "UMP", a plan name, or a plan ID such as "S5617-148".
 */
export async function checkCoverage(drug: string, planFilter?: string): Promise<CoverageResult> {
  const match = await matchDrug(drug);
  if (!match) return { query: drug, match: null, rows: [], referencePrice: null };
  const manifest = readJson<Manifest>("manifest.json");
  const rows = [
    appleHealthRow(match, readJson<Record<string, AppleHealthRow>>("apple-health.json"), manifest.appleHealth),
    ...partDRows(match, readJson<PartDIndex>("partd.json"), manifest.partD),
    ...EXCHANGE_INSURERS.flatMap((x) => cached<ExchangeIndex>(`${x.key}.json`, manifest[x.key], `Exchange (${x.label})`, (index, info) => exchangeRows(match, index, info, x.label))),
    ...cached<UmpIndex>("ump.json", manifest.ump, "PEBB/SEBB: Uniform Medical Plan (UMP)", (index, info) => [umpRow(match, index, info)]),
  ];
  const filter = planFilter?.trim().toLowerCase();
  return { query: drug, match, rows: filter ? rows.filter((r) => r.plan.toLowerCase().includes(filter)) : rows, referencePrice: nadacPrice(match, manifest) };
}
