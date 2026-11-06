import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { benefitData, resolveBenefitQuery } from "@/lib/data/benefit";
import { partDListing } from "@/lib/data/part-d";
import { seededDb, seededDbWithout } from "../helpers/db";

let h: DbHandle;
beforeAll(async () => {
  h = await seededDb();
}, 120_000);
afterAll(async () => {
  await h.close();
});

const PROXY = "55513071001"; // Prolia's proxy NDC in the CMS fixture
const SAME_PRODUCT = "55513071021"; // another Prolia package
const UNRELATED = "00000000000";

describe("benefit facts", () => {
  it("reads a route-specific SAD entry", async () => {
    const d = await benefitData({ code: "J0490" }, h.db);
    expect(d.found).toBe(true);
    expect(d.facts.sad).toMatchObject({ status: "route_specific", displayId: "A53033", contractorsTotal: 2 });
    expect(d.facts.oppsStatus).toBe("K");
    expect(d.asp).toMatchObject({ limit: expect.any(Number) });
    expect(d.opps).toMatchObject({ statusIndicator: "K", paymentRate: 58.333 });
  });
  it("reads a listed drug with its contractor count", async () => {
    const d = await benefitData({ code: "J1438" }, h.db);
    expect(d.facts.sad).toMatchObject({ status: "listed", contractorsListing: 2 });
  });
  it("reads DME policies", async () => {
    const d = await benefitData({ code: "J3285" }, h.db);
    expect(d.facts.dmePolicies).toContain("pump");
    expect(d.policyLinks).toContainEqual({ policy: "pump", displayId: "L33794", title: "External Infusion Pumps" });
  });
  it("ignores ended SAD rows", async () => {
    const d = await benefitData({ code: "J0129" }, h.db);
    expect(d.facts.sad?.status).toBe("not_listed");
  });
  it("treats a NOC code with listed products as catch_all", async () => {
    const d = await benefitData({ code: "J3590" }, h.db);
    expect(d.facts.isNoc).toBe(true);
    expect(d.facts.sad?.status).toBe("catch_all");
    expect(d.facts.sad?.products).toHaveLength(2);
  });
  it("reports an unlisted drug as not listed with no contractors", async () => {
    expect((await benefitData({ code: "J9312" }, h.db)).facts.sad).toMatchObject({ status: "not_listed", contractorsListing: 0 });
  });
  it("carries the inpatient deductible for the copay cap", async () => {
    expect((await benefitData({ code: "J9312" }, h.db)).inpatientDeductible).toBe(1736);
  });
  it("finds NDCs through the crosswalk, and FDA routes through them", async () => {
    const d = await benefitData({ code: "J9312" }, h.db);
    expect(d.facts.routes).toContain("INTRAVENOUS");
    expect(d.facts.productType).toBe("HUMAN PRESCRIPTION DRUG");
  });
  it("reports an unknown code as not found", async () => {
    expect((await benefitData({ code: "J0001" }, h.db)).found).toBe(false);
  });
  it("never carries MultiCare benchmark data", async () => {
    const text = JSON.stringify(await benefitData({ code: "J9312" }, h.db));
    expect(text).not.toMatch(/commercialBenchmark|hospitalRates|negotiated/i);
  });
  it("names the sources it used", async () => {
    const keys = (await benefitData({ code: "J0490" }, h.db)).provenance.map((p) => p.sourceKey);
    expect(keys).toEqual(expect.arrayContaining(["cms_mcd_articles", "cms_mcd_lcds", "cms_partd_wa", "cms_payment_limits"]));
  });
});

describe("Part D link", () => {
  it("links a drug by exact NDC, with plan counts", async () => {
    const l = (await partDListing(h.db, [PROXY], "J0897"))!;
    expect(l.linkedBy).toContain("ndc");
    expect(l.plansListing).toEqual({ pdp: 1, mapd: 2 });
    expect(l.plansTotal).toEqual({ pdp: 1, mapd: 2 });
    expect(l).toMatchObject({ tierMin: 4, tierMax: 4, priorAuth: 0, stepTherapy: 0, quantityLimit: 3, selectedDrug: false });
  });
  it("links another package of the same product", async () => {
    const l = (await partDListing(h.db, [SAME_PRODUCT], "J0897"))!;
    expect(l.linkedBy).toContain("product");
    expect(l.plansListing).toEqual({ pdp: 1, mapd: 2 });
  });
  it("links through RxCUI when no NDC matches, as a union of plans", async () => {
    await h.db.insert(t.ndcRxcui).values({ productNdc9: "000000001", rxcui: "993456", sourceReleaseId: (await h.db.select({ id: t.sourceReleases.id }).from(t.sourceReleases).where(eq(t.sourceReleases.sourceKey, "fda_ndc_rxcui")))[0].id });
    const l = (await partDListing(h.db, ["00000000199"], null))!;
    expect(l.linkedBy).toEqual(["rxcui"]);
    expect(l.plansListing).toEqual({ pdp: 1, mapd: 2 });
  });
  it("does not double-count a plan across a drug's RxCUIs", async () => {
    const [row] = await h.db.select().from(t.partdWaFormularyDrugs).limit(1);
    await h.db.insert(t.partdWaFormularyDrugs).values({ ...row, id: undefined, rxcui: "993452" }); // Prolia's other RxCUI, in the openFDA fixture
    const l = (await partDListing(h.db, [PROXY], "J0897"))!;
    expect(l.plansListing).toEqual({ pdp: 1, mapd: 2 });
  });
  it("returns zero plans, not an error, when nothing links", async () => {
    expect((await partDListing(h.db, [UNRELATED], null))?.plansListing).toEqual({ pdp: 0, mapd: 0 });
  });
  it("returns zero plans for no NDCs", async () => {
    expect((await partDListing(h.db, [], null))?.linkedBy).toEqual([]);
  });
  it("carries costs with what is needed to convert them", async () => {
    const l = (await partDListing(h.db, [PROXY], "J0897"))!;
    expect(l.costs).toEqual([expect.objectContaining({ unitCostMedian: 1846.1841, dosageForm: "INJECTION" })]);
  });
});

describe("missing sources", () => {
  it("names missing sources when a feed is absent", async () => {
    const empty = await seededDbWithout(["cms_partd_wa", "cms_mcd_lcds"]);
    const d = await benefitData({ code: "J9312" }, empty.db);
    expect(d.found).toBe(true);
    expect(d.facts.dmePolicies).toBeNull();
    expect(d.partD).toBeNull();
    expect(d.missingSources).toEqual(expect.arrayContaining(["cms_partd_wa", "cms_mcd_lcds"]));
    await empty.close();
  }, 120_000);
  it("reports no SAD fact when the article export is absent", async () => {
    const empty = await seededDbWithout(["cms_mcd_articles"]);
    expect((await benefitData({ code: "J9312" }, empty.db)).facts.sad).toBeNull();
    await empty.close();
  }, 120_000);
});

describe("resolving what the user typed", () => {
  it("takes a HCPCS code", async () => {
    expect(await resolveBenefitQuery("j9312", h.db)).toMatchObject({ code: "J9312", slug: null, choices: [] });
  });
  it("takes an NDC", async () => {
    expect((await resolveBenefitQuery("50242-0051-21", h.db)).code).toBe("J9312");
  });
  it("takes a drug name", async () => {
    expect(await resolveBenefitQuery("rituxan", h.db)).toMatchObject({ code: "J9312", slug: "rituxan-rituximab" });
  });
  it("finds nothing for nonsense", async () => {
    expect(await resolveBenefitQuery("zzzzqq", h.db)).toEqual({ code: null, slug: null, choices: [] });
  });
  it("offers each code of a drug with several", async () => {
    const r = await resolveBenefitQuery("aranesp", h.db);
    expect(r.code).toBeNull();
    expect(r.slug).toMatch(/^aranesp/);
    expect(r.choices.map((c) => c.code).sort()).toEqual(["J0881", "J0882"]);
  });
  it("decides nothing for a multi-code drug until a code is chosen", async () => {
    const { slug } = await resolveBenefitQuery("aranesp", h.db);
    const d = await benefitData({ slug: slug! }, h.db);
    expect(d.code).toBeNull();
    expect(d.found).toBe(true);
    expect([...d.codes].sort()).toEqual(["J0881", "J0882"]);
  });
  it("keeps each code's SAD status separate", async () => {
    expect((await benefitData({ code: "J3357" }, h.db)).facts.sad?.status).toBe("listed");
    expect((await benefitData({ code: "J3358" }, h.db)).facts.sad?.status).toBe("not_listed");
  });
});
