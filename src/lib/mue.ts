/**
 * Medically Unlikely Edit (MUE) presentation helpers. Wording follows CMS's NCCI MUE
 * descriptions; CodeRx shows the published value and indicator, never a payment
 * determination.
 */

export type MueServiceType = "practitioner" | "outpatient_hospital" | "dme_supplier";

export const MUE_SERVICE_LABELS: Record<MueServiceType, { short: string; long: string }> = {
  practitioner: { short: "Practitioner", long: "Practitioner services (professional claims)" },
  outpatient_hospital: { short: "Outpatient hospital", long: "Facility outpatient hospital services" },
  dme_supplier: { short: "DME supplier", long: "DME supplier services" },
};

/** Summaries of CMS's MUE adjudication indicator descriptions (NCCI FAQs, MLN Matters MM8853). */
export const MAI_TEXT: Record<1 | 2 | 3, string> = {
  1: "Claim-line edit: each line is checked against the value; if a line exceeds it, all units on that line are denied.",
  2: "Date-of-service edit (policy): units above the value for the same patient and date are considered contrary to statute, regulation, or CMS guidance.",
  3: "Date-of-service edit (clinical benchmarks): more units for the same patient and date are possible but medically highly unlikely; documentation of medical necessity may be considered.",
};

export const MUE_INFO_URL = "https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-medically-unlikely-edits";

export interface MueEntry {
  serviceType: MueServiceType;
  value: number;
  adjudicationIndicator: number | null;
  adjudicationText: string | null;
  rationale: string | null;
  period: string;
  releaseId: number;
}

export type MueStatus = "within" | "exceeds" | "not-reportable";

export function mueStatus(units: number, value: number): MueStatus {
  if (value === 0) return "not-reportable";
  return units > value ? "exceeds" : "within";
}
