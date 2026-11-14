/** UMP PDF rules on small, made-up pieces that copy the real PDF's layout (positions in points). */
import { describe, expect, it } from "vitest";
import { umpRow } from "../src/check-coverage.ts";
import { checkUmpIndex, parseCostNotes, parseCostTable, parseIndexPage, type PdfText, type UmpIndex } from "../src/ump.ts";

const t = (str: string, x: number, y: number): PdfText => ({ str, x, y });
const header = [t("Drug Name", 18, 716), t("Special Code", 306, 716), t("Tier", 387, 716), t("Category", 426, 716)];

describe("reading the Alphabetical Index table", () => {
  const page = [
    ...header,
    // A name and a tier that wrap onto a second line belong to the row above.
    t("QL", 306, 704), t("ANTIHYPERLIPIDEMICS", 426, 704),
    t("atorvastatin tab (LIPITOR equiv) (QL= 1 tab/day; Covered at $0 for members", 18, 703), t("Preventi", 386, 703),
    t("40 years or older)", 18, 692), t("ve", 386, 692),
    // A specialty tier is two words on two lines.
    t("AMSP-PA-QL", 306, 650), t("ANALGESICS", 426, 650), t("ENBREL INJ (QL= 8 inj/28 days)", 18, 650),
    t("Tier 2", 386, 649), t("Specialty", 386, 638),
    // "-" means no special code.
    t("-", 306, 620), t("acyclovir cream (ZOVIRAX equiv)", 18, 620), t("Tier 1", 386, 620),
    // The legend box and footer are not table rows.
    t("BRANDS", 417, 138), t("LD", 386, 132), t("Limited Distribution", 416, 132),
    t("Coverage of medications, including those not otherwise identified", 18, 82),
  ];
  const rows = parseIndexPage(page);
  it("rebuilds one row per Special Code cell, joining wrapped lines", () => {
    expect(rows).toEqual([
      { name: "atorvastatin tab (LIPITOR equiv) (QL= 1 tab/day; Covered at $0 for members 40 years or older)", tier: "Preventive", codes: ["QL"] },
      { name: "ENBREL INJ (QL= 8 inj/28 days)", tier: "Tier 2 Specialty", codes: ["AMSP", "PA", "QL"] },
      { name: "acyclovir cream (ZOVIRAX equiv)", tier: "Tier 1", codes: [] },
    ]);
  });
  it("fails loudly instead of dropping a row it cannot complete", () => {
    expect(() => parseIndexPage([...header, t("QL", 306, 704), t("orphan name with no tier", 18, 704)])).toThrow(/layout/);
  });
  it("stops the refresh on a tier or code the PDL legend does not define", () => {
    const ok = { lastUpdated: "x", costs: {}, costNotes: [], entries: [{ name: "A", tier: "Tier 2 Specialty", codes: ["AMSP", "PA"] }] };
    expect(() => checkUmpIndex(ok)).not.toThrow();
    expect(() => checkUmpIndex({ ...ok, entries: [{ name: "A", tier: "ANTIVIRALS Tier 1", codes: [] }] })).toThrow(/tier/);
    expect(() => checkUmpIndex({ ...ok, entries: [{ name: "A", tier: "Tier 1", codes: ["ZZ"] }] })).toThrow(/code/);
  });
  it("keeps the page-1 sentences about the $35 cap", () => {
    // As on the real page: a sentence, then the cost table (no periods), then a sentence glued to the last row.
    const text = "Also, for all plans the plan pays for certain Tier 2 drugs, which are capped at $35 per 30-day supply. This table applies to the following plans: UMP Classic Tier 1 10% coinsurance or $25 whichever is less Tier 2 30% coinsurance or $75 whichever is less Covered insulins, certain corticosteroid inhalers are covered at 30% coinsurance or $35 whichever is less, the deductible is waived.";
    expect(parseCostNotes(text)).toEqual([
      "Also, for all plans the plan pays for certain Tier 2 drugs, which are capped at $35 per 30-day supply.",
      "Covered insulins, certain corticosteroid inhalers are covered at 30% coinsurance or $35 whichever is less, the deductible is waived.",
    ]);
  });
  it("returns nothing for a page without the table header", () => {
    expect(parseIndexPage([t("Search Tip:", 26, 759)])).toEqual([]);
  });
  it("reads the cost table even when pdf.js splits an amount into pieces", () => {
    const text = ["Preventive Tier", " ", "$0", "Tier 1", " ", "10% coinsurance or $25", " ", "whichever is less", "Tier 2", " ", "30% coinsurance or $", "7", "5", " ", "whichever is less"].join("");
    expect(parseCostTable(text)).toEqual({ Preventive: "$0", "Tier 1": "10% coinsurance or $25 whichever is less", "Tier 2": "30% coinsurance or $75 whichever is less" });
  });
});

describe("UMP coverage row", () => {
  const info = { url: "https://example.test/ump.pdf", fetchedAt: "2026-11-13", asOf: "UMP PDL last updated 11/1/2026" };
  const index: UmpIndex = {
    lastUpdated: "11/1/2026",
    costNotes: [],
    costs: { "Tier 1": "10% coinsurance or $25 whichever is less", "Tier 2": "30% coinsurance or $75 whichever is less" },
    entries: [
      { name: "OZEMPIC INJ (QL= 3ml/28 days; Diagnosis Restricted – Type 2 Diabetes (E11))", tier: "Tier 2", codes: ["QL", "RDX"] },
      { name: "ENBREL INJ (QL= 8 inj/28 days)", tier: "Tier 2 Specialty", codes: ["AMSP", "PA", "QL"] },
      { name: "HUMIRA PEN", tier: "Tier 2 Specialty", codes: ["AMSP", "QL"] },
      { name: "ADALIMUMAB-ADAZ INJ", tier: "Tier 2 Specialty", codes: ["AMSP", "PA", "QL"] },
      { name: "atorvastatin tab (LIPITOR equiv)", tier: "Tier 1", codes: [] },
      { name: "atorvastatin/ezetimibe tab (VYTORIN equiv)", tier: "Tier 2", codes: [] },
    ],
  };
  const match = (names: string[]) => ({ matchedName: "test", rxcuis: names.map((_, i) => String(i)), ndcs: [], products: names.map((name, i) => ({ rxcui: String(i), name })) });

  it("matches a brand by name and reports tier, codes and the plan's cost rule", () => {
    const r = umpRow(match(["semaglutide 2 MG/3ML Pen Injector [Ozempic]"]), index, info);
    expect(r).toMatchObject({ covered: "yes", tier: "Tier 2", priorAuth: "no", quantityLimit: "yes", stepTherapy: "no", benefitType: "pharmacy" });
    expect(r.costSharing).toContain("30% coinsurance or $75");
    expect(r.reason).toMatch(/restricted to diagnosis/i);
    expect(r.reason).toMatch(/by name/i);
  });
  it("treats a specialty-pharmacy drug without a PA code as unknown PA, since the PDL says most need it", () => {
    const r = umpRow(match(["adalimumab 40 MG/0.4ML Pen Injector [Humira]"]), index, info);
    expect(r.priorAuth).toBe("unknown");
    expect(r.reason).toMatch(/specialty/i);
  });
  it("does not state cost sharing for specialty tiers, which the PDL's cost table leaves out", () => {
    const r = umpRow(match(["etanercept 50 MG/ML Prefilled Syringe [Enbrel]"]), index, info);
    expect(r).toMatchObject({ covered: "yes", priorAuth: "yes", costSharing: null });
    expect(r.reason).toMatch(/specialty/i);
  });
  it("matches a generic by ingredient but not combinations or biosimilars that only start with it", () => {
    const r = umpRow(match(["atorvastatin 10 MG Oral Tablet"]), index, info);
    expect(r.tier).toBe("Tier 1");
    expect(r.reason).not.toContain("ezetimibe");
    expect(umpRow(match(["adalimumab 40 MG/0.4ML Prefilled Syringe"]), index, info).reason).not.toContain("ADAZ");
  });
  it("says unknown, not no, when no entry matches by name, and points to the medical benefit", () => {
    const r = umpRow(match(["infliximab 100 MG Injection [Remicade]"]), index, info);
    expect(r).toMatchObject({ covered: "unknown", benefitType: "unknown" });
    expect(r.reason).toMatch(/medical benefit/i);
  });
  it("matches every drug in a combined entry, not just the first", () => {
    const r = umpRow(match(["semaglutide 7 MG Oral Tablet [Rybelsus]"]), { ...index, entries: [{ name: "OZEMPIC TAB, RYBELSUS TAB (QL= 1 tab/day)", tier: "Tier 2", codes: ["QL"] }] }, info);
    expect(r).toMatchObject({ covered: "yes", tier: "Tier 2" });
  });
  it("falls back to the base name when RxNorm's salt name is not on the PDL, but keeps distinct salts apart", () => {
    const salts: UmpIndex = { ...index, entries: [
      { name: "metformin tab", tier: "Value", codes: [] },
      { name: "metoprolol succinate ER tab (TOPROL XL equiv)", tier: "Tier 1", codes: [] },
      { name: "metoprolol tartrate tab (LOPRESSOR equiv)", tier: "Value", codes: [] },
    ] };
    expect(umpRow(match(["metformin hydrochloride 500 MG Oral Tablet"]), salts, info)).toMatchObject({ covered: "yes", tier: "Value" });
    const r = umpRow(match(["24 HR metoprolol succinate 25 MG Extended Release Oral Tablet"]), salts, info);
    expect(r.tier).toBe("Tier 1");
  });
  it("shows quantity limit as unknown when the name states a limit but the code column does not", () => {
    const r = umpRow(match(["guanfacine 3 MG Extended Release Oral Tablet"]), { ...index, entries: [{ name: "guanfacine ER tab 3mg (INTUNIV equiv) (QL= 60 tabs/30 days)", tier: "Tier 1", codes: [] }] }, info);
    expect(r.quantityLimit).toBe("unknown");
    expect(r.reason).toMatch(/QL=/);
  });
  it("never falls back to a bare salt word, so calcium citrate does not match calcium acetate", () => {
    const r = umpRow(match(["calcium citrate 950 MG Oral Tablet"]), { ...index, entries: [{ name: "calcium acetate cap (PHOSLO equiv)", tier: "Tier 1", codes: [] }] }, info);
    expect(r.covered).toBe("unknown");
  });
  it("adds the PDL's $35 cap note to Tier 2 cost sharing", () => {
    const capped = { ...index, costNotes: ["Covered insulins are covered at 30% coinsurance or $35 whichever is less."] };
    const r = umpRow(match(["semaglutide 2 MG/3ML Pen Injector [Ozempic]"]), capped, info);
    expect(r.costSharing).toMatch(/\$35/);
    expect(r.reason).toContain("Covered insulins");
  });
  it("reads plan exclusion and not-covered codes as not covered, and M as the medical benefit", () => {
    const coded = (codes: string[]) => ({ ...index, entries: [{ name: "TESTDRUG INJ", tier: "Tier 2", codes }] });
    const m = match(["testdrug 10 MG Injection [Testdrug]"]);
    expect(umpRow(m, coded(["EXC"]), info)).toMatchObject({ covered: "no" });
    expect(umpRow(m, coded(["NC"]), info)).toMatchObject({ covered: "no" });
    expect(umpRow(m, coded(["M"]), info)).toMatchObject({ covered: "yes", benefitType: "medical" });
  });
  it("mentions generic equivalents when only a brand was searched", () => {
    const r = umpRow(match(["atorvastatin 10 MG Oral Tablet [Lipitor]"]), index, info);
    expect(r.covered).toBe("unknown");
    expect(r.reason).toContain("LIPITOR equiv");
  });
});
