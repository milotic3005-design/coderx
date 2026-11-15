import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverPartdWa } from "@/ingest/discover";
import { canStartPartd, partdCatalogDue } from "@/ingest/refresh";
import { formularyCounts, parseFormularyRows, parseInsulinCosts, parseTierCosts, partdProblems, readPartdWa, summarizeCosts, tierCostWarnings, washingtonPlans } from "@/ingest/parsers/cms-partd";
import { byteSourceFromBytes } from "@/ingest/remote-zip";
import { FIXTURE_DIR, partdArchive } from "../helpers/fixtures";

// Excerpts of CMS's quarterly Part D files for 2026 Q3: Prolia in three Washington plans,
// plus a D.C. PDP and a Nebraska plan that must be filtered out.
const read = (n: string) => readFileSync(join(FIXTURE_DIR, "partd-wa", n), "latin1");
const geo = read("geographic-locator.txt");
const planInfo = read("plan-information.txt");
const formulary = read("basic-drugs-formulary.txt");
const pricing = read("pricing.txt");
const beneficiaryCost = read("beneficiary-cost.txt");

async function* rows(text: string) {
  for (const line of text.split(/\r?\n/)) if (line) yield line;
}

describe("Washington Part D plans", () => {
  const plans = washingtonPlans(geo, planInfo);

  it("counts PDPs in region 30 and MA-PDs by Washington county", () => {
    expect(plans.filter((p) => p.type === "PDP").map((p) => p.key)).toEqual(["S5617|148|000"]);
    expect(plans.filter((p) => p.type === "MA-PD").map((p) => p.key).sort()).toEqual(["H1036|306|000", "H1036|319|000"]);
  });
  it("excludes Washington D.C. and other states", () => {
    expect(plans.map((p) => p.key)).not.toContain("S4802|079|000");
    expect(plans.map((p) => p.key)).not.toContain("H0028|007|000");
  });
  it("keeps each plan's name and deductible", () => {
    expect(plans.find((p) => p.key === "S5617|148|000")).toMatchObject({ name: "HealthSpring Assurance Rx (PDP)", deductible: 615 });
  });
  it("counts a plan that also serves Oregon once", () => {
    expect(plans.filter((p) => p.key === "H1036|306|000")).toHaveLength(1);
  });
  it("counts a regional PPO by its MA region", () => {
    const withRegional = `${planInfo.trimEnd()}\r\nR1234|001|000|REGIONAL PLAN|Regional PPO|00026089|0.00|615|23| | | |0|N\r\nR5678|001|000|OTHER REGION|Regional PPO|00026089|0.00|615|05| | | |0|N\r\n`;
    const keys = washingtonPlans(geo, withRegional).map((p) => p.key);
    expect(keys).toContain("R1234|001|000");
    expect(keys).not.toContain("R5678|001|000");
  });
  it("totals plans by formulary and type", () => {
    expect(formularyCounts(plans)).toEqual(
      expect.arrayContaining([
        { formularyId: "00026089", pdpPlans: 1, mapdPlans: 0 },
        { formularyId: "00026408", pdpPlans: 0, mapdPlans: 1 },
        { formularyId: "00026412", pdpPlans: 0, mapdPlans: 1 },
      ]),
    );
  });
});

describe("Part D formulary and cost rows", () => {
  const plans = washingtonPlans(geo, planInfo);
  const drugs = parseFormularyRows(formulary, new Set(plans.map((p) => p.formularyId)));

  it("keeps Washington formularies with their restrictions", () => {
    expect(drugs).toHaveLength(3);
    expect(drugs[0]).toEqual({ formularyId: "00026089", rxcui: "993456", proxyNdc: "55513071001", tier: 4, priorAuth: false, stepTherapy: false, quantityLimit: true, selectedDrug: false });
  });
  it("fails on a file whose layout changed", () => {
    expect(() => parseFormularyRows("FORMULARY_ID|NDC\n1|2\n", new Set(["1"]))).toThrow(/RXCUI/);
  });
  it("summarizes 30-day costs across Washington plans only", async () => {
    expect(await summarizeCosts(rows(pricing), plans, new Map([["55513071001", "993456"]]))).toEqual([
      { proxyNdc: "55513071001", rxcui: "993456", planCount: 3, unitCostMin: 1842.4988, unitCostMedian: 1846.1841, unitCostMax: 1852.0732 },
    ]);
  });
  it("skips a blank unit cost rather than counting it as $0", async () => {
    const blank = pricing.replace("|30|1846.1841", "|30|");
    const [cost] = await summarizeCosts(rows(blank), plans, new Map());
    expect(cost.planCount).toBe(2);
    expect(cost.unitCostMin).toBe(1842.4988);
  });
  it("averages the middle two for an even number of plans", async () => {
    const two = plans.filter((p) => p.key.startsWith("H1036"));
    const [cost] = await summarizeCosts(rows(pricing), two, new Map());
    expect(cost.unitCostMedian).toBe(1844.3415); // midpoint of 1842.4988 and 1846.1841, rounded to 4 places
    expect(cost.rxcui).toBeNull();
  });
});

describe("Checking a Part D import", () => {
  const plan = { key: "x", name: "Test PDP", formularyId: "1", type: "PDP" as const, deductible: 0 };
  const drug = (rxcui: string) => ({ formularyId: "1", rxcui, proxyNdc: "1", tier: 1, priorAuth: false, stepTherapy: false, quantityLimit: false, selectedDrug: false });
  const cost = { proxyNdc: "1", rxcui: "1", planCount: 1, unitCostMin: 1, unitCostMedian: 1, unitCostMax: 1 };
  const tierCost = (planKey: string) => ({ planKey, tier: 1, deductibleApplies: false, specialty: false, preferred: { type: "copay" as const, amount: 1, max: null }, standard: null });
  const full = { plans: Array(60).fill(plan), drugs: Array.from({ length: 1500 }, (_, i) => drug(String(i))), costs: Array(1500).fill(cost), tierCosts: Array.from({ length: 60 }, (_, i) => tierCost(String(i))) };
  it("passes a full file", () => {
    expect(partdProblems(full)).toEqual([]);
  });
  it("names a file with too few plans or RxCUIs", () => {
    expect(partdProblems({ ...full, plans: [plan] }).join()).toContain("plans");
    expect(partdProblems({ ...full, drugs: [drug("1")] }).join()).toContain("RxCUIs");
  });
  it("catches a layout change that loses the costs", () => {
    expect(partdProblems({ ...full, costs: [] }).join()).toContain("cost");
  });
  it("only warns, never fails, when plan copays are missing or thin", () => {
    expect(partdProblems({ ...full })).toEqual([]);
    expect(tierCostWarnings({ ...full, tierCostsFound: true, costFileWarnings: [] })).toEqual([]);
    expect(tierCostWarnings({ ...full, tierCosts: [], tierCostsFound: true, costFileWarnings: [] }).join()).toContain("only 0 of 60");
    expect(tierCostWarnings({ ...full, tierCosts: [], tierCostsFound: false, costFileWarnings: ["The beneficiary cost file was not found"] }).join()).toContain("not found");
  });
});

describe("Reading the quarterly archive", () => {
  it("reads only the needed files from the nested archive", async () => {
    const p = await readPartdWa(byteSourceFromBytes(partdArchive()));
    expect(p.plans).toHaveLength(3);
    expect(p.drugs).toHaveLength(3);
    expect(p.costs).toHaveLength(1);
    expect(p.tierCosts).toHaveLength(3);
    expect(p.checksum).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("Finding the newest quarterly file", () => {
  const title = (date: string) => `Quarterly Prescription Drug Plan Formulary, Pharmacy Network, and Pricing Information : ${date}`;
  const catalog = JSON.stringify({
    dataset: [
      { title: title("2026-06-01"), distribution: [{ format: "ZIP", downloadURL: "https://data.cms.gov/q2.zip" }] },
      { title: title("2026-09-01"), distribution: [{ format: "API", accessURL: "https://data.cms.gov/api" }, { format: "ZIP", downloadURL: "https://data.cms.gov/q3.zip" }] },
      { title: "Monthly Prescription Drug Plan Formulary and Pharmacy Network Information : 2026-10-15", distribution: [{ format: "ZIP", downloadURL: "https://data.cms.gov/m.zip" }] },
    ],
  });
  it("takes the latest release and names its quarter", async () => {
    expect(await discoverPartdWa(async () => catalog)).toMatchObject({ sourceKey: "cms_partd_wa", period: "2026-Q3", url: "https://data.cms.gov/q3.zip" });
  });
  it("returns null when the catalog has no such dataset", async () => {
    expect(await discoverPartdWa(async () => JSON.stringify({ dataset: [] }))).toBeNull();
  });
});

describe("Fitting Part D into the daily refresh", () => {
  const day = 86_400_000;
  const now = Date.parse("2026-11-06T10:15:00Z");
  it("checks the 18 MB catalog at most weekly once a quarter is loaded", () => {
    expect(partdCatalogDue(null, now)).toBe(true);
    expect(partdCatalogDue(new Date(now - 3 * day).toISOString(), now)).toBe(false);
    expect(partdCatalogDue(new Date(now - 8 * day).toISOString(), now)).toBe(true);
  });
  it("starts only when the run has done nothing else and has time left", () => {
    expect(canStartPartd(5_000, 0)).toBe(true);
    expect(canStartPartd(5_000, 1)).toBe(false);
    expect(canStartPartd(120_000, 0)).toBe(false);
  });
});

describe("Part D tier cost sharing", () => {
  const costs = parseTierCosts(beneficiaryCost, new Set(washingtonPlans(geo, planInfo).map((p) => p.key)));
  it("keeps the initial coverage phase, 30-day supply, Washington plans only", () => {
    expect(costs.map((c) => c.planKey).sort()).toEqual(["H1036|306|000", "H1036|319|000", "S5617|148|000"]);
  });
  it("reads copays in dollars and coinsurance as a fraction, with the deductible flag", () => {
    const by = (k: string) => costs.find((c) => c.planKey === k)!;
    expect(by("H1036|306|000")).toMatchObject({ tier: 4, deductibleApplies: true, preferred: { type: "copay", amount: 47, max: null }, standard: { type: "copay", amount: 52, max: null } });
    expect(by("H1036|319|000").preferred).toEqual({ type: "coinsurance", amount: 0.25, max: null });
    // Preferred retail not offered (cost type 0): only standard retail.
    expect(by("S5617|148|000")).toMatchObject({ deductibleApplies: false, preferred: null, standard: { type: "copay", amount: 100 } });
  });
  it("stops on a layout change", () => {
    expect(() => parseTierCosts("CONTRACT_ID|PLAN_ID\nX|1", new Set())).toThrow(/layout/);
  });
  it("reads a blank amount as not stated, not $0", () => {
    const header = beneficiaryCost.split("\n")[0];
    const [c] = parseTierCosts(`${header}\nS5617|148|000|1|4|1|1||0|0|2|.25|0|0|0|0|0|0|0|0|0|0|N|N`, new Set(["S5617|148|000"]));
    expect(c).toMatchObject({ preferred: null, standard: { type: "coinsurance", amount: 0.25 } });
  });
  it("still reads the formulary when the archive has no beneficiary cost file", async () => {
    const p = await readPartdWa(byteSourceFromBytes(partdArchive({ withoutBeneficiaryCost: true })));
    expect(p).toMatchObject({ tierCosts: [], tierCostsFound: false });
    expect(p.costFileWarnings.join()).toContain("not found");
    expect(p.drugs).toHaveLength(3);
  });
  it("still reads the formulary when the beneficiary cost file's layout changed, with a warning", async () => {
    const renamed = beneficiaryCost.replace("DED_APPLIES_YN", "DEDUCTIBLE_APPLIES");
    const p = await readPartdWa(byteSourceFromBytes(partdArchive({ beneficiaryCostText: renamed })));
    expect(p).toMatchObject({ tierCosts: [], tierCostsFound: false });
    expect(p.costFileWarnings.join()).toMatch(/could not be read: .*DED_APPLIES_YN/);
    expect(p.drugs).toHaveLength(3);
    expect(p.insulinCosts).toHaveLength(3);
  });
});

describe("Part D insulin cost sharing", () => {
  const insulin = read("insulin-beneficiary-cost.txt");
  const costs = parseInsulinCosts(insulin, new Set(washingtonPlans(geo, planInfo).map((p) => p.key)));
  it("reads CMS's 2026 lower-case columns, 30-day rows, Washington plans only", () => {
    expect(costs.map((c) => c.planKey).sort()).toEqual(["H1036|306|000", "H1036|319|000", "S5617|148|000"]);
  });
  it("keeps copays in dollars, coinsurance as a fraction, and a blank tier for defined standard plans", () => {
    const by = (k: string) => costs.find((c) => c.planKey === k)!;
    expect(by("H1036|306|000")).toMatchObject({ tier: 4, preferred: { copay: 35, coinsurance: null } });
    expect(by("H1036|319|000")).toMatchObject({ preferred: { copay: null, coinsurance: 0.25 } });
    expect(by("S5617|148|000")).toMatchObject({ tier: null, preferred: null, standard: { copay: 35, coinsurance: null } });
  });
  it("stops on a layout change", () => {
    expect(() => parseInsulinCosts("CONTRACT_ID|PLAN_ID\nX|1", new Set())).toThrow(/layout/);
  });
});
