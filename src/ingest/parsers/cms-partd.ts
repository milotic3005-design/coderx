/**
 * Reader for CMS's quarterly "Prescription Drug Plan Formulary, Pharmacy Network, and Pricing
 * Information" archive. Keeps Washington's PDP and MA-PD plans: per formulary, each drug's
 * tier and restrictions; per drug, the spread of plans' 30-day unit costs; per plan, its name,
 * deductible, and each tier's 30-day retail cost sharing in the initial coverage phase.
 *
 * The file's NDC is a proxy: one representative NDC per RxNorm concept. UNIT_COST is the
 * plan's average at in-area retail pharmacies, not a home infusion contract rate.
 */
import { sha256 } from "../fetch";
import { entryBytes, entryStream, firstMemberStream, lines, listRemoteZip, type ByteSource, type RemoteEntry } from "../remote-zip";
import { baseName, unzipVerified } from "../zip";

export type PartdPlanType = "PDP" | "MA-PD";

export interface PartdPlan {
  /** CONTRACT_ID|PLAN_ID|SEGMENT_ID */
  key: string;
  name: string;
  formularyId: string;
  type: PartdPlanType;
  /** The plan's yearly deductible in dollars, as the plan information file states it. */
  deductible: number | null;
}

/** One retail cost-sharing amount, as CMS's beneficiary cost file states it. */
export interface PartdRetailCost {
  type: "copay" | "coinsurance";
  /** Dollars for a copay; a fraction (0.25 = 25%) for coinsurance. */
  amount: number;
  /** The file's maximum cost sharing, when it gives one. */
  max: number | null;
}

/** A plan's insulin cost sharing at one pharmacy type, as CMS's insulin cost file states it (either may be blank). */
export interface PartdInsulinAmount {
  copay: number | null;
  /** A fraction: 0.25 = 25%. */
  coinsurance: number | null;
}

/** A plan's insulin cost sharing for one tier (null for defined standard plans), 30-day supply. */
export interface PartdInsulinCost {
  planKey: string;
  tier: number | null;
  preferred: PartdInsulinAmount | null;
  standard: PartdInsulinAmount | null;
}

/** A plan's cost sharing for one tier: 30-day supply, initial coverage phase, preferred and standard retail. */
export interface PartdTierCost {
  planKey: string;
  tier: number;
  deductibleApplies: boolean;
  specialty: boolean;
  preferred: PartdRetailCost | null;
  standard: PartdRetailCost | null;
}

export interface PartdFormulary {
  formularyId: string;
  pdpPlans: number;
  mapdPlans: number;
}

export interface PartdFormularyDrug {
  formularyId: string;
  rxcui: string;
  proxyNdc: string;
  tier: number | null;
  priorAuth: boolean;
  stepTherapy: boolean;
  quantityLimit: boolean;
  selectedDrug: boolean;
}

export interface PartdCost {
  proxyNdc: string;
  rxcui: string | null;
  planCount: number;
  unitCostMin: number;
  unitCostMedian: number;
  unitCostMax: number;
}

export interface PartdWaParse {
  plans: PartdPlan[];
  formularies: PartdFormulary[];
  drugs: PartdFormularyDrug[];
  costs: PartdCost[];
  tierCosts: PartdTierCost[];
  insulinCosts: PartdInsulinCost[];
  /** False when the archive has no beneficiary cost file. */
  tierCostsFound: boolean;
  /** Why plan copays or insulin amounts could not be read (missing or changed files). Never fails the release. */
  costFileWarnings: string[];
  checksum: string;
  byteSize: number;
}

const WASHINGTON = "Washington";

/** Pipe-delimited text with a header row, as header-keyed records. */
function records(text: string, required: string[]): Record<string, string>[] {
  const [header, ...body] = text.split(/\r?\n/);
  const names = header.split("|");
  const missing = required.filter((c) => !names.includes(c));
  if (missing.length) throw new Error(`Part D file is missing ${missing.join(", ")}; the layout may have changed.`);
  return body.filter(Boolean).map((line) => {
    const fields = line.split("|");
    return Object.fromEntries(names.map((n, i) => [n, (fields[i] ?? "").trim()]));
  });
}

export function washingtonPlans(geoText: string, planText: string): PartdPlan[] {
  const counties = records(geoText, ["COUNTY_CODE", "STATENAME", "MA_REGION_CODE", "PDP_REGION_CODE"]).filter((g) => g.STATENAME === WASHINGTON);
  const countyCodes = new Set(counties.map((g) => g.COUNTY_CODE));
  const pdpRegions = new Set(counties.map((g) => g.PDP_REGION_CODE));
  const maRegions = new Set(counties.map((g) => g.MA_REGION_CODE));

  const plans = new Map<string, PartdPlan>();
  for (const p of records(planText, ["CONTRACT_ID", "PLAN_ID", "SEGMENT_ID", "PLAN_NAME", "FORMULARY_ID", "DEDUCTIBLE", "MA_REGION_CODE", "PDP_REGION_CODE", "COUNTY_CODE"])) {
    const kind = p.CONTRACT_ID[0];
    const inWashington = kind === "S" ? pdpRegions.has(p.PDP_REGION_CODE) : kind === "R" ? maRegions.has(p.MA_REGION_CODE) : countyCodes.has(p.COUNTY_CODE);
    if (!inWashington) continue;
    const key = `${p.CONTRACT_ID}|${p.PLAN_ID}|${p.SEGMENT_ID}`;
    const deductible = p.DEDUCTIBLE === "" ? NaN : Number(p.DEDUCTIBLE);
    plans.set(key, { key, name: p.PLAN_NAME, formularyId: p.FORMULARY_ID, type: kind === "S" ? "PDP" : "MA-PD", deductible: Number.isFinite(deductible) ? deductible : null });
  }
  return [...plans.values()];
}

export function formularyCounts(plans: PartdPlan[]): PartdFormulary[] {
  const counts = new Map<string, PartdFormulary>();
  for (const p of plans) {
    const row = counts.get(p.formularyId) ?? { formularyId: p.formularyId, pdpPlans: 0, mapdPlans: 0 };
    if (p.type === "PDP") row.pdpPlans++;
    else row.mapdPlans++;
    counts.set(p.formularyId, row);
  }
  return [...counts.values()];
}

export function parseFormularyRows(text: string, formularyIds: Set<string>): PartdFormularyDrug[] {
  const rows = records(text, ["FORMULARY_ID", "RXCUI", "NDC", "TIER_LEVEL_VALUE", "QUANTITY_LIMIT_YN", "PRIOR_AUTHORIZATION_YN", "STEP_THERAPY_YN", "SELECTED_DRUG_YN"]);
  return rows
    .filter((r) => formularyIds.has(r.FORMULARY_ID))
    .map((r) => ({
      formularyId: r.FORMULARY_ID,
      rxcui: r.RXCUI,
      proxyNdc: r.NDC,
      tier: r.TIER_LEVEL_VALUE ? Number(r.TIER_LEVEL_VALUE) : null,
      priorAuth: r.PRIOR_AUTHORIZATION_YN === "Y",
      stepTherapy: r.STEP_THERAPY_YN === "Y",
      quantityLimit: r.QUANTITY_LIMIT_YN === "Y",
      selectedDrug: r.SELECTED_DRUG_YN === "Y",
    }));
}

/**
 * Beneficiary cost file, per CMS's record layout: COVERAGE_LEVEL 1 = initial coverage, DAYS_SUPPLY 1 = 30 days,
 * COST_TYPE 0 = not offered, 1 = copay (dollars), 2 = coinsurance (0.25 = 25%).
 */
export function parseTierCosts(text: string, planKeys: Set<string>): PartdTierCost[] {
  const rows = records(text, ["CONTRACT_ID", "PLAN_ID", "SEGMENT_ID", "COVERAGE_LEVEL", "TIER", "DAYS_SUPPLY", "COST_TYPE_PREF", "COST_AMT_PREF", "COST_MAX_AMT_PREF", "COST_TYPE_NONPREF", "COST_AMT_NONPREF", "COST_MAX_AMT_NONPREF", "TIER_SPECIALTY_YN", "DED_APPLIES_YN"]);
  const cost = (type: string, amount: string, max: string): PartdRetailCost | null => {
    if ((type !== "1" && type !== "2") || amount.trim() === "") return null;
    const value = Number(amount);
    if (!Number.isFinite(value)) return null;
    const cap = Number(max);
    return { type: type === "1" ? "copay" : "coinsurance", amount: value, max: Number.isFinite(cap) && cap > 0 ? cap : null };
  };
  const out: PartdTierCost[] = [];
  for (const r of rows) {
    const planKey = `${r.CONTRACT_ID}|${r.PLAN_ID}|${r.SEGMENT_ID}`;
    if (!planKeys.has(planKey) || r.COVERAGE_LEVEL !== "1" || r.DAYS_SUPPLY !== "1" || r.TIER.trim() === "") continue;
    const tier = Number(r.TIER);
    if (!Number.isInteger(tier)) continue;
    out.push({
      planKey,
      tier,
      deductibleApplies: r.DED_APPLIES_YN === "Y",
      specialty: r.TIER_SPECIALTY_YN === "Y",
      preferred: cost(r.COST_TYPE_PREF, r.COST_AMT_PREF, r.COST_MAX_AMT_PREF),
      standard: cost(r.COST_TYPE_NONPREF, r.COST_AMT_NONPREF, r.COST_MAX_AMT_NONPREF),
    });
  }
  return out;
}

/**
 * Insulin beneficiary cost file, per CMS's 2026 record layout: DAYS_SUPPLY 1 = 30 days; COPAY_AMT_* in dollars,
 * COIN_AMT_* as a fraction; TIER blank for defined standard plans. Column names are matched without regard to case
 * (the 2026 file writes them in lower case).
 */
export function parseInsulinCosts(text: string, planKeys: Set<string>): PartdInsulinCost[] {
  const [header, ...body] = text.split(/\r?\n/);
  const names = header.split("|").map((n) => n.trim().toUpperCase());
  const required = ["CONTRACT_ID", "PLAN_ID", "SEGMENT_ID", "TIER", "DAYS_SUPPLY", "COPAY_AMT_PREF_INSLN", "COPAY_AMT_NONPREF_INSLN", "COIN_AMT_PREF_INSLN", "COIN_AMT_NONPREF_INSLN"];
  const missing = required.filter((c) => !names.includes(c));
  if (missing.length) throw new Error(`Part D insulin cost file is missing ${missing.join(", ")}; the layout may have changed.`);
  const num = (v: string | undefined) => {
    const s = (v ?? "").trim();
    const n = s === "" ? NaN : Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const amount = (copay: string | undefined, coinsurance: string | undefined): PartdInsulinAmount | null => {
    const a = { copay: num(copay), coinsurance: num(coinsurance) };
    return a.copay == null && a.coinsurance == null ? null : a;
  };
  const out: PartdInsulinCost[] = [];
  for (const line of body) {
    if (!line) continue;
    const f = line.split("|");
    const r = Object.fromEntries(names.map((n, i) => [n, (f[i] ?? "").trim()]));
    const planKey = `${r.CONTRACT_ID}|${r.PLAN_ID}|${r.SEGMENT_ID}`;
    if (!planKeys.has(planKey) || r.DAYS_SUPPLY !== "1") continue;
    out.push({
      planKey,
      tier: r.TIER === "" ? null : Number.isInteger(Number(r.TIER)) ? Number(r.TIER) : null,
      preferred: amount(r.COPAY_AMT_PREF_INSLN, r.COIN_AMT_PREF_INSLN),
      standard: amount(r.COPAY_AMT_NONPREF_INSLN, r.COIN_AMT_NONPREF_INSLN),
    });
  }
  return out;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The spread of plans' 30-day unit costs per NDC. The 54 million lines are skipped by contract before they are split. */
export async function summarizeCosts(rows: AsyncIterable<string>, plans: PartdPlan[], rxcuiByNdc: Map<string, string>): Promise<PartdCost[]> {
  const keys = new Set(plans.map((p) => p.key));
  const contracts = new Set(plans.map((p) => p.key.split("|")[0]));
  const costs = new Map<string, number[]>();
  let col: Record<string, number> | null = null;
  for await (const line of rows) {
    if (!col) {
      const names = line.split("|");
      col = Object.fromEntries(names.map((n, i) => [n, i]));
      if (col.CONTRACT_ID !== 0 || ["NDC", "DAYS_SUPPLY", "UNIT_COST"].some((c) => !(c in col!))) throw new Error("Part D pricing file layout changed.");
      continue;
    }
    if (!contracts.has(line.slice(0, 5))) continue;
    const f = line.split("|");
    if (f[col.DAYS_SUPPLY] !== "30" || !keys.has(`${f[col.CONTRACT_ID]}|${f[col.PLAN_ID]}|${f[col.SEGMENT_ID]}`)) continue;
    if (!f[col.UNIT_COST]?.trim()) continue;
    const cost = Number(f[col.UNIT_COST]);
    if (!Number.isFinite(cost)) continue;
    const ndc = f[col.NDC];
    const list = costs.get(ndc);
    if (list) list.push(cost);
    else costs.set(ndc, [cost]);
  }
  return [...costs].map(([proxyNdc, values]) => {
    values.sort((a, b) => a - b);
    return { proxyNdc, rxcui: rxcuiByNdc.get(proxyNdc) ?? null, planCount: values.length, unitCostMin: values[0], unitCostMedian: round4(median(values)), unitCostMax: values[values.length - 1] };
  });
}

/** Reasons a parsed file looks wrong, such as a layout change that lost a table. */
export function partdProblems(p: Pick<PartdWaParse, "plans" | "drugs" | "costs">): string[] {
  const rxcuis = new Set(p.drugs.map((d) => d.rxcui)).size;

  return [
    ...(p.plans.length >= 50 ? [] : [`Part D file has only ${p.plans.length} Washington plans; expected at least 50.`]),
    ...(rxcuis >= 1000 ? [] : [`Part D file has only ${rxcuis} RxCUIs for Washington plans; expected at least 1,000.`]),
    ...(p.costs.length >= 1000 ? [] : [`Part D file has only ${p.costs.length} unit cost rows for Washington plans; expected at least 1,000.`]),
  ];
}

/**
 * Problems with the tier cost sharing that the copay comparison uses. They are warnings, not failures:
 * a renamed or thin beneficiary cost file must not hold back the formulary rows other pages read.
 */
export function tierCostWarnings(p: Pick<PartdWaParse, "plans" | "tierCosts" | "tierCostsFound" | "costFileWarnings">): string[] {
  if (!p.tierCostsFound) return p.costFileWarnings;
  const costed = new Set(p.tierCosts.map((c) => c.planKey)).size;
  return [...p.costFileWarnings, ...(costed >= Math.min(50, p.plans.length) ? [] : [`Tier cost sharing found for only ${costed} of ${p.plans.length} Washington plans.`])];
}

/** Reads only the five files CodeRx needs. The checksum covers their names, CRCs, and sizes, so a re-post of the same data is skipped. */
export async function readPartdWa(src: ByteSource): Promise<PartdWaParse> {
  const entries = await listRemoteZip(src);
  const find = (pattern: RegExp): RemoteEntry => {
    const entry = entries.find((e) => pattern.test(baseName(e.name)));
    if (!entry) throw new Error(`Part D archive: ${pattern.source} not found.`);
    return entry;
  };
  const small = async (entry: RemoteEntry) => {
    const [member] = unzipVerified(await entryBytes(src, entry));
    if (!member) throw new Error(`Part D archive: ${entry.name} is empty.`);
    return new TextDecoder("latin1").decode(member.data);
  };
  const geo = find(/^geographic locator file/i);
  const plan = find(/^plan information/i);
  const formulary = find(/^basic drugs formulary file/i);
  const pricing = find(/^pricing file/i);
  // Optional files for the copay comparison: a missing or changed one becomes a warning (see tierCostWarnings),
  // never a failed release, so the formulary rows other pages read keep updating.
  // Not "insulin beneficiary cost file", which the ^ anchor leaves out.
  const beneficiaryCost = entries.find((e) => /^beneficiary cost file/i.test(baseName(e.name))) ?? null;
  const insulinCost = entries.find((e) => /^insulin beneficiary cost file/i.test(baseName(e.name))) ?? null;
  const costFileWarnings: string[] = [];
  const optional = async <T>(entry: RemoteEntry | null, label: string, parse: (text: string) => T[]): Promise<T[]> => {
    if (!entry) {
      costFileWarnings.push(`The ${label} was not found in the archive; it was not loaded.`);
      return [];
    }
    try {
      return parse(await small(entry));
    } catch (error) {
      costFileWarnings.push(`The ${label} could not be read: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  };

  const plans = washingtonPlans(await small(geo), await small(plan));
  const drugs = parseFormularyRows(await small(formulary), new Set(plans.map((p) => p.formularyId)));
  const rxcuiByNdc = new Map(drugs.map((d) => [d.proxyNdc, d.rxcui]));
  const costs = await summarizeCosts(lines(firstMemberStream(entryStream(src, pricing))), plans, rxcuiByNdc);
  const planKeys = new Set(plans.map((p) => p.key));
  const tierCosts = await optional(beneficiaryCost, "beneficiary cost file (plan copays)", (text) => parseTierCosts(text, planKeys));
  const insulinCosts = await optional(insulinCost, "insulin beneficiary cost file (Part D insulin amounts)", (text) => parseInsulinCosts(text, planKeys));
  const used = [geo, plan, formulary, pricing, ...[beneficiaryCost, insulinCost].filter((e): e is RemoteEntry => !!e)];
  return {
    plans,
    formularies: formularyCounts(plans),
    drugs,
    costs,
    tierCosts,
    insulinCosts,
    tierCostsFound: !!beneficiaryCost && !costFileWarnings.some((w) => w.includes("beneficiary cost file (plan copays)")),
    costFileWarnings,
    checksum: sha256(new TextEncoder().encode(JSON.stringify(used.map((e) => [e.name, e.crc, e.size])))),
    byteSize: used.reduce((total, e) => total + e.compressedSize, 0),
  };
}
