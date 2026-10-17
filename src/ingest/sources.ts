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
  | "cms_mdrp_products";

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

export interface SourceDefinition {
  key: SourceKey;
  organization: "CMS" | "FDA";
  dataset: string;
  shortName: string;
  landingPageUrl: string;
  cadence: "quarterly" | "daily" | "monthly";
  /** Badge used for data from this source. */
  badge: "official-cms" | "official-fda";
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
