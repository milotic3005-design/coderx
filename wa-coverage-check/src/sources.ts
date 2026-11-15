/** Where cached files live, and the shapes of the small indexes the refresh script writes. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CACHE_DIR = join(import.meta.dirname, "..", "cache");
export const cachePath = (name: string) => join(CACHE_DIR, name);
export const readJson = <T>(name: string): T => JSON.parse(readFileSync(cachePath(name), "utf8")) as T;

export const APPLE_HEALTH_URL = "https://www.hca.wa.gov/assets/billers-and-providers/apple-health-preferred-drug-list.xlsx";
/**
 * Washington exchange insurers that publish CMS-layout formulary JSON with WA plans in it.
 * WA runs its own exchange, so insurers are not required to; these two do (checked 2026-11-13).
 * UnitedHealthcare's index refuses automated requests (HTTP 403); Molina, Kaiser and Elevance list no WA plans.
 */
export const EXCHANGE_INSURERS = [
  { key: "ambetter", label: "Ambetter", indexUrl: "https://api.centene.com/ambetter/reference/cms-data-index.json", formularyFilter: (u: string) => u.endsWith("-WA.json") },
  { key: "cambia", label: "Regence/BridgeSpan", indexUrl: "https://cms-machine-readable.cambiahealth.com/index.json", formularyFilter: (_u: string) => true },
] as const;
export type ExchangeKey = (typeof EXCHANGE_INSURERS)[number]["key"];
export const UMP_PDL_URL = "https://www.hca.wa.gov/assets/pebb/ump-preferred-drug-list.pdf";
export const CMS_CATALOG_URL = "https://data.cms.gov/data.json";
export const MEDICAID_API = "https://data.medicaid.gov/api/1";

/** One entry per source: where it came from and how current it is. */
export interface SourceInfo {
  url: string;
  fetchedAt: string;
  /** The date the publisher gives for the data, in the publisher's own words when possible. */
  asOf: string;
}
export type Manifest = Record<"appleHealth" | "partD" | ExchangeKey | "ump" | "nadac", SourceInfo>;

/** Apple Health PDL, one row per NDC. Codes are the PDL's own (see its KEY sheet). */
export interface AppleHealthRow {
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

export interface PartDIndex {
  plans: { key: string; name: string; formularyId: string; type: "PDP" | "MA-PD" }[];
  /** rxcui -> formulary id -> restrictions */
  drugs: Record<string, Record<string, { tier: number; pa: boolean; st: boolean; ql: boolean }>>;
  /** plan key -> tier -> plain-English cost sharing (initial coverage, 30-day, retail) */
  costs: Record<string, Record<string, string>>;
}

/** NADAC, one week, keyed by 11-digit NDC. A pharmacy's average purchase price, not a patient's cost. */
export type NadacIndex = Record<string, { description: string; perUnit: number; unit: string; effectiveDate: string; classification: string }>;

/** One cost_sharing entry of a plan's tier, with CMS's field values as the insurer's file states them. */
export interface ExchangeCostDetail {
  pharmacyType: string;
  copayAmount: number | null;
  copayOpt: string | null;
  coinsuranceRate: number | null;
  coinsuranceOpt: string | null;
}

/** One exchange insurer's WA plans and drug listings, from its CMS-layout JSON. */
export interface ExchangeIndex {
  /** costs: each tier's rule in words; costDetails: the same entries as published (older caches lack them). */
  plans: Record<string, { name: string; costs: Record<string, string>; costDetails?: Record<string, ExchangeCostDetail[]> }>;
  /** rxcui -> one entry per plan */
  drugs: Record<string, { planId: string; tier: string; pa: boolean; st: boolean; ql: boolean }[]>;
}
