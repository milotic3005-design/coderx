/** Apple Health rules on small, made-up rows that mimic the real PDL's codes, including the blanks the audit found. */
import { describe, expect, it } from "vitest";
import { appleHealthRow } from "../src/check-coverage.ts";
import type { AppleHealthRow } from "../src/sources.ts";

const info = { url: "https://example.test/pdl.xlsx", fetchedAt: "2026-11-13", asOf: "Effective test" };
const match = (ndcs: string[]) => ({ matchedName: "test drug", rxcuis: ["1"], products: [], ndcs });
const row = (over: Partial<AppleHealthRow>): AppleHealthRow => ({ label: "TEST", coverage: "CP", nonCoveredReason: "", pharmacyPreferred: "P", pharmacyPa: "N", medicalPreferred: "X", medicalPa: "", paPolicy: "", ...over });

describe("Apple Health rows", () => {
  it("does not call a drug covered when its only NDCs have a blank coverage code", () => {
    const r = appleHealthRow(match(["1"]), { "1": row({ coverage: "" }) }, info);
    expect(r.covered).toBe("unknown");
    expect(r.reason).toContain("blank coverage code");
  });
  it("ignores blank-coded NDCs when other NDCs are covered", () => {
    const r = appleHealthRow(match(["1", "2"]), { "1": row({ coverage: "" }), "2": row({}) }, info);
    expect(r).toMatchObject({ covered: "yes", benefitType: "pharmacy", priorAuth: "no" });
  });
  it("reports medical PA as unknown when NDCs disagree", () => {
    const r = appleHealthRow(match(["1", "2"]), { "1": row({ coverage: "CM", medicalPa: "Y" }), "2": row({ coverage: "CM", medicalPa: "N" }) }, info);
    expect(r).toMatchObject({ covered: "yes", benefitType: "medical", priorAuth: "unknown" });
  });
  it("explains why step therapy, quantity limits, and cost sharing are unknown", () => {
    const r = appleHealthRow(match(["1"]), { "1": row({}) }, info);
    expect(r.reason).toContain("step therapy or quantity limits");
    expect(r.reason).toContain("cost sharing");
  });
});
