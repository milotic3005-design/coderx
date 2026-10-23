import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@/lib/db/client";
import { getDrugDetail, getHcpcsDetail, getNdcDetail } from "@/lib/data/queries";
import { biosimilarGroups, quarterlyChanges } from "@/lib/data/tools";
import { GET as searchGET } from "@/app/api/search/route";
import { GET as suggestGET } from "@/app/api/suggest/route";
import { GET as hcpcsGET } from "@/app/api/hcpcs/[code]/route";
import { GET as ndcGET } from "@/app/api/ndc/[ndc]/route";
import { GET as drugGET } from "@/app/api/drugs/[slug]/route";
import { GET as mfrGET } from "@/app/api/manufacturers/[id]/route";
import { GET as sourcesGET } from "@/app/api/sources/route";
import { GET as healthGET } from "@/app/api/health/route";
import { POST as importPOST } from "@/app/api/admin/import/route";
import { seededDb, useAsGlobalDb } from "../helpers/db";
import { FIXTURE_DIR, FIXTURE_URLS } from "../helpers/fixtures";

let h: DbHandle;
beforeAll(async () => {
  h = await seededDb();
  useAsGlobalDb(h);
});
afterAll(async () => {
  await h?.close();
});

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

describe("read models expose provenance and honest gaps", () => {
  it("HCPCS detail: descriptor, official billing unit, payment history, crosswalk, provenance", async () => {
    const d = (await getHcpcsDetail("J9312", h.db))!;
    expect(d.code.longDescription).toBe("Injection, rituximab, 10 mg");
    expect(d.billingUnit).toMatchObject({ text: "10 MG", source: "cms_payment_limits" });
    expect(d.payments.map((p) => p.period)).toEqual(["2026-Q4", "2026-Q3"]);
    expect(d.payments[0].paymentLimit).toBe("72.094");
    expect(d.crosswalk.map((x) => x.ndcFormatted)).toEqual(expect.arrayContaining(["50242-0051-21", "50242-0053-06"]));
    expect(d.relatedBiologics.map((b) => b.slug)).toEqual(expect.arrayContaining(["truxima-rituximab-abbs"]));
    expect(d.provenance.map((p) => p.sourceKey)).toEqual(expect.arrayContaining(["cms_hcpcs", "cms_payment_limits", "cms_ndc_hcpcs"]));
    for (const p of d.provenance) expect(p).toMatchObject({ organization: "CMS", status: "official-cms" });
  });

  it("13. missing source data is represented as absent, never substituted", async () => {
    const d = (await getHcpcsDetail("J3490", h.db))!;
    expect(d.code.isNoc).toBe(true);
    expect(d.payments).toEqual([]);
    expect(d.crosswalk).toEqual([]);
    expect(d.billingUnit.text).toBeNull();
    expect(d.billingUnit.source).toBeNull();
  });

  it("drug detail: packages with crosswalk units, codes, biosimilars", async () => {
    const d = (await getDrugDetail("rituxan-rituximab", h.db))!;
    expect(d.drug.hcpcsCodes).toEqual(["J9312"]);
    expect(d.packages.find((k) => k.ndc11 === "50242005121")?.crosswalk[0]).toMatchObject({ hcpcsCode: "J9312", billUnitsPerPackage: "10" });
    expect(d.biosimilars.map((b) => b.slug)).toEqual(expect.arrayContaining(["riabni-rituximab-arrx", "ruxience-rituximab-pvvr", "truxima-rituximab-abbs"]));
    expect(d.provenance.some((p) => p.sourceKey === "fda_purple_book" && p.status === "official-fda")).toBe(true);
  });

  it("drug detail: home infusion per diem S-codes from the FDA class and route", async () => {
    const rituxan = (await getDrugDetail("rituxan-rituximab", h.db))!;
    expect(rituxan.perDiem.status).toBe("matched");
    expect(rituxan.perDiem.matches[0]).toMatchObject({ therapy: { id: "chemotherapy" }, basis: "fda-epc", evidence: ["CD20-directed Cytolytic Antibody"] });
    // The fixture HCPCS file carries no S-codes, so the descriptor is reported missing rather than invented.
    expect(rituxan.perDiem.matches[0].codes.map((c) => [c.code, c.description])).toEqual([["S9329", null], ["S9330", null], ["S9331", null]]);
    // Reimbursement fields are read from the CMS files too, and stay empty when the file has no row.
    expect(rituxan.perDiem.matches[0].codes[0]).toMatchObject({ coverageCode: null, pricingIndicators: [], payment: null });
    // State Medicaid: the Washington schedule rides along with its release, and lists none of the drug's per diems.
    const [wa] = rituxan.stateFeeSchedules;
    expect(wa).toMatchObject({ state: "WA", payer: "Washington Apple Health (Medicaid)", effectiveDate: "2026-07-01" });
    expect(wa.release).toMatchObject({ sourceKey: "wa_hca_home_infusion", status: "official-state" });
    expect(wa.rows).toHaveLength(59);
    expect(wa.rows.some((r) => ["S9329", "S9330", "S9331"].includes(r.hcpcsCode))).toBe(false);
    expect(rituxan.provenance.some((p) => p.sourceKey === "wa_hca_home_infusion")).toBe(true);
    const prolia = (await getDrugDetail("prolia-denosumab", h.db))!;
    expect(prolia.perDiem.status).toBe("unclassified");
    expect(prolia.perDiem.matches[0].codes.find((c) => c.suggested)?.code).toBe("S9542");
    const ozurdex = (await getDrugDetail("ozurdex-dexamethasone", h.db))!;
    expect(ozurdex.perDiem).toMatchObject({ status: "not-applicable", matches: [] });
  });

  it("NDC detail: FDA listing plus CMS crosswalk", async () => {
    const d = (await getNdcDetail("00006302602", h.db))!;
    expect(d.formatted).toBe("00006-3026-02");
    expect(d.fda[0].product.proprietaryName).toBe("KEYTRUDA");
    expect(d.codes.map((c) => c.code)).toEqual(["J9271"]);
  });
});

describe("quarterly changes", () => {
  it("compares the two newest payment quarters and flags drug codes", async () => {
    const d = await quarterlyChanges(null, h.db);
    expect(d.period).toBe("2026-Q4");
    expect(d.previous).toBe("2026-Q3");
    expect(d.periods).toEqual(["2026-Q4", "2026-Q3"]);
    const j9312 = d.limitChanges.find((c) => c.code === "J9312");
    expect(j9312).toMatchObject({ after: 72.094, isDrug: true });
    for (const c of d.limitChanges) expect(c.before).not.toBe(c.after);
    // One crosswalk quarter in the fixtures: nothing to compare, and nothing invented.
    expect(d.crosswalk).toMatchObject({ period: "2026-Q4", previous: null, added: [], removed: [] });
    expect((await quarterlyChanges("2026-Q3", h.db)).previous).toBeNull();
  });
});

describe("biosimilar comparator", () => {
  it("groups each brand under its own Purple Book reference even when brands share a BLA", async () => {
    // Fresenius Kabi licenses Conexxence (reference Prolia) and Bomyntra (reference Xgeva) under BLA 761398.
    const { groups } = await biosimilarGroups(h.db);
    const members = (ref: string) => groups.find((g) => g.referenceName === ref)?.products.map((p) => `${p.role}:${p.displayName}`);
    expect(members("Prolia")).toEqual(["reference:Prolia", "interchangeable:Conexxence"]);
    expect(members("Xgeva")).toEqual(["reference:Xgeva", "interchangeable:Bomyntra"]);
  });
});

describe("API routes return the documented envelope", () => {
  it("GET /api/search", async () => {
    const res = await searchGET(req("/api/search?q=J9271"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.hits[0].key).toBe("J9271");
    expect(body.meta).toMatchObject({ pagination: { page: 1 }, match: { queryType: "hcpcs_code", normalized: "J9271" } });
    expect(body.meta.requestId).toBeTruthy();
    expect(res.headers.get("cache-control")).toMatch(/s-maxage/);
  });

  it("GET /api/search rejects invalid parameters with details", async () => {
    const res = await searchGET(req("/api/search?q=&pageSize=1000"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("INVALID_PARAMETER");
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  it("GET /api/suggest", async () => {
    const body = await (await suggestGET(req("/api/suggest?q=keyt"))).json();
    expect(body.data.groups[0].items[0].title).toBe("Keytruda");
  });

  it("GET /api/hcpcs/[code] with provenance, 400 and 404", async () => {
    const ok = await hcpcsGET(req("/api/hcpcs/j9271"), params({ code: "j9271" }));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.data.code.code).toBe("J9271");
    expect(body.meta.provenance.length).toBeGreaterThan(0);
    expect((await hcpcsGET(req("/api/hcpcs/96413"), params({ code: "96413" }))).status).toBe(400);
    expect((await hcpcsGET(req("/api/hcpcs/J0001"), params({ code: "J0001" }))).status).toBe(404);
  });

  it("GET /api/ndc/[ndc] normalizes formats and rejects ambiguous input", async () => {
    const ok = await ndcGET(req("/api/ndc/0006-3026-02"), params({ ndc: "0006-3026-02" }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).meta.match.formatted).toBe("00006-3026-02");
    const amb = await ndcGET(req("/api/ndc/0006302602"), params({ ndc: "0006302602" }));
    expect(amb.status).toBe(400);
  });

  it("GET /api/drugs/[slug] and /api/manufacturers/[id]", async () => {
    const keytruda = await drugGET(req("/x"), params({ slug: "keytruda-pembrolizumab" }));
    expect(keytruda.status).toBe(200);
    expect((await keytruda.json()).data.perDiem.matches.map((m: { therapy: { id: string } }) => m.therapy.id)).toEqual(["chemotherapy"]);
    expect((await drugGET(req("/x"), params({ slug: "no-such-drug" }))).status).toBe(404);
    expect((await drugGET(req("/x"), params({ slug: "../etc" }))).status).toBe(400);
    expect((await mfrGET(req("/x"), params({ id: "genentech-inc" }))).status).toBe(200);
  });

  it("GET /api/sources and /api/health", async () => {
    const s = await (await sourcesGET(req("/api/sources"))).json();
    expect(s.data.releases.length).toBeGreaterThanOrEqual(8);
    const health = await (await healthGET(req("/api/health"))).json();
    expect(health.data.status).toBe("ok");
    expect(health.data.counts.hcpcsCodes).toBeGreaterThan(0);
  });

  it("POST /api/admin/import is hidden without a token and rejects bad tokens", async () => {
    const prev = process.env.CODERX_ADMIN_TOKEN;
    delete process.env.CODERX_ADMIN_TOKEN;
    expect((await importPOST(req("/api/admin/import", { method: "POST" }))).status).toBe(404);
    process.env.CODERX_ADMIN_TOKEN = "a".repeat(48);
    const res = await importPOST(req("/api/admin/import", { method: "POST", headers: { authorization: "Bearer wrong" } }));
    expect(res.status).toBe(401);
    const bad = await importPOST(req("/api/admin/import", { method: "POST", headers: { authorization: `Bearer ${"a".repeat(48)}` }, body: "{not json" }));
    expect(bad.status).toBe(400);

    // Upload mode: the official URL must belong to the source's own publisher.
    const auth = { authorization: `Bearer ${"a".repeat(48)}` };
    const xlsx = new Uint8Array(readFileSync(join(FIXTURE_DIR, "wa-hca-home-infusion-20260701.xlsx")));
    const upload = (qs: string) => importPOST(req(`/api/admin/import?${qs}`, { method: "POST", headers: auth, body: xlsx }));
    expect((await upload(`source=wa_hca_home_infusion&url=${encodeURIComponent("https://www.cms.gov/files/x.xlsx")}`)).status).toBe(400);
    expect((await upload(`source=cms_hcpcs&url=${encodeURIComponent(FIXTURE_URLS.waHcaHomeInfusion)}`)).status).toBe(400);
    const ok = await upload(`source=wa_hca_home_infusion&period=2026-07-01&url=${encodeURIComponent(FIXTURE_URLS.waHcaHomeInfusion)}`);
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.outcome.status).toBe("skipped"); // same file the fixture import already loaded
    if (prev) process.env.CODERX_ADMIN_TOKEN = prev;
    else delete process.env.CODERX_ADMIN_TOKEN;
  });
});
