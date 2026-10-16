import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@/lib/db/client";
import { rowsOf } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { importRelease, runDerive } from "@/ingest/pipeline";
import { FIXTURE_DIR, FIXTURE_RELEASES, FIXTURE_URLS, fixtureFetcher } from "../helpers/fixtures";
import { seededDb } from "../helpers/db";

let h: DbHandle;
const count = async (table: string, where = sql`TRUE`) =>
  Number(rowsOf<{ n: number }>(await h.db.execute(sql`SELECT count(*)::int AS n FROM ${sql.raw(table)} WHERE ${where}`))[0].n);

beforeAll(async () => {
  h = await seededDb();
});
afterAll(async () => {
  await h?.close();
});

describe("ingestion pipeline (real CMS/FDA excerpts)", () => {
  it("records every release with checksum, dates, and status", async () => {
    const releases = await h.db.select().from(t.sourceReleases);
    expect(releases).toHaveLength(FIXTURE_RELEASES.length);
    for (const r of releases) {
      expect(r.status).toBe("succeeded");
      expect(r.isCurrent).toBe(true);
      expect(r.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(r.recordCount).toBeGreaterThan(0);
      expect(r.downloadUrl).toMatch(/^https:\/\/(www\.cms\.gov|www\.accessdata\.fda\.gov)\//);
    }
    const pay = releases.find((r) => r.sourceKey === "cms_payment_limits" && r.periodLabel === "2026-Q4")!;
    expect(pay).toMatchObject({ effectiveStart: "2026-10-01", effectiveEnd: "2026-12-31", publicationLabel: "09/17/2026 - Final file" });
  });

  it("loads all three MUE tables with their service type", async () => {
    const rows = await h.db.select().from(t.mueValues).where(eq(t.mueValues.hcpcsCode, "J2783"));
    const by = Object.fromEntries(rows.map((r) => [r.serviceType, r.mueValue]));
    expect(by).toEqual({ practitioner: 60, outpatient_hospital: 60, dme_supplier: 0 });
    const release = (await h.db.select().from(t.sourceReleases).where(eq(t.sourceReleases.sourceKey, "cms_mue_practitioner")))[0];
    expect(release).toMatchObject({ effectiveStart: "2026-10-01", effectiveEnd: "2026-12-31", periodLabel: "2026-Q4" });
    expect((release.report as { excluded: { cptRows: number } }).excluded.cptRows).toBe(2);
  });

  it("stores no CPT content", async () => {
    expect(await count("payment_limits", sql`hcpcs_code ~ '^[0-9]'`)).toBe(0);
    expect(await count("mue_values", sql`hcpcs_code ~ '^[0-9]'`)).toBe(0);
    expect(await count("ndc_hcpcs_crosswalk", sql`hcpcs_code ~ '^[0-9]'`)).toBe(0);
    expect(await count("hcpcs_codes", sql`code !~ '^[A-Z][0-9]{4}$'`)).toBe(0);
  });

  it("builds HCPCS history from quarterly snapshots", async () => {
    const hist = await h.db.select().from(t.hcpcsCodeHistory).where(sql`${t.hcpcsCodeHistory.code} IN ('J9020','S0189','J9277','C9027')`);
    const by = (code: string) => hist.filter((r) => r.code === code).map((r) => `${r.period}:${r.changeType}`).sort();
    expect(by("J9020")).toEqual(["2025-Q4:baseline", "2026-Q4:terminated"]);
    expect(by("S0189")).toEqual(["2025-Q4:baseline", "2026-Q4:terminated"]);
    expect(by("J9277")).toEqual(["2026-Q4:added"]);
    expect(by("C9027")).toEqual(["2025-Q4:baseline"]);
    const [s0189] = await h.db.select().from(t.hcpcsCodes).where(eq(t.hcpcsCodes.code, "S0189"));
    expect(s0189.terminationDate).toBe("2025-12-31");
  });

  it("flags NOC codes from the CMS list and drug codes from official fields", async () => {
    const rows = await h.db.select({ code: t.hcpcsCodes.code, isNoc: t.hcpcsCodes.isNoc, isDrug: t.hcpcsCodes.isDrug }).from(t.hcpcsCodes);
    const get = (c: string) => rows.find((r) => r.code === c)!;
    expect(get("J3490").isNoc).toBe(true);
    expect(get("C9399").isNoc).toBe(true);
    expect(get("J9271").isNoc).toBe(false);
    expect(get("J9271").isDrug).toBe(true);
  });

  it("links NDCs to codes only through CMS crosswalk rows", async () => {
    const orphanLinks = rowsOf<{ n: number }>(
      await h.db.execute(sql`SELECT count(*)::int AS n FROM code_relationships r
        WHERE r.kind = 'NDC_HCPCS' AND NOT EXISTS (SELECT 1 FROM ndc_hcpcs_crosswalk x WHERE x.ndc11 = r.ndc11 AND x.hcpcs_code = r.hcpcs_code)`),
    )[0].n;
    expect(orphanLinks).toBe(0);
    // Every derived drug → code link must be backed by crosswalk rows for each NDC it cites.
    const unsupported = rowsOf<{ n: number }>(
      await h.db.execute(sql`SELECT count(*)::int AS n FROM code_relationships r, jsonb_array_elements_text(r.evidence->'ndcs') AS e(ndc)
        WHERE r.kind = 'DRUG_HCPCS' AND NOT EXISTS (SELECT 1 FROM ndc_hcpcs_crosswalk x WHERE x.ndc11 = e.ndc AND x.hcpcs_code = r.hcpcs_code)`),
    )[0].n;
    expect(unsupported).toBe(0);
  });

  it("never infers a code from a shared generic name", async () => {
    // FDA lists Renflexis with the nonproprietary name "infliximab" — the same text as Remicade —
    // but CMS crosswalks its NDCs to Q5104, not J1745. CodeRx must follow CMS, not the name.
    const rows = await h.db.select({ slug: t.drugs.slug, generic: t.drugs.genericName, codes: t.drugs.hcpcsCodes }).from(t.drugs).where(sql`lower(${t.drugs.genericName}) = 'infliximab'`);
    const renflexis = rows.find((r) => r.slug.startsWith("renflexis"))!;
    const remicade = rows.find((r) => r.slug.startsWith("remicade"))!;
    expect(renflexis.codes).toEqual(["Q5104"]);
    expect(remicade.codes).toEqual(["J1745"]);
  });

  it("derives drug → HCPCS links from NDC-level evidence and labels them derived", async () => {
    const [keytruda] = await h.db.select().from(t.drugs).where(eq(t.drugs.slug, "keytruda-pembrolizumab"));
    expect(keytruda.hcpcsCodes).toEqual(["J9271"]);
    const [rel] = await h.db.select().from(t.codeRelationships).where(and(eq(t.codeRelationships.kind, "DRUG_HCPCS"), eq(t.codeRelationships.drugId, keytruda.id)));
    expect(rel).toMatchObject({ hcpcsCode: "J9271", authority: "DERIVED", reviewStatus: "NOT_REQUIRED", isCurrent: true });
    expect((rel.evidence as { ndcs: string[] }).ndcs).toContain("00006302602");
  });

  it("links biosimilars to their reference product via FDA Purple Book BLA numbers", async () => {
    const rows = rowsOf<{ slug: string; ref: string; status: string }>(
      await h.db.execute(sql`SELECT d.slug, r.slug AS ref, d.biosimilar_status AS status FROM drugs d JOIN drugs r ON r.id = d.reference_drug_id ORDER BY d.slug`),
    );
    const refOf = (slug: string) => rows.find((r) => r.slug === slug)?.ref;
    expect(refOf("truxima-rituximab-abbs")).toBe("rituxan-rituximab");
    expect(refOf("ruxience-rituximab-pvvr")).toBe("rituxan-rituximab");
    expect(refOf("riabni-rituximab-arrx")).toBe("rituxan-rituximab");
    const [rituxan] = await h.db.select().from(t.drugs).where(eq(t.drugs.slug, "rituxan-rituximab"));
    expect(rituxan.biosimilarStatus).toBe("reference");
    expect(await count("code_relationships", sql`kind = 'BIOSIMILAR_REFERENCE' AND authority = 'OFFICIAL'`)).toBeGreaterThanOrEqual(3);
  });

  it("keeps CMS-crosswalked NDCs that left the FDA directory as excluded listings", async () => {
    expect(await count("ndc_packages", sql`listing_status = 'excluded'`)).toBeGreaterThan(0);
    expect(await count("ndc_packages", sql`listing_status = 'excluded' AND exclude_flag IS NULL`)).toBe(0);
  });

  it("is idempotent: re-importing an unchanged file is skipped", async () => {
    const before = await count("payment_limits");
    const outcome = await importRelease(h.db, FIXTURE_RELEASES[3], { fetcher: fixtureFetcher(), plausibility: "relaxed" });
    expect(outcome.status).toBe("skipped");
    expect(await count("payment_limits")).toBe(before);
  });

  it("rolls back a corrupted download and records the failure without touching current data", async () => {
    const good = rowsOf<{ n: number }>(await h.db.execute(sql`SELECT count(*)::int AS n FROM payment_limits`))[0].n;
    const corrupted = new Uint8Array((await fixtureFetcher()(FIXTURE_URLS.payment2026q4)).bytes);
    // Flip a byte inside the first entry's compressed data (after the local header and file name).
    const dataStart = 30 + (corrupted[26] | (corrupted[27] << 8)) + (corrupted[28] | (corrupted[29] << 8));
    corrupted[dataStart + 5] ^= 0xff;
    const outcome = await importRelease(h.db, FIXTURE_RELEASES[3], {
      fetcher: fixtureFetcher({ [FIXTURE_URLS.payment2026q4]: corrupted }),
      plausibility: "relaxed",
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.reason).toMatch(/CRC|corrupt|ZIP/i);
    expect(await count("payment_limits")).toBe(good);
    const failed = await h.db.select().from(t.sourceReleases).where(eq(t.sourceReleases.status, "failed"));
    expect(failed).toHaveLength(1);
    expect(failed[0].error).toBeTruthy();
    const current = await h.db.select().from(t.sourceReleases).where(and(eq(t.sourceReleases.sourceKey, "cms_payment_limits"), eq(t.sourceReleases.periodLabel, "2026-Q4"), eq(t.sourceReleases.isCurrent, true)));
    expect(current).toHaveLength(1);
    expect(current[0].status).toBe("succeeded");
  });

  it("rolls back when a file fails validation midway (missing header)", async () => {
    const broken = zipSync({ "section 508 version of October 2026 Medicare Part B Payment Limit File 091626.csv": new TextEncoder().encode("not,a,cms,file\n1,2,3,4\n") });
    const outcome = await importRelease(h.db, FIXTURE_RELEASES[3], { fetcher: fixtureFetcher({ [FIXTURE_URLS.payment2026q4]: broken }), plausibility: "relaxed" });
    expect(outcome.status).toBe("failed");
    expect(outcome.reason).toMatch(/header row/i);
  });

  it("supersedes a re-posted quarter and reports the difference (real rows only)", async () => {
    // CMS re-posts quarters; simulate a re-post that drops one real row (no values are altered).
    const text = readFileSync(join(FIXTURE_DIR, "payment-2026q4.csv"), "latin1");
    const reposted = text.replace(/^J1100,[^\r\n]*\r?\n/m, "");
    expect(reposted).not.toBe(text);
    const zip = zipSync({ "section 508 version of October 2026 Medicare Part B Payment Limit File 091626.csv": new Uint8Array(Buffer.from(reposted, "latin1")) });
    const outcome = await importRelease(
      h.db,
      { ...FIXTURE_RELEASES[3], publicationLabel: "Final file - revised (test re-post)" },
      { fetcher: fixtureFetcher({ [FIXTURE_URLS.payment2026q4]: zip }), plausibility: "relaxed", skipDerive: true },
    );
    expect(outcome.status).toBe("imported");
    expect(outcome.report?.diff).toMatchObject({ revisionOfExistingQuarter: true, removedCodes: 1, changedLimits: 0 });
    const q4 = await h.db.select().from(t.sourceReleases).where(and(eq(t.sourceReleases.sourceKey, "cms_payment_limits"), eq(t.sourceReleases.periodLabel, "2026-Q4")));
    expect(q4.filter((r) => r.isCurrent)).toHaveLength(1);
    expect(q4.filter((r) => r.status === "superseded")).toHaveLength(1);
    await runDerive(h.db);
  });
});
