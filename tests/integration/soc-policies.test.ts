/** Payer site-of-care uploads and the /tools/soc-check read model on PGlite. */
import { gzipSync } from "node:zlib";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/admin/soc-policies/route";
import { importSocUpload, socUploadSchema, type SocUpload } from "@/ingest/soc-policies";
import { socData, withRule } from "@/lib/data/soc";
import type { DbHandle } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { SOC_RULES } from "@/lib/soc/rules";
import { freshDb, useAsGlobalDb } from "../helpers/db";

let h: DbHandle;
beforeAll(async () => {
  h = await freshDb();
  useAsGlobalDb(h);
}, 120_000);
afterAll(async () => {
  await h.close();
});

const sha = (n: number) => n.toString(16).padStart(64, "0");
const entry = (code: string, label: string, addedDate: string | null = "2024-10-01") => ({ code, label, addedDate, oncologyStar: false, homeInfusionEligible: "Yes" as const });
const regence = (n: number, codes: [string, string][], criteriaHash = SOC_RULES.regence.writtenFrom.criteriaHash, future?: [string, string][]): SocUpload => ({
  payerKey: "regence",
  sha256: sha(n),
  documents: [
    {
      role: "policy",
      url: "https://regence.myprime.com/content/dam/prime/memberportal/forms/AuthorForms/Cambia/Program_Summaries/dru408reg.pdf",
      title: "Site of Care Review",
      policyNumber: "dru408",
      effectiveDate: "2026-09-01",
      sha256: sha(n + 100),
      criteriaText: "Policy/Criteria\nNOTE – Grace period: … the first 30 days …",
      criteriaHash,
      entries: codes.map(([c, l]) => entry(c, l)),
    },
    ...(future
      ? [{ role: "future" as const, url: "https://regence.myprime.com/future.pdf", title: "Site of Care Review", policyNumber: "dru408", effectiveDate: "2027-01-01", sha256: sha(n + 200), criteriaText: "x", criteriaHash, entries: future.map(([c, l]) => entry(c, l)) }]
      : []),
  ],
});
const load = (u: SocUpload) => importSocUpload(h.db, socUploadSchema.parse(u));

describe("site-of-care uploads", () => {
  it("shows every payer with its hand-written rule before anything is loaded", async () => {
    const d = await socData(h.db);
    expect(d.loaded).toBe(false);
    expect(d.payers.map((p) => p.key)).toEqual(["uhc", "premera", "regence", "aetna", "cigna", "anthem"]);
    expect(d.payers.every((p) => p.list === null && !p.changedSinceReview)).toBe(true);
  });

  it("loads a payer's policy and list, and skips the same data", async () => {
    const first = regence(1, [["J3262", "Actemra, tocilizumab"], ["J0256", "Aralast NP"]]);
    expect((await load(first)).status).toBe("imported");
    expect((await load(first)).status).toBe("skipped");
    const p = (await socData(h.db)).payers.find((x) => x.key === "regence")!;
    expect(p.list?.entries.map((e) => e.code)).toEqual(["J0256", "J3262"]);
    expect(p.policy).toMatchObject({ policyNumber: "dru408", effectiveDate: "2026-09-01" });
    expect(p.provenance[0]).toMatchObject({ sourceKey: "payer_soc_policies", status: "insurer-published" });
    expect(p.changedSinceReview).toBe(false);
    // A copy read back from the Data Cache carries the rule as it was cached; withRule swaps in the current one.
    const stale = { ...p, rule: { ...p.rule, writtenFrom: { ...p.rule.writtenFrom, criteriaHash: "stale" } }, changedSinceReview: true };
    expect(withRule(stale)).toMatchObject({ rule: SOC_RULES.regence, changedSinceReview: false });
  });

  it("holds an upload that would remove much of the list, until it is sent with force", async () => {
    const held = await load(regence(2, [["J3262", "Actemra, tocilizumab"], ["J1745", "Remicade, infliximab"]], "0123456789abcdef"));
    expect(held).toMatchObject({ status: "held", changes: { removed: [{ code: "J0256" }] } });
    const p = (await socData(h.db)).payers.find((x) => x.key === "regence")!;
    expect(p.list?.entries.map((e) => e.code)).toEqual(["J0256", "J3262"]);
  });

  it("records what the next refresh changed, and flags new criteria wording until it is reviewed", async () => {
    const result = await load({ ...regence(2, [["J3262", "Actemra, tocilizumab"], ["J1745", "Remicade, infliximab"]], "0123456789abcdef"), force: true });
    expect(result.status).toBe("imported");
    expect(result.changes).toMatchObject({ added: [{ code: "J1745" }], removed: [{ code: "J0256" }], criteriaChanged: true });
    const p = (await socData(h.db)).payers.find((x) => x.key === "regence")!;
    expect(p.changedSinceReview).toBe(true);
    expect(p.history[0].changes).toMatchObject({ added: [{ code: "J1745" }], removed: [{ code: "J0256" }] });
    // One current release per payer; the replaced rows are gone.
    const current = await h.db.select().from(t.sourceReleases).where(and(eq(t.sourceReleases.sourceKey, "payer_soc_policies"), eq(t.sourceReleases.isCurrent, true)));
    expect(current).toHaveLength(1);
    expect(await h.db.$count(t.socListEntries)).toBe(2);
  });

  it("shows what a version posted ahead adds and removes", async () => {
    await load({ ...regence(3, [["J3262", "Actemra, tocilizumab"]], SOC_RULES.regence.writtenFrom.criteriaHash, [["J3262", "Actemra, tocilizumab"], ["J9999", "Newmab"]]), force: true });
    const p = (await socData(h.db)).payers.find((x) => x.key === "regence")!;
    expect(p.future).toMatchObject({ effectiveDate: "2027-01-01", added: [{ code: "J9999", label: "Newmab" }], removed: [], criteriaChanged: false });
    // The list in force is the policy's, not the future version's.
    expect(p.list?.entries.map((e) => e.code)).toEqual(["J3262"]);
  });
});

describe("POST /api/admin/soc-policies", () => {
  const post = (body: Uint8Array | string, headers: Record<string, string>) => POST(new Request("https://x.test/api/admin/soc-policies", { method: "POST", headers, body: typeof body === "string" ? body : new Uint8Array(body) }));
  it("needs the admin token, accepts gzip, and rejects files from other hosts", async () => {
    const prev = process.env.CODERX_ADMIN_TOKEN;
    process.env.CODERX_ADMIN_TOKEN = "a".repeat(48);
    try {
      const upload = regence(3, [["J3262", "Actemra, tocilizumab"]], SOC_RULES.regence.writtenFrom.criteriaHash, [["J3262", "Actemra, tocilizumab"], ["J9999", "Newmab"]]);
      expect((await post(gzipSync(JSON.stringify(upload)), { "content-encoding": "gzip", authorization: `Bearer ${"b".repeat(48)}` })).status).toBe(401);
      const ok = await post(gzipSync(JSON.stringify(upload)), { "content-encoding": "gzip", authorization: `Bearer ${"a".repeat(48)}` });
      expect(ok.status).toBe(200);
      expect((await ok.json()).data).toMatchObject({ status: "skipped" });
      const elsewhere = { ...upload, documents: upload.documents.map((d) => ({ ...d, url: "https://example.com/x.pdf" })) };
      expect((await post(JSON.stringify(elsewhere), { authorization: `Bearer ${"a".repeat(48)}` })).status).toBe(400);
    } finally {
      if (prev) process.env.CODERX_ADMIN_TOKEN = prev;
      else delete process.env.CODERX_ADMIN_TOKEN;
    }
  });
});
