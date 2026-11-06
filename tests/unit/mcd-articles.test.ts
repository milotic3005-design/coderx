import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MCD_TABLES, mcdArticleUrl, parseMcdArticles, parseMcdSadLists, type McdTables } from "@/ingest/parsers/cms-mcd";
import { FIXTURE_DIR } from "../helpers/fixtures";

// Excerpts of CMS's Medicare Coverage Database "Current Article Data" export (October 2026).
const tables = Object.fromEntries(MCD_TABLES.map((n) => [n, readFileSync(join(FIXTURE_DIR, "mcd-articles", n), "utf8")])) as McdTables;

describe("Medicare Coverage Database article parser", () => {
  const p = parseMcdArticles(tables);
  it("keeps active articles that list a HCPCS drug code and drops CPT rows", () => {
    expect(p.articles.map((a) => a.displayId).sort()).toEqual(["A56380", "A57186"]);
    expect(p.excluded.articlesWithoutDrugCodes).toBe(3); // A52369 (knee arthroscopy) and the two SAD lists, which have no HCPCS rows
    expect(p.excluded.cptRows).toBeGreaterThan(0);
    expect(p.hcpcs.every((h) => /^(J|Q|C9|A9)/.test(h.hcpcsCode))).toBe(true);
    expect(p.hcpcs.filter((h) => h.articleId === 57186).map((h) => h.hcpcsCode)).toEqual(["J0585", "J0586", "J0587", "J0588", "J0589"]);
  });
  it("records contractors and the states their A/B MAC jurisdictions cover", () => {
    const botox = p.articles.find((a) => a.articleId === 57186)!;
    expect(botox).toMatchObject({ title: "Billing and Coding: Botulinum Toxin Injections", articleType: "6" });
    expect(botox.states).toContain("WA");
    expect(new Set(botox.contractors.map((c) => c.name))).toEqual(new Set(["Noridian Healthcare Solutions, LLC"]));
    expect(botox.contractors.map((c) => c.number)).toEqual(expect.arrayContaining(["02401", "02402"]));
    const rituximab = p.articles.find((a) => a.articleId === 56380)!;
    expect(rituximab.states).not.toContain("WA");
    expect(rituximab.states).toEqual(expect.arrayContaining(["NC", "SC", "VA"]));
  });
  it("reports Medicare sub-state regions as their state", () => {
    // CMS's state_lookup has regions such as 63 "New York - Downstate" (DN) and 65 "New York - Upstate" (UN). The export uses CRLF.
    const withRegions = { ...tables, "contractor_jurisdiction.csv": `${tables["contractor_jurisdiction.csv"].trimEnd()}\r\n374,13,1,63,2014-02-25 15:10:54.463000,1900-01-01 00:00:00,\r\n374,13,1,65,2014-02-25 15:10:54.463000,1900-01-01 00:00:00,\r\n` };
    const states = parseMcdArticles(withRegions).articles.find((a) => a.articleId === 56380)!.states;
    expect(states).toContain("NY");
    expect(states).not.toEqual(expect.arrayContaining(["DN"]));
    expect(states).not.toEqual(expect.arrayContaining(["UN"]));
    expect(states.filter((s) => s === "NY")).toHaveLength(1);
  });
  it("keeps covered ICD-10-CM codes with CMS's descriptions", () => {
    expect(p.icd10.find((c) => c.articleId === 56380 && c.code === "C81.00")).toMatchObject({ group: 1, description: "Nodular lymphocyte predominant Hodgkin lymphoma, unspecified site", asterisk: false });
    expect(p.icd10.filter((c) => c.articleId === 57186).length).toBe(30);
    expect(mcdArticleUrl(56380, 56)).toBe("https://www.cms.gov/medicare-coverage-database/view/article.aspx?articleid=56380&ver=56");
  });
});

describe("Self-administered drug exclusion lists", () => {
  const s = parseMcdSadLists(tables);
  const noridian = s.entries.filter((e) => e.articleId === 53033);

  it("reads SAD lists from the code table with route flags", () => {
    expect(noridian.find((e) => e.hcpcsCode === "J1438")).toMatchObject({ routeFlag: null, endDate: null });
    expect(noridian.find((e) => e.hcpcsCode === "J0490")).toMatchObject({ routeFlag: "single", productText: "Belimumab (Benlysta)*" });
    expect(noridian.find((e) => e.hcpcsCode === "J0801")).toMatchObject({ routeFlag: "double" });
    expect(noridian.filter((e) => e.hcpcsCode === "J3590")).toHaveLength(2);
  });
  it("records the list's number, contractors, and states", () => {
    const list = s.lists.find((l) => l.articleId === 53033)!;
    expect(list).toMatchObject({ displayId: "A53033", effectiveDate: "2026-10-01" });
    expect(list.states).toContain("WA");
    expect(new Set(list.contractors.map((c) => c.name))).toEqual(new Set(["Noridian Healthcare Solutions, LLC"]));
    expect(s.lists.find((l) => l.articleId === 53032)!.states).not.toContain("WA");
  });
  it("cleans markup from product text and keeps end dates", () => {
    expect(noridian.find((e) => e.hcpcsCode === "J0129")).toMatchObject({ productText: "Orencia (Abatacept)", endDate: "2013-09-30" });
    expect(s.entries.find((e) => e.articleId === 53032)!.productText).toBe("Enbrel®");
  });
  it("decodes numeric entities in product text", () => {
    const withEntity = { ...tables, "article_x_code_table.csv": tables["article_x_code_table.csv"].replace("Belimumab (Benlysta)*", "Daclizumab (Zinbryta&#8482)") };
    expect(parseMcdSadLists(withEntity).entries.find((e) => e.hcpcsCode === "J0490")!.productText).toBe("Daclizumab (Zinbryta™)");
  });
  it("splits the reasons", () => {
    expect(noridian.find((e) => e.hcpcsCode === "J0490")!.reasons).toEqual(["Apparent on its Face"]);
  });
  it("applies the asterisk meaning only to Noridian's lists", () => {
    const other = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.replaceAll("53033", "52800")])) as McdTables;
    expect(parseMcdSadLists(other).entries.find((e) => e.hcpcsCode === "J0490")).toMatchObject({ routeFlag: null, productText: "Belimumab (Benlysta)*" });
  });
  it("drops CPT rows", () => {
    const withCpt = { ...tables, "article_x_code_table.csv": tables["article_x_code_table.csv"].replaceAll("J1438", "90675") };
    const parsed = parseMcdSadLists(withCpt);
    expect(parsed.excluded.cptRows).toBe(2);
    expect(parsed.entries.some((e) => e.hcpcsCode === "90675")).toBe(false);
  });
});
