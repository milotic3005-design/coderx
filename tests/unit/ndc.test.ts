import { describe, expect, it } from "vitest";
import { formatNdc11, formatProductNdc9, looksLikeNdc, parseNdc, toNdc11, toProductNdc9 } from "@/lib/ndc";

describe("parseNdc — hyphenated 10-digit layouts", () => {
  it.each([
    ["0006-3026-02", "00006302602", "4-4-2"], // Keytruda 100 mg/4 mL (FDA layout 4-4-2)
    ["50242-051-21", "50242005121", "5-3-2"], // Rituxan 100 mg/10 mL (FDA layout 5-3-2)
    ["12345-6789-1", "12345678901", "5-4-1"],
    ["00006-3026-02", "00006302602", "5-4-2"],
  ])("%s → %s (%s)", (input, ndc11, format) => {
    const p = parseNdc(input);
    expect(p).toMatchObject({ kind: "package", ndc11, format });
  });

  it("accepts spaces, unicode dashes, surrounding whitespace, and an N4 claim qualifier", () => {
    expect(toNdc11(" 0006 3026 02 ")).toBe("00006302602");
    expect(toNdc11("0006–3026–02")).toBe("00006302602");
    expect(toNdc11("N400006302602")).toBe("00006302602");
  });
});

describe("parseNdc — digits only", () => {
  it("11 digits is unambiguous", () => {
    expect(parseNdc("00006302602")).toMatchObject({ kind: "package", ndc11: "00006302602", format: "11-digit" });
  });

  it("10 digits is ambiguous and yields all three 11-digit candidates", () => {
    const p = parseNdc("0006302602");
    expect(p.kind).toBe("ambiguous");
    if (p.kind !== "ambiguous") return;
    expect(p.candidates.map((c) => c.ndc11)).toEqual(["00006302602", "00063002602", "00063026002"]);
    expect(p.candidates.map((c) => c.format)).toEqual(["4-4-2", "5-3-2", "5-4-1"]);
  });

  it("8 and 9 digits are product NDCs", () => {
    expect(parseNdc("000063026")).toMatchObject({ kind: "product", candidates: [{ productNdc9: "000063026" }] });
    const p8 = parseNdc("00063026");
    expect(p8.kind).toBe("product");
  });
});

describe("parseNdc — invalid input", () => {
  it.each(["", "abc", "123", "123456789012", "1234-56-7890", "0006-3026-0A"])("rejects %j", (input) => {
    const p = parseNdc(input);
    expect(["invalid", "product"].includes(p.kind) ? p.kind : "valid").not.toBe("valid");
    expect(toNdc11(input)).toBeNull();
  });
});

describe("product NDCs and formatting", () => {
  it("normalizes FDA product NDCs", () => {
    expect(toProductNdc9("0006-3026")).toBe("000063026");
    expect(toProductNdc9("50242-051")).toBe("502420051");
    expect(toProductNdc9("50242-0051")).toBe("502420051");
  });
  it("formats", () => {
    expect(formatNdc11("00006302602")).toBe("00006-3026-02");
    expect(formatProductNdc9("000063026")).toBe("00006-3026");
    expect(formatNdc11("abc")).toBe("abc");
  });
  it("detects NDC-looking queries", () => {
    expect(looksLikeNdc("0006-3026-02")).toBe(true);
    expect(looksLikeNdc("00006302602")).toBe(true);
    expect(looksLikeNdc("J9271")).toBe(false);
    expect(looksLikeNdc("96413")).toBe(false);
  });
});
