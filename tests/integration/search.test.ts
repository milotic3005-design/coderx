import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@/lib/db/client";
import { search, suggest } from "@/lib/search/engine";
import { seededDb } from "../helpers/db";

let h: DbHandle;
beforeAll(async () => {
  h = await seededDb();
});
afterAll(async () => {
  await h?.close();
});

const run = (q: string, opts = {}) => search(q, { pageSize: 50, ...opts }, h.db);

describe("required search scenarios", () => {
  it("1. exact HCPCS code", async () => {
    const r = await run("J9271");
    expect(r.query.type).toBe("hcpcs_code");
    expect(r.hits[0]).toMatchObject({ kind: "hcpcs", key: "J9271", tier: 100 });
    expect(r.hits[0].match.type).toBe("exact_code");
    expect(r.hits.some((x) => x.kind === "drug" && x.key === "keytruda-pembrolizumab")).toBe(true);
  });

  it("2. lowercase HCPCS code", async () => {
    const r = await run("j9271");
    expect(r.hits[0]).toMatchObject({ kind: "hcpcs", key: "J9271" });
  });

  it("3. brand name", async () => {
    const r = await run("Keytruda");
    expect(r.hits[0]).toMatchObject({ kind: "drug", key: "keytruda-pembrolizumab" });
    expect(r.hits[0].match.type).toBe("exact_name");
  });

  it("4. generic name", async () => {
    const r = await run("pembrolizumab");
    expect(r.hits[0]).toMatchObject({ kind: "drug", key: "keytruda-pembrolizumab" });
  });

  it("5. formatted 10-digit NDC (4-4-2)", async () => {
    const r = await run("0006-3026-02");
    expect(r.query.type).toBe("ndc");
    expect(r.hits[0]).toMatchObject({ kind: "ndc", key: "00006302602" });
    expect(r.hits[0].match.type).toBe("exact_ndc");
    expect(r.hits[0].codes).toContain("J9271");
  });

  it("6. normalized 11-digit NDC", async () => {
    const r = await run("00006302602");
    expect(r.hits[0]).toMatchObject({ kind: "ndc", key: "00006302602" });
  });

  it("6b. unhyphenated 10-digit NDC is resolved across candidates and flagged", async () => {
    const r = await run("0006302602");
    expect(r.query.type).toBe("ndc_ambiguous");
    expect(r.hits[0].key).toBe("00006302602");
    expect(r.notices.join(" ")).toMatch(/three 11-digit forms/);
  });

  it("7. minor misspelling", async () => {
    const r = await run("Keytrda");
    const hit = r.hits.find((x) => x.key === "keytruda-pembrolizumab");
    expect(hit).toBeDefined();
    expect(hit!.match.type).toBe("fuzzy");
    expect(r.hits[0].key).toBe("keytruda-pembrolizumab");
  });

  it("8/9. active and inactive records are distinguished; inactive sorts after active", async () => {
    const terminated = await run("S0189");
    expect(terminated.hits[0]).toMatchObject({ key: "S0189", isActive: false, statusEndDate: "2025-12-31" });
    const r = await run("pembrolizumab");
    const keys = r.hits.map((x) => x.key);
    expect(keys).toContain("C9027"); // historical pass-through code (terminated 2015-12-31)
    const firstInactive = r.hits.findIndex((x) => !x.isActive);
    expect(r.hits.slice(firstInactive).every((x) => !x.isActive)).toBe(true);
  });

  it("11. ambiguous drug name is flagged", async () => {
    const r = await run("dexamethasone");
    expect(r.ambiguous).toBe(true);
    expect(r.notices.join(" ")).toMatch(/matches \d+ different drugs/);
    const exact = r.hits.filter((x) => x.kind === "drug" && x.tier === 90).map((x) => x.key);
    expect(exact).toEqual(expect.arrayContaining(["ozurdex-dexamethasone", "dextenza-dexamethasone", "hemady-dexamethasone"]));
  });

  it("12. no-result query", async () => {
    const r = await run("zzqxjv");
    expect(r.total).toBe(0);
    expect(r.hits).toEqual([]);
  });

  it("ranks exact generic above biosimilar prefixes, and explains every hit", async () => {
    const r = await run("rituximab");
    expect(r.hits[0]).toMatchObject({ key: "rituxan-rituximab", tier: 90 });
    const bios = r.hits.filter((x) => ["truxima-rituximab-abbs", "ruxience-rituximab-pvvr", "riabni-rituximab-arrx"].includes(x.key));
    expect(bios).toHaveLength(3);
    for (const b of bios) expect(b.tier).toBeLessThan(90);
    for (const hit of r.hits) expect(hit.match.label.length).toBeGreaterThan(3);
  });

  it("matches manufacturers, and drugs by manufacturer at a lower tier", async () => {
    const r = await run("Genentech");
    expect(r.hits[0].kind).toBe("manufacturer");
    expect(r.hits.some((x) => x.kind === "drug" && x.match.type === "manufacturer")).toBe(true);
  });

  it("does not match a code whose descriptor excludes the searched term", async () => {
    const r = await run("infliximab biosimilar");
    const keys = r.hits.map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(["Q5103", "Q5104", "Q5121"]));
    expect(keys).not.toContain("J1745"); // "Injection, infliximab, excludes biosimilar"
  });

  it("explains CPT-style queries instead of guessing", async () => {
    const r = await run("0042T");
    expect(r.query.type).toBe("cpt_like");
    expect(r.notices.join(" ")).toMatch(/CPT/);
  });

  it("applies filters", async () => {
    const onlyQ = await run("rituximab", { filters: { kinds: ["hcpcs"], families: ["Q"] } });
    expect(onlyQ.hits.length).toBeGreaterThan(0);
    expect(onlyQ.hits.every((x) => x.kind === "hcpcs" && x.family === "Q")).toBe(true);
    const inactive = await run("pembrolizumab", { filters: { status: "inactive" } });
    expect(inactive.hits.every((x) => !x.isActive)).toBe(true);
    const bios = await run("rituximab", { filters: { kinds: ["drug"], biosimilar: "any" } });
    expect(bios.hits.every((x) => x.biosimilarStatus === "biosimilar" || x.biosimilarStatus === "interchangeable")).toBe(true);
  });

  it("paginates", async () => {
    const p1 = await search("rituximab", { pageSize: 2, page: 1 }, h.db);
    const p2 = await search("rituximab", { pageSize: 2, page: 2 }, h.db);
    expect(p1.totalPages).toBeGreaterThan(1);
    expect(p1.hits.map((x) => x.key)).not.toEqual(p2.hits.map((x) => x.key));
  });

  it("groups type-ahead suggestions", async () => {
    const s = await suggest("rituxi", h.db);
    expect(s.groups.map((g) => g.label)).toEqual(expect.arrayContaining(["Drugs", "HCPCS codes"]));
    expect(s.groups.find((g) => g.kind === "drug")?.items[0].title).toBe("Rituxan");
  });

  it("answers within the performance budget", async () => {
    const started = performance.now();
    for (const q of ["Keytruda", "J9312", "0006-3026-02", "dexamethasone", "Keytrda"]) await run(q);
    expect((performance.now() - started) / 5).toBeLessThan(500);
  });
});
