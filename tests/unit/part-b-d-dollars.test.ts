import { describe, expect, it } from "vitest";
import { compareDollars, convertUnitCost, UNIT_COST_CONFIRMED_FORMS, type CostRow } from "@/lib/part-b-d-dollars";
import { decideBenefit, type BenefitFacts } from "@/lib/part-b-d";
import { programNet } from "@/lib/site-of-care";

const FORM = "INJECTION";
const forms = new Set([FORM]);
const cost = (over: Partial<CostRow> = {}): CostRow => ({ unitCostMedian: 10, packageSize: 5, billUnitsPerItem: 50, dosageForm: FORM, ...over });

const facts = (over: Partial<BenefitFacts> = {}): BenefitFacts => ({ code: "J0897", isActive: true, isNoc: false, routes: ["SUBCUTANEOUS"], productType: null, sad: { status: "not_listed", products: [], contractorsListing: 0, contractorsTotal: 8, displayId: "A53033" }, dmePolicies: [], notPayable: false, oppsStatus: "K", ...over });
const results = (f = facts()) => decideBenefit(f, { route: null, answers: {}, dmeposEnrolled: false });
const base = { results: results(), units: 60, dosesPerMonth: 1, opps: { paymentRate: 30, copayPerUnit: 6 }, paymentLimit: 30, inpatientDeductible: 1736, partDPerHcpcsUnit: 28, rawPartD: 1680, contractRate: null };

describe("Part D unit cost conversion", () => {
  it("converts with the crosswalk", () => {
    expect(convertUnitCost([cost()], 1, forms)).toEqual({ perHcpcsUnit: 1, raw: 10 });
  });
  it("converts Prolia as the CMS crosswalk describes it", () => {
    const r = convertUnitCost([cost({ unitCostMedian: 1847.7879, packageSize: 1, billUnitsPerItem: 60 })], 30.8, forms);
    expect(r.perHcpcsUnit).toBeCloseTo(30.7965, 3);
  });
  it("rejects a value outside the band", () => {
    expect(convertUnitCost([cost({ packageSize: 5, billUnitsPerItem: 5 })], 1, forms)).toEqual({ perHcpcsUnit: null, raw: 10 });
    expect(convertUnitCost([cost({ unitCostMedian: 0.3, packageSize: 1, billUnitsPerItem: 2 })], 1.183, forms).perHcpcsUnit).toBeNull();
  });
  it("needs crosswalk values", () => {
    expect(convertUnitCost([cost({ packageSize: null })], 1, forms).perHcpcsUnit).toBeNull();
    expect(convertUnitCost([cost({ billUnitsPerItem: 0 })], 1, forms).perHcpcsUnit).toBeNull();
  });
  it("needs a payment limit to check against", () => {
    expect(convertUnitCost([cost()], null, forms).perHcpcsUnit).toBeNull();
  });
  it("leaves a form outside the confirmed set unconverted but keeps the raw cost", () => {
    expect(convertUnitCost([cost({ dosageForm: "GRANULE" })], 1, forms)).toEqual({ perHcpcsUnit: null, raw: 10 });
  });
  it("takes the median across several NDCs", () => {
    const rows = [cost({ unitCostMedian: 9 }), cost({ unitCostMedian: 10 }), cost({ unitCostMedian: 11 })];
    expect(convertUnitCost(rows, 1, forms).perHcpcsUnit).toBe(1);
  });
  it("has no costs to convert", () => {
    expect(convertUnitCost([], 1, forms)).toEqual({ perHcpcsUnit: null, raw: null });
  });
  it("confirms the forms that the October 2026 sample supported", () => {
    expect(UNIT_COST_CONFIRMED_FORMS.has("INJECTION, SOLUTION")).toBe(true);
  });
});

describe("Sequestration", () => {
  it("matches site-of-care sequestration", () => {
    expect(programNet(100, 20, 2)).toBeCloseTo(98.4);
  });
});

describe("Comparing pathways", () => {
  const key = (r: ReturnType<typeof compareDollars>, k: string) => r.pathways.find((p) => p.key === k)!;

  it("ranks only when two pathways are lawful", () => {
    const r = compareDollars(base);
    expect(r.lawfulCount).toBe(2);
    expect(r.higher).toBe("hopd_b");
  });
  it("shows no ranking when only one pathway is lawful", () => {
    const sad = facts({ sad: { status: "listed", products: ["Enbrel®"], contractorsListing: 8, contractorsTotal: 8, displayId: "A53033" } });
    const r = compareDollars({ ...base, results: results(sad) });
    expect(r.higher).toBeNull();
    expect(r.lawfulCount).toBe(1);
    expect(key(r, "hopd_b").expectedPerDose).toBeNull();
  });
  it("nets HOPD with the copay and sequestration on Medicare's share only", () => {
    const r = compareDollars(base);
    const allowed = 30 * 60;
    const patient = 6 * 60;
    expect(key(r, "hopd_b").expectedPerDose).toBeCloseTo(programNet(allowed, patient, 2), 2);
  });
  it("caps the HOPD copay at the inpatient deductible", () => {
    const r = compareDollars({ ...base, inpatientDeductible: 100 });
    expect(key(r, "hopd_b").expectedPerDose).toBeCloseTo(programNet(30 * 60, 100, 2), 2);
  });
  it("uses a 20% patient share for home Part B", () => {
    const pump = results(facts({ dmePolicies: ["pump"] }));
    const r = compareDollars({ ...base, results: pump });
    expect(key(r, "home_b_dme").expectedPerDose).toBeCloseTo(programNet(1800, 360, 2), 2);
  });
  it("hides the Part D pathway when Part B would pay at home", () => {
    const r = compareDollars({ ...base, results: results(facts({ dmePolicies: ["nebulizer"] })) });
    expect(key(r, "home_d").expectedPerDose).toBeNull();
  });
  it("has no sequestration on Part D", () => {
    expect(key(compareDollars(base), "home_d").expectedPerDose).toBe(1680);
  });
  it("multiplies by doses per month", () => {
    expect(key(compareDollars({ ...base, dosesPerMonth: 2 }), "home_d").expectedPerMonth).toBe(3360);
  });
  it("contract rate overrides the benchmark", () => {
    const r = key(compareDollars({ ...base, contractRate: 40 }), "home_d");
    expect(r.source).toBe("you");
    expect(r.allowedPerUnit).toBe(40);
  });
  it("a contract rate allows the comparison when the benchmark did not convert", () => {
    const r = compareDollars({ ...base, partDPerHcpcsUnit: null, contractRate: 40 });
    expect(key(r, "home_d").expectedPerDose).toBe(2400);
    expect(r.higher).toBe("home_d");
  });
  it("keeps the raw cost when nothing converts", () => {
    const r = compareDollars({ ...base, partDPerHcpcsUnit: null });
    expect(key(r, "home_d").expectedPerDose).toBeNull();
    expect(r.rawPartD).toBe(1680);
    expect(r.higher).toBeNull();
  });
  it.each([null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e9])("bad units %s hide dollars", (units) => {
    const r = compareDollars({ ...base, units });
    expect(r.pathways.every((p) => p.expectedPerDose === null && p.expectedPerMonth === null)).toBe(true);
    expect(r.higher).toBeNull();
  });
  it.each([null, 0, -1, Number.NaN, 1e9])("bad doses %s hide the monthly figure", (dosesPerMonth) => {
    const r = compareDollars({ ...base, dosesPerMonth });
    expect(r.pathways.every((p) => p.expectedPerMonth === null)).toBe(true);
  });
  it.each([0, -5, Number.NaN, 1e9])("a bad contract rate %s falls back to the benchmark", (contractRate) => {
    const r = key(compareDollars({ ...base, contractRate }), "home_d");
    expect(r.source).toBe("cms");
    expect(r.allowedPerUnit).toBe(28);
  });
});
