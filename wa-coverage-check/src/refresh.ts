/**
 * Downloads every source, records its date, and writes small JSON indexes to cache/.
 * Run with `npm run refresh`. Nothing about any patient is sent or stored; the only
 * requests are for public files.
 */
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { unzipSync } from "fflate";
import { listRemoteZip, readRemoteEntry } from "./remote-zip.ts";
import { checkUmpIndex, parseCostNotes, parseCostTable, parseIndexPage, type PdfText, type UmpIndex } from "./ump.ts";
import { EXCHANGE_INSURERS, APPLE_HEALTH_URL, CACHE_DIR, CMS_CATALOG_URL, MEDICAID_API, UMP_PDL_URL, cachePath, type NadacIndex, type ExchangeIndex, type ExchangeKey, type SourceInfo, type AppleHealthRow, type Manifest, type PartDIndex } from "./sources.ts";

const UA = "wa-coverage-check/0.1 (public-data research tool)";
const now = () => new Date().toISOString();

// Every file is written under a temporary name and swapped in only after all sources succeed,
// so the cache never holds new data under an old date in manifest.json.
const staged: string[] = [];
function stage(name: string, data: string | Uint8Array) {
  writeFileSync(cachePath(`${name}.new`), data);
  staged.push(name);
}

async function download(url: string): Promise<{ bytes: Uint8Array; lastModified: string | null }> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Download failed for ${url}: HTTP ${res.status}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), lastModified: res.headers.get("last-modified") };
}

const text = (v: ExcelJS.CellValue) => (v == null ? "" : typeof v === "object" && "richText" in v ? v.richText.map((r) => r.text).join("") : String(v)).trim();

async function appleHealth() {
  const { bytes } = await download(APPLE_HEALTH_URL);
  stage("apple-health-pdl.xlsx", bytes);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes.buffer as ArrayBuffer);
  const sheet = wb.getWorksheet("PDL");
  if (!sheet) throw new Error("Apple Health PDL: sheet 'PDL' not found.");
  let asOf = "";
  let header: string[] = [];
  const rows: Record<string, AppleHealthRow> = {};
  sheet.eachRow((row) => {
    const cells = (row.values as ExcelJS.CellValue[]).slice(1).map(text);
    if (!header.length) {
      if ((cells[0] ?? "").startsWith("Effective")) asOf = cells[0];
      if (cells[0] === "PRODUCT IDENTIFIER") header = cells;
      return;
    }
    const get = (name: string) => cells[header.indexOf(name)] ?? "";
    if (get("IDENTIFIER TYPE") !== "NDC") return;
    rows[get("PRODUCT IDENTIFIER")] = {
      label: get("LABEL NAME"),
      coverage: get("COVERAGE TYPE"),
      nonCoveredReason: get("NON-COVERED REASON"),
      pharmacyPreferred: get("PHARMACY PREFERRED STATUS"),
      pharmacyPa: get("PHARMACY PA STATUS"),
      medicalPreferred: get("MEDICAL PREFERRED STATUS"),
      medicalPa: get("MEDICAL PA STATUS"),
      paPolicy: get("PA POLICY NUMBER"),
    };
  });
  if (!header.length || Object.keys(rows).length < 1000) throw new Error("Apple Health PDL: layout changed or file is incomplete.");
  stage("apple-health.json", JSON.stringify(rows));
  console.log(`Apple Health PDL: ${Object.keys(rows).length} NDCs, ${asOf}`);
  return { url: APPLE_HEALTH_URL, fetchedAt: now(), asOf };
}

/** Pipe-delimited CMS text as header-keyed records. */
function records(bytes: Uint8Array): Record<string, string>[] {
  const [head, ...lines] = new TextDecoder("latin1").decode(bytes).split(/\r?\n/);
  const names = head.split("|");
  return lines.filter(Boolean).map((l) => Object.fromEntries(l.split("|").map((v, i) => [names[i], v.trim()])));
}

/** "$47.00 copay" or "25% coinsurance", per CMS's 2026 record layout (cost type 1 = copay, 2 = coinsurance). */
function partDCost(type: string, amount: string): string | null {
  if (type === "1") return `$${Number(amount).toFixed(2)} copay`;
  if (type === "2") return `${Math.round(Number(amount) * 100)}% coinsurance`;
  return null;
}

async function partD() {
  const catalogRes = await fetch(CMS_CATALOG_URL, { headers: { "User-Agent": UA } });
  if (!catalogRes.ok) throw new Error(`CMS catalog: HTTP ${catalogRes.status}`);
  const catalog = (await catalogRes.json()) as { dataset: { title?: string; distribution?: { format?: string; downloadURL?: string }[] }[] };
  const prefix = "Quarterly Prescription Drug Plan Formulary, Pharmacy Network, and Pricing Information :";
  const newest = catalog.dataset
    .filter((d) => d.title?.startsWith(prefix))
    .map((d) => ({ date: d.title!.slice(prefix.length).trim(), url: d.distribution?.find((x) => x.format === "ZIP")?.downloadURL }))
    .filter((d): d is { date: string; url: string } => !!d.url)
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  if (!newest) throw new Error("Part D: quarterly file not found in the CMS catalog.");

  const { entries } = await listRemoteZip(newest.url);
  const read = async (prefixName: string) => {
    const e = entries.find((x) => x.name.toLowerCase().startsWith(prefixName));
    if (!e) throw new Error(`Part D archive: ${prefixName} not found.`);
    return records(Object.values(unzipSync(await readRemoteEntry(newest.url, e)))[0]);
  };
  const [geo, planInfo, formulary, costs] = [await read("geographic locator"), await read("plan information"), await read("basic drugs formulary"), await read("beneficiary cost")];

  // Washington: PDPs by PDP region, regional PPOs by MA region, other MA-PDs by county. "Washington D.C." is excluded.
  const wa = geo.filter((g) => g.STATENAME === "Washington");
  const counties = new Set(wa.map((g) => g.COUNTY_CODE));
  const pdpRegions = new Set(wa.map((g) => g.PDP_REGION_CODE));
  const maRegions = new Set(wa.map((g) => g.MA_REGION_CODE));
  const plans = new Map<string, PartDIndex["plans"][number]>();
  for (const p of planInfo) {
    const kind = p.CONTRACT_ID[0];
    const inWa = kind === "S" ? pdpRegions.has(p.PDP_REGION_CODE) : kind === "R" ? maRegions.has(p.MA_REGION_CODE) : counties.has(p.COUNTY_CODE);
    if (!inWa) continue;
    const key = `${p.CONTRACT_ID}-${p.PLAN_ID}-${p.SEGMENT_ID}`;
    plans.set(key, { key, name: p.PLAN_NAME, formularyId: p.FORMULARY_ID, type: kind === "S" ? "PDP" : "MA-PD" });
  }
  const formularies = new Set([...plans.values()].map((p) => p.formularyId));
  const drugs: PartDIndex["drugs"] = {};
  for (const r of formulary) {
    if (!formularies.has(r.FORMULARY_ID)) continue;
    (drugs[r.RXCUI] ??= {})[r.FORMULARY_ID] = { tier: Number(r.TIER_LEVEL_VALUE), pa: r.PRIOR_AUTHORIZATION_YN === "Y", st: r.STEP_THERAPY_YN === "Y", ql: r.QUANTITY_LIMIT_YN === "Y" };
  }
  // Initial coverage phase (1), 30-day supply (1), preferred retail; standard retail when preferred is not offered.
  const costTable: PartDIndex["costs"] = {};
  for (const c of costs) {
    const key = `${c.CONTRACT_ID}-${c.PLAN_ID}-${c.SEGMENT_ID}`;
    if (!plans.has(key) || c.COVERAGE_LEVEL !== "1" || c.DAYS_SUPPLY !== "1") continue;
    const pref = partDCost(c.COST_TYPE_PREF, c.COST_AMT_PREF);
    const std = partDCost(c.COST_TYPE_NONPREF, c.COST_AMT_NONPREF);
    const cost = pref ? `${pref} (preferred retail)` : std ? `${std} (standard retail)` : null;
    if (cost) (costTable[key] ??= {})[c.TIER] = `${cost}, 30-day, initial coverage phase${c.DED_APPLIES_YN === "Y" ? ", after deductible" : ""}`;
  }
  if (plans.size < 50 || Object.keys(drugs).length < 1000) throw new Error("Part D: layout changed or file is incomplete.");
  const index: PartDIndex = { plans: [...plans.values()], drugs, costs: costTable };
  stage("partd.json", JSON.stringify(index));
  const asOf = `CMS quarterly file dated ${newest.date}`;
  console.log(`Medicare Part D: ${plans.size} Washington plans, ${Object.keys(drugs).length} RxCUIs, ${asOf}`);
  return { url: newest.url, fetchedAt: now(), asOf };
}

/** CMS's machine-readable exchange layout: costs per tier, as one plain-English line. */
function ambetterCost(c: { pharmacy_type: string; copay_amount: number; copay_opt: string; coinsurance_rate: number; coinsurance_opt: string | null }): string {
  const parts = [c.copay_amount ? `$${c.copay_amount.toFixed(2)} copay` : "", c.coinsurance_rate ? `${Math.round(c.coinsurance_rate * 100)}% coinsurance` : ""].filter(Boolean);
  const when = [c.copay_opt, c.coinsurance_opt].filter((x) => x && x !== "NO-CHARGE").join(", ").toLowerCase();
  return `${parts.join(" + ") || "$0"} (${c.pharmacy_type.toLowerCase()}${when ? `, ${when}` : ""})`;
}

/** One exchange insurer: its WA plans for this calendar year and every drug listing for them. */
async function exchange(insurer: (typeof EXCHANGE_INSURERS)[number]) {
  const name = insurer.label;
  const index = JSON.parse(new TextDecoder().decode((await download(insurer.indexUrl)).bytes)) as { formulary_urls: string[]; plan_urls: string[] };
  const drugUrls = index.formulary_urls.filter(insurer.formularyFilter);
  if (!drugUrls.length) throw new Error(`${name}: no formulary file in the index.`);
  const year = new Date().getFullYear();
  type Plan = { plan_id: string; marketing_name: string; years: number[]; formulary: { drug_tier: string; cost_sharing: Parameters<typeof ambetterCost>[0][] }[] };
  type Drug = { rxnorm_id: string; plans: { plan_id: string; drug_tier: string; prior_authorization: boolean; step_therapy: boolean; quantity_limit: boolean; years: number[] }[] };
  const plans: ExchangeIndex["plans"] = {};
  for (const url of index.plan_urls) {
    for (const p of JSON.parse(new TextDecoder().decode((await download(url)).bytes)) as Plan[]) {
      if (p.plan_id.slice(5, 7) !== "WA" || !p.years.includes(year)) continue;
      plans[p.plan_id] = {
        name: p.marketing_name,
        costs: Object.fromEntries(p.formulary.map((f) => [f.drug_tier, f.cost_sharing.map(ambetterCost).join("; ")])),
        // The same entries as published, for comparing amounts (CMS's QHP formulary schema).
        costDetails: Object.fromEntries(
          p.formulary.map((f) => [
            f.drug_tier,
            f.cost_sharing.map((c) => ({ pharmacyType: c.pharmacy_type, copayAmount: c.copay_amount ?? null, copayOpt: c.copay_opt ?? null, coinsuranceRate: c.coinsurance_rate ?? null, coinsuranceOpt: c.coinsurance_opt ?? null })),
          ]),
        ),
      };
    }
  }
  const drugs: ExchangeIndex["drugs"] = {};
  const modified: string[] = [];
  for (const url of drugUrls) {
    const file = await download(url);
    modified.push(file.lastModified ?? "unknown");
    for (const d of JSON.parse(new TextDecoder().decode(file.bytes)) as Drug[]) {
      const rows = d.plans.filter((p) => plans[p.plan_id] && p.years.includes(year)).map((p) => ({ planId: p.plan_id, tier: p.drug_tier, pa: p.prior_authorization, st: p.step_therapy, ql: p.quantity_limit }));
      if (rows.length) (drugs[d.rxnorm_id] ??= []).push(...rows);
    }
  }
  if (!Object.keys(plans).length || Object.keys(drugs).length < 500) throw new Error(`${name}: layout changed or file is incomplete.`);
  stage(`${insurer.key}.json`, JSON.stringify({ plans, drugs } satisfies ExchangeIndex));
  const asOf = `${name} formulary file${drugUrls.length > 1 ? "s" : ""}, last modified ${[...new Set(modified)].join(" / ")} (plan year ${year})`;
  console.log(`${name} WA: ${Object.keys(plans).length} plans, ${Object.keys(drugs).length} RxCUIs, ${asOf}`);
  return { url: drugUrls.length > 1 ? insurer.indexUrl : drugUrls[0], fetchedAt: now(), asOf };
}

/** UMP: the PDL PDF, read with pdf.js. Only the Alphabetical Index pages and the first page's cost table are used. */
async function ump() {
  const { bytes, lastModified } = await download(UMP_PDL_URL);
  stage("ump-pdl.pdf", bytes);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const index: UmpIndex = { lastUpdated: "", costs: {}, costNotes: [], entries: [] };
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    const items: PdfText[] = content.items.flatMap((i) => ("str" in i ? [{ str: i.str, x: i.transform[4], y: i.transform[5] }] : []));
    if (n === 1) {
      const page1 = items.map((i) => i.str).join("");
      index.costs = parseCostTable(page1);
      // For sentences, a line break counts as a space, so words at line ends are not glued ("plan" + "pays").
      index.costNotes = parseCostNotes(content.items.map((i) => ("str" in i ? i.str + (i.hasEOL ? " " : "") : "")).join(""));
    }
    if (!items.some((i) => i.str.includes("Alphabetical Index"))) continue;
    index.lastUpdated ||= /Last Updated\*?\s*([\d/]+)/.exec(items.map((i) => i.str).join(" "))?.[1] ?? "";
    index.entries.push(...parseIndexPage(items));
  }
  checkUmpIndex(index);
  if (index.entries.length < 1000 || Object.keys(index.costs).length < 4) throw new Error(`UMP: read ${index.entries.length} drugs and ${Object.keys(index.costs).length} cost tiers; the PDF layout may have changed.`);
  stage("ump.json", JSON.stringify(index));
  const asOf = `UMP PDL last updated ${index.lastUpdated || "unknown"} (PDF last modified ${lastModified ?? "unknown"})`;
  console.log(`UMP: ${index.entries.length} drug rows, ${asOf}`);
  return { url: UMP_PDL_URL, fetchedAt: now(), asOf };
}

mkdirSync(CACHE_DIR, { recursive: true });
/** NADAC: the newest yearly dataset on data.medicaid.gov, latest week only, read page by page through its public API. */
async function nadac() {
  const getJson = async <T>(url: string): Promise<T> => {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`NADAC ${url}: HTTP ${res.status}`);
    return (await res.json()) as T;
  };
  const search = await getJson<{ results: Record<string, { identifier: string; title: string }> }>(`${MEDICAID_API}/search?fulltext=NADAC&page-size=50`);
  const yearly = Object.values(search.results)
    .map((d) => ({ id: d.identifier, year: Number(/^NADAC \(National Average Drug Acquisition Cost\) (\d{4})$/.exec(d.title)?.[1]) }))
    .filter((d) => d.year)
    .sort((a, b) => b.year - a.year)[0];
  if (!yearly) throw new Error("NADAC: no yearly dataset found on data.medicaid.gov.");
  const query = `${MEDICAID_API}/datastore/query/${yearly.id}/0`;
  type Row = { ndc: string; ndc_description: string; nadac_per_unit: string; pricing_unit: string; effective_date: string; classification_for_rate_setting: string; as_of_date: string };
  const latest = (await getJson<{ results: Row[] }>(`${query}?limit=1&properties[0]=as_of_date&sorts[0][property]=as_of_date&sorts[0][order]=desc`)).results[0]?.as_of_date;
  if (!latest) throw new Error("NADAC: could not find the latest week.");
  const index: NadacIndex = {};
  const props = ["ndc", "ndc_description", "nadac_per_unit", "pricing_unit", "effective_date", "classification_for_rate_setting"].map((p, i) => `properties[${i}]=${p}`).join("&");
  const limit = 5000;
  for (let offset = 0; ; offset += limit) {
    const page = (await getJson<{ results: Row[] }>(`${query}?${props}&limit=${limit}&offset=${offset}&sorts[0][property]=ndc&sorts[0][order]=asc&conditions[0][property]=as_of_date&conditions[0][value]=${encodeURIComponent(latest)}&conditions[0][operator]=%3D`)).results;
    const before = Object.keys(index).length;
    for (const r of page) {
      const perUnit = Number(r.nadac_per_unit);
      // A blank, zero, or non-numeric price is skipped, so it is never shown as a real price.
      if (!r.nadac_per_unit || !Number.isFinite(perUnit) || perUnit <= 0) continue;
      index[r.ndc] = { description: r.ndc_description, perUnit, unit: r.pricing_unit, effectiveDate: r.effective_date, classification: r.classification_for_rate_setting };
    }
    // Stop at the last page, or if a page adds nothing new (guards against an API that ignores offset).
    if (page.length < limit || Object.keys(index).length === before) break;
  }
  if (Object.keys(index).length < 1000) throw new Error(`NADAC: only ${Object.keys(index).length} rows for ${latest}; refusing to save a partial week.`);
  stage("nadac.json", JSON.stringify(index));
  const asOf = `NADAC week of ${latest} (${yearly.year} dataset)`;
  console.log(`NADAC: ${Object.keys(index).length} NDCs, ${asOf}`);
  return { url: `https://data.medicaid.gov/dataset/${yearly.id}`, fetchedAt: now(), asOf };
}

const appleHealthInfo = await appleHealth();
const partDInfo = await partD();
// Each insurer's date and link are saved under its own key, whatever order the list is in.
const exchanges = {} as Record<ExchangeKey, SourceInfo>;
for (const insurer of EXCHANGE_INSURERS) exchanges[insurer.key] = await exchange(insurer);
const manifest: Manifest = { appleHealth: appleHealthInfo, partD: partDInfo, ...exchanges, ump: await ump(), nadac: await nadac() };
stage("manifest.json", JSON.stringify(manifest, null, 2));
for (const name of staged) renameSync(cachePath(`${name}.new`), cachePath(name));
// RxNorm lookups are cached between refreshes; a successful refresh clears them so drug matches stay current.
rmSync(cachePath("rxnav"), { recursive: true, force: true });
console.log("All sources saved; dates are in cache/manifest.json");
