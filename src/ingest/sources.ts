/**
 * Source registry and the pinned manifest of known releases.
 *
 * The manifest is the reproducible baseline (what was verified on 2026-10-14);
 * `discover.ts` reads the publishers' landing pages to find newer releases, and
 * every imported file is recorded with its URL and SHA-256 in `source_releases`.
 */

export type SourceKey =
  | "cms_hcpcs"
  | "cms_payment_limits"
  | "cms_ndc_hcpcs"
  | "cms_mue_practitioner"
  | "cms_mue_outpatient"
  | "cms_mue_dme"
  | "fda_ndc"
  | "fda_ndc_excluded"
  | "fda_purple_book"
  | "cms_mdrp_products"
  | "cms_opps_addendum_a"
  | "cms_opps_addendum_b"
  | "wa_hca_home_infusion"
  | "wa_hca_professional_drugs";

export const SOURCE_KEYS: SourceKey[] = [
  "cms_hcpcs",
  "cms_payment_limits",
  "cms_ndc_hcpcs",
  "cms_mue_practitioner",
  "cms_mue_outpatient",
  "cms_mue_dme",
  "fda_ndc",
  "fda_ndc_excluded",
  "fda_purple_book",
  "cms_mdrp_products",
  "cms_opps_addendum_a",
  "cms_opps_addendum_b",
  "wa_hca_home_infusion",
  "wa_hca_professional_drugs",
];

/** The three MUE tables CMS publishes each quarter, keyed by the service type stored with each value. */
export const MUE_SOURCES = {
  cms_mue_practitioner: { serviceType: "practitioner", label: "Practitioner services", fileSlug: "practitioner" },
  cms_mue_outpatient: { serviceType: "outpatient_hospital", label: "Facility outpatient hospital services", fileSlug: "facility-outpatient-hospital" },
  cms_mue_dme: { serviceType: "dme_supplier", label: "DME supplier services", fileSlug: "dme-supplier" },
} as const;
export type MueSourceKey = keyof typeof MUE_SOURCES;
export type MueServiceType = (typeof MUE_SOURCES)[MueSourceKey]["serviceType"];
export const isMueSource = (key: string): key is MueSourceKey => key in MUE_SOURCES;

/**
 * State Medicaid fee schedules: the state, payer, and program each one describes.
 * kind "home_infusion" schedules feed the drug pages' per diem block; kind "drugs"
 * schedules price individual drug codes.
 */
export const STATE_FEE_SOURCES = {
  wa_hca_home_infusion: {
    kind: "home_infusion",
    state: "WA",
    payer: "Washington Apple Health (Medicaid)",
    publisher: "HCA",
    program: "Home Infusion Therapy/Parenteral Nutrition Program",
    /** Legend and payment rule, from HCA's fee schedule legend and WAC 182-553. */
    note: "BR = by report (invoice required); DP = covered under another program (see comments); N/A = no separate rate for that area. HCA pays the lesser of the provider’s usual charge and the maximum allowable fee (WAC 182-553).",
  },
  wa_hca_professional_drugs: {
    kind: "drugs",
    state: "WA",
    payer: "Washington Apple Health (Medicaid)",
    publisher: "HCA",
    program: "Professional Administered Drug Fee Schedule",
    /** Legend from the schedule itself; the outpatient hospital rule from HCA's OPPS billing guide. */
    note: "AAC = actual acquisition cost, based on NDC or invoice; BR = by report; NC = not covered; DC = not covered, see a different code; DP = covered under another program (see comments); PA = prior authorization; EPA = expedited prior authorization (see the billing guide); CPA = contractor prior authorization (Qualis). For professional claims; hospital-administered drugs are paid under HCA's outpatient (OPPS/EAPG) rules.",
  },
} as const;
export type StateFeeSourceKey = keyof typeof STATE_FEE_SOURCES;

export interface SourceDefinition {
  key: SourceKey;
  organization: "CMS" | "FDA" | "Washington State HCA";
  dataset: string;
  shortName: string;
  landingPageUrl: string;
  cadence: "quarterly" | "daily" | "monthly" | "as published";
  /** Badge used for data from this source. */
  badge: "official-cms" | "official-fda" | "official-state";
  licenseNote: string;
}

const MUE_PAGE = "https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-medically-unlikely-edits";
const MUE_LICENSE =
  "U.S. Government work. Only HCPCS Level II rows are stored; CPT rows (AMA copyright) are dropped. CMS keeps some MUE values confidential, so a missing value does not mean there is no limit.";

export const SOURCES: Record<SourceKey, SourceDefinition> = {
  cms_hcpcs: {
    key: "cms_hcpcs",
    organization: "CMS",
    dataset: "HCPCS Level II Quarterly Update (Alpha-Numeric HCPCS File)",
    shortName: "CMS HCPCS quarterly file",
    landingPageUrl: "https://www.cms.gov/medicare/coding-billing/healthcare-common-procedure-system/quarterly-update",
    cadence: "quarterly",
    badge: "official-cms",
    licenseNote: "HCPCS Level II codes are maintained by CMS and public. CPT and CDT content is not stored.",
  },
  cms_payment_limits: {
    key: "cms_payment_limits",
    organization: "CMS",
    dataset: "Medicare Part B Drug Payment Limit File (ASP pricing file)",
    shortName: "CMS Part B payment limit file",
    landingPageUrl: "https://www.cms.gov/medicare/payment/part-b-drugs/asp-pricing-files",
    cadence: "quarterly",
    badge: "official-cms",
    licenseNote: "U.S. Government work. CPT rows (AMA copyright) are excluded by CodeRx.",
  },
  cms_ndc_hcpcs: {
    key: "cms_ndc_hcpcs",
    organization: "CMS",
    dataset: "NDC–HCPCS Crosswalks (ASP, OPPS, AWP, PrEP, NOC)",
    shortName: "CMS NDC–HCPCS crosswalk",
    landingPageUrl: "https://www.cms.gov/medicare/payment/part-b-drugs/asp-pricing-files",
    cadence: "quarterly",
    badge: "official-cms",
    licenseNote: "U.S. Government work. Not a comprehensive list of all NDCs; supports ASP-based Part B payment only.",
  },
  cms_mue_practitioner: {
    key: "cms_mue_practitioner",
    organization: "CMS",
    dataset: "Medicare NCCI Medically Unlikely Edits — Practitioner Services MUE Table",
    shortName: "CMS MUE table (practitioner)",
    landingPageUrl: MUE_PAGE,
    cadence: "quarterly",
    badge: "official-cms",
    licenseNote: MUE_LICENSE,
  },
  cms_mue_outpatient: {
    key: "cms_mue_outpatient",
    organization: "CMS",
    dataset: "Medicare NCCI Medically Unlikely Edits — Facility Outpatient Hospital Services MUE Table",
    shortName: "CMS MUE table (outpatient hospital)",
    landingPageUrl: MUE_PAGE,
    cadence: "quarterly",
    badge: "official-cms",
    licenseNote: MUE_LICENSE,
  },
  cms_mue_dme: {
    key: "cms_mue_dme",
    organization: "CMS",
    dataset: "Medicare NCCI Medically Unlikely Edits — DME Supplier Services MUE Table",
    shortName: "CMS MUE table (DME supplier)",
    landingPageUrl: MUE_PAGE,
    cadence: "quarterly",
    badge: "official-cms",
    licenseNote: MUE_LICENSE,
  },
  cms_mdrp_products: {
    key: "cms_mdrp_products",
    organization: "CMS",
    dataset: "Drug Products in the Medicaid Drug Rebate Program",
    shortName: "CMS Medicaid Drug Rebate Program product data",
    landingPageUrl: "https://www.medicaid.gov/medicaid/prescription-drugs/medicaid-drug-rebate-program/medicaid-drug-rebate-program-data",
    cadence: "quarterly",
    badge: "official-cms",
    licenseNote: "U.S. Government work (data.medicaid.gov). CodeRx keeps the newest quarter for the NDCs it indexes. Labeler-reported; a missing NDC is not proof that a drug lacks a rebate agreement.",
  },
  fda_ndc: {
    key: "fda_ndc",
    organization: "FDA",
    dataset: "National Drug Code Directory (finished drugs)",
    shortName: "FDA NDC Directory",
    landingPageUrl: "https://www.fda.gov/drugs/drug-approvals-and-databases/national-drug-code-directory",
    cadence: "daily",
    badge: "official-fda",
    licenseNote: "Public data. Inclusion does not indicate FDA approval, verification, or coverage.",
  },
  fda_ndc_excluded: {
    key: "fda_ndc_excluded",
    organization: "FDA",
    dataset: "NDC Directory — excluded products and packages",
    shortName: "FDA NDC excluded listings",
    landingPageUrl: "https://www.fda.gov/drugs/drug-approvals-and-databases/national-drug-code-directory",
    cadence: "daily",
    badge: "official-fda",
    licenseNote: "Public data. Records removed from the active directory (flags E, U, I, D).",
  },
  cms_opps_addendum_a: {
    key: "cms_opps_addendum_a",
    organization: "CMS",
    dataset: "Hospital Outpatient Prospective Payment System (OPPS) Addendum A (payment by APC), quarterly update",
    shortName: "CMS OPPS Addendum A",
    landingPageUrl: "https://www.cms.gov/medicare/payment/prospective-payment-systems/hospital-outpatient-pps/quarterly-addenda-updates",
    cadence: "quarterly",
    badge: "official-cms",
    licenseNote:
      "U.S. Government work, downloaded through CMS's AMA CPT license page (accepted by the CodeRx operator on 2026-10-26). Addendum A lists APCs with CMS group titles and rates; it contains no CPT rows.",
  },
  cms_opps_addendum_b: {
    key: "cms_opps_addendum_b",
    organization: "CMS",
    dataset: "Hospital Outpatient Prospective Payment System (OPPS) Addendum B (payment by HCPCS code), quarterly update",
    shortName: "CMS OPPS Addendum B",
    landingPageUrl: "https://www.cms.gov/medicare/payment/prospective-payment-systems/hospital-outpatient-pps/quarterly-addenda-updates",
    cadence: "quarterly",
    badge: "official-cms",
    licenseNote:
      "U.S. Government work, downloaded through CMS's AMA CPT license page (accepted by the CodeRx operator on 2026-10-26). Only HCPCS Level II rows are stored; CPT rows (AMA copyright) and dental rows (ADA copyright) are counted and dropped.",
  },
  wa_hca_professional_drugs: {
    key: "wa_hca_professional_drugs",
    organization: "Washington State HCA",
    dataset: "Apple Health (Medicaid) Professional Administered Drug Fee Schedule",
    shortName: "Washington HCA professional administered drug fee schedule",
    landingPageUrl: "https://www.hca.wa.gov/billers-providers-partners/prior-authorization-claims-and-billing/provider-billing-guides-and-fee-schedules",
    cadence: "as published",
    badge: "official-state",
    licenseNote: "Washington State government publication. Maximum allowable fees and prior-authorization flags for drugs billed on professional claims. Only HCPCS Level II rows are stored.",
  },
  wa_hca_home_infusion: {
    key: "wa_hca_home_infusion",
    organization: "Washington State HCA",
    dataset: "Apple Health (Medicaid) Home Infusion Therapy/Parenteral Nutrition Program fee schedule",
    shortName: "Washington HCA home infusion fee schedule",
    landingPageUrl: "https://www.hca.wa.gov/billers-providers-partners/prior-authorization-claims-and-billing/provider-billing-guides-and-fee-schedules",
    cadence: "as published",
    badge: "official-state",
    licenseNote: "Washington State government publication. Maximum allowable fees; HCA pays the lesser of the provider's usual charge and the schedule (WAC 182-553). Only HCPCS Level II rows are stored.",
  },
  fda_purple_book: {
    key: "fda_purple_book",
    organization: "FDA",
    dataset: "Purple Book: Database of Licensed Biological Products (monthly data)",
    shortName: "FDA Purple Book",
    landingPageUrl: "https://purplebooksearch.fda.gov/downloads",
    cadence: "monthly",
    badge: "official-fda",
    licenseNote: "Public data. Biosimilar and interchangeable relationships as licensed by FDA.",
  },
};

export interface ReleaseCandidate {
  sourceKey: SourceKey;
  /** "2026-Q4" (quarterly), "2026-09" (monthly); FDA daily snapshots get their period from Last-Modified. */
  period: string | null;
  url: string;
  publicationLabel?: string | null;
  publicationDate?: string | null;
}

const CMS = "https://www.cms.gov";

/** Releases verified on the CMS landing pages on 2026-10-14 (labels copied as posted). */
export const MANIFEST: ReleaseCandidate[] = [
  // HCPCS quarterly files
  { sourceKey: "cms_hcpcs", period: "2025-Q1", url: `${CMS}/files/zip/january-2025-alpha-numeric-hcpcs-file.zip`, publicationLabel: "Updated 12/17/2024", publicationDate: "2024-12-17" },
  { sourceKey: "cms_hcpcs", period: "2025-Q2", url: `${CMS}/files/zip/april-2025-alpha-numeric-hcpcs-file.zip`, publicationLabel: "Updated 03/26/2025", publicationDate: "2025-03-26" },
  { sourceKey: "cms_hcpcs", period: "2025-Q3", url: `${CMS}/files/zip/july-2025-alpha-numeric-hcpcs-file.zip`, publicationLabel: "Updated 07/09/2025", publicationDate: "2025-07-09" },
  { sourceKey: "cms_hcpcs", period: "2025-Q4", url: `${CMS}/files/zip/october-2025-alpha-numeric-hcpcs-file.zip`, publicationLabel: "Updated 09/23/2025", publicationDate: "2025-09-23" },
  { sourceKey: "cms_hcpcs", period: "2026-Q1", url: `${CMS}/files/zip/january-2026-alpha-numeric-hcpcs-file.zip`, publicationLabel: "Updated 01/12/2026", publicationDate: "2026-01-12" },
  { sourceKey: "cms_hcpcs", period: "2026-Q2", url: `${CMS}/files/zip/april-2026-alpha-numeric-hcpcs-file.zip`, publicationLabel: "Updated 03/18/2026", publicationDate: "2026-03-18" },
  { sourceKey: "cms_hcpcs", period: "2026-Q3", url: `${CMS}/files/zip/july-2026-alpha-numeric-hcpcs-file.zip`, publicationLabel: "Updated 06/17/2026", publicationDate: "2026-06-17" },
  { sourceKey: "cms_hcpcs", period: "2026-Q4", url: `${CMS}/files/zip/october-2026-alpha-numeric-hcpcs-file.zip`, publicationLabel: "Updated 09/23/2026", publicationDate: "2026-09-23" },

  // Part B payment limit files
  { sourceKey: "cms_payment_limits", period: "2025-Q1", url: `${CMS}/files/zip/january-2025-asp-pricing-file-03/11/25-final-file.zip`, publicationLabel: "12/19/25 - Final File", publicationDate: "2025-12-19" },
  { sourceKey: "cms_payment_limits", period: "2025-Q2", url: `${CMS}/files/zip/april-2025-asp-pricing-file.zip`, publicationLabel: "03/10/2026 – Final File", publicationDate: "2026-03-10" },
  { sourceKey: "cms_payment_limits", period: "2025-Q3", url: `${CMS}/files/zip/july-2025-asp-pricing-file.zip`, publicationLabel: "03/10/2026 – Final File", publicationDate: "2026-03-10" },
  { sourceKey: "cms_payment_limits", period: "2025-Q4", url: `${CMS}/files/zip/october-2025-asp-pricing-final-file.zip`, publicationLabel: "09/08/2026 – Final File", publicationDate: "2026-09-08" },
  { sourceKey: "cms_payment_limits", period: "2026-Q1", url: `${CMS}/files/zip/january-2026-medicare-part-b-payment-limit-files.zip`, publicationLabel: "Final file - revised 09/15/2026", publicationDate: "2026-09-15" },
  { sourceKey: "cms_payment_limits", period: "2026-Q2", url: `${CMS}/files/zip/april-2026-medicare-part-b-payment-limit-files-final-file.zip`, publicationLabel: "Final file - revised 09/15/2026", publicationDate: "2026-09-15" },
  { sourceKey: "cms_payment_limits", period: "2026-Q3", url: `${CMS}/files/zip/july-2026-medicare-part-b-payment-limit-files.zip`, publicationLabel: "Final file - revised 09/15/2026", publicationDate: "2026-09-15" },
  { sourceKey: "cms_payment_limits", period: "2026-Q4", url: `${CMS}/files/zip/october-2026-medicare-part-b-payment-limit-files-final.zip`, publicationLabel: "09/17/2026 - Final file", publicationDate: "2026-09-17" },

  // NDC-HCPCS crosswalks
  { sourceKey: "cms_ndc_hcpcs", period: "2025-Q1", url: `${CMS}/files/zip/january-2025-asp-ndc-hcpcps-crosswalks-06/11/25-final-file.zip`, publicationLabel: "06/11/25 - Final File", publicationDate: "2025-06-11" },
  { sourceKey: "cms_ndc_hcpcs", period: "2025-Q2", url: `${CMS}/files/zip/april-2025-asp-ndc-hcpcs-crosswalk.zip`, publicationLabel: "06/11/25 – Final File", publicationDate: "2025-06-11" },
  { sourceKey: "cms_ndc_hcpcs", period: "2025-Q3", url: `${CMS}/files/zip/july-2025-asp-ndc-hcpcs-crosswalk-06/30/25-final-file.zip`, publicationLabel: "06/30/25 – Final File", publicationDate: "2025-06-30" },
  { sourceKey: "cms_ndc_hcpcs", period: "2025-Q4", url: `${CMS}/files/zip/october-2025-asp-ndc-hcpcs-crosswalk-final-file.zip`, publicationLabel: "03/10/2026 – Final File", publicationDate: "2026-03-10" },
  { sourceKey: "cms_ndc_hcpcs", period: "2026-Q1", url: `${CMS}/files/zip/january-2026-ndc-hcpcs-crosswalk.zip`, publicationLabel: "Final file - revised 03/30/2026", publicationDate: "2026-03-30" },
  { sourceKey: "cms_ndc_hcpcs", period: "2026-Q2", url: `${CMS}/files/zip/april-2026-ndc-hcpcs-crosswalk-03-30-2026-final-file.zip`, publicationLabel: "Final file - revised 03/30/2026", publicationDate: "2026-03-30" },
  { sourceKey: "cms_ndc_hcpcs", period: "2026-Q3", url: `${CMS}/files/zip/july-2026-ndc-hcpcs-crosswalk.zip`, publicationLabel: "06/17/2026 - Final file", publicationDate: "2026-06-17" },
  { sourceKey: "cms_ndc_hcpcs", period: "2026-Q4", url: `${CMS}/files/zip/october-2026-ndc-hcpcs-crosswalk-final.zip`, publicationLabel: "09/17/2026 - Final file", publicationDate: "2026-09-17" },

  // NCCI MUE tables (CMS posts only the current quarter on the MUE page; older quarters live in the archive)
  { sourceKey: "cms_mue_practitioner", period: "2026-Q4", url: `${CMS}/files/zip/medicare-ncci-2026-q4-practitioner-services-mue-table.zip`, publicationLabel: "Effective October 1, 2026; Posted September 1, 2026", publicationDate: "2026-09-01" },
  { sourceKey: "cms_mue_outpatient", period: "2026-Q4", url: `${CMS}/files/zip/medicare-ncci-2026-q4-facility-outpatient-hospital-services-mue-table.zip`, publicationLabel: "Effective October 1, 2026; Posted September 1, 2026", publicationDate: "2026-09-01" },
  { sourceKey: "cms_mue_dme", period: "2026-Q4", url: `${CMS}/files/zip/medicare-ncci-2026-q4-dme-supplier-services-mue-table.zip`, publicationLabel: "Effective October 1, 2026; Posted September 1, 2026", publicationDate: "2026-09-01" },

  // Medicaid Drug Rebate Program product data (one file per quarter; each file repeats every quarter since 2022)
  { sourceKey: "cms_mdrp_products", period: "2026-Q2", url: "https://download.medicaid.gov/data/drugproducts-q2-2026.csv", publicationLabel: "2Q 2026 product data" },

  // OPPS addenda (one CMS page per quarter; the XLSX inside each zip is parsed). Two quarters are kept for the change report.
  {
    sourceKey: "cms_opps_addendum_a",
    period: "2026-Q3",
    url: `${CMS}/files/zip/july-2026-opps-addendum.zip`,
    publicationLabel: "July 2026 OPPS Addendum A - Updated July 21, 2026",
    publicationDate: "2026-07-21",
  },
  {
    sourceKey: "cms_opps_addendum_b",
    period: "2026-Q3",
    url: `${CMS}/files/zip/july-2026-opps-addendum-b.zip`,
    publicationLabel: "July 2026 OPPS Addendum B - Updated July 21, 2026",
    publicationDate: "2026-07-21",
  },
  {
    sourceKey: "cms_opps_addendum_a",
    period: "2026-Q4",
    url: `${CMS}/files/zip/October-2026-OPPS-Addendum.zip`,
    publicationLabel: "Addendum A - Updated 10/15/2026",
    publicationDate: "2026-10-15",
  },
  {
    sourceKey: "cms_opps_addendum_b",
    period: "2026-Q4",
    url: `${CMS}/files/zip/October-2026-OPPS-Addendum-B.zip`,
    publicationLabel: "Addendum B - Updated 10/15/2026",
    publicationDate: "2026-10-15",
  },

  // Washington HCA fee schedules (period = effective date). Add a row when HCA posts a new effective date.
  // The 2026-07-01 file (SHA-256 4c56a327…) was checked by hand; the URL follows HCA's asset naming.
  {
    sourceKey: "wa_hca_home_infusion",
    period: "2026-07-01",
    url: "https://www.hca.wa.gov/assets/billers-and-providers/home-infusion-parenteral-nutrition-20260701.xlsx",
    publicationLabel: "July 1, 2026",
    publicationDate: "2026-07-01",
  },

  {
    sourceKey: "wa_hca_professional_drugs",
    period: "2026-10-01",
    url: "https://www.hca.wa.gov/assets/billers-and-providers/professional-administered-drugs-20261001.xlsx",
    publicationLabel: "Effective October 1, 2026; Updated October 29, 2026",
    publicationDate: "2026-10-29",
  },

  // FDA (period assigned from the file's Last-Modified date at download time)
  { sourceKey: "fda_ndc", period: null, url: "https://www.accessdata.fda.gov/cder/ndctext.zip" },
  { sourceKey: "fda_ndc_excluded", period: null, url: "https://www.accessdata.fda.gov/cder/ndc_excluded.zip" },
  {
    sourceKey: "fda_purple_book",
    period: "2026-09",
    url: "https://www.accessdata.fda.gov/drugsatfda_docs/PurpleBook/2026/purplebook-search-September-data-download.csv",
    publicationLabel: "September 2026 data download",
  },
];

/** Import order matters only for efficiency; history is rebuilt from snapshots. */
export function manifestFor(key: SourceKey, quarters?: number): ReleaseCandidate[] {
  const entries = MANIFEST.filter((m) => m.sourceKey === key).sort((a, b) => (a.period ?? "").localeCompare(b.period ?? ""));
  return quarters ? entries.slice(-quarters) : entries;
}
