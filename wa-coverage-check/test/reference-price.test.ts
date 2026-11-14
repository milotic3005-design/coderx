/** NADAC reference price: hand-made rows for the rules, plus live checks on the cached week. */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkCoverage, referencePrice } from "../src/check-coverage.ts";
import { cachePath, type NadacIndex } from "../src/sources.ts";

const info = { url: "https://example.test/nadac", fetchedAt: "2026-11-13", asOf: "NADAC week of 2026-11-11" };
const match = (ndcs: string[]) => ({ matchedName: "test", rxcuis: ["1"], products: [], ndcs });
const nadac: NadacIndex = {
  "1": { description: "TESTDRUG 10 MG TABLET", perUnit: 0.1, unit: "EA", effectiveDate: "2026-10-01", classification: "G" },
  "2": { description: "TESTDRUG 10 MG TABLET", perUnit: 0.3, unit: "EA", effectiveDate: "2026-10-08", classification: "G" },
  "3": { description: "TESTBRAND 10 MG TABLET", perUnit: 9.5, unit: "EA", effectiveDate: "2026-09-01", classification: "B" },
};

describe("reference price rules", () => {
  it("is labeled as not patient cost", () => {
    const p = referencePrice(match(["1"]), nadac, info);
    expect(p.label).toMatch(/not .*patient/i);
  });
  it("groups NDCs by product and gives the low-high price per unit", () => {
    const p = referencePrice(match(["1", "2", "3"]), nadac, info);
    expect(p.prices).toEqual([
      { product: "TESTBRAND 10 MG TABLET", brandOrGeneric: "brand", low: 9.5, high: 9.5, unit: "EA", ndcCount: 1, effectiveDate: "2026-09-01" },
      { product: "TESTDRUG 10 MG TABLET", brandOrGeneric: "generic", low: 0.1, high: 0.3, unit: "EA", ndcCount: 2, effectiveDate: "2026-10-08" },
    ]);
  });
  it("keeps brand and generic NDCs with the same description apart", () => {
    const mixed: NadacIndex = { ...nadac, "4": { ...nadac["1"], classification: "B", perUnit: 5 } };
    const p = referencePrice(match(["1", "4"]), mixed, info);
    expect(p.prices.map((x) => x.brandOrGeneric).sort()).toEqual(["brand", "generic"]);
  });
  it("says so when RxNorm lists no NDCs, rather than implying a lookup", () => {
    expect(referencePrice(match([]), nadac, info).reason).toContain("no NDCs");
  });
  it("gives no prices and a reason when no NDC has a NADAC", () => {
    const p = referencePrice(match(["99"]), nadac, info);
    expect(p.prices).toEqual([]);
    expect(p.reason).toMatch(/specialty|clinic/i);
  });
  it("carries the source link and week", () => {
    expect(referencePrice(match(["1"]), nadac, info)).toMatchObject({ sourceUrl: info.url, asOfDate: info.asOf });
  });
});

describe.runIf(existsSync(cachePath("nadac.json")))("reference price on the cached NADAC week", () => {
  it("finds generic atorvastatin prices", async () => {
    const r = await checkCoverage("atorvastatin");
    expect(r.referencePrice!.prices.some((p) => p.brandOrGeneric === "generic" && p.low > 0)).toBe(true);
  }, 60_000);
  it("keeps the reference price out of the coverage rows", async () => {
    const r = await checkCoverage("atorvastatin");
    const fields = ["plan", "covered", "tier", "priorAuth", "stepTherapy", "quantityLimit", "costSharing", "benefitType", "sourceUrl", "asOfDate", "reason"].sort();
    for (const row of r.rows) expect(Object.keys(row).sort()).toEqual(fields);
  }, 60_000);
  it("returns no reference price when RxNorm does not know the name", async () => {
    expect((await checkCoverage("zzzzqq")).referencePrice).toBeNull();
  });
});
