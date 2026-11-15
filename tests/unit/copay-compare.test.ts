/** Copay comparison rules on small, made-up plans that copy the real files' values. */
import { describe, expect, it } from "vitest";
import { describeCost, exchangeCopayRows, partdCopayRows, sortCopays, supplyLabel, type CopayRow, type ExchangeCostDetail } from "@/lib/copay-compare";

const match = { matchedName: "test", rxcuis: ["1"], products: [], ndcs: [] };
const entry = (over: Partial<ExchangeCostDetail>): ExchangeCostDetail => ({ pharmacyType: "1-MONTH-IN-RETAIL", copayAmount: 0, copayOpt: null, coinsuranceRate: 0, coinsuranceOpt: null, ...over });

describe("reading an exchange cost_sharing entry", () => {
  it("maps CMS's deductible options; a blank option is not stated", () => {
    expect(describeCost(entry({ copayAmount: 15, copayOpt: "BEFORE-DEDUCTIBLE" }))).toMatchObject({ cost: "$15.00 copay", deductibleFirst: "no", sort: { rank: 0, amount: 15 } });
    expect(describeCost(entry({ copayAmount: 50, copayOpt: "AFTER-DEDUCTIBLE" }))).toMatchObject({ deductibleFirst: "yes" });
    expect(describeCost(entry({ copayAmount: 10 }))).toMatchObject({ cost: "$10.00 copay", deductibleFirst: "unknown" });
  });
  it("reads no charge after deductible as $0 with the deductible first", () => {
    expect(describeCost(entry({ copayOpt: "NO-CHARGE-AFTER-DEDUCTIBLE" }))).toMatchObject({ cost: "$0.00 copay", deductibleFirst: "yes", sort: { rank: 0, amount: 0 } });
    expect(describeCost(entry({ copayAmount: 20, copayOpt: "NO-CHARGE" }))).toMatchObject({ cost: "$0.00 copay", deductibleFirst: "no" });
  });
  it("ranks any coinsurance after flat copays; a combined rule whose parts disagree about the deductible is not stated", () => {
    expect(describeCost(entry({ coinsuranceRate: 0.3, coinsuranceOpt: "AFTER-DEDUCTIBLE" }))).toMatchObject({ cost: "30% coinsurance", deductibleFirst: "yes", sort: { rank: 1, amount: 0.3 } });
    expect(describeCost(entry({ copayAmount: 20, copayOpt: "BEFORE-DEDUCTIBLE", coinsuranceRate: 0.1, coinsuranceOpt: "AFTER-DEDUCTIBLE" }))).toMatchObject({ cost: "$20.00 copay + 10% coinsurance", deductibleFirst: "unknown", sort: { rank: 1 } });
  });
  it("reads blank amounts as no amount stated, sorted last, not $0", () => {
    expect(describeCost(entry({ copayAmount: null, coinsuranceRate: null }))).toEqual({ cost: "No amount stated", deductibleFirst: "unknown", sort: { rank: 2, amount: 0 } });
  });
  it("labels the fill without assuming a supply length the file does not state", () => {
    expect(supplyLabel("1-MONTH-IN-RETAIL")).toBe("1-month retail");
    expect(supplyLabel("3-MONTH-IN-MAIL")).toBe("3-month mail order");
    expect(supplyLabel("RETAIL")).toBe("retail (supply not stated)");
    expect(supplyLabel("1-MONTH-OUT-RETAIL")).toBe("1-month retail, out of network");
  });
});

describe("exchange copay rows", () => {
  const listing = (tier: string) => ({ planId: "P1", tier, pa: true, st: false, ql: false });
  const plan = { planId: "P1", name: "Test Silver", costDetails: { "PREFERRED-BRAND": [entry({ pharmacyType: "RETAIL", copayAmount: 60 }), entry({ pharmacyType: "MAIL", copayAmount: 180 })] } };
  it("uses in-network retail, lists the rest as other options, and matches tier names that differ only in hyphens", () => {
    const [r] = exchangeCopayRows("Regence/BridgeSpan", [plan], [listing("PREFERREDBRAND")]);
    expect(r).toMatchObject({ cost: "$60.00 copay", supply: "retail (supply not stated)", deductibleFirst: "unknown", restrictions: "PA", other: ["mail order (supply not stated): $180.00 copay"] });
  });
  it("says so when the plan's file has no rule for the tier, and sorts it last", () => {
    const [r] = exchangeCopayRows("Ambetter", [plan], [listing("SPECIALTYDRUGS")]);
    expect(r).toMatchObject({ cost: "Not stated: the plan's file has no cost rule for this tier", sort: { rank: 2 } });
  });
  it("leaves out plans that do not list the drug", () => {
    expect(exchangeCopayRows("Ambetter", [plan], [])).toEqual([]);
  });
});

describe("Part D copay rows", () => {
  const plan = (deductible: number | null, deductibleApplies: boolean) => ({
    planKey: "S1|001|000",
    planName: "Test PDP",
    planType: "PDP",
    formularyId: "F1",
    deductible,
    tierCosts: [{ tier: 3, deductibleApplies, specialty: false, preferred: { type: "copay" as const, amount: 47, max: null }, standard: null }],
    insulinCosts: [] as { tier: number | null; preferred: { copay: number | null; coinsurance: number | null } | null; standard: { copay: number | null; coinsurance: number | null } | null }[],
  });
  const rows = [{ formularyId: "F1", rxcui: "1", tier: 3, priorAuth: false, stepTherapy: false, quantityLimit: true }];
  it("shows the tier's preferred retail copay and the plan's deductible", () => {
    expect(partdCopayRows(match, [plan(615, true)], rows)[0]).toMatchObject({ planId: "S1-001-000", insurer: "Medicare Part D plan (PDP)", tier: "Tier 3", cost: "$47.00 copay", deductibleFirst: "yes", deductibleNote: "Plan deductible $615.00", restrictions: "quantity limit" });
  });
  it("does not put the deductible first when the plan's deductible is $0, and shows the deductible only where it applies", () => {
    expect(partdCopayRows(match, [plan(0, true)], rows)[0]).toMatchObject({ deductibleFirst: "no", deductibleNote: null });
    expect(partdCopayRows(match, [plan(615, false)], rows)[0]).toMatchObject({ deductibleFirst: "no", deductibleNote: null });
  });
  it("is not stated when CMS's cost file has no row for the tier", () => {
    const otherTier = { tier: 5, deductibleApplies: false, specialty: false, preferred: { type: "copay" as const, amount: 1, max: null }, standard: null };
    const [r] = partdCopayRows(match, [{ ...plan(615, true), tierCosts: [otherTier] }], rows);
    expect(r).toMatchObject({ cost: "Not stated in CMS's cost file", deductibleFirst: "unknown", sort: { rank: 2 } });
    // No cost rows at all means the file was not loaded, not that it states nothing.
    expect(partdCopayRows(match, [{ ...plan(615, true), tierCosts: [] }], rows)[0].cost).toBe("Not loaded yet");
  });
  it("shows coinsurance with its maximum when the file gives one", () => {
    const p = { ...plan(615, true), tierCosts: [{ tier: 3, deductibleApplies: false, specialty: true, preferred: { type: "coinsurance" as const, amount: 0.25, max: 150 }, standard: null }] };
    expect(partdCopayRows(match, [p], rows)[0]).toMatchObject({ tier: "Tier 3 (specialty)", cost: "25% coinsurance, up to $150.00", sort: { rank: 1, amount: 0.25 } });
  });
});

describe("sorting", () => {
  const row = (plan: string, rank: 0 | 1 | 2, amount: number, deductibleFirst: CopayRow["deductibleFirst"]): CopayRow => ({ group: "exchange", insurer: "X", plan, planId: plan, tier: "T", cost: "", supply: "", deductibleFirst, deductibleNote: null, restrictions: "", other: [], sort: { rank, amount } });
  it("puts flat copays lowest first, no-deductible ties first, then coinsurance, then no stated amount", () => {
    const sorted = sortCopays([row("none", 2, 0, "unknown"), row("coins", 1, 0.2, "no"), row("$0 after deductible", 0, 0, "yes"), row("$10", 0, 10, "no"), row("$0", 0, 0, "no")]);
    expect(sorted.map((r) => r.plan)).toEqual(["$0", "$0 after deductible", "$10", "coins", "none"]);
  });
});

describe("insulin", () => {
  const rows = [{ formularyId: "F1", rxcui: "1", tier: 3, priorAuth: false, stepTherapy: false, quantityLimit: false }];
  const plan = (insulinCosts: { tier: number | null; preferred: { copay: number | null; coinsurance: number | null } | null; standard: { copay: number | null; coinsurance: number | null } | null }[]) => ({
    planKey: "S1|001|000",
    planName: "Test PDP",
    planType: "PDP",
    formularyId: "F1",
    deductible: 615,
    tierCosts: [{ tier: 3, deductibleApplies: true, specialty: false, preferred: { type: "copay" as const, amount: 47, max: null }, standard: null }],
    insulinCosts,
  });
  it("shows a plan's plain insulin copay at or under Medicare's $35 cap, with no deductible", () => {
    expect(partdCopayRows(match, [plan([{ tier: 3, preferred: { copay: 10, coinsurance: null }, standard: null }])], rows, "all")[0]).toMatchObject({ cost: "$10.00 copay", supply: "one-month, preferred retail (insulin)", deductibleFirst: "no", other: ["CMS's insulin cost file lists $10.00 copay"], sort: { rank: 0, amount: 10 } });
  });
  it("shows the $35 cap when the file lists a copay and a coinsurance, only a coinsurance, or nothing", () => {
    const cap = "At most $35.00 per one-month supply (Medicare cap)";
    expect(partdCopayRows(match, [plan([{ tier: 3, preferred: { copay: 35, coinsurance: 0.25 }, standard: null }])], rows, "all")[0]).toMatchObject({ cost: cap, other: ["CMS's insulin cost file lists $35.00 copay and 25% coinsurance"], sort: { rank: 0, amount: 35 } });
    // Defined standard plans list no tier.
    expect(partdCopayRows(match, [plan([{ tier: null, preferred: null, standard: { copay: null, coinsurance: 0.25 } }])], rows, "all")[0]).toMatchObject({ cost: cap, supply: "one-month, standard retail (insulin)" });
    expect(partdCopayRows(match, [plan([])], rows, "all")[0]).toMatchObject({ cost: cap, other: [] });
  });
  it("does not guess for an insulin combined with other drugs", () => {
    expect(partdCopayRows(match, [plan([{ tier: 3, preferred: { copay: 35, coinsurance: null }, standard: null }])], rows, "some")[0]).toMatchObject({ sort: { rank: 2 } });
  });
  it("shows the plan's own tier copay on exchange rows when it is a plain copay under the cap", () => {
    const [r] = exchangeCopayRows("Ambetter", [{ planId: "P1", name: "Test", costDetails: { GENERIC: [entry({ copayAmount: 15, copayOpt: "BEFORE-DEDUCTIBLE" })] } }], [{ planId: "P1", tier: "GENERIC", pa: false, st: false, ql: false }], "all");
    expect(r).toMatchObject({ cost: "$15.00 copay", deductibleFirst: "no", sort: { rank: 0, amount: 15 } });
  });
  it("notes the HSA condition of RCW 48.43.780(1)(b) on HSA-qualified plans", () => {
    const [r] = exchangeCopayRows("Regence/BridgeSpan", [{ planId: "P1", name: "Regence Cascade Bronze HSA 7000", costDetails: { "PREFERRED-BRAND": [entry({ coinsuranceRate: 0.4, coinsuranceOpt: "AFTER-DEDUCTIBLE" })] } }], [{ planId: "P1", tier: "PREFERRED-BRAND", pa: false, st: false, ql: false }], "all");
    expect(r.cost).toBe("At most $35.00 per 30-day supply (Washington law)");
    expect(r.other.join()).toContain("RCW 48.43.780(1)(b)");
  });
  it("applies Washington's $35 cap on exchange rows and keeps the plan's general rule as another option", () => {
    const [r] = exchangeCopayRows("Ambetter", [{ planId: "P1", name: "Test", costDetails: { "PREFERRED-BRAND": [entry({ copayAmount: 50, copayOpt: "AFTER-DEDUCTIBLE" })] } }], [{ planId: "P1", tier: "PREFERRED-BRAND", pa: false, st: false, ql: false }], "all");
    expect(r).toMatchObject({ cost: "At most $35.00 per 30-day supply (Washington law)", deductibleFirst: "no", other: ["Plan's general rule for this tier: $50.00 copay after deductible"], sort: { rank: 0, amount: 35 } });
  });
  it("recognizes insulin from RxNorm ingredients", async () => {
    const { insulinKind } = await import("@/lib/wa-coverage");
    const m = (ingredients: string[][]) => ({ matchedName: "x", rxcuis: [], ndcs: [], products: ingredients.map((i, n) => ({ rxcui: String(n), name: "x", ingredients: i })) });
    expect(insulinKind(m([["insulin glargine"], ["insulin lispro"]]))).toBe("all");
    expect(insulinKind(m([["insulin glargine", "lixisenatide"]]))).toBe("some");
    expect(insulinKind(m([["semaglutide"]]))).toBe("none");
  });
});
describe("missing data", () => {
  it("says not loaded yet, not that the file has no rule, before an insurer's cost details arrive", () => {
    const [r] = exchangeCopayRows("Regence/BridgeSpan", [{ planId: "P1", name: "Test", costDetails: {} }], [{ planId: "P1", tier: "GENERIC", pa: false, st: false, ql: false }]);
    expect(r.cost).toBe("Not loaded yet");
  });
  it("never compares a 3-month fill with one-month amounts", () => {
    const [r] = exchangeCopayRows("Ambetter", [{ planId: "P1", name: "Test", costDetails: { GENERIC: [entry({ pharmacyType: "3-MONTH-IN-RETAIL", copayAmount: 30 })] } }], [{ planId: "P1", tier: "GENERIC", pa: false, st: false, ql: false }]);
    expect(r).toMatchObject({ cost: "No one-month retail amount in the plan's file", other: ["3-month retail: $30.00 copay"], sort: { rank: 2 } });
  });
});
