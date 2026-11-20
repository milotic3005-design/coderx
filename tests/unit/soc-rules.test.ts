/** The one-patient site-of-care calculator. */
import { describe, expect, it } from "vitest";
import { SOC_RULES, socCheck, type SocListEntryView } from "@/lib/soc/rules";

const entry = (over: Partial<SocListEntryView> = {}): SocListEntryView => ({ code: "J3262", label: "Actemra, tocilizumab", addedDate: "2015-03-01", oncologyStar: false, homeInfusionEligible: "Yes", ...over });
const base = { list: { count: 108, date: "2026-09-01" }, newCourse: true, hospitalDosesGiven: 1, nextDose: null, leadDays: 14, today: "2026-11-19" };

describe("initial periods (the first dose is day 1)", () => {
  it("covers Regence's first 30 days, in Regence's terms, with an act-by date", () => {
    const r = socCheck({ ...base, rule: SOC_RULES.regence, entry: entry(), firstHospitalDose: "2026-11-10" });
    expect(r.window).toEqual({ kind: "days", last: "2026-12-09", daysLeft: 20, approximate: false });
    expect(r.actBy).toBe("2026-11-25");
    expect(r.headline).toBe("Regence waives its site-of-care criteria for doses given in the first 30 days: through Dec 9, 2026. 20 days left.");
    expect(r.steps.join(" ")).toContain("Home infusion eligible: Yes");
    expect(r.steps.join(" ")).toContain("does not apply to Medicare plans");
  });
  it("counts Premera's first 90 days so that a Sep 1 start is covered through Nov 29", () => {
    const r = socCheck({ ...base, rule: SOC_RULES.premera, entry: entry({ homeInfusionEligible: null }), firstHospitalDose: "2026-09-01", nextDose: "2026-11-30" });
    expect(r.window).toMatchObject({ last: "2026-11-29" });
    expect(r.nextDoseInWindow).toBe(false);
    expect(r.steps.join(" ")).toContain("falls after this period");
    expect(r.steps.join(" ")).toContain("age 13 and older");
  });
  it("says when today is the last day, and when the period has already ended", () => {
    expect(socCheck({ ...base, rule: SOC_RULES.premera, entry: entry(), firstHospitalDose: "2026-08-22" }).headline).toMatch(/through Nov 19, 2026\. The last day is today\.$/);
    const r = socCheck({ ...base, rule: SOC_RULES.aetna, entry: entry({ code: null, label: "Entyvio" }), firstHospitalDose: "2026-08-01" });
    expect(r.headline).toBe("Aetna's initial period for this course ended on Sep 14, 2026.");
  });
  it("makes UHC's 4 weeks conditional on UHC approving the hospital, and adds its 6-month limit", () => {
    const r = socCheck({ ...base, rule: SOC_RULES.uhc, entry: entry({ code: "J1745", label: "Remicade (infliximab)", homeInfusionEligible: null }), firstHospitalDose: "2026-11-01" });
    expect(r.window).toMatchObject({ kind: "days", approximate: true, last: "2026-11-28" });
    expect(r.headline).toMatch(/^If UHC approves the hospital/);
    expect(r.steps[0]).toMatch(/needs UHC's approval for this course, before the first infusion/);
    expect(r.steps.join(" ")).toContain("no more than 6 months");
    // Once the period has ended, the approval step no longer applies.
    expect(socCheck({ ...base, rule: SOC_RULES.uhc, entry: entry({ homeInfusionEligible: null }), firstHospitalDose: "2026-09-01" }).steps.join(" ")).not.toMatch(/before the first infusion/);
  });
  it("does not apply an initial period to continuing therapy", () => {
    const r = socCheck({ ...base, rule: SOC_RULES.aetna, entry: entry({ code: null, label: "Entyvio" }), newCourse: false, firstHospitalDose: "2026-11-10" });
    expect(r).toMatchObject({ window: { kind: "none" }, actBy: "2026-11-19" });
    expect(r.headline).toMatch(/continuing therapy/);
  });
  it("names each payer's conditions for a new course", () => {
    expect(SOC_RULES.uhc.window.qualifies).toMatch(/more than 6 months off/);
    expect(SOC_RULES.premera.window.qualifies).toMatch(/6 months or longer off/);
    expect(SOC_RULES.regence.window.dayOneLabel).toMatch(/after the pre-authorization was approved/);
    expect(SOC_RULES.regence.window.qualifies).toMatch(/initial doses .*not a renewal for continuing therapy/);
    for (const rule of Object.values(SOC_RULES)) if (rule.window.kind === "days") expect(rule.window.qualifies).toBeTruthy();
  });
  it("points to another approved site when the payer marks the drug not eligible for home infusion", () => {
    const r = socCheck({ ...base, rule: SOC_RULES.regence, entry: entry({ homeInfusionEligible: "No" }), firstHospitalDose: "2026-11-10" });
    const steps = r.steps.join(" ");
    expect(steps).toContain("arrange another approved site (Regence marks this drug not eligible for home infusion)");
    expect(steps).not.toContain("home infusion referral");
  });
});

describe("UHC oncology drugs", () => {
  it("counts hospital infusions for starred drugs, and says the rest still needs approval", () => {
    const oncology = entry({ code: "J9022", label: "Tecentriq (atezolizumab)", oncologyStar: true, homeInfusionEligible: null });
    const one = socCheck({ ...base, rule: SOC_RULES.uhc, entry: oncology, firstHospitalDose: "2026-11-01", hospitalDosesGiven: 1 });
    expect(one).toMatchObject({ window: { kind: "doses", doses: 2, remaining: 1 }, actBy: null });
    expect(one.steps.join(" ")).toMatch(/needs UHC's approval under its other criteria/);
    expect(socCheck({ ...base, rule: SOC_RULES.uhc, entry: oncology, firstHospitalDose: "2026-11-01", hospitalDosesGiven: 2 }).headline).toMatch(/now applies/);
  });
});

describe("lists and payers without an initial period", () => {
  it("says a drug not found is missing from CodeRx's copy of the list, not from the policy", () => {
    const r = socCheck({ ...base, rule: SOC_RULES.regence, entry: null, firstHospitalDose: "2026-11-10" });
    expect(r).toMatchObject({ onList: "no", window: { kind: "none" } });
    expect(r.headline).toBe("Not found in CodeRx's copy of Regence's site-of-care list (108 entries, dated Sep 1, 2026).");
    expect(r.steps[0]).toMatch(/another name or code .* its site-of-care policy applies/);
  });
  it("says when a drug only comes under the policy at a later date", () => {
    const r = socCheck({ ...base, rule: SOC_RULES.aetna, entry: entry({ code: null, label: "Newdrug", addedDate: "2027-01-01" }), firstHospitalDose: "2026-11-10" });
    expect(r.onList).toBe("from-later-date");
    expect(r.headline).toMatch(/on Jan 1, 2027/);
  });
  it("needs the criteria from the first dose for Cigna, in CodeRx's words, and asks to confirm the list", () => {
    const r = socCheck({ ...base, rule: SOC_RULES.cigna, entry: null, list: null, firstHospitalDose: "2026-11-10" });
    expect(r).toMatchObject({ onList: "unknown", window: { kind: "none" }, actBy: "2026-11-19" });
    expect(r.headline).toBe(SOC_RULES.cigna.window.note);
    expect(r.steps.join(" ")).toContain("Confirm the drug is on it");
  });
  it("mentions Aetna's first-dose rule before the first dose", () => {
    const r = socCheck({ ...base, rule: SOC_RULES.aetna, entry: entry({ code: null, label: "Entyvio" }), firstHospitalDose: "2026-11-25", hospitalDosesGiven: 0 });
    expect(r.steps.join(" ")).toContain("first dose may be given");
  });
  it("keeps CodeRx's notes out of the quote fields", () => {
    for (const rule of Object.values(SOC_RULES)) expect(rule.window.quote).not.toMatch(/CodeRx|states no initial period/);
  });
});
