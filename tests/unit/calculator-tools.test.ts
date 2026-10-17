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
  // CMS JW/JZ FAQs 16 and 18: a claim line holds at most 9,999 billing units.
  it("splits large doses across lines with JZ, keeping a no-modifier line to pair with JW", () => {
    const big = { ...base, qualifier: null, ndc11: null };
    const faq16 = buildClaimLines({ ...big, dose: 49_000, result: { administeredUnits: 49_000, discardedUnits: 1_000, discardedAmount: 1_000, containersOpened: 1 } });
    expect(faq16.lines.map((l) => [l.units, l.modifier])).toEqual([[9999, "JZ"], [9999, "JZ"], [9999, "JZ"], [9999, "JZ"], [9004, null], [1000, "JW"]]);
    const faq18 = buildClaimLines({ ...big, dose: 22_000, result: { administeredUnits: 22_000, discardedUnits: 0, discardedAmount: 0, containersOpened: 1 } });
    expect(faq18.lines.map((l) => [l.units, l.modifier])).toEqual([[9999, "JZ"], [9999, "JZ"], [2002, "JZ"]]);
    expect(faq18.notes.join(" ")).toMatch(/9,999/);
    const exact = buildClaimLines({ ...big, dose: 19_998, result: { administeredUnits: 19_998, discardedUnits: 2, discardedAmount: 2, containersOpened: 1 } });
    expect(exact.lines.map((l) => [l.units, l.modifier])).toEqual([[9999, "JZ"], [9999, null], [2, "JW"]]);
    const multi = buildClaimLines({ ...big, containerType: "multi-dose", dose: 12_000, result: { administeredUnits: 12_000, discardedUnits: null, discardedAmount: null, containersOpened: 1 } });
    expect(multi.lines.map((l) => [l.units, l.modifier])).toEqual([[9999, null], [2001, null]]);
  });
  it("divides NDC milliliters across split lines so they still add up", () => {
    const { lines } = buildClaimLines({ ...base, dose: 15_000, containerAmount: 1_000, mlPerContainer: 10, result: { administeredUnits: 15_000, discardedUnits: 0, discardedAmount: 0, containersOpened: 15 } });
    expect(lines.map((l) => l.ndcQuantity)).toEqual([99.99, 50.01]);
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

describe("vial barcode parsing (GS1 / UPC / NDC)", () => {
  // NDC 50242-051-21 is the 10-digit (5-3-2) form of Rituxan 100 mg/10 mL, 11-digit 50242-0051-21.
  const ndc10 = "5024205121";
  const withCheck = (body: string) => {
    const digits = body.split("").map(Number).reverse();
    const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
    return `${body}${(10 - (sum % 10)) % 10}`;
  };
  const gtin = withCheck(`003${ndc10}`);

  it("reads GTIN, expiry, lot, and serial from a GS1 DataMatrix string", async () => {
    const { parseScan } = await import("@/lib/gs1");
    const p = parseScan(`]d201${gtin}17271231` + `10LOT123\u001d21SER9`);
    expect(p).toMatchObject({ kind: "gs1", gtin, ndc10, expiry: "2027-12-31", lot: "LOT123", serial: "SER9", problems: [] });
    expect(p.candidates).toEqual(["05024205121", "50242005121", "50242051201"]);
  });
  it("reads the human-readable form and end-of-month expiry", async () => {
    const { parseScan } = await import("@/lib/gs1");
    expect(parseScan(`(01)${gtin}(17)270200(10)A1`)).toMatchObject({ expiry: "2027-02-28", lot: "A1" });
  });
  it("reads UPC-A and plain NDCs, and flags a bad check digit", async () => {
    const { parseScan } = await import("@/lib/gs1");
    const upc = withCheck(`3${ndc10}`);
    expect(parseScan(upc)).toMatchObject({ kind: "upc", ndc10, problems: [] });
    expect(parseScan("50242-0051-21")).toMatchObject({ kind: "ndc", candidates: ["50242005121"] });
    const bad = `${gtin.slice(0, 13)}${(Number(gtin[13]) + 1) % 10}`;
    expect(parseScan(`01${bad}`).problems[0]).toMatch(/check digit/);
    expect(parseScan("hello").kind).toBe("unknown");
  });
});

describe("biosimilar switch simulator", () => {
  it("compares all-reference volume with a partial switch", async () => {
    const { simulateSwitch } = await import("@/lib/biosimilar-switch");
    // Rituxan J9312 $72.094 / 10 mg vs Truxima Q5115 $35.988 / 10 mg, 70,000 mg a year, half switched.
    const r = simulateSwitch({
      annualMg: 70_000,
      reference: { name: "Rituxan", perMg: 7.2094, coinsurancePct: 20 },
      target: { name: "Truxima", perMg: 3.5988, coinsurancePct: 20 },
      sharePct: 50,
    });
    expect(r.before).toMatchObject({ mg: 70_000, allowed: 504_658, patient: 100_931.6, cost: null, margin: null });
    expect(r.after.allowed).toBe(378_287);
    expect(r.delta.allowed).toBe(-126_371);
    expect(r.delta.patient).toBe(-25_274.2);
  });
  it("adds costs and margin only when every switched product has a cost", async () => {
    const { simulateSwitch } = await import("@/lib/biosimilar-switch");
    const base = { annualMg: 1000, reference: { name: "R", perMg: 10, coinsurancePct: 20, costPerMg: 9 }, sharePct: 100 };
    expect(simulateSwitch({ ...base, target: { name: "B", perMg: 6, coinsurancePct: 20 } }).after.margin).toBeNull();
    const withCost = simulateSwitch({ ...base, target: { name: "B", perMg: 6, coinsurancePct: 20, costPerMg: 4 } });
    // after: allowed 6,000; expected 6,000 × 0.2 + 6,000 × 0.8 × 0.98 = 5,904; cost 4,000
    expect(withCost.after).toMatchObject({ allowed: 6000, expected: 5904, cost: 4000, margin: 1904 });
    expect(withCost.delta.margin).toBe(1904 - (9840 - 9000));
  });
});

describe("chair capacity planner", () => {
  const input = {
    chairs: 10,
    openMinutes: 600,
    turnoverMinutes: 15,
    targetPct: 85,
    visits: [
      { name: "Short", chairMinutes: 45, perDay: 40 },
      { name: "Long", chairMinutes: 285, perDay: 8 },
    ],
  };
  it("computes utilization, chairs needed, and headroom", async () => {
    const { planCapacity } = await import("@/lib/capacity");
    const r = planCapacity(input);
    // demand: 40 × 60 + 8 × 300 = 4,800 of 6,000 chair-minutes
    expect(r).toMatchObject({ availableMinutes: 6000, demandMinutes: 4800, utilizationPct: 80, chairsNeeded: 10, tooLong: [] });
    // target 85% of 6,000 = 5,100; 300 spare minutes ÷ 100-minute average slot = 3 visits
    expect(r.headroomVisits).toBe(3);
    expect(r.byType.map((t) => t.sharePct)).toEqual([50, 50]);
  });
  it("packs the day and reports visits that do not fit", async () => {
    const { packChairs } = await import("@/lib/capacity");
    const ok = packChairs(input);
    expect(ok.overflow).toEqual([]);
    expect(ok.chairs.every((c) => c.minutes - input.turnoverMinutes <= input.openMinutes)).toBe(true);
    const tight = packChairs({ ...input, chairs: 4 });
    expect(tight.overflow.reduce((n, o) => n + o.count, 0)).toBeGreaterThan(0);
  });
});

describe("vial barcode parsing: decoder output", () => {
  it("ignores the leading FNC1 that DataMatrix decoders return as GS", async () => {
    const { parseScan } = await import("@/lib/gs1");
    expect(parseScan("\u001d0100350242051217172712311" + "0LOTA1")).toMatchObject({ kind: "gs1", gtin: "00350242051217", lot: "LOTA1", expiry: "2027-12-31" });
  });
});
