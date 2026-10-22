import { describe, expect, it } from "vitest";
import { epcNames, isClottingFactorFlag, MEDICARE_HIT_CATEGORIES, PER_DIEM_CODES, perDiemFor, routeKinds } from "@/lib/per-diem";

const codesOf = (r: ReturnType<typeof perDiemFor>) => r.matches.flatMap((m) => m.codes.map((c) => c.code));
const suggestedOf = (r: ReturnType<typeof perDiemFor>) => r.matches.flatMap((m) => m.codes.filter((c) => c.suggested).map((c) => c.code));

describe("home infusion per diem S-codes", () => {
  it("reads only EPC entries from the FDA pharm class list", () => {
    expect(epcNames(["Glycopeptide Antibacterial [EPC]", "Glycopeptides [CS]", "Virus Neutralization [MoA]"])).toEqual(["Glycopeptide Antibacterial"]);
  });

  it("groups FDA routes into home infusion route kinds", () => {
    expect([...routeKinds(["INTRAVENOUS", "INTRAMUSCULAR"])].sort()).toEqual(["im", "iv"]);
    expect([...routeKinds(["EPIDURAL", "PERINEURAL"])]).toEqual(["neuraxial"]);
    expect(routeKinds(["ORAL", "INTRAVITREAL", "INTRA-ARTICULAR"]).size).toBe(0);
  });

  it("maps an IV antibiotic to the dosing-frequency codes (vancomycin)", () => {
    const r = perDiemFor({ pharmClasses: ["Glycopeptide Antibacterial [EPC]", "Glycopeptides [CS]"], routes: ["INTRAVENOUS"] });
    expect(r.status).toBe("matched");
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].therapy.id).toBe("anti-infective");
    expect(r.matches[0].basis).toBe("fda-epc");
    expect(r.matches[0].evidence).toEqual(["Glycopeptide Antibacterial"]);
    expect(codesOf(r)).toEqual(["S9500", "S9501", "S9502", "S9503", "S9504", "S9497", "S9494"]);
    expect(suggestedOf(r)).toEqual([]); // the dosing interval decides, not the drug
  });

  it("maps IV infliximab to S9359 and IV dexamethasone to S9490", () => {
    const tnf = perDiemFor({ pharmClasses: ["Tumor Necrosis Factor Blocker [EPC]", "Tumor Necrosis Factor Receptor Blocking Activity [MoA]"], routes: ["INTRAVENOUS"] });
    expect(codesOf(tnf)).toEqual(["S9359"]);
    const steroid = perDiemFor({ pharmClasses: ["Corticosteroid Hormone Receptor Agonists [MoA]", "Corticosteroid [EPC]"], routes: ["INTRAMUSCULAR", "INTRAVENOUS"] });
    expect(codesOf(steroid)).toEqual(["S9490"]);
  });

  it("does not offer the IV-only anti-TNF per diem for a subcutaneous product", () => {
    const r = perDiemFor({ pharmClasses: ["Tumor Necrosis Factor Blocker [EPC]"], routes: ["SUBCUTANEOUS"] });
    expect(r.status).toBe("unclassified");
    expect(suggestedOf(r)).toEqual(["S9542"]);
  });

  it("maps rituximab and pembrolizumab to the chemotherapy codes", () => {
    for (const pharmClasses of [["CD20-directed Cytolytic Antibody [EPC]"], ["Programmed Death Receptor-1 Blocking Antibody [EPC]", "Endoglycosidase [EPC]"]]) {
      const r = perDiemFor({ pharmClasses, routes: ["INTRAVENOUS"] });
      expect(r.matches.map((m) => m.therapy.id)).toEqual(["chemotherapy"]);
      expect(codesOf(r)).toEqual(["S9329", "S9330", "S9331"]);
    }
  });

  it("suggests the infusion or injection code from the route", () => {
    const ivig = perDiemFor({ pharmClasses: ["Human Immunoglobulin G [EPC]"], routes: ["INTRAVENOUS"] });
    expect(suggestedOf(ivig)).toEqual(["S9338"]);
    const hbig = perDiemFor({ pharmClasses: ["Human Immunoglobulin [EPC]", "Immunoglobulins [CS]", "Virus-specific Hyperimmune Globulins [EXT]"], routes: ["INTRAMUSCULAR"] });
    expect(hbig.matches.map((m) => m.therapy.id)).toEqual(["immunotherapy"]); // [EXT] "Virus" text is not an EPC
    expect(suggestedOf(hbig)).toEqual(["S9563"]);
    const enox = perDiemFor({ pharmClasses: ["Low Molecular Weight Heparin [EPC]"], routes: ["SUBCUTANEOUS"] });
    expect(suggestedOf(enox)).toEqual(["S9372"]);
    const ondansetron = perDiemFor({ pharmClasses: ["Serotonin-3 Receptor Antagonist [EPC]"], routes: ["INTRAVENOUS"] });
    expect(suggestedOf(ondansetron)).toEqual(["S9351"]);
  });

  it("suggests nothing when the routes fit more than one code (Lovenox: IV and subcutaneous)", () => {
    const lovenox = perDiemFor({ pharmClasses: ["Low Molecular Weight Heparin [EPC]", "Low-Molecular-Weight [CS]"], routes: ["INTRAVENOUS", "SUBCUTANEOUS"] });
    expect(codesOf(lovenox)).toEqual(["S9336", "S9372"]);
    expect(suggestedOf(lovenox)).toEqual([]);
    const gamunex = perDiemFor({ pharmClasses: ["Human Immunoglobulin G [EPC]"], routes: ["INTRAVENOUS", "SUBCUTANEOUS"] });
    expect(suggestedOf(gamunex)).toEqual([]);
  });

  it("uses the CMS clotting-factor flag as official evidence for S9345", () => {
    const r = perDiemFor({ pharmClasses: [], routes: ["INTRAVENOUS"], clottingFactorCodes: ["J7192"] });
    expect(r.matches[0].therapy.id).toBe("anti-hemophilic");
    expect(r.matches[0].basis).toBe("cms-clotting-factor");
    expect(r.matches[0].evidence[0]).toMatch(/J7192/);
    // Factor kits such as Advate list no FDA route and no pharmacologic class; the CMS flag still applies.
    const advate = perDiemFor({ pharmClasses: [], routes: [], clottingFactorCodes: ["J7192"] });
    expect(advate.status).toBe("matched");
    expect(codesOf(advate)).toEqual(["S9345"]);
    expect(isClottingFactorFlag("1")).toBe(true); // the value CMS publishes
    expect(isClottingFactorFlag("Y")).toBe(true);
    expect(isClottingFactorFlag("")).toBe(false);
    expect(isClottingFactorFlag("N")).toBe(false);
    expect(isClottingFactorFlag(null)).toBe(false);
  });

  it("keeps factor Xa inhibitors and heparin antagonists out of the wrong categories", () => {
    const fxa = perDiemFor({ pharmClasses: ["Factor Xa Inhibitor [EPC]"], routes: ["SUBCUTANEOUS"] });
    expect(fxa.matches.map((m) => m.therapy.id)).toEqual(["anticoagulant"]);
    const protamine = perDiemFor({ pharmClasses: ["Heparin Antagonist [EPC]"], routes: ["INTRAVENOUS"] });
    expect(protamine.status).toBe("unclassified");
  });

  it("counts local anesthetics as pain management only by epidural or nerve-block routes", () => {
    const epidural = perDiemFor({ pharmClasses: ["Amide Local Anesthetic [EPC]"], routes: ["EPIDURAL", "INFILTRATION", "PERINEURAL"] });
    expect(epidural.matches.map((m) => m.therapy.id)).toEqual(["pain"]);
    const ivOnly = perDiemFor({ pharmClasses: ["Amide Local Anesthetic [EPC]", "Antiarrhythmic [EPC]"], routes: ["INTRAVENOUS"] });
    expect(ivOnly.status).toBe("unclassified");
    const morphine = perDiemFor({ pharmClasses: ["Opioid Agonist [EPC]", "Amide Local Anesthetic [EPC]"], routes: ["EPIDURAL", "INTRAVENOUS"] });
    expect(morphine.matches).toHaveLength(1); // two pain rules merge into one match
    expect(morphine.matches[0].evidence).toEqual(["Opioid Agonist", "Amide Local Anesthetic"]);
  });

  it("falls back to the NOC per diem by route when no category matches", () => {
    const iv = perDiemFor({ pharmClasses: ["RANK Ligand Inhibitor [EPC]"], routes: ["INTRAVENOUS"] });
    expect(iv.status).toBe("unclassified");
    expect(iv.matches[0].basis).toBe("route-only");
    expect(suggestedOf(iv)).toEqual(["S9379"]);
    const sc = perDiemFor({ pharmClasses: ["RANK Ligand Inhibitor [EPC]"], routes: ["SUBCUTANEOUS"] });
    expect(suggestedOf(sc)).toEqual(["S9542"]);
    const none = perDiemFor({ pharmClasses: [], routes: ["INTRAVENOUS"] });
    expect(none.matches[0].evidence).toEqual(["No FDA pharmacologic class (EPC) listed"]);
    const noRoute = perDiemFor({ pharmClasses: [], routes: [] });
    expect(noRoute.status).toBe("unclassified");
    expect(codesOf(noRoute)).toEqual(["S9379", "S9542"]);
    expect(suggestedOf(noRoute)).toEqual([]);
  });

  it("returns no per diem for oral, intravitreal, and vaccine products", () => {
    const oral = perDiemFor({ pharmClasses: ["Corticosteroid [EPC]"], routes: ["ORAL"] });
    expect(oral.status).toBe("not-applicable");
    expect(oral.matches).toEqual([]);
    expect(oral.reason).toMatch(/oral/);
    expect(perDiemFor({ pharmClasses: ["Corticosteroid [EPC]"], routes: ["INTRAVITREAL"] }).status).toBe("not-applicable");
    const vaccine = perDiemFor({ pharmClasses: ["Inactivated Influenza Virus Vaccine [EPC]"], routes: ["INTRAMUSCULAR"] });
    expect(vaccine.status).toBe("not-applicable");
    expect(vaccine.reason).toMatch(/Vaccines/);
  });

  it("never infers a category from the drug name", () => {
    // Same routes, no EPC: a name like "vancomycin" is not an input, so the result is the NOC fallback.
    const r = perDiemFor({ pharmClasses: [], routes: ["INTRAVENOUS"] });
    expect(r.matches.map((m) => m.therapy.id)).toEqual(["not-otherwise-classified"]);
  });

  it("names the Medicare home infusion services codes by payment category (subsequent, initial visit)", () => {
    expect(MEDICARE_HIT_CATEGORIES.map((h) => h.codes)).toEqual([["G0068", "G0088"], ["G0069", "G0089"], ["G0070", "G0090"]]);
  });

  it("lists only S-codes in the home infusion and injectable range", () => {
    expect(PER_DIEM_CODES.length).toBeGreaterThan(30);
    for (const c of PER_DIEM_CODES) expect(c).toMatch(/^S9[3-5]\d\d$/);
  });
});
