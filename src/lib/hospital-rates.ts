/**
 * Hospital price transparency drug rates, per HCPCS billing unit.
 *
 * A file states each negotiated charge for a drug quantity (drug_unit_of_measurement and
 * drug_type_of_measurement, e.g. 10 "ME" = 10 mg). The rate per HCPCS billing unit is
 * charge ÷ quantity × (billing unit in the same measure), computed only when the file's
 * measure and the CMS billing unit share a dimension. "UN" (unit) is not converted: the
 * CMS template does not say what the unit counts. Case rates and other encounter-level
 * methodologies are not per-unit drug prices and are left out of the per-unit figures, as
 * are amounts above LINE_AMOUNT_MULTIPLE × the CMS payment limit per unit: files list some
 * per-claim-line payments (e.g. Apple Health managed care drug lines) as fee schedule rates.
 */
import { convert, type ParsedDosage, type UnitKey } from "./billing";

export type PlanType = "commercial" | "medicare_advantage" | "medicaid_managed_care";

export const PLAN_TYPE_LABELS: Record<PlanType, string> = {
  commercial: "Commercial",
  medicare_advantage: "Medicare Advantage",
  medicaid_managed_care: "Apple Health managed care",
};

/** Above this multiple of the CMS payment limit per billing unit, an amount is treated as a per-line payment. */
export const LINE_AMOUNT_MULTIPLE = 10;

/** Methodologies whose amounts price the drug quantity itself. */
export const PER_UNIT_METHODOLOGIES = ["fee schedule", "percent of total billed charges"];

/** CMS template drug_type_of_measurement → CodeRx unit. */
const DRUG_UNITS: Record<string, UnitKey> = { ME: "mg", GR: "g", GM: "g", ML: "ml", F2: "iu", EA: "each" };

/** Multiplier from a file amount (for `quantity` of `drugUnit`) to one HCPCS billing unit; null when not comparable. */
export function toBillingUnitFactor(quantity: number | null, drugUnit: string | null, billingUnit: ParsedDosage | null): number | null {
  if (!quantity || quantity <= 0 || !drugUnit || !billingUnit) return null;
  const unit = DRUG_UNITS[drugUnit.toUpperCase()];
  if (!unit) return null;
  const billingInFileUnits = convert(billingUnit.amount, billingUnit.unit, unit);
  return billingInFileUnits == null ? null : billingInFileUnits / quantity;
}

export interface RateRow {
  hospitalKey: string;
  planType: string;
  setting: string | null;
  billingClass: string | null;
  methodology: string | null;
  drugQuantity: number | null;
  drugUnit: string | null;
  amounts: number[];
  percentContracts: number;
  algorithmContracts: number;
  grossMin: number | null;
  grossMax: number | null;
}

export interface RateSummary {
  hospitalKey: string;
  planType: string;
  /** Per-billing-unit amounts (one per payer-plan contract), sorted. */
  perUnit: number[];
  min: number | null;
  median: number | null;
  max: number | null;
  /** Median as a percent of the CMS payment limit, when there is one. */
  medianPctOfLimit: number | null;
  /** Contracts priced another way: case rates/other methodologies, a percent or algorithm only, or a drug measure that does not convert. */
  otherContracts: number;
  /** Amounts over LINE_AMOUNT_MULTIPLE × the CMS limit per unit (likely per claim line), as published. */
  lineAmounts: number[];
  grossPerUnit: { min: number; max: number } | null;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Outpatient facility rates for one code, per hospital and plan type. */
export function summarizeRates(rows: RateRow[], billingUnit: ParsedDosage | null, paymentLimit: number | null): RateSummary[] {
  const out = new Map<string, RateSummary & { gross: number[] }>();
  for (const r of rows) {
    if (r.setting !== "outpatient" || (r.billingClass && r.billingClass !== "facility")) continue;
    const key = `${r.hospitalKey}|${r.planType}`;
    let s = out.get(key);
    if (!s) {
      s = { hospitalKey: r.hospitalKey, planType: r.planType, perUnit: [], min: null, median: null, max: null, medianPctOfLimit: null, otherContracts: 0, lineAmounts: [], grossPerUnit: null, gross: [] };
      out.set(key, s);
    }
    const factor = toBillingUnitFactor(r.drugQuantity, r.drugUnit, billingUnit);
    s.otherContracts += r.percentContracts + r.algorithmContracts;
    if (!PER_UNIT_METHODOLOGIES.includes(r.methodology ?? "") || factor == null) {
      s.otherContracts += r.amounts.length;
      continue;
    }
    for (const a of r.amounts) {
      const perUnit = r2(a * factor);
      if (paymentLimit && perUnit > paymentLimit * LINE_AMOUNT_MULTIPLE) s.lineAmounts.push(a);
      else s.perUnit.push(perUnit);
    }
    for (const g of [r.grossMin, r.grossMax]) if (g != null) s.gross.push(r2(g * factor));
  }
  return [...out.values()].map(({ gross, ...s }) => {
    const perUnit = s.perUnit.sort((a, b) => a - b);
    const med = median(perUnit);
    return {
      ...s,
      perUnit,
      min: perUnit[0] ?? null,
      median: med == null ? null : r2(med),
      max: perUnit.at(-1) ?? null,
      medianPctOfLimit: med != null && paymentLimit ? Math.round((med / paymentLimit) * 100) : null,
      grossPerUnit: gross.length ? { min: Math.min(...gross), max: Math.max(...gross) } : null,
    };
  });
}

export const PLAN_ORDER: PlanType[] = ["commercial", "medicare_advantage", "medicaid_managed_care"];

/** One summary per plan type across every hospital (each contract counted once per hospital). */
export function pooledByPlanType(summaries: RateSummary[], paymentLimit: number | null) {
  return PLAN_ORDER.flatMap((planType) => {
    const perUnit = summaries.filter((s) => s.planType === planType).flatMap((s) => s.perUnit).sort((a, b) => a - b);
    if (!perUnit.length) return [];
    const med = median(perUnit)!;
    return [{ planType, contracts: perUnit.length, min: perUnit[0], median: Math.round(med * 100) / 100, max: perUnit.at(-1)!, medianPct: paymentLimit ? Math.round((med / paymentLimit) * 100) : null, minPct: paymentLimit ? Math.round((perUnit[0] / paymentLimit) * 100) : null, maxPct: paymentLimit ? Math.round((perUnit.at(-1)! / paymentLimit) * 100) : null }];
  });
}

/** Per plan type, amounts too large to be per-unit rates (likely per claim line), as published. */
export function lineAmountsByPlanType(summaries: RateSummary[]) {
  return PLAN_ORDER.flatMap((planType) => {
    const amounts = summaries.filter((s) => s.planType === planType).flatMap((s) => s.lineAmounts).sort((a, b) => a - b);
    return amounts.length ? [{ planType, contracts: amounts.length, min: amounts[0], median: Math.round(median(amounts)! * 100) / 100, max: amounts.at(-1)! }] : [];
  });
}
