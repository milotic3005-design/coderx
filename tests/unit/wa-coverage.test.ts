/** Washington coverage rules on small, made-up rows that copy the real files' codes (ported from wa-coverage-check/test). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { isDatabaseUnavailable } from "@/lib/db/availability";
import { matchRxNorm, RxNavError } from "@/lib/rxnorm";
import { appleHealthRow, exchangeRows, NADAC_LABEL, partDRow, referencePrice, tierCost, type ExchangePlan, type NadacRow, type PdlRow } from "@/lib/wa-coverage";

const match = (over: { ndcs?: string[]; rxcuis?: string[] } = {}) => ({ matchedName: "test drug", rxcuis: over.rxcuis ?? ["1", "2"], products: [], ndcs: over.ndcs ?? [] });
const pdl = (ndc11: string, over: Partial<PdlRow> = {}): PdlRow => ({ ndc11, label: "TEST", coverage: "CP", nonCoveredReason: "", pharmacyPreferred: "P", pharmacyPa: "N", medicalPreferred: "X", medicalPa: "", paPolicy: "", ...over });

describe("Apple Health rows", () => {
  it("does not call a drug covered when its only NDCs have a blank coverage code", () => {
    const r = appleHealthRow(match({ ndcs: ["1"] }), [pdl("1", { coverage: "" })]);
    expect(r.covered).toBe("unknown");
    expect(r.reason).toContain("blank coverage code");
  });
  it("ignores blank-coded NDCs when other NDCs are covered", () => {
    const r = appleHealthRow(match({ ndcs: ["1", "2"] }), [pdl("1", { coverage: "" }), pdl("2")]);
    expect(r).toMatchObject({ covered: "yes", benefitType: "pharmacy", priorAuth: "no", tier: "Preferred" });
  });
  it("reports medical PA as unknown when NDCs disagree", () => {
    const r = appleHealthRow(match({ ndcs: ["1", "2"] }), [pdl("1", { coverage: "CM", medicalPa: "Y" }), pdl("2", { coverage: "CM", medicalPa: "N" })]);
    expect(r).toMatchObject({ covered: "yes", benefitType: "medical", priorAuth: "unknown" });
  });
  it("says not covered, with the PDL's reason, when every NDC is NC", () => {
    const r = appleHealthRow(match({ ndcs: ["1"] }), [pdl("1", { coverage: "NC", nonCoveredReason: "SDYS" })]);
    expect(r).toMatchObject({ covered: "no" });
    expect(r.reason).toContain("sexual dysfunction product");
  });
  it("is unknown, not no, when no NDC is on the PDL, and says when RxNorm lists no NDCs at all", () => {
    expect(appleHealthRow(match({ ndcs: ["9"] }), []).covered).toBe("unknown");
    const none = appleHealthRow(match({ ndcs: [] }), []);
    expect(none.covered).toBe("unknown");
    expect(none.reason).toContain("RxNorm lists no NDCs");
  });
  it("only reads rows for this drug's NDCs", () => {
    expect(appleHealthRow(match({ ndcs: ["1"] }), [pdl("2", { coverage: "NC" })]).covered).toBe("unknown");
  });
  it("explains why step therapy, quantity limits, and cost sharing are unknown", () => {
    const r = appleHealthRow(match({ ndcs: ["1"] }), [pdl("1")]);
    expect(r).toMatchObject({ stepTherapy: "unknown", quantityLimit: "unknown", costSharing: null });
    expect(r.reason).toContain("step therapy or quantity limits");
  });
});

describe("Part D summary row", () => {
  const formularies = [
    { formularyId: "F1", pdpPlans: 3, mapdPlans: 7 },
    { formularyId: "F2", pdpPlans: 0, mapdPlans: 5 },
    { formularyId: "F3", pdpPlans: 1, mapdPlans: 0 },
  ];
  const l = (formularyId: string, rxcui: string, over: { tier?: number; pa?: boolean; st?: boolean; ql?: boolean } = {}) => ({ formularyId, rxcui, tier: over.tier ?? 3, priorAuth: over.pa ?? false, stepTherapy: over.st ?? false, quantityLimit: over.ql ?? false });

  it("counts plans, not formularies, and is yes only when every plan lists the drug", () => {
    const all = partDRow(match(), formularies, [l("F1", "1"), l("F2", "1"), l("F3", "2")]);
    expect(all).toMatchObject({ covered: "yes", coveredNote: "16 of 16 plans", tier: "Tier 3", priorAuth: "no" });
    const some = partDRow(match(), formularies, [l("F1", "1")]);
    expect(some).toMatchObject({ covered: "unknown", coveredNote: "10 of 16 plans" });
    expect(some.reason).toContain("Listed by 10 of 16");
  });
  it("is no, with the retired-ID limit, when no plan lists the drug", () => {
    const r = partDRow(match({ rxcuis: ["9"] }), formularies, [l("F1", "1")]);
    expect(r).toMatchObject({ covered: "no", coveredNote: "0 of 16 plans" });
    expect(r.reason).toContain("retired");
  });
  it("PA is yes only when every listing plan requires it on every form", () => {
    expect(partDRow(match(), formularies, [l("F1", "1", { pa: true }), l("F2", "1", { pa: true })]).priorAuth).toBe("yes");
    const mixedForms = partDRow(match(), formularies, [l("F1", "1", { pa: true }), l("F1", "2"), l("F2", "1", { pa: true })]);
    expect(mixedForms.priorAuth).toBe("unknown");
    expect(mixedForms.reason).toContain("PA: 5 of 15 listing plans on every form, 10 on some forms only");
  });
  it("shows a tier range when plans differ", () => {
    expect(partDRow(match(), formularies, [l("F1", "1", { tier: 2 }), l("F2", "1", { tier: 4 })]).tier).toBe("Tier 2–4");
  });
});

describe("exchange rows", () => {
  const plans: ExchangePlan[] = [
    { planId: "P1", name: "Test Silver", costs: { SPECIALTY: "30% coinsurance after deductible" } },
    { planId: "P2", name: "Test Gold", costs: {} },
  ];
  it("yes only when every form has the restriction, with the plan's cost rule", () => {
    const [r] = exchangeRows(match(), plans, [
      { planId: "P1", tier: "SPECIALTY", pa: true, st: true, ql: true },
      { planId: "P1", tier: "SPECIALTY", pa: true, st: false, ql: true },
    ]);
    expect(r).toMatchObject({ plan: "Test Silver (P1)", covered: "yes", priorAuth: "yes", quantityLimit: "yes", stepTherapy: "unknown", costSharing: "30% coinsurance after deductible" });
    expect(r.reason).toContain("some forms");
  });
  it("matches tier names that differ only in hyphens or case, and says when a tier has no cost rule", () => {
    const costs = { "PREFERRED-BRAND": "$50 copay", SPECIALTY: "30% coinsurance" };
    expect(tierCost(costs, "PREFERREDBRAND")).toBe("$50 copay");
    expect(tierCost(costs, "preferred-brand")).toBe("$50 copay");
    expect(tierCost(costs, "SPECIALTYDRUGS")).toBeNull();
    const [r] = exchangeRows(match(), [{ planId: "P1", name: "Test", costs }], [{ planId: "P1", tier: "SPECIALTYDRUGS", pa: true, st: false, ql: false }]);
    expect(r.costSharing).toBeNull();
    expect(r.reason).toContain("no cost-sharing rule for tier SPECIALTYDRUGS");
  });
  it("labels each cost rule with its tier when the drug sits in several tiers", () => {
    const [r] = exchangeRows(match(), [{ planId: "P1", name: "Test", costs: { GENERIC: "$10 copay", SPECIALTY: "30% coinsurance" } }], [
      { planId: "P1", tier: "GENERIC", pa: false, st: false, ql: false },
      { planId: "P1", tier: "OTHER", pa: false, st: false, ql: false },
      { planId: "P1", tier: "SPECIALTY", pa: false, st: false, ql: false },
    ]);
    expect(r.costSharing).toBe("GENERIC: $10 copay | SPECIALTY: 30% coinsurance");
    expect(r.reason).toContain("no cost-sharing rule for tier OTHER");
  });
  it("names the retired-ID limit for a plan that does not list the drug", () => {
    const [, r] = exchangeRows(match(), plans, [{ planId: "P1", tier: "GENERIC", pa: false, st: false, ql: false }]);
    expect(r.covered).toBe("no");
    expect(r.reason).toContain("retired");
  });
});

describe("reference price", () => {
  const rows: NadacRow[] = [
    { ndc11: "1", description: "TESTDRUG 10 MG TABLET", perUnit: 0.1, unit: "EA", effectiveDate: "2026-10-01", classification: "G" },
    { ndc11: "2", description: "TESTDRUG 10 MG TABLET", perUnit: 0.3, unit: "EA", effectiveDate: "2026-10-08", classification: "G" },
    { ndc11: "3", description: "TESTBRAND 10 MG TABLET", perUnit: 9.5, unit: "EA", effectiveDate: "2026-09-01", classification: "B" },
  ];
  it("is labeled as not patient cost", () => {
    expect(NADAC_LABEL).toMatch(/not patient cost/);
  });
  it("groups NDCs by product and gives the low-high price per unit", () => {
    expect(referencePrice(match({ ndcs: ["1", "2", "3"] }), rows).prices).toEqual([
      { product: "TESTBRAND 10 MG TABLET", brandOrGeneric: "brand", low: 9.5, high: 9.5, unit: "EA", ndcCount: 1, effectiveDate: "2026-09-01" },
      { product: "TESTDRUG 10 MG TABLET", brandOrGeneric: "generic", low: 0.1, high: 0.3, unit: "EA", ndcCount: 2, effectiveDate: "2026-10-08" },
    ]);
  });
  it("gives no prices and a reason when no NDC has a NADAC, and says when RxNorm lists no NDCs", () => {
    const none = referencePrice(match({ ndcs: ["99"] }), rows);
    expect(none.prices).toEqual([]);
    expect(none.reason).toMatch(/specialty|clinic/i);
    expect(referencePrice(match({ ndcs: [] }), rows).reason).toContain("no NDCs");
  });
});

describe("RxNav failures", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("are never read as a database outage, even when the network error carries ENOTFOUND", async () => {
    const dns = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("getaddrinfo ENOTFOUND rxnav.nlm.nih.gov"), { code: "ENOTFOUND" }) });
    expect(isDatabaseUnavailable(dns)).toBe(true); // why the wrapper exists
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(dns));
    const error = await matchRxNorm("Ozempic").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RxNavError);
    expect(isDatabaseUnavailable(error)).toBe(false);
  });
  it("offers only RxNorm's own names as suggestions", async () => {
    const body = (path: string) =>
      path.includes("/drugs.json") ? { drugGroup: {} } : { approximateGroup: { candidate: [{ rxcui: "1", name: "OZEMPIC", source: "MMSL" }, { rxcui: "1", name: "Ozempic", source: "RXNORM" }, { rxcui: "2", name: "Ozempic Pill", source: "RXNORM" }] } };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(body(url)), { status: 200 })));
    expect(await matchRxNorm("ozempick")).toEqual({ kind: "suggestions", suggestions: ["Ozempic", "Ozempic Pill"] });
  });
});
