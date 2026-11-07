/**
 * Reader for CMS's quarterly "Prescription Drug Plan Formulary, Pharmacy Network, and Pricing
 * Information" archive. Keeps Washington's PDP and MA-PD plans: per formulary, each drug's
 * tier and restrictions; per drug, the spread of plans' 30-day unit costs. Plan names are
 * not stored.
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
  formularyId: string;
  type: PartdPlanType;
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
  for (const p of records(planText, ["CONTRACT_ID", "PLAN_ID", "SEGMENT_ID", "FORMULARY_ID", "MA_REGION_CODE", "PDP_REGION_CODE", "COUNTY_CODE"])) {
    const kind = p.CONTRACT_ID[0];
    const inWashington = kind === "S" ? pdpRegions.has(p.PDP_REGION_CODE) : kind === "R" ? maRegions.has(p.MA_REGION_CODE) : countyCodes.has(p.COUNTY_CODE);
    if (!inWashington) continue;
    const key = `${p.CONTRACT_ID}|${p.PLAN_ID}|${p.SEGMENT_ID}`;
    plans.set(key, { key, formularyId: p.FORMULARY_ID, type: kind === "S" ? "PDP" : "MA-PD" });
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

/** Reads only the four files CodeRx needs. The checksum covers their names, CRCs, and sizes, so a re-post of the same data is skipped. */
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

  const plans = washingtonPlans(await small(geo), await small(plan));
  const drugs = parseFormularyRows(await small(formulary), new Set(plans.map((p) => p.formularyId)));
  const rxcuiByNdc = new Map(drugs.map((d) => [d.proxyNdc, d.rxcui]));
  const costs = await summarizeCosts(lines(firstMemberStream(entryStream(src, pricing))), plans, rxcuiByNdc);
  const used = [geo, plan, formulary, pricing];
  return {
    plans,
    formularies: formularyCounts(plans),
    drugs,
    costs,
    checksum: sha256(new TextEncoder().encode(JSON.stringify(used.map((e) => [e.name, e.crc, e.size])))),
    byteSize: used.reduce((total, e) => total + e.compressedSize, 0),
  };
}
