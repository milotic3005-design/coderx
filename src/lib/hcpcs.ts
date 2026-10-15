/**
 * HCPCS Level II code helpers: validation, code families, and billing context.
 *
 * Level II codes are one letter followed by four digits. CPT (Level I) codes are
 * AMA-copyrighted and are never stored by CodeRx; CDT D-codes are ADA-copyrighted
 * and are also excluded.
 */

export const HCPCS_LEVEL2_RE = /^[A-CEG-HJ-MP-V]\d{4}$/;

/** Uppercases and validates a Level II code ("j9271" → "J9271"); null when not a Level II code. */
export function normalizeHcpcs(input: string): string | null {
  const s = input.trim().toUpperCase();
  return HCPCS_LEVEL2_RE.test(s) ? s : null;
}

/** A partial code such as "J92" or "q51" (letter + 1–3 digits). */
export function normalizeHcpcsPrefix(input: string): string | null {
  const s = input.trim().toUpperCase();
  return /^[A-CEG-HJ-MP-V]\d{1,3}$/.test(s) ? s : null;
}

/** CPT Category I (5 digits), Category II (####F), Category III (####T), PLA (####U). */
export function isCptLike(input: string): boolean {
  return /^\d{4}[0-9FTU]$/i.test(input.trim());
}

/** CDT dental codes (D####) — ADA copyright, excluded. */
export function isCdtLike(input: string): boolean {
  return /^D\d{4}$/i.test(input.trim());
}

export type MedicareStatus = "medicare" | "medicare-temporary" | "non-medicare" | "varies";

export interface CodeFamily {
  letter: string;
  name: string;
  /** One-paragraph billing context shown with every code of the family. */
  context: string;
  medicare: MedicareStatus;
  drugRelevant: boolean;
}

export const CODE_FAMILIES: Record<string, CodeFamily> = {
  A: {
    letter: "A",
    name: "Supplies, radiopharmaceuticals, transport & miscellaneous",
    context:
      "A-codes cover ambulance services, medical and surgical supplies, administrative and miscellaneous items. A9500–A9999 include diagnostic and therapeutic radiopharmaceuticals and contrast agents. Payment depends on the specific code, benefit category, and setting.",
    medicare: "varies",
    drugRelevant: true,
  },
  B: {
    letter: "B",
    name: "Enteral and parenteral therapy",
    context: "B-codes describe enteral and parenteral nutrition formulae, supplies, and pumps.",
    medicare: "medicare",
    drugRelevant: false,
  },
  C: {
    letter: "C",
    name: "Hospital outpatient (OPPS) codes",
    context:
      "C-codes are temporary codes for hospital outpatient use under the Medicare Outpatient Prospective Payment System, including pass-through drugs and biologicals (many in C9xxx) and devices. They are generally not reported by physician offices; other payers may not recognize them.",
    medicare: "medicare-temporary",
    drugRelevant: true,
  },
  E: {
    letter: "E",
    name: "Durable medical equipment",
    context: "E-codes describe durable medical equipment.",
    medicare: "medicare",
    drugRelevant: false,
  },
  G: {
    letter: "G",
    name: "Procedures and professional services (temporary)",
    context: "G-codes are temporary codes for professional services and procedures that would otherwise be coded in CPT.",
    medicare: "medicare-temporary",
    drugRelevant: false,
  },
  H: {
    letter: "H",
    name: "Behavioral health and substance use services",
    context: "H-codes are used by state Medicaid agencies for mental health and substance use services. They are not payable by Medicare.",
    medicare: "non-medicare",
    drugRelevant: false,
  },
  J: {
    letter: "J",
    name: "Drugs administered other than oral method; chemotherapy drugs",
    context:
      "J-codes are permanent national codes for drugs and biologicals — most often clinician-administered (buy-and-bill) products paid under Medicare Part B — plus certain immunosuppressive, inhalation (via DME), and oral anticancer/antiemetic drugs. Units are reported in multiples of the dosage in the code descriptor.",
    medicare: "medicare",
    drugRelevant: true,
  },
  K: {
    letter: "K",
    name: "Temporary codes for DME MACs",
    context: "K-codes are temporary codes used by DME Medicare Administrative Contractors.",
    medicare: "medicare-temporary",
    drugRelevant: false,
  },
  L: {
    letter: "L",
    name: "Orthotics and prosthetics",
    context: "L-codes describe orthotic and prosthetic procedures and devices.",
    medicare: "medicare",
    drugRelevant: false,
  },
  M: {
    letter: "M",
    name: "Medical services and quality measures",
    context: "M-codes describe certain medical services and quality-measure reporting.",
    medicare: "medicare",
    drugRelevant: false,
  },
  P: {
    letter: "P",
    name: "Pathology and laboratory services",
    context: "P-codes include pathology and laboratory services; P9xxx codes describe blood and blood products.",
    medicare: "medicare",
    drugRelevant: true,
  },
  Q: {
    letter: "Q",
    name: "Temporary codes",
    context:
      "Q-codes are temporary national codes recognized by Medicare. For drugs they include biosimilar products (Q51xx) and other drugs, biologicals, and skin substitutes that are not yet assigned a permanent code. Units follow the dosage in the descriptor.",
    medicare: "medicare-temporary",
    drugRelevant: true,
  },
  R: {
    letter: "R",
    name: "Diagnostic radiology services",
    context: "R-codes describe portable diagnostic radiology transportation and setup.",
    medicare: "medicare",
    drugRelevant: false,
  },
  S: {
    letter: "S",
    name: "Temporary national codes (non-Medicare)",
    context:
      "S-codes are temporary national codes established for private payers and Medicaid programs. They are not payable by Medicare; whether a payer recognizes an S-code, and how it pays, varies by payer and contract.",
    medicare: "non-medicare",
    drugRelevant: true,
  },
  T: {
    letter: "T",
    name: "State Medicaid agency codes",
    context: "T-codes are national codes established for state Medicaid agencies. They are not valid for Medicare.",
    medicare: "non-medicare",
    drugRelevant: false,
  },
  U: {
    letter: "U",
    name: "Coronavirus and laboratory tests (temporary)",
    context: "U-codes are temporary codes for certain laboratory tests.",
    medicare: "medicare-temporary",
    drugRelevant: false,
  },
  V: {
    letter: "V",
    name: "Vision, hearing, and speech-language services",
    context: "V-codes describe vision, hearing, and speech-language pathology services and supplies.",
    medicare: "medicare",
    drugRelevant: false,
  },
};

export function familyOf(code: string): CodeFamily | undefined {
  return CODE_FAMILIES[code.charAt(0).toUpperCase()];
}

export const DRUG_FAMILY_LETTERS = ["J", "Q", "C", "A", "P", "S"] as const;

export const NOC_CONTEXT =
  "Not otherwise classified (NOC/NOS) code on the CMS NOC code list. NOC codes are used when no specific code describes a product; claims commonly require additional information such as the drug name, NDC, dosage, and route. CodeRx never assigns a product to a specific NOC code unless a CMS file supports it.";

/** CMS HCPCS coverage codes (record layout field 16). */
export const COVERAGE_CODES: Record<string, string> = {
  C: "Carrier judgment",
  D: "Special coverage instructions apply",
  I: "Not payable by Medicare",
  M: "Non-covered by Medicare",
  S: "Non-covered by Medicare statute",
};

/** CMS HCPCS action codes (record layout field 30). */
export const ACTION_CODES: Record<string, string> = {
  A: "Added",
  B: "Administrative data field and long description changed",
  C: "Long description changed",
  D: "Discontinued",
  F: "Administrative data field changed",
  N: "No maintenance",
  P: "Payment change",
  R: "Reactivated",
  S: "Short description changed",
  T: "Miscellaneous change",
};

/** CMS HCPCS pricing indicator codes relevant to drugs (record layout field 9). */
export const PRICING_INDICATORS: Record<string, string> = {
  "00": "Not separately priced by Part B",
  "11": "Physician fee schedule (national RVUs)",
  "12": "Physician fee schedule (anesthesia base units)",
  "13": "Priced by contractor (e.g., NOC, individual determination)",
  "21": "Clinical lab fee schedule (national limitation amount)",
  "22": "Clinical lab — priced by contractor",
  "31": "DME — frequently serviced",
  "32": "DME — inexpensive/routinely purchased",
  "33": "DME — oxygen and oxygen equipment",
  "34": "DME supplies",
  "35": "Surgical dressings",
  "36": "DME — capped rental",
  "37": "Ostomy, tracheostomy and urological supplies",
  "38": "Orthotics, prosthetics, prosthetic devices & vision services",
  "39": "Parenteral and enteral nutrition",
  "40": "Lymphedema compression treatment items",
  "45": "Customized DME items",
  "46": "DME — carrier priced",
  "51": "Drugs",
  "52": "Reasonable charge",
  "53": "Statute",
  "54": "Vaccinations",
  "55": "Splints and casts",
  "56": "IOLs inserted in a physician's office",
  "57": "Other carrier priced",
  "99": "Value not established",
};

/**
 * Whether a code is drug-related, using only official CMS fields: pricing
 * indicator 51 (drugs) or 54 (vaccinations), BETOS O1D/O1E/O1G, or presence in a
 * CMS drug payment/crosswalk file (passed in by the caller).
 */
export function isDrugCode(input: {
  pricingIndicators: string[];
  betos?: string | null;
  inCmsDrugFile?: boolean;
}): boolean {
  if (input.inCmsDrugFile) return true;
  if (input.pricingIndicators.some((p) => p === "51" || p === "54")) return true;
  return ["O1D", "O1E", "O1G"].includes((input.betos ?? "").toUpperCase());
}

/** Code is active on `onDate` (YYYY-MM-DD) given its CMS termination date. */
export function isCodeActive(terminationDate: string | null | undefined, onDate: string): boolean {
  return !terminationDate || terminationDate >= onDate;
}
