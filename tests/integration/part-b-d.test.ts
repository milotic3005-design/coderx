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
    expect(keys).toEqual(expect.arrayContaining(["cms_mcd_articles", "cms_mcd_lcds", "cms_partd_wa", "cms_payment_limits", "cms_ndc_hcpcs", "fda_ndc"]));
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
  it("says zero plans when the drug's RxCUI is known and no plan lists it", async () => {
    const l = (await partDListing(h.db, ["50242005121"], "J9312"))!;
    expect(l.plansListing).toEqual({ pdp: 0, mapd: 0 });
    expect(l.linkedBy).toEqual([]);
  });
  it("claims nothing when no identifier links the drug", async () => {
    expect(await partDListing(h.db, [UNRELATED], null)).toBeNull();
  });
  it("claims nothing when CodeRx has no NDCs for the drug", async () => {
    expect(await partDListing(h.db, [], null)).toBeNull();
  });
  it("carries costs with what is needed to convert them", async () => {
    const l = (await partDListing(h.db, [PROXY], "J0897"))!;
    expect(l.costs).toEqual([expect.objectContaining({ unitCostMedian: 1846.1841, dosageForm: "INJECTION" })]);
  });
});

describe("drugs CMS's current crosswalk does not link", () => {
  it("says nothing about Part D for a code with no NDCs", async () => {
    expect((await benefitData({ code: "J3357" }, h.db)).partD).toBeNull();
  });
  it("still finds the drug by its code", async () => {
    await h.db.update(t.drugs).set({ hcpcsCodes: ["J3357", "J3358"] }).where(eq(t.drugs.slug, "stelara-ustekinumab"));
    const d = await benefitData({ code: "J3357" }, h.db);
    expect(d.facts.routes).toContain("SUBCUTANEOUS");
    expect(d.facts.productType).toBe("HUMAN PRESCRIPTION DRUG");
    expect(d.partD).toBeNull();
  });
});

describe("linking NDCs to a code", () => {
  const release = async (key: "cms_ndc_hcpcs") => (await h.db.select({ id: t.sourceReleases.id }).from(t.sourceReleases).where(eq(t.sourceReleases.sourceKey, key)))[0].id;
  const crosswalkRow = async (hcpcsCode: string, period: string, ndc11: string) => ({ sourceReleaseId: await release("cms_ndc_hcpcs"), period, crosswalkType: "ASP", hcpcsCode, ndcRaw: ndc11, ndc11 });

  it("uses the newest quarter that lists the code when the current one drops it", async () => {
    await h.db.insert(t.ndcHcpcsCrosswalk).values(await crosswalkRow("J1438", "2025-Q1", PROXY));
    const d = await benefitData({ code: "J1438" }, h.db);
    expect(d.partD?.plansListing).toEqual({ pdp: 1, mapd: 2 });
    await h.db.delete(t.ndcHcpcsCrosswalk).where(eq(t.ndcHcpcsCrosswalk.hcpcsCode, "J1438"));
  });
  it("takes routes from the code's own products, not every code of the drug", async () => {
    await h.db.update(t.drugs).set({ hcpcsCodes: ["J3357", "J3358"] }).where(eq(t.drugs.slug, "stelara-ustekinumab"));
    expect((await benefitData({ code: "J3358" }, h.db)).facts.routes).toEqual(["INTRAVENOUS"]);
  });
  it("narrows a shared code to the chosen drug's products", async () => {
    await h.db.insert(t.ndcHcpcsCrosswalk).values(await crosswalkRow("J0897", "2026-Q4", "57894005427")); // another product under the same code
    const [prolia] = await h.db.select({ slug: t.drugs.slug }).from(t.drugs).where(eq(t.drugs.slug, "prolia-denosumab"));
    expect((await benefitData({ code: "J0897" }, h.db)).facts.routes).toContain("INTRAVENOUS");
    const chosen = await benefitData({ code: "J0897", slug: prolia.slug }, h.db);
    expect(chosen.facts.routes).toEqual(["SUBCUTANEOUS"]);
    await h.db.delete(t.ndcHcpcsCrosswalk).where(eq(t.ndcHcpcsCrosswalk.ndc11, "57894005427"));
  });
});

describe("what counts as a drug", () => {
  it("does not treat a non-drug code as a drug", async () => {
    const [code] = await h.db.select({ code: t.hcpcsCodes.code }).from(t.hcpcsCodes).where(eq(t.hcpcsCodes.isDrug, false)).limit(1);
    expect((await benefitData({ code: code.code }, h.db)).found).toBe(false);
  });
  it("keeps catch-all drug codes", async () => {
    expect((await benefitData({ code: "J3590" }, h.db)).found).toBe(true);
  });
});

describe("SAD dates", () => {
  it("ignores a row that has not taken effect yet", async () => {
    const [row] = await h.db.select().from(t.mcdSadEntries).limit(1);
    await h.db.insert(t.mcdSadEntries).values({ ...row, id: undefined, hcpcsCode: "J9312", effectiveDate: "2099-01-01" });
    expect((await benefitData({ code: "J9312" }, h.db)).facts.sad).toMatchObject({ status: "not_listed", contractorsListing: 0 });
    await h.db.delete(t.mcdSadEntries).where(eq(t.mcdSadEntries.hcpcsCode, "J9312"));
  });
});

describe("missing sources", () => {
  it("claims nothing about Part D without the RxCUI link", async () => {
    const empty = await seededDbWithout(["fda_ndc_rxcui"]);
    const d = await benefitData({ code: "J9312" }, empty.db);
    expect(d.partD).toBeNull();
    expect(d.missingSources).toContain("fda_ndc_rxcui");
    await empty.close();
  }, 120_000);
  it("knows when the payment and OPPS files are missing", async () => {
    const empty = await seededDbWithout(["cms_payment_limits", "cms_opps_addendum_b"]);
    const d = await benefitData({ code: "J9312" }, empty.db);
    expect(d.facts.notPayable).toBeNull();
    expect(d.facts.oppsLoaded).toBe(false);
    await empty.close();
  }, 120_000);
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
  it("offers each code when an NDC maps to two", async () => {
    expect((await resolveBenefitQuery("55513-0002-04", h.db)).choices.map((c) => c.code).sort()).toEqual(["J0881", "J0882"]);
  });
  it("finds the drug for an NDC with no crosswalk row", async () => {
    expect(await resolveBenefitQuery("57894-060-02", h.db)).toMatchObject({ code: null, slug: "stelara-ustekinumab" });
  });
  it("finds a code by its name when no drug matches", async () => {
    expect((await resolveBenefitQuery("etanercept", h.db)).code).toBe("J1438");
  });
  it("offers the codes instead of silently picking when several drugs match", async () => {
    const r = await resolveBenefitQuery("denosumab", h.db);
    expect(r.code).toBeNull();
    expect(r.choices.length).toBeGreaterThan(1);
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
