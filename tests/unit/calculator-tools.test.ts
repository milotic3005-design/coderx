import { describe, expect, it } from "vitest";
import { buildClaimLines, claimLineText, ndcSegment } from "@/lib/claims";
import { mueStatus } from "@/lib/mue";
import { readPackageDescription } from "@/lib/package-label";
import { leastWastePlan, roundingCandidates, singleSizePlans } from "@/lib/vials";

describe("FDA package description facts (real descriptions from the fixture excerpt)", () => {
  it("reads volume, count, and single-dose wording", () => {
    expect(readPackageDescription("1 VIAL, SINGLE-USE in 1 CARTON (0069-0238-01)  / 10 mL in 1 VIAL, SINGLE-USE")).toEqual({
      mlPerItem: 10,
      itemsPerPackage: 1,
      itemType: "VIAL, SINGLE-USE",
      containerType: "single-dose",
      isPowder: false,
    });
  });
  it("leaves the container type unknown when the text does not state it", () => {
    const f = readPackageDescription("2 VIAL in 1 CARTON (0006-3026-04)  / 4 mL in 1 VIAL (0006-3026-01) ");
    expect(f).toMatchObject({ mlPerItem: 4, itemsPerPackage: 2, containerType: null });
  });
  it("recognizes multi-dose containers and powders", () => {
    expect(readPackageDescription("1 VIAL, MULTI-DOSE in 1 BAG (0404-9842-10)  / 10 mL in 1 VIAL, MULTI-DOSE").containerType).toBe("multi-dose");
    const powder = readPackageDescription("1 VIAL in 1 CARTON (0023-1145-01)  / 1 INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION in 1 VIAL");
    expect(powder).toMatchObject({ isPowder: true, mlPerItem: null });
  });
  it("does not read volumes out of kits", () => {
    expect(readPackageDescription("1 KIT in 1 CARTON (0074-0554-01)  / 1 KIT in 1 KIT *  1 SYRINGE in 1 TRAY / .4 mL in 1 SYRINGE *  1 mL in 1 PACKET").mlPerItem).toBeNull();
  });
});

describe("vial optimizer", () => {
  it("finds the least-waste mix, preferring fewer containers on ties", () => {
    expect(leastWastePlan(1250.5, [{ amount: 100 }, { amount: 500 }])).toMatchObject({
      counts: [
        { amount: 500, count: 2 },
        { amount: 100, count: 3 },
      ],
      total: 1300,
      waste: 49.5,
      vials: 5,
    });
    expect(leastWastePlan(450, [{ amount: 100 }, { amount: 500 }])).toMatchObject({ counts: [{ amount: 500, count: 1 }], total: 500, vials: 1 });
  });
  it("handles decimal sizes and a dose that fits exactly", () => {
    expect(leastWastePlan(2.4, [{ amount: 0.8 }, { amount: 2 }])).toMatchObject({ total: 2.4, waste: 0, vials: 3 });
  });
  it("compares single-size plans", () => {
    expect(singleSizePlans(1250.5, [{ amount: 100 }, { amount: 500 }]).map((p) => `${p.vials}x${p.counts[0].amount}=${p.total}`)).toEqual(["3x500=1500", "13x100=1300"]);
  });
  it("offers whole-container doses within the threshold only", () => {
    const r = roundingCandidates(1250.5, [{ amount: 100 }, { amount: 500 }], 10);
    expect(r.down).toMatchObject({ dose: 1200, changePct: -4 });
    expect(r.up).toMatchObject({ dose: 1300, changePct: 4 });
    expect(r.down?.plan.waste).toBe(0);
    expect(roundingCandidates(375, [{ amount: 100 }], 5)).toEqual({ down: null, up: null });
    expect(roundingCandidates(375, [{ amount: 100 }], 10).up).toMatchObject({ dose: 400, changePct: 6.7 });
  });
  it("returns nothing for invalid input", () => {
    expect(leastWastePlan(0, [{ amount: 100 }])).toBeNull();
    expect(leastWastePlan(100, [])).toBeNull();
  });
});

describe("claim lines", () => {
  const base = { hcpcsCode: "J9312", dose: 375, containerType: "single-dose" as const, ndc11: "50242-0051-21", qualifier: "ML" as const, containerAmount: 100, mlPerContainer: 10 };

  it("splits administered and discarded units with JW and proportional NDC milliliters", () => {
    const { lines } = buildClaimLines({ ...base, result: { administeredUnits: 38, discardedUnits: 2, discardedAmount: 25, containersOpened: 4 } });
    expect(lines).toEqual([
      { role: "administered", hcpcsCode: "J9312", modifier: null, units: 38, ndc11: "50242-0051-21", qualifier: "ML", ndcQuantity: 37.5 },
      { role: "discarded", hcpcsCode: "J9312", modifier: "JW", units: 2, ndc11: "50242-0051-21", qualifier: "ML", ndcQuantity: 2.5 },
    ]);
    expect(claimLineText(lines[1])).toMatch(/^J9312-JW +2 units +N450242005121ML2\.5 +discarded \(JW\)$/);
  });
  it("uses JZ when nothing is discarded from a single-dose container", () => {
    const { lines } = buildClaimLines({ ...base, dose: 400, result: { administeredUnits: 40, discardedUnits: 0, discardedAmount: 0, containersOpened: 4 } });
    expect(lines.map((l) => l.modifier)).toEqual(["JZ"]);
  });
  it("shows no discarded-drug modifier for multi-dose or unknown containers", () => {
    for (const containerType of ["multi-dose", "unknown"] as const) {
      const out = buildClaimLines({ ...base, containerType, result: { administeredUnits: 38, discardedUnits: 2, discardedAmount: 25, containersOpened: 4 } });
      expect(out.lines).toHaveLength(1);
      expect(out.lines[0].modifier).toBeNull();
      expect(out.notes.join(" ")).toMatch(/single-dose/);
    }
  });
  it("formats the N4 segment without hyphens", () => {
    expect(ndcSegment("50242-0051-21", "UN", 4)).toBe("N450242005121UN4");
    expect(ndcSegment("50242005121", "ML", 1 / 3)).toBe("N450242005121ML0.333");
  });
});

describe("MUE status", () => {
  it("treats 0 as not reportable and compares units otherwise", () => {
    expect(mueStatus(38, 150)).toBe("within");
    expect(mueStatus(151, 150)).toBe("exceeds");
    expect(mueStatus(1, 0)).toBe("not-reportable");
  });
});

describe("margin analyzer arithmetic", () => {
  it("nets sequestration from Medicare's share only and keeps the patient coinsurance", async () => {
    const { medicareMargin } = await import("@/lib/margin");
    // 10 billable units × $72.094: allowed $720.94; patient 20% = $144.188; program 80% × 98% = $565.217; expected $709.405
    const m = medicareMargin({ paymentLimit: 72.094, units: 10, coinsurancePct: 20, cost: 650 });
    expect(m).toMatchObject({ allowed: 720.94, patientShare: 144.19, programShare: 565.22, expected: 709.4, margin: 59.4, status: "positive" });
    expect(m.marginPct).toBe(8.4);
  });
  it("uses the CMS coinsurance percentage and flags underwater drugs", async () => {
    const { medicareMargin } = await import("@/lib/margin");
    const m = medicareMargin({ paymentLimit: 100, units: 1, coinsurancePct: 15, cost: 105 }, { sequestrationPct: 2, includeCoinsurance: false });
    expect(m.expected).toBe(83.3);
    expect(m.status).toBe("underwater");
  });
});
