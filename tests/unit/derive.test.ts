import { describe, expect, it } from "vitest";
import { buildHcpcsHistory, deriveProductClass, manufacturerKey } from "@/ingest/derive";

describe("derive helpers", () => {
  it("merges labeler names only across punctuation, case, and legal suffixes", () => {
    expect(manufacturerKey("Merck Sharp & Dohme LLC")).toBe(manufacturerKey("Merck Sharp & Dohme Corp."));
    expect(manufacturerKey("Samsung Bioepis Co., Ltd.")).toBe("samsung bioepis");
    expect(manufacturerKey("Pfizer Laboratories Div Pfizer Inc")).not.toBe(manufacturerKey("Pfizer Inc"));
  });

  it("derives product class from FDA marketing category and Purple Book license type", () => {
    expect(deriveProductClass({ categories: ["BLA"], hasBrand: true, purpleBookTypes: ["351(k) Interchangeable"] })).toBe("interchangeable_biosimilar");
    expect(deriveProductClass({ categories: ["BLA"], hasBrand: true, purpleBookTypes: ["351(k) Biosimilar"] })).toBe("biosimilar");
    expect(deriveProductClass({ categories: ["BLA"], hasBrand: true, purpleBookTypes: ["351(a)"] })).toBe("biologic");
    expect(deriveProductClass({ categories: ["NDA"], hasBrand: true, purpleBookTypes: [] })).toBe("brand");
    expect(deriveProductClass({ categories: ["ANDA"], hasBrand: false, purpleBookTypes: [] })).toBe("generic");
    expect(deriveProductClass({ categories: ["UNAPPROVED DRUG OTHER"], hasBrand: false, purpleBookTypes: [] })).toBe("unapproved");
  });

  it("builds quarter-over-quarter history", () => {
    const base = {
      id: 1, sourceReleaseId: 1, shortDescription: "x", pricingIndicators: [], multiplePricingIndicator: null, coverageCode: null, betos: null,
      typeOfService: [], crossReferences: [], processingNote: null, addedDate: "2002-01-01", actionEffectiveDate: "2002-01-01", actionCode: "N", isNoc: false,
    };
    const snaps = new Map([
      ["S0189", [
        { ...base, code: "S0189", period: "2025-Q4", longDescription: "Testosterone pellet, 75 mg", terminationDate: null },
        { ...base, code: "S0189", period: "2026-Q1", longDescription: "Testosterone pellet, 75 mg", terminationDate: "2025-12-31" },
      ]],
      ["J9277", [{ ...base, code: "J9277", period: "2026-Q1", longDescription: "Injection, pembrolizumab, 1 mg and berahyaluronidase alfa-pmph, 1 unit", terminationDate: null }]],
      ["X0001", [{ ...base, code: "X0001", period: "2025-Q4", longDescription: "Dropped", terminationDate: null }]],
    ]);
    const h = buildHcpcsHistory(snaps as never, ["2025-Q4", "2026-Q1"]);
    const types = (code: string) => h.filter((r) => r.code === code).map((r) => `${r.period}:${r.changeType}`);
    expect(types("S0189")).toEqual(["2025-Q4:baseline", "2026-Q1:terminated"]);
    expect(types("J9277")).toEqual(["2026-Q1:added"]);
    expect(types("X0001")).toEqual(["2025-Q4:baseline", "2026-Q1:removed_from_file"]);
  });
});
