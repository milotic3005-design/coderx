/** Washington formulary uploads (Apple Health PDL, exchange insurers, NADAC) and the coverage read model on PGlite. */
import { gzipSync } from "node:zlib";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/admin/wa-coverage/route";
import { importWaUpload, waUploadSchema, type WaUpload } from "@/ingest/wa-formularies";
import { waCoverage } from "@/lib/data/wa-coverage";
import type { DbHandle } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import type { RxNormResult } from "@/lib/rxnorm";
import { seededDb, useAsGlobalDb } from "../helpers/db";

let h: DbHandle;
beforeAll(async () => {
  h = await seededDb();
  useAsGlobalDb(h);
}, 120_000);
afterAll(async () => {
  await h.close();
});

const DRUG_NDC = "11111111111";
const PROLIA_RXCUI = "993456"; // listed on the Part D fixture's formularies
const sha = (n: number) => n.toString(16).padStart(64, "0");
const filler = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1).padStart(11, "0"));

const appleHealth = (n: number, effectiveStart: string, pa = "Y"): WaUpload => ({
  kind: "apple_health",
  url: "https://www.hca.wa.gov/assets/billers-and-providers/apple-health-preferred-drug-list.xlsx",
  effectiveStart,
  effectiveEnd: null,
  asOf: `Effective ${effectiveStart}`,
  lastModified: null,
  sha256: sha(n),
  bytes: 1000,
  rows: [...filler(1000), DRUG_NDC].map((ndc11) => ({ ndc11, label: ndc11 === DRUG_NDC ? "TESTBRAND" : "FILLER", coverage: "CP", nonCoveredReason: "", pharmacyPreferred: "N", pharmacyPa: ndc11 === DRUG_NDC ? pa : "N", medicalPreferred: "X", medicalPa: "", paPolicy: "" })),
});
const exchange = (insurerKey: "ambetter" | "cambia", n: number, listsDrug: boolean): WaUpload => {
  const planId = insurerKey === "ambetter" ? "61836WA0050007" : "71281WA0010001";
  const fillerDrugs = Array.from({ length: 100 }, (_, i) => ({ rxcui: String(500_000 + i), listings: [{ planId, tier: "GENERIC", pa: false, st: false, ql: false }] }));
  return {
    kind: "exchange",
    insurerKey,
    url: insurerKey === "ambetter" ? "https://api.centene.com/ambetter/reference/drugs-AMB-WA.json" : "https://cms-machine-readable.cambiahealth.com/index.json",
    planYear: 2026,
    asOf: `${insurerKey} formulary file (plan year 2026)`,
    lastModified: "Thu, 12 Nov 2026 02:00:32 GMT",
    sha256: sha(n),
    bytes: 1000,
    plans: [
      {
        planId,
        name: `${insurerKey} Test Silver`,
        costs: { SPECIALTY: "30% coinsurance after deductible" },
        costDetails: {
          SPECIALTY: [
            { pharmacyType: "1-MONTH-IN-RETAIL", copayAmount: 0, copayOpt: null, coinsuranceRate: 0.3, coinsuranceOpt: "AFTER-DEDUCTIBLE" },
            { pharmacyType: "3-MONTH-IN-MAIL", copayAmount: 0, copayOpt: null, coinsuranceRate: 0.3, coinsuranceOpt: "AFTER-DEDUCTIBLE" },
          ],
        },
      },
    ],
    drugs: listsDrug ? [...fillerDrugs, { rxcui: PROLIA_RXCUI, listings: [{ planId, tier: "SPECIALTY", pa: true, st: false, ql: true }] }] : fillerDrugs,
  };
};
const nadac = (n: number): WaUpload => ({
  kind: "nadac",
  url: "https://data.medicaid.gov/dataset/fbb83258-11c7-47f5-8b18-5f8e79f7e704",
  weekOf: "2026-11-11",
  asOf: "NADAC week of 2026-11-11 (2026 dataset)",
  lastModified: null,
  sha256: sha(n),
  bytes: 1000,
  rows: [...filler(1000), DRUG_NDC].map((ndc11) => ({ ndc11, description: ndc11 === DRUG_NDC ? "TESTBRAND 60 MG/ML SYRINGE" : "FILLER", perUnit: ndc11 === DRUG_NDC ? 12.5 : 1, unit: "ML", effectiveDate: "2026-10-21", classification: "B" })),
});
const load = (u: WaUpload) => importWaUpload(h.db, waUploadSchema.parse(u));
const matched = async (): Promise<RxNormResult> => ({ kind: "match", match: { matchedName: "testbrand", rxcuis: [PROLIA_RXCUI], products: [{ rxcui: PROLIA_RXCUI, name: "denosumab 60 MG/ML Prefilled Syringe [Testbrand]" }], ndcs: [DRUG_NDC] } });

describe("Washington formulary uploads", () => {
  it("shows every source as not loaded before any upload, and UMP as link-only", async () => {
    const d = await waCoverage("testbrand", { db: h.db, lookup: matched });
    expect(d.groups.filter((g) => g.state === "missing").map((g) => g.key)).toEqual(["apple_health", "exchange_ambetter", "exchange_cambia"]);
    expect(d.groups.find((g) => g.key === "ump")).toMatchObject({ state: "link-only" });
    expect(d.reference).toBeNull();
  });

  it("imports each dataset once and skips the same data", async () => {
    for (const u of [appleHealth(1, "2026-11-07"), exchange("ambetter", 2, true), exchange("cambia", 3, false), nadac(4)]) {
      expect((await load(u)).status).toBe("imported");
      expect((await load(u)).status).toBe("skipped");
    }
    expect(await h.db.$count(t.waPdlNdcs)).toBe(1001);
    expect(await h.db.$count(t.waExchangePlans)).toBe(2);
  });

  it("replaces the current release and deletes the rows it replaced", async () => {
    const before = await h.db.select().from(t.sourceReleases).where(and(eq(t.sourceReleases.sourceKey, "wa_hca_pdl"), eq(t.sourceReleases.isCurrent, true)));
    expect((await load(appleHealth(5, "2026-11-14", "N"))).status).toBe("imported");
    expect(await h.db.$count(t.waPdlNdcs)).toBe(1001);
    const [old] = await h.db.select().from(t.sourceReleases).where(eq(t.sourceReleases.id, before[0].id));
    expect(old).toMatchObject({ status: "superseded", isCurrent: false });
  });

  it("keeps one current release per insurer", async () => {
    expect((await load(exchange("cambia", 6, false))).status).toBe("imported");
    const current = await h.db.select().from(t.sourceReleases).where(and(eq(t.sourceReleases.sourceKey, "wa_exchange_formularies"), eq(t.sourceReleases.isCurrent, true)));
    expect(current.map((r) => r.periodLabel).sort()).toEqual(["ambetter", "cambia"]);
    expect(await h.db.$count(t.waExchangePlans)).toBe(2);
  });

  it("imports data seen before and since replaced, and re-imports on force without duplicating rows", async () => {
    // Cambia release 3 was replaced by release 6 above; uploading 3 again makes it current instead of skipping it.
    expect((await load(exchange("cambia", 3, false))).status).toBe("imported");
    const forced = await load({ ...exchange("cambia", 3, false), force: true });
    expect(forced.status).toBe("imported");
    const current = await h.db.select().from(t.sourceReleases).where(and(eq(t.sourceReleases.sourceKey, "wa_exchange_formularies"), eq(t.sourceReleases.periodLabel, "cambia"), eq(t.sourceReleases.isCurrent, true)));
    expect(current.map((r) => r.id)).toEqual([forced.releaseId]);
    expect(await h.db.$count(t.waExchangeDrugs, eq(t.waExchangeDrugs.insurerKey, "cambia"))).toBe(100);
  });

  it("rejects an unparsable URL without throwing", () => {
    expect(waUploadSchema.safeParse({ ...nadac(9), url: "https://" }).success).toBe(false);
    expect(waUploadSchema.safeParse({ ...exchange("ambetter", 9, true), url: "not a url" }).success).toBe(false);
  });

  it("rejects listings for plans the upload does not name, and files from other hosts", () => {
    const u = exchange("ambetter", 7, true) as Extract<WaUpload, { kind: "exchange" }>;
    expect(waUploadSchema.safeParse({ ...u, drugs: [...u.drugs, { rxcui: "1", listings: [{ planId: "99999WA9999999", tier: "X", pa: false, st: false, ql: false }] }] }).success).toBe(false);
    expect(waUploadSchema.safeParse({ ...u, url: "https://example.com/drugs.json" }).success).toBe(false);
    expect(waUploadSchema.safeParse({ ...u, insurerKey: "cambia" }).success).toBe(false);
  });
});

describe("coverage read model", () => {
  it("answers each plan from the current releases", async () => {
    const d = await waCoverage("testbrand", { db: h.db, lookup: matched });
    const group = (key: string) => d.groups.find((g) => g.key === key)!;
    expect(group("apple_health").rows[0]).toMatchObject({ covered: "yes", priorAuth: "no", tier: "Non-preferred" });
    expect(group("apple_health").provenance[0]).toMatchObject({ sourceKey: "wa_hca_pdl", period: "2026-11-14", status: "official-state" });
    expect(group("partd")).toMatchObject({ state: "ok" });
    expect(group("partd").rows[0].coveredNote).toMatch(/^\d+ of \d+ plans$/);
    expect(group("exchange_ambetter").rows).toEqual([expect.objectContaining({ plan: "ambetter Test Silver (61836WA0050007)", covered: "yes", priorAuth: "yes", quantityLimit: "yes", costSharing: "30% coinsurance after deductible" })]);
    expect(group("exchange_ambetter").provenance[0]).toMatchObject({ organization: "Ambetter (Centene)", status: "insurer-published" });
    expect(group("exchange_cambia").rows[0]).toMatchObject({ covered: "no" });
    expect(d.reference?.prices).toEqual([expect.objectContaining({ product: "TESTBRAND 60 MG/ML SYRINGE", low: 12.5, brandOrGeneric: "brand" })]);
  });
  it("compares the stated copays of every plan that lists the drug, flat copays lowest first", async () => {
    const { copays } = await waCoverage("testbrand", { db: h.db, lookup: matched });
    expect(copays).toMatchObject({ partdLoaded: true, exchangeMissing: [] });
    // Part D fixture: $47 copay (deductible applies, $615 deductible), standard-retail-only $100 copay, 25% coinsurance; Ambetter 30% after deductible. Cambia does not list the drug.
    expect(copays.rows.map((r) => [r.planId, r.cost, r.deductibleFirst])).toEqual([
      ["H1036-306-000", "$47.00 copay", "yes"],
      ["S5617-148-000", "$100.00 copay", "no"],
      ["H1036-319-000", "25% coinsurance", "yes"],
      ["61836WA0050007", "30% coinsurance", "yes"],
    ]);
    expect(copays.rows[0]).toMatchObject({ plan: "Humana Gold Plus - Diabetes and Heart (HMO C-SNP)", tier: "Tier 4", supply: "30-day, preferred retail", deductibleNote: "Plan deductible $615.00", other: ["Standard retail: $52.00 copay"] });
    expect(copays.rows[1]).toMatchObject({ supply: "30-day, standard retail", restrictions: "quantity limit", deductibleNote: null });
    expect(copays.rows[3]).toMatchObject({ insurer: "Ambetter", supply: "1-month retail", other: ["3-month mail order: 30% coinsurance after deductible"] });
    expect(copays.provenance.map((p) => p.sourceKey)).toEqual(["cms_partd_wa", "wa_exchange_formularies", "wa_exchange_formularies"]);
  });
  it("reads nothing when RxNorm has no exact match", async () => {
    const d = await waCoverage("tesbrand", { db: h.db, lookup: async () => ({ kind: "suggestions", suggestions: ["Testbrand"] }) });
    expect(d).toMatchObject({ groups: [], reference: null, lookup: { kind: "suggestions" } });
  });
});

describe("general import endpoint", () => {
  it("refuses sources that only arrive through their own upload endpoints", async () => {
    const { importBodySchema } = await import("@/lib/api/validation");
    for (const source of ["cms_nadac", "wa_hca_pdl", "wa_exchange_formularies", "hpt_multicare"]) expect(importBodySchema.safeParse({ source }).success).toBe(false);
    expect(importBodySchema.safeParse({ source: "cms_partd_wa" }).success).toBe(true);
  });
});

describe("POST /api/admin/wa-coverage", () => {
  const post = (body: Uint8Array | string, headers: Record<string, string>) => POST(new Request("https://x.test/api/admin/wa-coverage", { method: "POST", headers, body: typeof body === "string" ? body : new Uint8Array(body) }));
  it("needs the admin token, accepts gzip, and skips data it already has", async () => {
    const prev = process.env.CODERX_ADMIN_TOKEN;
    delete process.env.CODERX_ADMIN_TOKEN;
    expect((await post("{}", { authorization: `Bearer ${"a".repeat(48)}` })).status).toBe(404);
    process.env.CODERX_ADMIN_TOKEN = "a".repeat(48);
    try {
      const gz = gzipSync(JSON.stringify(nadac(4)));
      expect((await post(gz, { "content-encoding": "gzip", authorization: `Bearer ${"b".repeat(48)}` })).status).toBe(401);
      const res = await post(gz, { "content-encoding": "gzip", authorization: `Bearer ${"a".repeat(48)}` });
      expect(res.status).toBe(200);
      expect((await res.json()).data).toMatchObject({ status: "skipped", sourceKey: "cms_nadac" });
      expect((await post("not json", { authorization: `Bearer ${"a".repeat(48)}` })).status).toBe(400);
      expect((await post(JSON.stringify({ ...nadac(8), rows: [] }), { authorization: `Bearer ${"a".repeat(48)}` })).status).toBe(400);
    } finally {
      if (prev) process.env.CODERX_ADMIN_TOKEN = prev;
      else delete process.env.CODERX_ADMIN_TOKEN;
    }
  });
});
