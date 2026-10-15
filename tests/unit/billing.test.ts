import { describe, expect, it } from "vitest";
import { calculateBillingUnits, ceilUnits, convert, parseCmsDosage, parseDescriptorDosage, resolveUnit, type CalculatorResult } from "@/lib/billing";

function ok(r: ReturnType<typeof calculateBillingUnits>): CalculatorResult {
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
}

describe("unit parsing and conversion", () => {
  it("parses CMS dosage descriptors", () => {
    expect(parseCmsDosage("10 MG")).toMatchObject({ amount: 10, unit: "mg" });
    expect(parseCmsDosage("0.5 ML")).toMatchObject({ amount: 0.5, unit: "ml" });
    expect(parseCmsDosage("150 IU")).toMatchObject({ amount: 150, unit: "iu" });
    expect(parseCmsDosage("1 EA")).toMatchObject({ amount: 1, unit: "each" });
    expect(parseCmsDosage("Per infusion (minimum 50 million cells)")).toBeNull();
    expect(parseCmsDosage("Less than or equal to 100 MG")).toBeNull();
  });
  it("derives a unit from HCPCS descriptors", () => {
    expect(parseDescriptorDosage("Injection, pembrolizumab, 1 mg")).toMatchObject({ amount: 1, unit: "mg" });
    expect(parseDescriptorDosage("Injection, rituximab, 10 mg")).toMatchObject({ amount: 10, unit: "mg" });
    expect(parseDescriptorDosage("Factor viii (antihemophilic factor, recombinant) per i.u., not otherwise specified")).toMatchObject({ amount: 1, unit: "iu" });
    expect(parseDescriptorDosage("Unclassified drugs")).toBeNull();
  });
  it("converts only within a dimension", () => {
    expect(convert(1, "g", "mg")).toBe(1000);
    expect(convert(500, "mcg", "mg")).toBe(0.5);
    expect(convert(1, "mg", "ml")).toBeNull();
    expect(convert(1, "unit", "iu")).toBeNull();
    expect(resolveUnit("µg")).toBe("mcg");
    expect(resolveUnit("CC")).toBe("ml");
  });
  it("ceilUnits ignores floating-point noise", () => {
    expect(ceilUnits(0.1 * 3 * 10)).toBe(3);
    expect(ceilUnits(37.5)).toBe(38);
  });
});

describe("calculateBillingUnits", () => {
  it("exact multiple: no rounding", () => {
    const r = ok(calculateBillingUnits({ dose: 200, doseUnit: "mg", billingUnitAmount: 1, billingUnitUnit: "mg", containerType: "single-dose" }));
    expect(r.administeredUnits).toBe(200);
    expect(r.roundedUp).toBe(false);
    expect(r.warnings).toHaveLength(0);
  });

  it("rounds a partial unit up and warns", () => {
    const r = ok(calculateBillingUnits({ dose: 375, doseUnit: "mg", billingUnitAmount: 10, billingUnitUnit: "mg", containerType: "single-dose" }));
    expect(r.rawUnits).toBe(37.5);
    expect(r.administeredUnits).toBe(38);
    expect(r.roundedUp).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/rounded up/);
  });

  it("MAC example: 7 mg given from a 10 mg unit with 3 mg discarded bills 1 unit and no discarded units", () => {
    const r = ok(calculateBillingUnits({ dose: 7, doseUnit: "mg", billingUnitAmount: 10, billingUnitUnit: "mg", discardedAmount: 3, containerType: "single-dose" }));
    expect(r.administeredUnits).toBe(1);
    expect(r.discardedUnits).toBe(0);
    expect(r.warnings.join(" ")).toMatch(/covered by the rounded-up administered units/);
  });

  it("2 mg given from a 40 mg single-dose vial at 10 mg/unit: 1 administered + 3 discarded units", () => {
    const r = ok(calculateBillingUnits({ dose: 2, doseUnit: "mg", billingUnitAmount: 10, billingUnitUnit: "mg", containerAmount: 40, containerUnit: "mg", containerType: "single-dose" }));
    expect(r.administeredUnits).toBe(1);
    expect(r.totalUnitsOpened).toBe(4);
    expect(r.discardedUnits).toBe(3);
    expect(r.discardedAmount).toBe(38);
    expect(r.utilizationPct).toBe(5);
  });

  it("computes containers, utilization, and leftover for multi-vial doses", () => {
    const r = ok(calculateBillingUnits({ dose: 375, doseUnit: "mg", billingUnitAmount: 10, billingUnitUnit: "mg", containerAmount: 100, containerUnit: "mg", containerType: "single-dose", paymentLimitPerUnit: 72.094 }));
    expect(r.containersOpened).toBe(4);
    expect(r.totalOpened).toBe(400);
    expect(r.discardedAmount).toBe(25);
    expect(r.utilizationPct).toBe(93.8);
    expect(r.discardedUnits).toBe(2);
    expect(r.estimatedAllowedAdministered).toBe(2739.57);
    expect(r.estimatedAllowedDiscarded).toBe(144.19);
  });

  it("does not compute discarded units for multi-dose containers", () => {
    const r = ok(calculateBillingUnits({ dose: 5, doseUnit: "mg", billingUnitAmount: 1, billingUnitUnit: "mg", containerAmount: 50, containerUnit: "mg", containerType: "multi-dose" }));
    expect(r.discardedUnits).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/Multi-dose/);
  });

  it("converts the dose to the billing-unit measure", () => {
    const r = ok(calculateBillingUnits({ dose: 1.5, doseUnit: "g", billingUnitAmount: 500, billingUnitUnit: "mg", containerType: "unknown" }));
    expect(r.administeredUnits).toBe(3);
    expect(r.steps[0].label).toMatch(/Convert/);
  });

  it("rejects incompatible units and bad input with field-level errors", () => {
    const incompatible = calculateBillingUnits({ dose: 5, doseUnit: "ml", billingUnitAmount: 1, billingUnitUnit: "mg", containerType: "unknown" });
    expect(incompatible.ok).toBe(false);
    const bad = calculateBillingUnits({ dose: -1, doseUnit: "mg", billingUnitAmount: 0, billingUnitUnit: "mg", containerType: "unknown", containersOpened: 1.5 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.map((e) => e.field).sort()).toEqual(["billingUnitAmount", "containersOpened", "dose"]);
  });

  it("warns when too few containers are entered", () => {
    const r = ok(calculateBillingUnits({ dose: 250, doseUnit: "mg", billingUnitAmount: 10, billingUnitUnit: "mg", containerAmount: 100, containerUnit: "mg", containersOpened: 2, containerType: "single-dose" }));
    expect(r.warnings.join(" ")).toMatch(/at least 3/);
  });
});
