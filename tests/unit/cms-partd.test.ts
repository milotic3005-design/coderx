import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverPartdWa } from "@/ingest/discover";
import { canStartPartd, partdCatalogDue } from "@/ingest/refresh";
import { formularyCounts, parseFormularyRows, readPartdWa, summarizeCosts, washingtonPlans } from "@/ingest/parsers/cms-partd";
import { byteSourceFromBytes } from "@/ingest/remote-zip";
import { FIXTURE_DIR, partdArchive } from "../helpers/fixtures";

// Excerpts of CMS's quarterly Part D files for 2026 Q3: Prolia in three Washington plans,
// plus a D.C. PDP and a Nebraska plan that must be filtered out.
const read = (n: string) => readFileSync(join(FIXTURE_DIR, "partd-wa", n), "latin1");
const geo = read("geographic-locator.txt");
const planInfo = read("plan-information.txt");
const formulary = read("basic-drugs-formulary.txt");
const pricing = read("pricing.txt");

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
  it("averages the middle two for an even number of plans", async () => {
    const two = plans.filter((p) => p.key.startsWith("H1036"));
    const [cost] = await summarizeCosts(rows(pricing), two, new Map());
    expect(cost.unitCostMedian).toBe(1844.3415); // midpoint of 1842.4988 and 1846.1841, rounded to 4 places
    expect(cost.rxcui).toBeNull();
  });
});

describe("Reading the quarterly archive", () => {
  it("reads only the needed files from the nested archive", async () => {
    const p = await readPartdWa(byteSourceFromBytes(partdArchive()));
    expect(p.plans).toHaveLength(3);
    expect(p.drugs).toHaveLength(3);
    expect(p.costs).toHaveLength(1);
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
