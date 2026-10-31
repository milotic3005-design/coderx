import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { anonymize, parseHospitalMrfStream, planTypeOf } from "@/ingest/parsers/hospital-mrf";
import { parseCmsDosage } from "@/lib/billing";
import { lineAmountsByPlanType, median, pooledByPlanType, summarizeRates, toBillingUnitFactor } from "@/lib/hospital-rates";
import { FIXTURE_DIR } from "../helpers/fixtures";

// Real rows from MultiCare Yakima Memorial's price transparency file (CMS template v3.0.0).
async function parsed() {
  const bytes = new Uint8Array(readFileSync(join(FIXTURE_DIR, "hpt-multicare-yakima-excerpt.csv")));
  // Split into odd-sized chunks so records cross chunk boundaries.
  return parseHospitalMrfStream(
    (async function* () {
      for (let i = 0; i < bytes.length; i += 997) yield bytes.subarray(i, i + 997);
    })(),
  );
}

describe("hospital price transparency file parser", () => {
  it("reads the metadata and keeps only HCPCS drug rows", async () => {
    const p = await parsed();
    expect(p.meta).toMatchObject({ hospitalName: "MultiCare Yakima Valley Memorial Hospital Association", lastUpdatedOn: "2026-08-27", version: "3.0.0", npis: ["1053373480"], license: "HAC.FS.00000058" });
    expect(p.meta.locationNames).toEqual(["MultiCare Yakima Memorial Hospital", "MultiCare Yakima Memorial Emergency Union Gap"]);
    expect(p.rowsRead).toBe(134); // 2 APR-DRG + 2 CPT + 130 drug rows
    expect(p.drugRows).toBe(130);
    expect(new Set(p.contracts.map((c) => c.code))).toEqual(new Set(["J9312", "J1569", "J0121"]));
    const j9312 = p.contracts.find((c) => c.code === "J9312" && c.payer === "Regence" && c.plan === "RealValue" && c.setting === "outpatient")!;
    expect(j9312).toMatchObject({ methodology: "fee schedule", dollar: 174.78, drugQuantity: 10, drugUnit: "ME", billingClass: "facility" });
  });

  it("anonymizes: plan types only, one amount per payer-plan contract, no names", async () => {
    const groups = anonymize((await parsed()).contracts);
    expect(JSON.stringify(groups)).not.toMatch(/Regence|Premera|Molina|Aetna|Cigna|RealValue|Apple Health/);
    const fee = groups.find((g) => g.code === "J9312" && g.setting === "outpatient" && g.planType === "commercial" && g.methodology === "fee schedule")!;
    expect(fee).toMatchObject({ drugQuantity: 10, drugUnit: "ME" });
    expect(fee.amounts).toContain(174.78);
    expect(fee.amounts).toEqual([...fee.amounts].sort((a, b) => a - b));
    expect(groups.some((g) => g.code === "J9312" && g.planType === "medicaid_managed_care" && g.methodology === "case rate")).toBe(true);
  });

  it("keeps one amount per payer-plan contract, using the median of its chargemaster lines", () => {
    const base = { code: "J9312", setting: "outpatient", billingClass: "facility", methodology: "percent of total billed charges", percentage: null, algorithm: null, drugQuantity: 10, drugUnit: "ME", modifiers: "", ndcs: [], descriptions: [], grossMin: null, grossMax: null, cashMin: null, cashMax: null, rows: 1 };
    const [g] = anonymize([
      { ...base, payer: "A", plan: "PPO", dollar: 200 },
      { ...base, payer: "A", plan: "PPO", dollar: 220 },
      { ...base, payer: "A", plan: "PPO", dollar: 260 },
      { ...base, payer: "B", plan: "HMO", dollar: 300 },
    ]);
    expect(g.amounts).toEqual([220, 300]);
  });

  it("classifies plans from the names in the file", () => {
    expect(planTypeOf("Molina", "Apple Health")).toBe("medicaid_managed_care");
    expect(planTypeOf("Regence", "MedAdvantage")).toBe("medicare_advantage");
    expect(planTypeOf("Community Health Plan of Washington", "Cascade Care")).toBe("commercial");
    expect(planTypeOf("Premera", "Signature")).toBe("commercial");
  });
});

describe("hospital rates per CMS billing unit", () => {
  it("converts the file's drug measure to the CMS billing unit only when dimensions match", () => {
    expect(toBillingUnitFactor(10, "ME", parseCmsDosage("10 MG"))).toBe(1);
    expect(toBillingUnitFactor(1, "GR", parseCmsDosage("500 MG"))).toBe(0.5);
    expect(toBillingUnitFactor(100, "UN", parseCmsDosage("1 UNIT"))).toBeNull(); // "UN" is not converted
    expect(toBillingUnitFactor(10, "ML", parseCmsDosage("10 MG"))).toBeNull();
    expect(toBillingUnitFactor(null, null, parseCmsDosage("1 MG"))).toBeNull();
  });

  it("summarizes outpatient per-unit contracts by plan type and leaves case rates out", async () => {
    const groups = anonymize((await parsed()).contracts);
    const rows = groups.map((g) => ({ ...g, hospitalKey: "yakima-memorial" }));
    const j9312 = summarizeRates(rows.filter((r) => r.code === "J9312"), parseCmsDosage("10 MG"), 72.094);
    const c = j9312.find((s) => s.planType === "commercial")!;
    const expected = rows
      .filter((r) => r.code === "J9312" && r.setting === "outpatient" && r.planType === "commercial" && ["fee schedule", "percent of total billed charges"].includes(r.methodology))
      .flatMap((r) => r.amounts)
      .sort((a, b) => a - b);
    expect(c.perUnit).toEqual(expected);
    expect(c.median).toBe(Math.round(median(expected)! * 100) / 100);
    expect(c.medianPctOfLimit).toBe(Math.round((median(expected)! / 72.094) * 100));
    const medicaid = j9312.find((s) => s.planType === "medicaid_managed_care")!;
    expect(medicaid.perUnit).toEqual([]); // Apple Health MCO contracts are outpatient case rates
    expect(medicaid.otherContracts).toBeGreaterThan(0);
    const pooled = pooledByPlanType(j9312, 72.094);
    expect(pooled.map((p) => p.planType)).toEqual(["commercial", "medicare_advantage"]);
  });
});

describe("per-line amounts", () => {
  it("keeps amounts above the gross charge (or 25x the CMS limit without one) out of the per-unit figures", () => {
    const row = { hospitalKey: "auburn", setting: "outpatient", billingClass: "facility", methodology: "fee schedule", drugQuantity: 10, drugUnit: "ME", percentContracts: 0, algorithmContracts: 0, grossMin: null, grossMax: null };
    // Real J9312 amounts at Auburn: Apple Health managed care lines of $3,103–$3,351, commercial $93–$455.
    const s = summarizeRates(
      [
        { ...row, planType: "medicaid_managed_care", amounts: [3103.24, 3351.5] },
        { ...row, planType: "commercial", amounts: [93.22, 455.38] },
      ],
      parseCmsDosage("10 MG"),
      72.094,
    );
    expect(s.find((x) => x.planType === "medicaid_managed_care")).toMatchObject({ perUnit: [], lineAmounts: [3103.24, 3351.5] });
    expect(s.find((x) => x.planType === "commercial")).toMatchObject({ perUnit: [93.22, 455.38], lineAmounts: [] });
    expect(lineAmountsByPlanType(s)).toEqual([{ planType: "medicaid_managed_care", contracts: 2, min: 3103.24, median: 3227.37, max: 3351.5 }]);
  });
  it("keeps high percent-of-charges rates that stay under the hospital's gross charge", () => {
    // Real Mary Bridge J9312 rows: commercial $863.42 against a $1,060.71 gross charge; Apple Health $3,413.26.
    const row = { hospitalKey: "mary-bridge", setting: "outpatient", billingClass: "facility", drugQuantity: 10, drugUnit: "ME", percentContracts: 0, algorithmContracts: 0, grossMin: 780.46, grossMax: 1060.71 };
    const s = summarizeRates(
      [
        { ...row, planType: "commercial", methodology: "percent of total billed charges", amounts: [863.42] },
        { ...row, planType: "medicaid_managed_care", methodology: "fee schedule", amounts: [3413.26] },
      ],
      parseCmsDosage("10 MG"),
      72.094,
    );
    expect(s.find((x) => x.planType === "commercial")).toMatchObject({ perUnit: [863.42], lineAmounts: [] });
    expect(s.find((x) => x.planType === "medicaid_managed_care")).toMatchObject({ perUnit: [], lineAmounts: [3413.26] });
  });
});
