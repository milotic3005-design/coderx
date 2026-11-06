import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseOpenFdaRxcui } from "@/ingest/parsers/fda-rxcui";
import { FIXTURE_DIR } from "../helpers/fixtures";

// Real openFDA NDC entries for a capecitabine product, Prolia, and a product with no RxCUI.
const json = readFileSync(join(FIXTURE_DIR, "openfda-ndc-excerpt.json"), "utf8");

describe("openFDA NDC to RxCUI link", () => {
  const p = parseOpenFdaRxcui(json);

  it("maps product NDCs to RxCUIs", () => {
    expect(p.rows).toContainEqual({ productNdc9: "555130710", rxcui: "993456" });
    expect(p.rows.some((r) => r.rxcui === "200328" || r.rxcui === "200327")).toBe(true);
  });
  it("counts products with no RxCUI", () => {
    expect(p.productsWithoutRxcui).toBe(1);
  });
  it("has no duplicate pairs", () => {
    expect(new Set(p.rows.map((r) => `${r.productNdc9}|${r.rxcui}`)).size).toBe(p.rows.length);
  });
  it("collapses the same pair repeated across entries", () => {
    const doubled = JSON.stringify({ results: [...JSON.parse(json).results, ...JSON.parse(json).results] });
    expect(parseOpenFdaRxcui(doubled).rows).toHaveLength(p.rows.length);
  });
});
