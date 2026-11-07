import { describe, expect, it } from "vitest";
import { compareDollars, convertUnitCost, UNIT_COST_CONFIRMED_FORMS, type CostRow } from "@/lib/part-b-d-dollars";
import { decideBenefit, type BenefitFacts } from "@/lib/part-b-d";
import { programNet } from "@/lib/site-of-care";

const FORM = "INJECTION";
const forms = new Set([FORM]);
const cost = (over: Partial<CostRow> = {}): CostRow => ({ unitCostMedian: 10, packageSize: 5, billUnitsPerItem: 50, dosageForm: FORM, ...over });

const facts = (over: Partial<BenefitFacts> = {}): BenefitFacts => ({ code: "J0897", isActive: true, isNoc: false, routes: ["SUBCUTANEOUS"], productType: null, sad: { status: "not_listed", products: [], contractorsListing: 0, contractorsTotal: 8, displayId: "A53033" }, dmePolicies: [], notPayable: false, oppsLoaded: true, oppsStatus: "K", ...over });
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
  it("does not blend products that cost different amounts per unit", () => {
    const prolia = cost({ unitCostMedian: 1847.79, packageSize: 1, billUnitsPerItem: 60 });
    const xgeva = cost({ unitCostMedian: 1228, packageSize: 1.7, billUnitsPerItem: 120 });
    expect(convertUnitCost([prolia, xgeva], 29.856, forms).perHcpcsUnit).toBeNull();
    expect(convertUnitCost([prolia, xgeva], 29.856, forms).raw).not.toBeNull();
  });
  it("keeps products within 1.5 times of each other", () => {
    expect(convertUnitCost([cost({ unitCostMedian: 8 }), cost({ unitCostMedian: 11 })], 1, forms).perHcpcsUnit).toBeCloseTo(0.95, 5);
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
  it("does not call a rounding-sized gap higher", () => {
    const r = compareDollars({ ...base, opps: { paymentRate: 54.563, copayPerUnit: 10.92 }, paymentLimit: 54.563, results: results(facts({ dmePolicies: ["pump"] })), units: 100 });
    expect(r.lawfulCount).toBeGreaterThanOrEqual(2);
    expect(r.higher).toBeNull();
  });
  it("never ranks Part D for a pump drug, which Part B would pay", () => {
    const r = compareDollars({ ...base, results: results(facts({ dmePolicies: ["pump"] })), contractRate: 70 });
    expect(key(r, "home_d").lawful).toBe(false);
    expect(key(r, "home_d").expectedPerDose).toBeNull();
    expect(r.higher).not.toBe("home_d");
  });
  it("says only one pathway is lawful only when nothing else is open", () => {
    const listed = facts({ sad: { status: "listed", products: ["Enbrel®"], contractorsListing: 8, contractorsTotal: 8, displayId: "A53033" } });
    expect(compareDollars({ ...base, results: results(listed) }).onlyOneLawful).toBe(true);
    expect(compareDollars({ ...base, results: results(facts({ oppsStatus: "E1" })) }).onlyOneLawful).toBe(false);
    expect(compareDollars({ ...base, results: results(facts({ oppsStatus: "N" })) }).onlyOneLawful).toBe(false);
    expect(compareDollars({ ...base, results: results(facts({ isActive: false })) }).onlyOneLawful).toBe(false);
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
  it("says which pathways apply to the case, even with no rate", () => {
    const r = compareDollars({ ...base, partDPerHcpcsUnit: null });
    expect(key(r, "hopd_b").lawful).toBe(true);
    expect(key(r, "home_d").lawful).toBe(true);
    expect(key(r, "home_d").source).toBeNull();
    expect(key(r, "home_b_dme").lawful).toBe(false);
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
  it.each([0, -5, Number.NaN, 1e9])("a bad contract rate %s hides the Part D dollars and says so", (contractRate) => {
    const r = compareDollars({ ...base, contractRate });
    expect(r.contractRateRejected).toBe(true);
    expect(key(r, "home_d").expectedPerDose).toBeNull();
    expect(key(r, "home_d").lawful).toBe(true);
    expect(r.higher).toBeNull();
  });
  it("a blank contract rate uses the benchmark", () => {
    const r = compareDollars({ ...base, contractRate: null });
    expect(r.contractRateRejected).toBe(false);
    expect(key(r, "home_d").source).toBe("cms");
  });
  it("uses the file's coinsurance percentage for home Part B", () => {
    const pump = results(facts({ dmePolicies: ["pump"] }));
    expect(key(compareDollars({ ...base, results: pump, partBCoinsurancePct: 15 }), "home_b_dme").expectedPerDose).toBeCloseTo(programNet(1800, 270, 2), 2);
  });
  it("prices a home clotting factor at the Part B limit", () => {
    const clotting = decideBenefit(facts(), { route: null, answers: { clottingFactor: true }, dmeposEnrolled: false });
    const r = compareDollars({ ...base, results: clotting });
    expect(key(r, "home_b_dme").expectedPerDose).toBeCloseTo(programNet(1800, 360, 2), 2);
  });
  it("gives an ESRD drug no per-unit dollars, and leaves the case open", () => {
    const esrd = decideBenefit(facts({ sad: { status: "listed", products: [], contractorsListing: 1, contractorsTotal: 8, displayId: "A53033" } }), { route: null, answers: { dialysisEsa: true }, dmeposEnrolled: false });
    const r = compareDollars({ ...base, results: esrd });
    expect(key(r, "home_b_dme").expectedPerDose).toBeNull();
    expect(r.onlyOneLawful).toBe(false);
  });
});
