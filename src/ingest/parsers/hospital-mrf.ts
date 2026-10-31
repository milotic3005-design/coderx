/**
 * Streaming parser for hospital price transparency files (45 CFR 180.50) in CMS's CSV
 * "tall" template (v2.x/v3.x): a metadata header and value row, then one row per item,
 * payer, and plan with negotiated dollar, percentage, or algorithm.
 *
 * Only drug rows are kept: a HCPCS Level II drug code (J, Q, C9, A9 families) in one of the
 * code columns. CPT rows and every other code type are dropped, so no CPT content is read
 * past the code check. Rows that repeat a contract for each NDC or chargemaster line are
 * collapsed into one contract row.
 */
import type { PlanType } from "@/lib/hospital-rates";
import { csvFields, csvRecords } from "./cms-mdrp";

export interface HospitalMeta {
  hospitalName: string | null;
  lastUpdatedOn: string | null;
  version: string | null;
  locationNames: string[];
  addresses: string[];
  license: string | null;
  npis: string[];
}

/** One payer-plan contract rate for a drug code (payer names stay in the operator's local report). */
export interface HospitalDrugContract {
  code: string;
  setting: string;
  billingClass: string;
  payer: string;
  plan: string;
  methodology: string;
  dollar: number | null;
  percentage: number | null;
  algorithm: string | null;
  /** Drug quantity the charge applies to, e.g. 10 with unit "ME" (milligrams). */
  drugQuantity: number | null;
  drugUnit: string | null;
  modifiers: string;
  ndcs: string[];
  descriptions: string[];
  grossMin: number | null;
  grossMax: number | null;
  cashMin: number | null;
  cashMax: number | null;
  rows: number;
}

export interface HospitalMrfParse {
  meta: HospitalMeta;
  contracts: HospitalDrugContract[];
  /** Data rows read, drug rows kept. */
  rowsRead: number;
  drugRows: number;
}

/** HCPCS Level II drug families: J (drugs), Q (incl. biosimilars), C9 (OPPS drugs), A9 (radiopharmaceuticals). */
export const DRUG_HCPCS_RE = /^(J\d{4}|Q\d{4}|C9\d{3}|A9\d{3})$/;

const num = (v: string | undefined) => {
  const s = (v ?? "").replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const medianOf = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const minOf = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.min(a, b));
const maxOf = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b));

export async function parseHospitalMrfStream(chunks: AsyncIterable<Uint8Array>): Promise<HospitalMrfParse> {
  let metaKeys: string[] | null = null;
  let meta: HospitalMeta | null = null;
  let header: string[] | null = null;
  const col: Record<string, number> = {};
  const codeCols: { code: number; type: number }[] = [];
  const contracts = new Map<string, HospitalDrugContract>();
  let rowsRead = 0;
  let drugRows = 0;

  for await (const rec of csvRecords(chunks)) {
    if (!rec.trim()) continue;
    const f = csvFields(rec);
    if (!metaKeys) {
      metaKeys = f.map((k) => k.trim().toLowerCase());
      continue;
    }
    if (!meta) {
      const get = (prefix: string) => {
        const i = metaKeys!.findIndex((k) => k === prefix || k.startsWith(`${prefix}|`));
        return i >= 0 ? (f[i] ?? "").trim() || null : null;
      };
      const split = (v: string | null) => (v ? v.split("|").map((s) => s.trim()).filter(Boolean) : []);
      meta = {
        hospitalName: get("hospital_name"),
        lastUpdatedOn: get("last_updated_on"),
        version: get("version"),
        locationNames: split(get("location_name")),
        addresses: split(get("hospital_address")),
        license: get("license_number"),
        npis: split(get("type_2_npi")),
      };
      continue;
    }
    if (!header) {
      header = f.map((h) => h.trim().toLowerCase());
      header.forEach((h, i) => (col[h] = i));
      for (let k = 1; k <= 9; k++) if (col[`code|${k}`] != null && col[`code|${k}|type`] != null) codeCols.push({ code: col[`code|${k}`], type: col[`code|${k}|type`] });
      for (const need of ["payer_name", "plan_name", "standard_charge|negotiated_dollar", "setting"]) {
        if (col[need] == null) throw new Error(`Hospital price file: column '${need}' not found (only the CMS CSV "tall" template is supported).`);
      }
      continue;
    }
    rowsRead++;
    let code: string | null = null;
    const ndcs: string[] = [];
    for (const c of codeCols) {
      const type = (f[c.type] ?? "").trim().toUpperCase();
      const value = (f[c.code] ?? "").trim().toUpperCase();
      if (type === "HCPCS" && DRUG_HCPCS_RE.test(value)) code = value;
      else if (type === "NDC" && value) ndcs.push(value.replace(/\D/g, ""));
    }
    if (!code) continue;
    drugRows++;
    const v = (name: string) => (col[name] != null ? (f[col[name]] ?? "").trim() : "");
    const payer = v("payer_name");
    const plan = v("plan_name");
    const dollar = num(v("standard_charge|negotiated_dollar"));
    const percentage = num(v("standard_charge|negotiated_percentage"));
    const algorithm = v("standard_charge|negotiated_algorithm") || null;
    const drugQuantity = num(v("drug_unit_of_measurement"));
    const drugUnit = v("drug_type_of_measurement").toUpperCase() || null;
    const base = {
      code,
      setting: v("setting").toLowerCase(),
      billingClass: v("billing_class").toLowerCase(),
      payer,
      plan,
      methodology: v("standard_charge|methodology").toLowerCase(),
      dollar,
      percentage,
      algorithm,
      drugQuantity,
      drugUnit,
      modifiers: v("modifiers"),
    };
    const key = JSON.stringify(base);
    const gross = num(v("standard_charge|gross"));
    const cash = num(v("standard_charge|discounted_cash"));
    const description = v("description");
    const existing = contracts.get(key);
    if (existing) {
      existing.rows++;
      for (const n of ndcs) if (!existing.ndcs.includes(n)) existing.ndcs.push(n);
      if (description && existing.descriptions.length < 5 && !existing.descriptions.includes(description)) existing.descriptions.push(description);
      existing.grossMin = minOf(existing.grossMin, gross);
      existing.grossMax = maxOf(existing.grossMax, gross);
      existing.cashMin = minOf(existing.cashMin, cash);
      existing.cashMax = maxOf(existing.cashMax, cash);
    } else {
      contracts.set(key, { ...base, ndcs: [...new Set(ndcs)], descriptions: description ? [description] : [], grossMin: gross, grossMax: gross, cashMin: cash, cashMax: cash, rows: 1 });
    }
  }
  if (!meta || !header) throw new Error("Hospital price file: metadata or column header row missing.");
  return { meta, contracts: [...contracts.values()], rowsRead, drugRows };
}


/**
 * Plan category from the payer and plan names as the hospital wrote them (derived; the
 * names themselves are not uploaded). Washington Apple Health plans are Medicaid managed
 * care; "MedAdvantage"/"Medicare Advantage" plans are Medicare Advantage; everything else
 * (including Cascade Care exchange plans) is commercial.
 */
export function planTypeOf(payer: string, plan: string): PlanType {
  const s = `${payer} ${plan}`;
  if (/apple health|medicaid/i.test(s)) return "medicaid_managed_care";
  if (/med\s*advantage|medicare/i.test(s)) return "medicare_advantage";
  return "commercial";
}

/** Anonymized group for upload: no payer or plan names, one amount per payer-plan contract. */
export interface HospitalRateGroup {
  code: string;
  planType: PlanType;
  setting: string;
  billingClass: string;
  methodology: string;
  drugQuantity: number | null;
  drugUnit: string | null;
  /** Negotiated dollar amounts, one per payer-plan (sorted). */
  amounts: number[];
  /** Payer-plan contracts priced only as a percentage or an algorithm (no dollar amount). */
  percentContracts: number;
  algorithmContracts: number;
  grossMin: number | null;
  grossMax: number | null;
  cashMin: number | null;
  cashMax: number | null;
}

/**
 * One amount per payer-plan contract in each group. A contract priced as a percent of
 * charges yields a different dollar amount for every chargemaster line (each line has its
 * own gross charge), so a contract with several amounts is represented by their median.
 */
export function anonymize(contracts: HospitalDrugContract[]): HospitalRateGroup[] {
  const groups = new Map<string, HospitalRateGroup & { byContract: Map<string, number[]>; pct: Set<string>; alg: Set<string> }>();
  for (const c of contracts) {
    const planType = planTypeOf(c.payer, c.plan);
    const key = JSON.stringify([c.code, planType, c.setting, c.billingClass, c.methodology, c.drugQuantity, c.drugUnit]);
    let g = groups.get(key);
    if (!g) {
      g = { code: c.code, planType, setting: c.setting, billingClass: c.billingClass, methodology: c.methodology, drugQuantity: c.drugQuantity, drugUnit: c.drugUnit, amounts: [], percentContracts: 0, algorithmContracts: 0, grossMin: null, grossMax: null, cashMin: null, cashMax: null, byContract: new Map(), pct: new Set(), alg: new Set() };
      groups.set(key, g);
    }
    const contract = `${c.payer}\u0000${c.plan}`;
    if (c.dollar != null) g.byContract.set(contract, [...(g.byContract.get(contract) ?? []), c.dollar]);
    else if (c.percentage != null) g.pct.add(contract);
    else if (c.algorithm) g.alg.add(contract);
    g.grossMin = minOf(g.grossMin, c.grossMin);
    g.grossMax = maxOf(g.grossMax, c.grossMax);
    g.cashMin = minOf(g.cashMin, c.cashMin);
    g.cashMax = maxOf(g.cashMax, c.cashMax);
  }
  return [...groups.values()].map((g) => ({
    code: g.code,
    planType: g.planType,
    setting: g.setting,
    billingClass: g.billingClass,
    methodology: g.methodology,
    drugQuantity: g.drugQuantity,
    drugUnit: g.drugUnit,
    amounts: [...g.byContract.values()].map((v) => Math.round(medianOf(v) * 100) / 100).sort((a, b) => a - b),
    percentContracts: g.pct.size,
    algorithmContracts: g.alg.size,
    grossMin: g.grossMin,
    grossMax: g.grossMax,
    cashMin: g.cashMin,
    cashMax: g.cashMax,
  }));
}
