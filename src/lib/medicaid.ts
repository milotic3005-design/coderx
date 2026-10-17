/**
 * Labels for the CMS Medicaid Drug Rebate Program product file, taken from the
 * data.medicaid.gov data dictionary, and the claim NDC unit qualifier that matches a
 * Medicaid unit type (as state Medicaid billing guides instruct).
 */
import type { NdcQualifier } from "./claims";

export const MDRP_UNIT_TYPES: Record<string, string> = {
  EA: "Each",
  ML: "Milliliter",
  GM: "Gram",
  AHF: "Injectable anti-hemophilic factor",
  TAB: "Tablet",
  CAP: "Capsule",
  SUP: "Suppository",
  TDP: "Transdermal patch",
};

export const COD_STATUS: Record<string, string> = {
  "01": "ANDA",
  "02": "BLA",
  "03": "NDA",
  "04": "NDA authorized generic",
  "05": "DESI 5 — less than effective (not eligible for coverage or rebates)",
  "06": "DESI 6 — withdrawn from market (not eligible for coverage or rebates)",
  "07": "Rx prenatal vitamin or fluoride",
  "08": "Rx dietary supplement / vitamin / mineral",
  "09": "OTC monograph tentative",
  "10": "OTC monograph final",
  "11": "Unapproved drug — drug shortage",
  "12": "Unapproved drug — 1927(k)(2)(A)(ii)",
  "13": "Unapproved drug — 1927(k)(2)(A)(iii)",
};

export const DRUG_CATEGORY: Record<string, string> = {
  S: "Single source",
  I: "Innovator multiple source",
  N: "Non-innovator multiple source",
};

/** NDC unit qualifier consistent with the Medicaid unit type; null when none applies (e.g. MCI). */
export function qualifierForUnitType(unitType: string | null | undefined): NdcQualifier | null {
  switch ((unitType ?? "").toUpperCase()) {
    case "ML":
      return "ML";
    case "GM":
      return "GR";
    case "AHF":
      return "F2";
    case "EA":
    case "TAB":
    case "CAP":
    case "SUP":
    case "TDP":
      return "UN";
    default:
      return null;
  }
}

export interface MedicaidInfo {
  period: string;
  unitType: string | null;
  unitsPerPackage: string | null;
  drugCategory: string | null;
  codStatus: string | null;
  terminationDate: string | null;
  labelerName: string | null;
  releaseId: number;
}

/** True when the product's Medicaid record makes it ineligible or ended on `today`. */
export function medicaidFlags(m: MedicaidInfo, today: string): string[] {
  const flags: string[] = [];
  if (m.codStatus === "05" || m.codStatus === "06") flags.push(`COD status ${m.codStatus}: ${COD_STATUS[m.codStatus]}.`);
  if (m.terminationDate && m.terminationDate <= today) flags.push(`Medicaid rebate file termination date ${m.terminationDate}.`);
  return flags;
}
