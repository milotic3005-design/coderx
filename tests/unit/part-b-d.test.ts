import { describe, expect, it } from "vitest";
import { decideBenefit, homeSummary, questionsFor, RULE_SOURCES, type BenefitAnswers, type BenefitFacts, type SadFact, type Setting } from "@/lib/part-b-d";

const notListed: SadFact = { status: "not_listed", products: [], contractorsListing: 0, contractorsTotal: 8, displayId: "A53033" };
const listed: SadFact = { ...notListed, status: "listed", products: ["Enbrel®"], contractorsListing: 8 };

/** Facts as the real data gives them: an infused drug with a Part B status, unless a case says otherwise. */
const facts = (over: Partial<BenefitFacts> = {}): BenefitFacts => ({ code: "J9312", isActive: true, isNoc: false, routes: ["INTRAVENOUS"], productType: "HUMAN PRESCRIPTION DRUG", sad: notListed, dmePolicies: [], notPayable: false, oppsLoaded: true, oppsStatus: "K", ...over });
const answers = (over: Partial<BenefitAnswers> = {}): BenefitAnswers => ({ route: null, answers: {}, dmeposEnrolled: false, ...over });
const row = (f: BenefitFacts, a: BenefitAnswers, setting: Setting) => decideBenefit(f, a).find((r) => r.setting === setting)!;

const benlysta = facts({ code: "J0490", routes: ["INTRAVENOUS", "SUBCUTANEOUS"], sad: { ...listed, status: "route_specific", products: ["Belimumab (Benlysta)*"] } });
const enbrel = facts({ code: "J1438", routes: ["SUBCUTANEOUS"], sad: listed, oppsStatus: "K" });
const prolia = facts({ code: "J0897", routes: ["SUBCUTANEOUS"] });
const treprostinil = facts({ code: "J3285", routes: ["INTRAVENOUS", "SUBCUTANEOUS"], dmePolicies: ["pump"] });
const gammagard = facts({ code: "J1569", routes: ["INTRAVENOUS", "SUBCUTANEOUS"], dmePolicies: ["pump", "ivig"] });
const tacrolimus = facts({ code: "J7507", routes: ["ORAL"], dmePolicies: ["immunosuppressive"], oppsStatus: null });
const capecitabine = facts({ code: "J8521", routes: ["ORAL"], oppsStatus: null });
const albuterol = facts({ code: "J7613", routes: ["RESPIRATORY (INHALATION)"], dmePolicies: ["nebulizer"], oppsStatus: null });
const catchAll = facts({ code: "J3590", isNoc: true, routes: ["SUBCUTANEOUS"], sad: { ...listed, status: "catch_all", products: ["Nemolizumab-ilto (Nemluvio)", "bimekizumab-bkzx (Bimzelx®)"] }, oppsStatus: "N" });

describe("golden cases from the spec", () => {
  it("Benlysta IV in the HOPD is Part B with JA", () => {
    expect(row(benlysta, answers({ route: "iv" }), "hopd")).toMatchObject({ verdict: "part_b", modifier: "JA" });
  });
  it("Benlysta subcutaneous in the HOPD is not Part B and bills JB", () => {
    expect(row(benlysta, answers({ route: "subcutaneous" }), "hopd")).toMatchObject({ verdict: "not_part_b", modifier: "JB" });
  });
  it("Benlysta subcutaneous at home is Part D", () => {
    expect(row(benlysta, answers({ route: "subcutaneous" }), "home_no_pump").verdict).toBe("part_d");
  });
  it("Enbrel in the HOPD is not Part B", () => {
    expect(row(enbrel, answers(), "hopd").verdict).toBe("not_part_b");
  });
  it("Enbrel at home is Part D", () => {
    expect(row(enbrel, answers(), "home_no_pump").verdict).toBe("part_d");
  });
  it("Prolia in the HOPD is Part B", () => {
    expect(row(prolia, answers(), "hopd").verdict).toBe("part_b");
  });
  it("Prolia at home with no pump is Part D", () => {
    expect(row(prolia, answers(), "home_no_pump").verdict).toBe("part_d");
  });
  it("treprostinil on a pump is Part B DME, and an unenrolled pharmacy cannot bill it", () => {
    const r = row(treprostinil, answers(), "home_pump");
    expect(r.verdict).toBe("part_b_dme");
    expect(r.notes.join(" ")).toContain("needs an enrolled DMEPOS supplier; Part D cannot pay because Part B would");
  });
  it("treprostinil on a pump can be billed by an enrolled pharmacy", () => {
    const r = row(treprostinil, answers({ dmeposEnrolled: true }), "home_pump");
    expect(r.verdict).toBe("part_b_dme");
    expect(r.notes.join(" ")).toContain("can bill this");
  });
  it("Gammagard at home for primary immune deficiency is Part B DME, drug only", () => {
    const r = row(gammagard, answers({ answers: { pid: true } }), "home_no_pump");
    expect(r.verdict).toBe("part_b_dme");
    expect(r.reason).toContain("drug only");
  });
  it("tacrolimus after a Medicare-covered transplant is Part B DME", () => {
    expect(row(tacrolimus, answers({ answers: { transplant: true } }), "home_no_pump").verdict).toBe("part_b_dme");
  });
  it("tacrolimus without one is Part D", () => {
    expect(row(tacrolimus, answers({ answers: { transplant: false } }), "home_no_pump").verdict).toBe("part_d");
  });
  it("capecitabine for cancer is Part B DME", () => {
    expect(row(capecitabine, answers({ answers: { cancer: true } }), "home_no_pump").verdict).toBe("part_b_dme");
  });
  it("albuterol at home is Part B DME", () => {
    expect(row(albuterol, answers(), "home_no_pump").verdict).toBe("part_b_dme");
  });
  it("albuterol in long-term care is Part D", () => {
    expect(row(albuterol, answers(), "ltc").verdict).toBe("part_d");
  });
  it("any drug in an inpatient Part A stay is Part A", () => {
    for (const f of [benlysta, enbrel, prolia, albuterol]) expect(row(f, answers(), "inpatient").verdict).toBe("part_a");
  });
  it("a catch-all code in the HOPD needs a human check and lists the products", () => {
    const r = row(catchAll, answers(), "hopd");
    expect(r.verdict).toBe("check");
    expect(r.notes.join(" ")).toContain("Nemolizumab-ilto (Nemluvio)");
  });
});

describe("settings", () => {
  it("returns one result per setting", () => {
    expect(decideBenefit(prolia, answers()).map((r) => r.setting)).toEqual(["inpatient", "snf", "hospice", "hopd", "home_pump", "home_no_pump", "ltc"]);
  });
  it("SNF Part A stays are bundled, with the chemotherapy exception noted", () => {
    const r = row(prolia, answers(), "snf");
    expect(r.verdict).toBe("part_a");
    expect(r.notes.join(" ")).toContain("chemotherapy");
  });
  it("hospice covers related drugs and notes unrelated ones", () => {
    const r = row(prolia, answers(), "hospice");
    expect(r.verdict).toBe("hospice");
    expect(r.notes.join(" ")).toContain("unrelated");
  });
  it("status N is packaged", () => {
    expect(row(facts({ oppsStatus: "N" }), answers(), "hopd").verdict).toBe("part_b_packaged");
  });
  it("status other than K, G, or N needs a check", () => {
    expect(row(facts({ oppsStatus: "E1" }), answers(), "hopd").verdict).toBe("check");
    expect(row(facts({ oppsStatus: null }), answers(), "hopd").verdict).toBe("check");
  });
  it("a code on Drugs Not Payable Under Part B is not Part B", () => {
    expect(row(facts({ notPayable: true }), answers(), "hopd").verdict).toBe("not_part_b");
  });
  it("an oral drug with no statutory case is not Part B in the HOPD", () => {
    expect(row(facts({ routes: ["ORAL"] }), answers(), "hopd").verdict).toBe("not_part_b");
  });
  it("a drug off the pump list sends you to the next row", () => {
    expect(row(prolia, answers(), "home_pump").verdict).toBe("not_applicable");
  });
  it("tells the HOPD what happens to the patient for a self-administered drug", () => {
    expect(row(enbrel, answers(), "hopd").reason).toContain("hospital may bill the patient");
  });
  it("says Part D pays for the drug only", () => {
    expect(row(prolia, answers(), "home_no_pump").reason).toContain("supplies and nursing");
  });
});

describe("route-specific codes", () => {
  it("needs a route when the code is route-specific", () => {
    expect(row(benlysta, answers(), "hopd").verdict).toBe("check");
  });
  it("warns that a claim with neither modifier is denied", () => {
    expect(row(benlysta, answers({ route: "iv" }), "hopd").notes.join(" ")).toContain("denied");
  });
  it("double-asterisk codes are Part B IM with no modifier", () => {
    const acthar = facts({ code: "J0801", routes: ["INTRAMUSCULAR", "SUBCUTANEOUS"], sad: { ...listed, status: "double_route" } });
    expect(row(acthar, answers({ route: "im" }), "hopd")).toMatchObject({ verdict: "part_b", modifier: null });
    expect(row(acthar, answers({ route: "subcutaneous" }), "hopd")).toMatchObject({ verdict: "not_part_b", modifier: "JB" });
  });
  it("uses the OPPS status once the route passes", () => {
    expect(row({ ...benlysta, oppsStatus: "N" }, answers({ route: "iv" }), "hopd")).toMatchObject({ verdict: "part_b_packaged", modifier: "JA" });
  });
});

describe("questions and answers", () => {
  it("uses Noridian's status only, and reports how many contractors list it", () => {
    const r = row(facts({ sad: { ...notListed, contractorsListing: 3 } }), answers(), "hopd");
    expect(r.verdict).toBe("part_b");
    expect(r.notes.join(" ")).toContain("3 of 8");
  });
  it("unanswered statutory question returns check", () => {
    expect(row(tacrolimus, answers(), "home_no_pump").verdict).toBe("check");
  });
  it("nebulizer counts as yes unless answered no", () => {
    expect(row(albuterol, answers({ answers: { nebulizer: false } }), "home_no_pump").verdict).toBe("part_d");
  });
  it("every part_b_dme result carries the DMEPOS message", () => {
    const cases: [BenefitFacts, BenefitAnswers][] = [
      [tacrolimus, answers({ answers: { transplant: true } })],
      [capecitabine, answers({ answers: { cancer: true } })],
      [albuterol, answers()],
      [treprostinil, answers()],
    ];
    for (const [f, a] of cases) {
      const dme = decideBenefit(f, a).filter((r) => r.verdict === "part_b_dme");
      expect(dme.length).toBeGreaterThan(0);
      for (const r of dme) expect(r.notes.join(" ")).toContain("DMEPOS");
    }
  });
  it("long-term care keeps Part D for pump drugs", () => {
    expect(row(treprostinil, answers(), "ltc").verdict).toBe("part_d");
  });
  it("long-term care keeps Part B for immunosuppressives after a covered transplant", () => {
    expect(row(tacrolimus, answers({ answers: { transplant: true } }), "ltc").verdict).toBe("part_b_dme");
  });
  it("home IVIG does not apply in long-term care", () => {
    expect(row(gammagard, answers({ answers: { pid: true } }), "ltc").verdict).toBe("part_d");
  });
  it("other situations change the home row when answered yes", () => {
    expect(row(facts(), answers({ answers: { clottingFactor: true } }), "home_no_pump").verdict).toBe("part_b");
    expect(row(facts(), answers({ answers: { dialysisEsa: true } }), "home_no_pump").reason).toContain("ESRD");
    expect(row(facts(), answers({ answers: { permanentGi: true } }), "home_no_pump").verdict).toBe("part_b_dme");
  });
  it("questions appear only when the fact applies", () => {
    expect(questionsFor(tacrolimus).primary).toEqual(["transplant"]);
    expect(questionsFor(capecitabine).primary).toEqual(["cancer"]);
    expect(questionsFor(prolia).primary).toEqual([]);
    expect(questionsFor(facts({ code: "J8499", routes: ["ORAL"] })).primary).not.toContain("cancer");
    expect(questionsFor(facts({ code: "J8540", routes: ["ORAL"], dmePolicies: ["antiemetic"] })).primary).toEqual(["antiemetic48h"]);
  });
  it("other situations are always available", () => {
    expect(questionsFor(prolia).other).toEqual(["clottingFactor", "dialysisEsa", "permanentGi"]);
  });
});

describe("gaps in the data", () => {
  it("inactive code returns check for Part B rows", () => {
    const r = row(facts({ isActive: false }), answers(), "hopd");
    expect(r.verdict).toBe("check");
    expect(r.reason).toContain("inactive");
    expect(row(facts({ isActive: false, dmePolicies: ["pump"] }), answers(), "home_pump").verdict).toBe("check");
  });
  it("missing sources return check and never part_d", () => {
    const f = facts({ sad: null, dmePolicies: null });
    expect(row(f, answers(), "hopd").verdict).toBe("check");
    expect(row(f, answers(), "home_pump").verdict).toBe("check");
    expect(row(f, answers(), "home_no_pump").verdict).toBe("check");
    expect(row(f, answers(), "ltc").verdict).toBe("check");
  });
  it("a drug with no HCPCS code needs a check in the HOPD and is Part D at home", () => {
    const f = facts({ code: null });
    expect(row(f, answers(), "hopd").verdict).toBe("check");
    expect(row(f, answers(), "home_no_pump").verdict).toBe("part_d");
  });
  it("catch-all DME code returns check", () => {
    const f = facts({ code: "J7799", isNoc: true, dmePolicies: ["pump"] });
    expect(row(f, answers(), "home_pump").verdict).toBe("check");
  });
});

describe("notes and sources", () => {
  it("adds the vaccine note for product type VACCINE", () => {
    const notes = row(facts({ productType: "VACCINE" }), answers(), "home_no_pump").notes.join(" ");
    expect(notes).toContain("influenza");
    expect(notes).toContain("Part D");
    expect(row(prolia, answers(), "home_no_pump").notes.join(" ")).not.toContain("influenza");
  });
  it("adds the Part B-ID note when the transplant question appears", () => {
    expect(row(tacrolimus, answers({ answers: { transplant: false } }), "home_no_pump").notes.join(" ")).toContain("Part B-ID");
  });
  it("notes Part D's excluded uses on Part D rows", () => {
    expect(row(prolia, answers(), "home_no_pump").notes.join(" ")).toContain("cosmetic");
  });
  it("every result cites sources that exist", () => {
    for (const f of [benlysta, enbrel, prolia, treprostinil, gammagard, tacrolimus, capecitabine, albuterol, catchAll]) {
      for (const r of decideBenefit(f, answers())) {
        expect(r.sources.length).toBeGreaterThan(0);
        for (const s of r.sources) expect(RULE_SOURCES[s].url).toMatch(/^https:\/\//);
      }
    }
  });
});

describe("codes CMS links to no product", () => {
  const unlinked = facts({ code: "Q2035", routes: [], productType: null, oppsStatus: "L" });

  it("never falls through to Part D at home or in long-term care", () => {
    expect(row(unlinked, answers(), "home_no_pump").verdict).toBe("check");
    expect(row(unlinked, answers(), "ltc").verdict).toBe("check");
    expect(row(unlinked, answers(), "home_no_pump").reason).toContain("no product");
  });
  const busulfan = facts({ code: "J8510", routes: [], productType: null, oppsStatus: null });
  it("still asks the cancer question for an oral chemotherapy code", () => {
    expect(questionsFor(busulfan).primary).toEqual(["cancer"]);
    expect(row(busulfan, answers(), "home_no_pump").verdict).toBe("check");
    expect(row(busulfan, answers({ answers: { cancer: true } }), "home_no_pump").verdict).toBe("part_b_dme");
    expect(row(busulfan, answers({ answers: { cancer: false } }), "home_no_pump").verdict).toBe("part_d");
  });
  it("treats the J8 family as oral in the HOPD", () => {
    expect(row(busulfan, answers({ answers: { cancer: false } }), "hopd").verdict).toBe("not_part_b");
  });
  it("keeps a statutory answer for a listed code with no product link", () => {
    const f = facts({ code: "J7525", routes: [], productType: null, dmePolicies: ["immunosuppressive"] });
    expect(row(f, answers({ answers: { transplant: true } }), "home_no_pump").verdict).toBe("part_b_dme");
    expect(row(f, answers({ answers: { transplant: false } }), "home_no_pump").verdict).toBe("check");
  });
});

describe("vaccines", () => {
  const flu = facts({ code: "Q2035", productType: "VACCINE", routes: ["INTRAMUSCULAR"], oppsStatus: "L" });
  it("are not called Part D, because the vaccine decides the benefit", () => {
    expect(row(flu, answers(), "home_no_pump").verdict).toBe("check");
    expect(row(flu, answers(), "ltc").verdict).toBe("check");
  });
});

describe("catch-all codes off Noridian's list", () => {
  const noc = facts({ code: "J9999", isNoc: true, oppsStatus: "N" });
  it("do not get a verdict in any Part B or Part D row", () => {
    for (const s of ["hopd", "home_no_pump", "ltc"] as const) expect(row(noc, answers(), s).verdict).toBe("check");
  });
});

describe("codes CMS lists as not payable under Part B", () => {
  it("do not get a Part B verdict at home", () => {
    const pump = facts({ notPayable: true, dmePolicies: ["pump"] });
    expect(row(pump, answers(), "home_pump").verdict).toBe("check");
  });
  it("do not get a statutory Part B verdict, which would block Part D", () => {
    const j8670 = facts({ code: "J8670", routes: ["ORAL"], dmePolicies: ["antiemetic"], notPayable: true, oppsStatus: null });
    const r = row(j8670, answers({ answers: { antiemetic48h: true } }), "home_no_pump");
    expect(r.verdict).toBe("check");
    expect(r.reason).toContain("not payable");
    expect(row(j8670, answers({ answers: { antiemetic48h: false } }), "home_no_pump").verdict).toBe("part_d");
  });
});

describe("sources not loaded", () => {
  it("does not decide an oral drug in the HOPD without the DME lists", () => {
    expect(row(facts({ routes: ["ORAL"], dmePolicies: null }), answers(), "hopd").verdict).toBe("check");
  });
  it("does not claim OPPS has no status when OPPS is not loaded", () => {
    const r = row(facts({ oppsLoaded: false, oppsStatus: null }), answers(), "hopd");
    expect(r.verdict).toBe("check");
    expect(r.reason).toContain("not been loaded");
  });
  it("does not say Part B when the not-payable list is not loaded", () => {
    expect(row(facts({ notPayable: null }), answers(), "hopd").verdict).toBe("check");
  });
});

describe("the home summary", () => {
  it("uses the pump row when it applies, including when it needs a check", () => {
    const f = facts({ code: "J7799", isNoc: true, dmePolicies: ["pump"] });
    expect(homeSummary(decideBenefit(f, answers())).setting).toBe("home_pump");
    expect(homeSummary(decideBenefit(treprostinil, answers())).setting).toBe("home_pump");
  });
  it("uses the no-pump row otherwise", () => {
    expect(homeSummary(decideBenefit(prolia, answers())).setting).toBe("home_no_pump");
  });
});

describe("small fixes", () => {
  it("says a code is inactive before asking a question about it", () => {
    const old = facts({ code: "J7507", routes: ["ORAL"], dmePolicies: ["immunosuppressive"], isActive: false, oppsStatus: null });
    expect(row(old, answers(), "home_no_pump").reason).toContain("inactive");
    expect(row(old, answers(), "ltc").reason).toContain("inactive");
  });
  it("calls an ESRD drug packaged, because the dialysis payment includes it", () => {
    expect(row(facts(), answers({ answers: { dialysisEsa: true } }), "home_no_pump").verdict).toBe("part_b_packaged");
  });
  it("notes that a clotting factor's furnishing fee is separate", () => {
    expect(row(facts(), answers({ answers: { clottingFactor: true } }), "home_no_pump").notes.join(" ")).toContain("furnishing fee");
  });
  it("does not cite Noridian's list for an oral drug that is not on it", () => {
    const r = row(facts({ routes: ["ORAL"] }), answers(), "hopd");
    expect(r.verdict).toBe("not_part_b");
    expect(r.sources).not.toContain("noridian_sad");
    expect(r.sources).toContain("sad_hopd");
  });
});
