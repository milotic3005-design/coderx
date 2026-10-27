import { describe, expect, it } from "vitest";
import { additionalHours, compareSites, wageFactor, type ApcRate, type SiteOfCareInput } from "@/lib/site-of-care";

// CY 2026 October Addendum A/B values.
const L4: ApcRate = { apc: "5694", title: "Level 4 Drug Administration", statusIndicator: "S", paymentRate: 337.46, copay: 67.5 };
const L2: ApcRate = { apc: "5692", title: "Level 2 Drug Administration", statusIndicator: "S", paymentRate: 73.56, copay: 14.72 };
const OFFSET = { ratio: 0.9951, statusIndicators: ["J1", "J2", "P", "Q1", "Q2", "Q3", "R", "S", "S1", "T", "U", "V"] };

function base(): SiteOfCareInput {
  return {
    drug: { code: "J9312", aspLimit: 72.094, aspCoinsurancePct: 20, opps: { statusIndicator: "K", paymentRate: 72.094, copayPerUnit: 14.42 } },
    unitsPerAdmin: 50,
    adminsPerMonth: 1,
    hopd: { apcLines: [{ apc: L4, count: 1 }, { apc: L2, count: 2 }], wageIndex: 1, applyRemedyOffset: true, remedyOffset: OFFSET },
    medicare: { homePartB: false, homeDmePerMonth: null, homePartDPerUnit: null },
    appleHealth: { hopdVisit: null, hopdDrugPerUnit: null, homeDrugPerUnit: null, homeDispensingFee: null, fillsPerMonth: 1, hcaItems: [], nursingPerVisit: null, nursingVisitsPerAdmin: 1 },
    commercial: { hopdDrug: null, hopdAdmin: null, homeDrug: null, perDiem: null, perDiemDaysPerMonth: 1, nursingPerVisit: null, nursingVisitsPerAdmin: 1, homeOtherPerMonth: null },
    cost: { hopdPerUnit: null, homePerUnit: null },
    sequestrationPct: 2,
  };
}
const by = (input: SiteOfCareInput) => Object.fromEntries(compareSites(input).map((c) => [c.payer, c]));

describe("site of care: Medicare HOPD", () => {
  it("pays a status K drug at the Addendum B rate and wage-adjusts administration APCs with the remedy offset", () => {
    const m = by(base()).medicare.hopd;
    expect(m.status).toBe("computed");
    const admin = (337.46 + 2 * 73.56) * 0.9951;
    expect(m.lines.map((l) => l.amount)).toEqual([3604.7, r2(337.46 * 0.9951), r2(2 * 73.56 * 0.9951)]);
    // Copays: drug $14.42 × 50; APCs at their published copays × 0.9951.
    const patient = 14.42 * 50 + (67.5 + 2 * 14.72) * 0.9951;
    expect(m.patientShare).toBe(r2(patient));
    expect(m.allowed).toBe(r2(3604.7 + admin));
    expect(m.expected).toBe(r2((3604.7 + admin - patient) * 0.98 + patient));
  });
  it("applies 60% of the rate to the wage index", () => {
    expect(wageFactor(1.2)).toBeCloseTo(1.12, 10);
    const i = base();
    i.hopd.wageIndex = 1.2;
    i.hopd.applyRemedyOffset = false;
    expect(by(i).medicare.hopd.lines[1].amount).toBe(r2(337.46 * 1.12));
  });
  it("pays nothing separately for a packaged (status N) drug", () => {
    const i = base();
    i.drug = { code: "J1100", aspLimit: 0.1, aspCoinsurancePct: 20, opps: { statusIndicator: "N", paymentRate: null, copayPerUnit: null } };
    const m = by(i).medicare.hopd;
    expect(m.lines[0]).toMatchObject({ amount: 0, formula: "No separate payment" });
    expect(m.notes.join(" ")).toMatch(/packages this drug/);
  });
  it("reports a missing Addendum B row instead of substituting the ASP limit", () => {
    const i = base();
    i.drug.opps = null;
    const m = by(i).medicare.hopd;
    expect(m.status).toBe("incomplete");
    expect(m.notes).toContain("No authoritative public data was located for this field.");
  });
});

describe("site of care: home infusion without HIT certification", () => {
  it("needs Part B coverage or a Part D amount for Medicare at home", () => {
    const home = by(base()).medicare.home;
    expect(home.status).toBe("incomplete");
    expect(home.notes[0]).toMatch(/not a Medicare home infusion therapy \(HIT\) supplier/i);
    const i = base();
    i.medicare.homePartB = true;
    const partB = by(i).medicare;
    expect(partB.home.lines[0]).toMatchObject({ amount: 3604.7, patientShare: 720.94, source: "cms_payment_limits" });
    expect(partB.better).toBe("hopd");
    expect(partB.difference).toBe(r2(partB.home.expected - partB.hopd.expected));
  });
  it("prices Apple Health supplies and pump rental from the HCA schedule by frequency", () => {
    const i = base();
    i.adminsPerMonth = 2;
    i.appleHealth.homeDrugPerUnit = 70;
    i.appleHealth.hcaItems = [
      { fee: { code: "A4222", modifier: null, label: "Infusion supplies", amount: 47.35, text: "47.35" }, quantity: 1, frequency: "admin" },
      { fee: { code: "E0781", modifier: "RR", label: "Ambulatory infusion pump", amount: 298.5, text: "298.5" }, quantity: 1, frequency: "month" },
      { fee: { code: "A4221", modifier: null, label: "Catheter supplies", amount: 24.96, text: "24.96" }, quantity: 1, frequency: "week" },
      { fee: { code: "A4223", modifier: null, label: "Supplies", amount: null, text: "BR*" }, quantity: 1, frequency: "admin" },
    ];
    const home = by(i).apple_health.home;
    expect(home.lines.map((l) => [l.source, l.amount])).toEqual([
      ["you", 7000],
      ["wa_hca_home_infusion", 94.7],
      ["wa_hca_home_infusion", 298.5],
      ["wa_hca_home_infusion", r2((24.96 * 52) / 12)],
    ]);
    expect(home.notes.join(" ")).toMatch(/A4223.*"BR\*"/);
    expect(by(i).apple_health.better).toBeNull(); // the HOPD EAPG payment was not entered
  });
});

describe("site of care: commercial contract terms", () => {
  it("prices percent-of-ASP and percent-of-Medicare terms and picks the better site", () => {
    const i = base();
    i.commercial = { hopdDrug: { kind: "pct_asp", pct: 150 }, hopdAdmin: { kind: "pct_medicare", pct: 200 }, homeDrug: { kind: "pct_asp", pct: 120 }, perDiem: 150, perDiemDaysPerMonth: 1, nursingPerVisit: 200, nursingVisitsPerAdmin: 1, homeOtherPerMonth: null };
    const c = by(i).commercial;
    expect(c.hopd.lines.map((l) => l.amount)).toEqual([r2(72.094 * 1.5 * 50), r2((337.46 + 2 * 73.56) * 0.9951 * 2)]);
    expect(c.home.expected).toBe(r2(72.094 * 1.2 * 50 + 150 + 200));
    expect(c.better).toBe("hopd");
  });
  it("adds margin only when an acquisition cost is entered", () => {
    const i = base();
    i.medicare.homePartB = true;
    i.cost = { hopdPerUnit: 60, homePerUnit: null };
    const m = by(i).medicare;
    expect(m.hopd.margin).toBe(r2(m.hopd.expected - 3000));
    expect(m.home.margin).toBeNull();
  });
});

describe("infusion time", () => {
  it("counts an additional hour once the extra time passes 30 minutes", () => {
    expect([60, 90, 91, 150, 151, 211].map(additionalHours)).toEqual([0, 0, 1, 1, 2, 3]);
  });
});

function r2(x: number) {
  return Math.round(x * 100) / 100;
}
