/**
 * Copay comparison (pure; no database or network): for one drug, each plan's stated cost sharing for
 * the drug's tier, from Medicare Part D plans (CMS's beneficiary cost file) and exchange plans (insurers'
 * machine-readable files), sorted with flat copays lowest first, then coinsurance, then plans whose
 * file states no amount. Amounts are shown as the plans state them: coinsurance stays a percent, because
 * the plan's price for the drug is not published.
 */
import { restriction, type DrugMatch, type PartDListingRow, type YesNoUnknown } from "./wa-coverage";

/** From insulinKind(): insulin follows its own cost-sharing rules (CMS's insulin cost file; Washington's cap). */
export type InsulinKind = "all" | "some" | "none";

/** RCW 48.43.780(1)(a): state-regulated health plans cap a covered insulin at $35 per 30-day supply, with no deductible. */
export const WA_INSULIN_CAP_URL = "https://apps.leg.wa.gov/RCW/default.aspx?cite=48.43.780";
/** Medicare: each Part D-covered insulin costs no more than $35 for a one-month supply, with no deductible. */
export const MEDICARE_INSULIN_URL = "https://www.medicare.gov/coverage/insulin";

export interface RetailCost {
  type: "copay" | "coinsurance";
  /** Dollars for a copay; a fraction (0.25 = 25%) for coinsurance. */
  amount: number;
  max: number | null;
}

export interface PartdPlanCosts {
  planKey: string;
  planName: string;
  planType: string;
  formularyId: string;
  deductible: number | null;
  tierCosts: { tier: number; deductibleApplies: boolean; specialty: boolean; preferred: RetailCost | null; standard: RetailCost | null }[];
  insulinCosts: { tier: number | null; preferred: InsulinAmount | null; standard: InsulinAmount | null }[];
}

export interface InsulinAmount {
  copay: number | null;
  coinsurance: number | null;
}

/** One cost_sharing entry as the insurer's file states it (CMS's QHP formulary schema). */
export interface ExchangeCostDetail {
  pharmacyType: string;
  copayAmount: number | null;
  copayOpt: string | null;
  coinsuranceRate: number | null;
  coinsuranceOpt: string | null;
}

export interface ExchangePlanCosts {
  planId: string;
  name: string;
  costDetails: Record<string, ExchangeCostDetail[]>;
}

export interface ExchangeListingRow {
  planId: string;
  tier: string;
  pa: boolean;
  st: boolean;
  ql: boolean;
}

export type CopayGroup = "partd" | "exchange";

export interface CopayRow {
  group: CopayGroup;
  insurer: string;
  plan: string;
  planId: string;
  tier: string;
  /** "$47.00 copay", "25% coinsurance", or why there is no amount. */
  cost: string;
  /** Which fill the amount is for: "30-day, preferred retail", "1-month retail", "retail (supply not stated)". */
  supply: string;
  /** Yes: the plan's price is paid until the deductible is met. */
  deductibleFirst: YesNoUnknown;
  deductibleNote: string | null;
  restrictions: string;
  /** The plan's other stated options (standard retail, mail order). */
  other: string[];
  sort: { rank: 0 | 1 | 2; amount: number };
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const pct = (f: number) => `${Math.round(f * 1000) / 10}%`;
const retail = (c: RetailCost) => (c.type === "copay" ? `${usd(c.amount)} copay` : `${pct(c.amount)} coinsurance${c.max != null ? `, up to ${usd(c.max)}` : ""}`);

/** "PA, step therapy (some forms)" from the listings of one tier. */
function restrictionsOf(rows: { pa: boolean; st: boolean; ql: boolean }[]): string {
  const parts = (
    [
      ["pa", "PA"],
      ["st", "step therapy"],
      ["ql", "quantity limit"],
    ] as const
  ).flatMap(([k, label]) => {
    const v = restriction(rows.map((r) => r[k]));
    return v === "yes" ? [label] : v === "unknown" ? [`${label} (some forms)`] : [];
  });
  return parts.join(", ") || "None listed";
}

/* ------------------------------------------------------------------ */
/* Medicare Part D                                                     */
/* ------------------------------------------------------------------ */

const MEDICARE_INSULIN_CAP = 35;

/** What CMS's insulin cost file lists for a plan, in words ("$35.00 copay and 25% coinsurance"). */
function listedInsulin(a: InsulinAmount): string {
  return [a.copay != null ? `${usd(a.copay)} copay` : "", a.coinsurance != null && a.coinsurance > 0 ? `${pct(a.coinsurance)} coinsurance` : ""].filter(Boolean).join(" and ") || "no amount";
}

/**
 * A Part D plan's insulin cost. Medicare caps each covered insulin at $35 for a one-month supply with no deductible,
 * so the row shows the plan's listed copay when it is a plain copay at or under the cap, and the cap otherwise
 * (most Washington plans list both "$35.00" and "25%", which the file does not say how to combine).
 */
function insulinCost(a: InsulinAmount | null): { cost: string; sort: CopayRow["sort"] } {
  const plainCopay = a && a.copay != null && !(a.coinsurance != null && a.coinsurance > 0) && a.copay <= MEDICARE_INSULIN_CAP ? a.copay : null;
  return plainCopay != null
    ? { cost: `${usd(plainCopay)} copay`, sort: { rank: 0, amount: plainCopay } }
    : { cost: `At most ${usd(MEDICARE_INSULIN_CAP)} per one-month supply (Medicare cap)`, sort: { rank: 0, amount: MEDICARE_INSULIN_CAP } };
}

export function partdCopayRows(match: DrugMatch, plans: PartdPlanCosts[], listings: PartDListingRow[], insulin: InsulinKind = "none"): CopayRow[] {
  const rxcuis = new Set(match.rxcuis);
  const out: CopayRow[] = [];
  for (const plan of plans) {
    const rows = listings.filter((l) => l.formularyId === plan.formularyId && rxcuis.has(l.rxcui));
    if (!rows.length) continue;
    for (const tier of [...new Set(rows.map((r) => r.tier))].sort((a, b) => (a ?? 99) - (b ?? 99))) {
      const tierRows = rows.filter((r) => r.tier === tier).map((r) => ({ pa: r.priorAuth, st: r.stepTherapy, ql: r.quantityLimit }));
      const base = {
        group: "partd" as const,
        insurer: plan.planType === "PDP" ? "Medicare Part D plan (PDP)" : "Medicare Advantage with drugs (MA-PD)",
        plan: plan.planName,
        planId: plan.planKey.replaceAll("|", "-"),
        tier: tier == null ? "Not stated" : `Tier ${tier}`,
        restrictions: restrictionsOf(tierRows),
      };
      if (insulin !== "none") {
        // Insulin: Medicare's cap and CMS's insulin cost file, not the tier's general amounts. Defined standard plans list no tier.
        if (insulin === "some") {
          out.push({ ...base, cost: "Not shown: an insulin combined with other drugs may follow Part D's insulin rules", supply: "one-month retail", deductibleFirst: "unknown", deductibleNote: null, other: [], sort: { rank: 2, amount: 0 } });
          continue;
        }
        const ic = plan.insulinCosts.find((t) => t.tier === tier) ?? plan.insulinCosts.find((t) => t.tier == null);
        const listed = ic?.preferred ?? ic?.standard ?? null;
        const described = insulinCost(listed);
        out.push({
          ...base,
          cost: described.cost,
          supply: ic?.preferred ? "one-month, preferred retail (insulin)" : ic?.standard ? "one-month, standard retail (insulin)" : "one-month retail (insulin)",
          deductibleFirst: "no",
          deductibleNote: null,
          other: listed ? [`CMS's insulin cost file lists ${listedInsulin(listed)}`] : [],
          sort: described.sort,
        });
        continue;
      }
      const tc = tier == null ? undefined : plan.tierCosts.find((t) => t.tier === tier);
      const primary = tc?.preferred ?? tc?.standard ?? null;
      // A deductible that applies but is $0 leaves nothing to pay first.
      const deductibleFirst: YesNoUnknown = !tc ? "unknown" : tc.deductibleApplies && plan.deductible !== 0 ? "yes" : "no";
      out.push({
        ...base,
        tier: tier == null ? "Not stated" : `Tier ${tier}${tc?.specialty ? " (specialty)" : ""}`,
        cost: primary ? retail(primary) : tier == null ? "Not stated: no tier in CMS's file" : plan.tierCosts.length ? "Not stated in CMS's cost file" : "Not loaded yet",
        supply: tc?.preferred ? "30-day, preferred retail" : tc?.standard ? "30-day, standard retail" : "30-day retail",
        deductibleFirst,
        deductibleNote: deductibleFirst === "yes" && plan.deductible != null ? `Plan deductible ${usd(plan.deductible)}` : null,
        // Standard retail is worth showing only when it differs from the preferred amount.
        other: tc?.preferred && tc.standard && retail(tc.standard) !== retail(tc.preferred) ? [`Standard retail: ${retail(tc.standard)}`] : [],
        sort: primary ? { rank: primary.type === "copay" ? 0 : 1, amount: primary.amount } : { rank: 2, amount: 0 },
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Exchange plans                                                      */
/* ------------------------------------------------------------------ */

const NO_CHARGE = new Set(["NO-CHARGE", "NO-CHARGE-AFTER-DEDUCTIBLE"]);
/** CMS's copay_opt / coinsurance_opt: AFTER-DEDUCTIBLE and NO-CHARGE-AFTER-DEDUCTIBLE mean the deductible comes first. A blank option says nothing. */
const deductibleOf = (opt: string | null): YesNoUnknown => (opt === "AFTER-DEDUCTIBLE" || opt === "NO-CHARGE-AFTER-DEDUCTIBLE" ? "yes" : opt === "BEFORE-DEDUCTIBLE" || opt === "NO-CHARGE" ? "no" : "unknown");

/** "1-MONTH-IN-RETAIL" -> "1-month retail"; "RETAIL" -> "retail (supply not stated)". */
export function supplyLabel(pharmacyType: string): string {
  const t = pharmacyType.toUpperCase();
  const where = t.includes("MAIL") ? "mail order" : t.includes("RETAIL") ? "retail" : pharmacyType.toLowerCase();
  const length = /^(\d)-MONTH/.exec(t)?.[1];
  const network = t.includes("-OUT-") ? ", out of network" : "";
  return length ? `${length}-month ${where}${network}` : `${where} (supply not stated)${network}`;
}

/** The amount, its sort key, and whether the deductible comes first, for one cost_sharing entry. */
export function describeCost(d: ExchangeCostDetail): { cost: string; deductibleFirst: YesNoUnknown; sort: CopayRow["sort"] } {
  // Blank amounts with no "no charge" option state nothing; they are not $0.
  if (d.copayAmount == null && d.coinsuranceRate == null && !NO_CHARGE.has(d.copayOpt ?? "") && !NO_CHARGE.has(d.coinsuranceOpt ?? "")) {
    return { cost: "No amount stated", deductibleFirst: "unknown", sort: { rank: 2, amount: 0 } };
  }
  const copay = NO_CHARGE.has(d.copayOpt ?? "") ? 0 : (d.copayAmount ?? 0);
  const coinsurance = NO_CHARGE.has(d.coinsuranceOpt ?? "") ? 0 : (d.coinsuranceRate ?? 0);
  const parts = [copay > 0 ? `${usd(copay)} copay` : "", coinsurance > 0 ? `${pct(coinsurance)} coinsurance` : ""].filter(Boolean);
  // The options that qualify the amounts actually charged; with neither charged, both say how the $0 applies.
  const opts = [copay > 0 || coinsurance === 0 ? d.copayOpt : null, coinsurance > 0 || copay === 0 ? d.coinsuranceOpt : null].filter((o): o is string => !!o);
  const values = opts.map(deductibleOf);
  // Yes or no only when every charged part agrees (a copay before the deductible plus coinsurance after it is neither).
  const deductibleFirst: YesNoUnknown = values.length && values.every((v) => v === "yes") ? "yes" : values.length && values.every((v) => v === "no") ? "no" : "unknown";
  return {
    cost: parts.join(" + ") || `${usd(0)} copay`,
    deductibleFirst,
    sort: coinsurance > 0 ? { rank: 1, amount: coinsurance } : { rank: 0, amount: copay },
  };
}

/** The tier's entries; tier names that differ only in hyphens or case are the same tier (as in the coverage rows). */
function detailsFor(details: Record<string, ExchangeCostDetail[]>, tier: string): ExchangeCostDetail[] | null {
  const key = (t: string) => t.replace(/-/g, "").toUpperCase();
  return details[tier] ?? Object.entries(details).find(([k]) => key(k) === key(tier))?.[1] ?? null;
}

/** In-network one-month retail first, then in-network retail with no stated length; never a longer fill, which is not comparable. */
function primaryOf(entries: ExchangeCostDetail[]): ExchangeCostDetail | null {
  const t = (e: ExchangeCostDetail) => e.pharmacyType.toUpperCase();
  return entries.find((e) => t(e) === "1-MONTH-IN-RETAIL") ?? entries.find((e) => t(e).includes("RETAIL") && !t(e).includes("-OUT-") && !/^\d-MONTH/.test(t(e))) ?? null;
}

export function exchangeCopayRows(insurer: string, plans: ExchangePlanCosts[], listings: ExchangeListingRow[], insulin: InsulinKind = "none"): CopayRow[] {
  const out: CopayRow[] = [];
  for (const plan of plans) {
    const rows = listings.filter((l) => l.planId === plan.planId);
    if (!rows.length) continue;
    for (const tier of [...new Set(rows.map((r) => r.tier))]) {
      const entries = detailsFor(plan.costDetails, tier);
      const primary = entries ? primaryOf(entries) : null;
      const described = primary ? describeCost(primary) : null;
      const loaded = Object.keys(plan.costDetails).length > 0;
      const generalRule = described ? `Plan's general rule for this tier: ${described.cost}${described.deductibleFirst === "yes" ? " after deductible" : ""}` : null;
      if (insulin !== "none") {
        // RCW 48.43.780(1)(a): a covered insulin costs at most $35 per 30-day supply, with no deductible. The plan's own
        // tier copay applies when it is a plain copay under the cap. A combination product may or may not count.
        const plainCopay = described && described.sort.rank === 0 && described.sort.amount <= 35 ? described.sort.amount : null;
        // (1)(b) changes this for HSA-qualified plans only if the IRS removes insulin from HSA preventive care.
        const hsa = /\bHSA\b/i.test(plan.name);
        out.push({
          group: "exchange",
          insurer,
          plan: plan.name,
          planId: plan.planId,
          tier,
          cost: insulin === "some" ? "Not shown: Washington's insulin cap may apply to this combination" : plainCopay != null ? `${usd(plainCopay)} copay` : "At most $35.00 per 30-day supply (Washington law)",
          supply: "30-day",
          deductibleFirst: insulin === "all" ? "no" : "unknown",
          deductibleNote: null,
          restrictions: restrictionsOf(rows.filter((r) => r.tier === tier)),
          other: [
            ...(generalRule ? [generalRule] : []),
            ...(insulin === "all" && hsa ? ["HSA-qualified plan: RCW 48.43.780(1)(b) would change the cap only if the IRS removed insulin from HSA preventive care"] : []),
          ],
          sort: insulin === "all" ? { rank: 0, amount: plainCopay ?? 35 } : { rank: 2, amount: 0 },
        });
        continue;
      }
      out.push({
        group: "exchange",
        insurer,
        plan: plan.name,
        planId: plan.planId,
        tier,
        cost: described?.cost ?? (!loaded ? "Not loaded yet" : entries ? "No one-month retail amount in the plan's file" : "Not stated: the plan's file has no cost rule for this tier"),
        supply: primary ? supplyLabel(primary.pharmacyType) : "retail",
        deductibleFirst: described?.deductibleFirst ?? "unknown",
        deductibleNote: null,
        restrictions: restrictionsOf(rows.filter((r) => r.tier === tier)),
        other: (entries ?? [])
          .filter((e) => e !== primary)
          .map((e) => {
            const d = describeCost(e);
            return `${supplyLabel(e.pharmacyType)}: ${d.cost}${d.deductibleFirst === "yes" ? " after deductible" : ""}`;
          }),
        sort: described?.sort ?? { rank: 2, amount: 0 },
      });
    }
  }
  return out;
}

const DEDUCTIBLE_ORDER: Record<YesNoUnknown, number> = { no: 0, unknown: 1, yes: 2 };

/** Flat copays lowest first, then coinsurance lowest first, then no stated amount; ties: no deductible first. */
export function sortCopays(rows: CopayRow[]): CopayRow[] {
  return [...rows].sort(
    (a, b) =>
      a.sort.rank - b.sort.rank ||
      a.sort.amount - b.sort.amount ||
      DEDUCTIBLE_ORDER[a.deductibleFirst] - DEDUCTIBLE_ORDER[b.deductibleFirst] ||
      a.insurer.localeCompare(b.insurer) ||
      a.plan.localeCompare(b.plan) ||
      a.tier.localeCompare(b.tier),
  );
}
