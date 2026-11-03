import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MCD_TABLES, mcdArticleUrl, parseMcdArticles, type McdTables } from "@/ingest/parsers/cms-mcd";
import { FIXTURE_DIR } from "../helpers/fixtures";

// Excerpts of CMS's Medicare Coverage Database "Current Article Data" export (October 2026).
const tables = Object.fromEntries(MCD_TABLES.map((n) => [n, readFileSync(join(FIXTURE_DIR, "mcd-articles", n), "utf8")])) as McdTables;

describe("Medicare Coverage Database article parser", () => {
  const p = parseMcdArticles(tables);
  it("keeps active articles that list a HCPCS drug code and drops CPT rows", () => {
    expect(p.articles.map((a) => a.displayId).sort()).toEqual(["A56380", "A57186"]);
    expect(p.excluded.articlesWithoutDrugCodes).toBe(1); // A52369, a knee arthroscopy article
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
  it("keeps covered ICD-10-CM codes with CMS's descriptions", () => {
    expect(p.icd10.find((c) => c.articleId === 56380 && c.code === "C81.00")).toMatchObject({ group: 1, description: "Nodular lymphocyte predominant Hodgkin lymphoma, unspecified site", asterisk: false });
    expect(p.icd10.filter((c) => c.articleId === 57186).length).toBe(30);
    expect(mcdArticleUrl(56380, 56)).toBe("https://www.cms.gov/medicare-coverage-database/view/article.aspx?articleid=56380&ver=56");
  });
});
