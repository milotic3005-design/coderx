/** Rules from the architect review, on small hand-made examples plus one live RxNorm check. */
import { describe, expect, it } from "vitest";
import { exchangeRows, partDRows } from "../src/check-coverage.ts";
import { matchDrug } from "../src/rxnorm.ts";
import type { ExchangeIndex, PartDIndex } from "../src/sources.ts";

const info = { url: "https://example.test/file", fetchedAt: "2026-11-13", asOf: "test date" };
const match = { matchedName: "test", rxcuis: ["1", "2"], ndcs: [], products: [] };

describe("RxNorm matching", () => {
  it("keeps combination products out of a single-ingredient search", async () => {
    const m = (await matchDrug("atorvastatin"))!;
    expect(m.products.length).toBeGreaterThan(0);
    expect(m.products.some((p) => p.name.includes(" / "))).toBe(false);
  }, 60_000);
  it("still finds a combination product when that is what was typed", async () => {
    const m = (await matchDrug("Caduet"))!;
    expect(m.products.every((p) => p.name.includes(" / "))).toBe(true);
  }, 60_000);
});

describe("restrictions mean the same thing on every plan", () => {
  const partD: PartDIndex = {
    plans: [{ key: "S1-001-000", name: "Test PDP", formularyId: "F1", type: "PDP" }],
    drugs: { "1": { F1: { tier: 3, pa: true, st: false, ql: false } }, "2": { F1: { tier: 3, pa: false, st: false, ql: false } } },
    costs: {},
  };
  it("Part D: PA on some forms only is unknown, with a reason", () => {
    const [r] = partDRows(match, partD, info);
    expect(r.priorAuth).toBe("unknown");
    expect(r.reason).toContain("some forms");
  });
  const amb: ExchangeIndex = { plans: { P1: { name: "Test plan", costs: {} } }, drugs: { "1": [{ planId: "P1", tier: "SPECIALTY", pa: true, st: true, ql: true }], "2": [{ planId: "P1", tier: "SPECIALTY", pa: true, st: false, ql: true }] } };
  it("Exchange: yes only when every form has it, and the row names the insurer", () => {
    const [r] = exchangeRows(match, amb, info, "Regence/BridgeSpan");
    expect(r.plan).toMatch(/^Exchange \(Regence\/BridgeSpan\): Test plan/);
    expect(r).toMatchObject({ priorAuth: "yes", quantityLimit: "yes", stepTherapy: "unknown" });
    expect(r.reason).toContain("published");
  });
  it("names the retired-ID limit when nothing matches", () => {
    const [r] = partDRows({ ...match, rxcuis: ["9"] }, partD, info);
    expect(r.covered).toBe("no");
    expect(r.reason).toContain("retired");
  });
});
