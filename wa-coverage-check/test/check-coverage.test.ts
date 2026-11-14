/**
 * Five hand-verified drugs, checked against the cached sources from `npm run refresh`.
 * Each expectation was confirmed by reading the raw file separately from the code:
 * the Apple Health xlsx, Ambetter's and Cambia's WA JSON (searched by drug name), the UMP PDF
 * (read with a second PDF reader), and Part D counts that match CodeRx's
 * independent count. Live checks test patterns (all, none, every listed row), not exact
 * counts, so a weekly source update does not break them. Exact rules live in rules.test.ts.
 */
import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { checkCoverage, type CoverageResult, type CoverageRow } from "../src/check-coverage.ts";
import { cachePath } from "../src/sources.ts";

const results: Record<string, CoverageResult> = {};
const appleHealth = (d: string) => results[d].rows.find((r) => r.plan.startsWith("Apple Health"))!;
const partD = (d: string) => results[d].rows.filter((r) => r.plan.startsWith("Medicare Part D"));
const ambetter = (d: string) => results[d].rows.filter((r) => r.plan.startsWith("Exchange (Ambetter)"));
const regence = (d: string) => results[d].rows.filter((r) => r.plan.startsWith("Exchange (Regence/BridgeSpan)"));
const ump = (d: string) => results[d].rows.find((r) => r.plan.includes("(UMP)"))!;
const all = (rows: CoverageRow[], test: (r: CoverageRow) => boolean) => rows.length > 0 && rows.every(test);
const count = (rows: CoverageRow[], key: keyof CoverageRow, value: string) => rows.filter((r) => r[key] === value).length;

beforeAll(async () => {
  if (!existsSync(cachePath("manifest.json"))) throw new Error("No cached sources. Run `npm run refresh` first.");
  for (const d of ["atorvastatin", "Ozempic", "Enbrel", "Viagra", "Remicade"]) results[d] = await checkCoverage(d);
}, 120_000);

describe("generic: atorvastatin", () => {
  it("is covered by Apple Health through the pharmacy benefit", () => {
    expect(appleHealth("atorvastatin")).toMatchObject({ covered: "yes", benefitType: "pharmacy" });
  });
  it("reports PA as unknown because it differs by product, and names them (brand Lipitor needs PA, generics do not)", () => {
    expect(appleHealth("atorvastatin").priorAuth).toBe("unknown");
    expect(appleHealth("atorvastatin").reason).toContain("PA varies by product");
    expect(appleHealth("atorvastatin").reason).toMatch(/PA required: .*Lipitor/i);
  });
  it("matches atorvastatin alone, not combinations such as amlodipine / atorvastatin", () => {
    expect(results.atorvastatin.match!.products.some((p) => p.name.includes(" / "))).toBe(false);
  });
  it("is on every Washington Part D and Ambetter formulary without PA", () => {
    expect(count(partD("atorvastatin"), "covered", "yes")).toBe(partD("atorvastatin").length);
    expect(count(ambetter("atorvastatin"), "covered", "yes")).toBe(ambetter("atorvastatin").length);
    expect(count(partD("atorvastatin"), "priorAuth", "yes")).toBe(0);
  });
  it("is on every Regence/BridgeSpan plan without PA, and preventive ($0) on UMP", () => {
    expect(all(regence("atorvastatin"), (r) => r.covered === "yes" && r.priorAuth === "no")).toBe(true);
    expect(ump("atorvastatin")).toMatchObject({ covered: "yes", tier: "Preventive", priorAuth: "no" });
  });
});

describe("PA brand: Ozempic", () => {
  it("needs PA under Apple Health", () => {
    expect(appleHealth("Ozempic")).toMatchObject({ covered: "yes", priorAuth: "yes", benefitType: "pharmacy" });
  });
  it("needs PA on every Part D plan that lists it", () => {
    const listed = partD("Ozempic").filter((r) => r.covered === "yes");
    expect(listed.length).toBeGreaterThan(partD("Ozempic").length * 0.9);
    expect(listed.every((r) => r.priorAuth === "yes")).toBe(true);
  });
  it("shows Ambetter's file as published: preferred brand, no PA", () => {
    expect(ambetter("Ozempic").every((r) => r.covered === "yes" && r.priorAuth === "no" && r.tier === "PREFERREDBRAND")).toBe(true);
    expect(ambetter("Ozempic")[0].reason).toContain("published");
  });
  it("needs PA on every Regence/BridgeSpan plan", () => {
    expect(all(regence("Ozempic"), (r) => r.covered === "yes" && r.priorAuth === "yes")).toBe(true);
  });
  it("is Tier 2 on UMP, restricted to a type 2 diabetes diagnosis", () => {
    expect(ump("Ozempic")).toMatchObject({ covered: "yes", tier: "Tier 2" });
    expect(ump("Ozempic").reason).toContain("RDX");
  });
});

describe("biologic: Enbrel", () => {
  it("is on every Washington Part D formulary", () => {
    expect(count(partD("Enbrel"), "covered", "yes")).toBe(partD("Enbrel").length);
  });
  it("is a specialty drug with PA on every Ambetter plan", () => {
    expect(ambetter("Enbrel").every((r) => r.covered === "yes" && r.priorAuth === "yes" && r.tier === "SPECIALTYDRUGS")).toBe(true);
  });
  it("needs PA under Apple Health", () => {
    expect(appleHealth("Enbrel")).toMatchObject({ covered: "yes", priorAuth: "yes" });
  });
  it("needs PA on every Regence/BridgeSpan plan and on UMP, where it is a specialty drug", () => {
    expect(all(regence("Enbrel"), (r) => r.covered === "yes" && r.priorAuth === "yes")).toBe(true);
    expect(ump("Enbrel")).toMatchObject({ covered: "yes", tier: "Tier 2 Specialty", priorAuth: "yes", costSharing: null });
  });
});

describe("uncovered: Viagra", () => {
  it("is not covered by Apple Health, with the PDL's reason", () => {
    expect(appleHealth("Viagra")).toMatchObject({ covered: "no" });
    expect(appleHealth("Viagra").reason).toContain("sexual dysfunction");
  });
  it("is on no Part D or Ambetter formulary", () => {
    expect(count(partD("Viagra"), "covered", "yes")).toBe(0);
    expect(count(ambetter("Viagra"), "covered", "yes")).toBe(0);
    expect(count(regence("Viagra"), "covered", "yes")).toBe(0);
  });
  it("is not found by name on UMP, which stays unknown rather than no", () => {
    expect(ump("Viagra").covered).toBe("unknown");
  });
});

describe("infusion: Remicade", () => {
  it("is covered by Apple Health through both benefits, so the benefit type stays unknown", () => {
    expect(appleHealth("Remicade")).toMatchObject({ covered: "yes", priorAuth: "yes", benefitType: "unknown" });
    expect(appleHealth("Remicade").reason).toContain("both the pharmacy and medical benefits");
  });
  it("is on no Part D formulary, and the row says Part B may pay", () => {
    expect(count(partD("Remicade"), "covered", "yes")).toBe(0);
    expect(partD("Remicade")[0].reason).toContain("Part B");
  });
  it("is on no Ambetter formulary, and the row points to the medical benefit", () => {
    expect(count(ambetter("Remicade"), "covered", "yes")).toBe(0);
    expect(ambetter("Remicade")[0].reason).toContain("medical benefit");
    expect(count(regence("Remicade"), "covered", "yes")).toBe(0);
  });
  it("is not on the UMP pharmacy list, and the row points to the medical benefit", () => {
    expect(ump("Remicade")).toMatchObject({ covered: "unknown", benefitType: "unknown" });
    expect(ump("Remicade").reason).toContain("medical benefit");
  });
});

describe("output rules", () => {
  it("gives every row a source link and date, and a reason whenever anything is unknown", () => {
    for (const r of Object.values(results).flatMap((x) => x.rows)) {
      expect(r.sourceUrl).toMatch(/^https:\/\//);
      expect(r.asOfDate).not.toBe("");
      const unknown = [r.covered, r.priorAuth, r.stepTherapy, r.quantityLimit, r.benefitType].includes("unknown");
      if (unknown) expect(r.reason).not.toBe("");
    }
  });
  it("says UMP results are matched by name", () => {
    expect(ump("Enbrel").reason).toContain("by name");
  });
  it("filters by plan", async () => {
    const r = await checkCoverage("Enbrel", "ambetter");
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.every((x) => x.plan.includes("Ambetter"))).toBe(true);
    expect((await checkCoverage("Enbrel", "UMP")).rows).toHaveLength(1);
  });
  it("returns no rows for a name RxNorm does not know", async () => {
    expect(await checkCoverage("zzzzqq")).toMatchObject({ match: null, rows: [] });
  });
});
