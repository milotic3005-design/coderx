import { describe, expect, it } from "vitest";
import { CODE_FAMILIES, familyOf, isCdtLike, isCodeActive, isCptLike, isDrugCode, normalizeHcpcs, normalizeHcpcsPrefix } from "@/lib/hcpcs";
import { displayCase, escapeLike, indexTokens, normalizeText, slugify } from "@/lib/text";
import { todayUs } from "@/lib/dates";

describe("HCPCS helpers", () => {
  it("normalizes case and validates Level II codes", () => {
    expect(normalizeHcpcs("j9271")).toBe("J9271");
    expect(normalizeHcpcs(" Q5115 ")).toBe("Q5115");
    expect(normalizeHcpcs("96413")).toBeNull();
    expect(normalizeHcpcs("D0120")).toBeNull(); // CDT (ADA) excluded
    expect(normalizeHcpcs("J92")).toBeNull();
    expect(normalizeHcpcsPrefix("j92")).toBe("J92");
  });
  it("recognizes CPT and CDT shapes", () => {
    expect(isCptLike("96413")).toBe(true);
    expect(isCptLike("0042T")).toBe(true);
    expect(isCptLike("J9271")).toBe(false);
    expect(isCdtLike("d1110")).toBe(true);
  });
  it("labels every drug-relevant family, and S-codes as non-Medicare", () => {
    for (const l of ["J", "Q", "C", "A", "P", "S"]) expect(CODE_FAMILIES[l].drugRelevant).toBe(true);
    expect(familyOf("S0189")?.medicare).toBe("non-medicare");
    expect(familyOf("S0189")?.context).toMatch(/not payable by Medicare/);
  });
  it("decides drug relevance only from official fields", () => {
    expect(isDrugCode({ pricingIndicators: ["51"] })).toBe(true);
    expect(isDrugCode({ pricingIndicators: ["00"], betos: "O1E" })).toBe(true);
    expect(isDrugCode({ pricingIndicators: ["00"], inCmsDrugFile: true })).toBe(true);
    expect(isDrugCode({ pricingIndicators: ["31"], betos: "D1A" })).toBe(false);
  });
  it("treats a code as active through its termination date", () => {
    expect(isCodeActive(null, "2026-10-14")).toBe(true);
    expect(isCodeActive("2026-12-31", "2026-10-14")).toBe(true);
    expect(isCodeActive("2025-12-31", "2026-10-14")).toBe(false);
  });
});

describe("text normalization", () => {
  it("normalizes punctuation, accents, and trademarks", () => {
    expect(normalizeText("Truxima® (rituximab-abbs)")).toBe("truxima rituximab abbs");
    expect(normalizeText("Crème")).toBe("creme");
  });
  it("skips words after negations when indexing", () => {
    expect(indexTokens("Injection, infliximab, excludes biosimilar, 10 mg")).toEqual(["infliximab"]);
    expect(indexTokens("Injection, infliximab-dyyb, biosimilar, (inflectra), 10 mg")).toEqual(["infliximab", "dyyb", "biosimilar", "inflectra"]);
  });
  it("slugifies and escapes LIKE patterns", () => {
    expect(slugify("Keytruda pembrolizumab")).toBe("keytruda-pembrolizumab");
    expect(escapeLike("50%_off")).toBe("50\\%\\_off");
    expect(displayCase("KEYTRUDA")).toBe("Keytruda");
    expect(displayCase("pH")).toBe("pH");
  });
});

describe("today for active checks", () => {
  it("uses the U.S. Eastern calendar date, not UTC", () => {
    // 10 PM Eastern on Dec 31 is already Jan 1 in UTC; a code terminated Dec 31 is still active.
    const lateEvening = new Date("2027-01-01T03:00:00Z");
    expect(todayUs(lateEvening)).toBe("2026-12-31");
    expect(isCodeActive("2026-12-31", todayUs(lateEvening))).toBe(true);
    expect(todayUs(new Date("2026-07-04T16:00:00Z"))).toBe("2026-07-04");
  });
});
