import { describe, expect, it } from "vitest";
import { parseQuery } from "@/lib/search/parse";
import { expandQuery } from "@/lib/search/synonyms";

describe("parseQuery", () => {
  it.each([
    ["J9271", "hcpcs_code"],
    ["j9271", "hcpcs_code"],
    ["J92", "hcpcs_prefix"],
    ["0006-3026-02", "ndc"],
    ["00006302602", "ndc"],
    ["0006302602", "ndc_ambiguous"],
    ["0006-3026", "product_ndc"],
    ["00006", "labeler_code"],
    ["0042T", "cpt_like"],
    ["Keytruda", "text"],
    ["   ", "empty"],
    ["1234-56-7890", "invalid_ndc"],
  ])("%j → %s", (q, type) => {
    expect(parseQuery(q).type).toBe(type);
  });

  it("normalizes lowercase codes and NDC candidates", () => {
    expect(parseQuery("j9312").hcpcsCode).toBe("J9312");
    expect(parseQuery("0006302602").ndc11Candidates).toHaveLength(3);
  });

  it("caps length and drops stopwords from tokens", () => {
    const q = parseQuery(`injection rituximab ${"x".repeat(200)}`);
    expect(q.truncated).toBe(true);
    expect(q.display.length).toBe(100);
    expect(parseQuery("injection, rituximab").tokens).toEqual(["rituximab"]);
  });

  it("expands well-known abbreviations for the search only", () => {
    expect(parseQuery("IVIG").expansions).toEqual([{ from: "ivig", to: "immune globulin" }]);
    expect(expandQuery("mtx dose")).toEqual([{ from: "mtx", to: "methotrexate dose" }]);
    expect(expandQuery("pembrolizumab")).toEqual([]);
  });
});
