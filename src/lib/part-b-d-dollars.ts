/**
 * Dollars for the pathways the rules allow. Part D's benchmark is CMS's UNIT_COST: a plan's
 * average at in-area retail pharmacies, per NDC billing unit (mL, each). CMS does not label the
 * unit, so a conversion to HCPCS units is shown only for dosage forms confirmed against real
 * data and only when the result is near the Part B limit. Otherwise the raw cost is shown and
 * nothing is compared. A contract rate the user enters is per HCPCS unit and needs no conversion.
 */
import type { SettingResult, Verdict } from "./part-b-d";
import { programNet } from "./site-of-care";

/**
 * FDA dosage forms where at least 3 distinct products converted to 0.5 to 2 times the Part B
 * limit, from all 499 Washington NDCs in the October 2026 ASP crosswalk with a payment limit.
 */
export const UNIT_COST_CONFIRMED_FORMS: Set<string> = new Set([
  "INJECTION",
  "INJECTION, POWDER, FOR SOLUTION",
  "INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION",
  "INJECTION, SOLUTION",
  "INJECTION, SUSPENSION",
  "INJECTION, SUSPENSION, EXTENDED RELEASE",
  "KIT",
  "SOLUTION",
  "SUSPENSION",
  "TABLET",
]);

export const PART_D_RATIO_BAND = { min: 0.25, max: 4 };
const SEQUESTRATION_PCT = 2;
const PART_B_PATIENT_SHARE = 0.2;
/** A gap under 1% is copay rounding, not a difference worth marking. */
const TIE_MARGIN = 0.01;
/** Same ceiling as the numeric inputs on the other tools. */
const MAX_INPUT = 99_999;

export interface CostRow {
  unitCostMedian: number;
  packageSize: number | null;
  billUnitsPerItem: number | null;
  dosageForm: string | null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function convertUnitCost(rows: CostRow[], paymentLimit: number | null, confirmedForms: Set<string> = UNIT_COST_CONFIRMED_FORMS): { perHcpcsUnit: number | null; raw: number | null } {
  if (!rows.length) return { perHcpcsUnit: null, raw: null };
  const raw = median(rows.map((r) => r.unitCostMedian));
  const converted = rows.flatMap((r) => (r.dosageForm && confirmedForms.has(r.dosageForm) && r.packageSize && r.billUnitsPerItem ? [(r.unitCostMedian * r.packageSize) / r.billUnitsPerItem] : []));
  if (!converted.length || !paymentLimit || paymentLimit <= 0) return { perHcpcsUnit: null, raw };
  const perHcpcsUnit = median(converted);
  const ratio = perHcpcsUnit / paymentLimit;
  return { perHcpcsUnit: ratio >= PART_D_RATIO_BAND.min && ratio <= PART_D_RATIO_BAND.max ? perHcpcsUnit : null, raw };
}

export type PathwayKey = "hopd_b" | "home_b_dme" | "home_d";

export interface Pathway {
  key: PathwayKey;
  /** The rules allow this pathway for the case, whether or not there is a rate for it. */
  lawful: boolean;
  allowedPerUnit: number | null;
  expectedPerDose: number | null;
  expectedPerMonth: number | null;
  source: "cms" | "you" | null;
}

export interface DollarResult {
  pathways: Pathway[];
  higher: PathwayKey | null;
  lawfulCount: number;
  /** One pathway is lawful and no setting row is still open, so it is safe to say so. */
  onlyOneLawful: boolean;
  rawPartD: number | null;
}

export interface DollarInput {
  results: SettingResult[];
  units: number | null;
  dosesPerMonth: number | null;
  opps: { paymentRate: number | null; copayPerUnit: number | null } | null;
  paymentLimit: number | null;
  inpatientDeductible: number | null;
  partDPerHcpcsUnit: number | null;
  rawPartD: number | null;
  contractRate: number | null;
}

const usable = (n: number | null): n is number => n != null && Number.isFinite(n) && n > 0 && n <= MAX_INPUT;
const cents = (n: number) => Math.round(n * 100) / 100;

export function compareDollars(input: DollarInput): DollarResult {
  const { results, opps, paymentLimit, inpatientDeductible } = input;
  const verdict = (setting: SettingResult["setting"]): Verdict | undefined => results.find((r) => r.setting === setting)?.verdict;
  const units = usable(input.units) ? input.units : null;
  const doses = usable(input.dosesPerMonth) ? input.dosesPerMonth : null;

  const pathway = (key: PathwayKey, lawful: boolean, perUnit: number | null, source: Pathway["source"], expected: (allowed: number) => number): Pathway => {
    const allowedPerUnit = lawful ? perUnit : null;
    const expectedPerDose = allowedPerUnit != null && units != null ? cents(expected(allowedPerUnit * units)) : null;
    return { key, lawful, allowedPerUnit, expectedPerDose, expectedPerMonth: expectedPerDose != null && doses != null ? cents(expectedPerDose * doses) : null, source: allowedPerUnit != null ? source : null };
  };

  const hopdLawful = verdict("hopd") === "part_b";
  const dmeLawful = verdict("home_pump") === "part_b_dme" || verdict("home_no_pump") === "part_b_dme";
  // A pump drug is Part B at home, so the no-pump row's Part D answer is a different case, not an alternative to rank.
  const partDLawful = verdict("home_no_pump") === "part_d" && verdict("home_pump") !== "part_b_dme";

  const copay = opps?.copayPerUnit ?? null;
  const hopdShare = (allowed: number) => {
    const share = copay != null && units != null ? copay * units : allowed * PART_B_PATIENT_SHARE;
    return inpatientDeductible != null ? Math.min(share, inpatientDeductible) : share;
  };
  const contract = usable(input.contractRate) ? input.contractRate : null;

  const pathways = [
    pathway("hopd_b", hopdLawful, opps?.paymentRate ?? null, "cms", (allowed) => programNet(allowed, hopdShare(allowed), SEQUESTRATION_PCT)),
    pathway("home_b_dme", dmeLawful, paymentLimit, "cms", (allowed) => programNet(allowed, allowed * PART_B_PATIENT_SHARE, SEQUESTRATION_PCT)),
    pathway("home_d", partDLawful, contract ?? input.partDPerHcpcsUnit, contract != null ? "you" : "cms", (allowed) => allowed),
  ];

  const priced = pathways.filter((p) => p.expectedPerDose != null);
  const lawfulCount = [hopdLawful, dmeLawful, partDLawful].filter(Boolean).length;
  const top = [...priced].sort((a, b) => b.expectedPerDose! - a.expectedPerDose!);
  const clearlyHigher = priced.length >= 2 && top[0].expectedPerDose! > top[1].expectedPerDose! * (1 + TIE_MARGIN);
  const higher = lawfulCount >= 2 && clearlyHigher ? top[0].key : null;
  const stillOpen = (["hopd", "home_pump", "home_no_pump"] as const).some((s) => verdict(s) === "check" || verdict(s) === "part_b_packaged") || verdict("home_no_pump") === "part_b";
  return { pathways, higher, lawfulCount, onlyOneLawful: lawfulCount === 1 && !stillOpen, rawPartD: input.rawPartD };
}
