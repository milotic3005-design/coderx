/**
 * Site-of-care rules per payer, transcribed from each payer's own policy, and the one-patient calculator
 * (pure; runs in the browser, so nothing about a patient is saved or sent).
 *
 * `quote` fields are the payer's words, verbatim. `note`, `headline` and `checks` are CodeRx's plain-language
 * readings of them and are never shown in quotation marks.
 *
 * The monthly refresh keeps drug lists and dates current on its own. The rules here are written by hand; each
 * payer records the fingerprint of the criteria wording they were written from (`writtenFrom.criteriaHash`).
 * When the payer's current wording has a different fingerprint, the page says the rule changed since review and
 * shows the new wording, until a pharmacist reviews it.
 */

export type SocPayerKey = "uhc" | "premera" | "regence" | "aetna" | "cigna" | "anthem";

export interface SocWindow {
  kind: "days" | "none";
  /** Counted from the first dose; the first dose is day 1. */
  days?: number;
  /** The payer gives the length as an example ("e.g., 4 weeks"), not a fixed limit. */
  approximate?: boolean;
  /** The dose that counts as day 1, in plain words ("the first dose"). */
  startsFrom?: string;
  /** Which courses get the period, in plain words; shown next to the "new course" checkbox. */
  qualifies?: string;
  /** Label for the day-1 date field when it is not simply the first hospital dose. */
  dayOneLabel?: string;
  /** A step that must happen before the first hospital dose for the period to apply at all. */
  approval?: string;
  /** What the period means for this payer, with {last} for the last day it covers. */
  headline?: string;
  /** CodeRx's note when the payer states no initial period. */
  note?: string;
  /** The payer's own words. */
  quote: string;
}

export interface SocPayerRule {
  key: SocPayerKey;
  name: string;
  /** The name to use inside sentences ("Regence"). */
  shortName: string;
  /** Which plans the policy covers, in the payer's words where it states it. */
  scope: string;
  window: SocWindow;
  /** UHC oncology (starred) drugs: the policy applies after this many hospital infusions as monotherapy. */
  oncologyDoses?: { doses: number; quote: string };
  /** A limit on hospital infusion even after an exception is approved. */
  exceptionLimit?: { months: number; quote: string };
  /** Whether the first dose may be given anywhere (the payer's words). */
  firstDose?: string;
  /** Things to confirm for every patient (who the policy covers), in plain words. */
  checks?: string[];
  /** How the drug list is published, and why it may be missing. */
  listNote: string;
  writtenFrom: { effectiveDate: string | null; criteriaHash: string; transcribedOn: string; reviewedBy: string | null };
}

export const SOC_RULES: Record<SocPayerKey, SocPayerRule> = {
  uhc: {
    key: "uhc",
    shortName: "UHC",
    name: "UnitedHealthcare (commercial)",
    scope: "UnitedHealthcare commercial plans (Medical Benefit Drug Policy 2026D0121X). UnitedHealthcare Community Plan (Apple Health) has a separate policy.",
    window: {
      kind: "days",
      days: 28,
      approximate: true,
      startsFrom: "the first infusion",
      qualifies: "A new start, or a restart after more than 6 months off (not for drugs dosed every 6 months or longer).",
      approval: "The hospital site needs UHC's approval for this course, before the first infusion. A new start or restart is one of the reasons its policy lists, and UHC sets how long (its example is 4 weeks).",
      headline: "If UHC approves the hospital for this new start or restart, its example length (4 weeks) runs about through {last}.",
      quote: "Initial infusion or re-initiation of previous therapy after more than 6 months (excludes drugs dosed at an interval of 6 months or greater) for a short duration of time (e.g., 4 weeks)",
    },
    oncologyDoses: {
      doses: 2,
      quote: "*For oncology drugs only: This policy applies when the medication is used as monotherapy and after at least 2 infusions administered in the hospital outpatient facility or when the medication is used as monotherapy after completion of therapy in combination with chemotherapy in the hospital outpatient facility.",
    },
    exceptionLimit: { months: 6, quote: "Ongoing outpatient hospital facility-based infusion duration of therapy will be no more than 6 months to allow for reassessment of the individual’s ability to receive therapy at an alternative Site of Care." },
    listNote: "UHC's Applicable Medications code list (HCPCS codes; CPT rows are not shown).",
    writtenFrom: { effectiveDate: "2026-10-01", criteriaHash: "803f93628b3552f9", transcribedOn: "2026-11-19", reviewedBy: null },
  },
  premera: {
    key: "premera",
    shortName: "Premera",
    name: "Premera Blue Cross",
    scope: "“Site of Service (SOS) Medical Necessity criteria applies ONLY to medical benefit reviews.” “For those age 13 and older, we also will review the site of service for medical necessity.” Not Alaska fully insured members.",
    window: {
      kind: "days",
      days: 90,
      startsFrom: "the first dose",
      qualifies: "The initial course, or a restart after 6 months or longer off (not when standard dosing is every 6 months or longer).",
      headline: "Premera considers the hospital medically necessary for the first 90 days: through {last}.",
      quote: "This site is considered medically necessary for the first 90 days for the following: The initial course of infusion or injection of a pharmacologic or biologic agent OR Re-initiation of an agent after 6 months or longer following discontinuation of therapy",
    },
    checks: ["Premera reviews the site only for members age 13 and older, and only on the medical benefit."],
    listNote: "The HCPCS codes in Premera's policy 11.01.523 (CMS descriptor wording).",
    writtenFrom: { effectiveDate: "2026-11-06", criteriaHash: "8f54c55d33bd978c", transcribedOn: "2026-11-19", reviewedBy: null },
  },
  regence: {
    key: "regence",
    shortName: "Regence",
    name: "Regence BlueShield (incl. UMP/PEBB/SEBB)",
    scope: "“This policy applies to fully insured commercial and exchange plans, and the Washington State Health Care Authority (with the exception of Uniform Medical Plan Plus) … This policy may apply to other self-insured groups … This policy does not apply to Medicare plans.”",
    window: {
      kind: "days",
      days: 30,
      startsFrom: "the first dose given after the drug's pre-authorization was approved",
      qualifies: "A new start: the initial doses of a drug after its pre-authorization was approved (not a renewal for continuing therapy).",
      dayOneLabel: "First dose after the pre-authorization was approved",
      headline: "Regence waives its site-of-care criteria for doses given in the first 30 days: through {last}.",
      quote: "NOTE – Grace period: Site of care review criteria will be waived for payment of the initial dose(s) of a medication given during the first 30 days (starting from the date of the first dose) after the medication has been approved for pre-authorization, to allow for adequate transition time to an approved site of care for subsequent doses.",
    },
    checks: ["Regence's policy does not apply to Medicare plans; it covers fully insured, exchange, and HCA plans (UMP/PEBB/SEBB, not UMP Plus)."],
    listNote: "Regence dru408 Appendix 1, with the date each drug came under site-of-care review and its “Home infusion eligible” column.",
    writtenFrom: { effectiveDate: "2026-09-01", criteriaHash: "9c0237e42f835ade", transcribedOn: "2026-11-19", reviewedBy: null },
  },
  aetna: {
    key: "aetna",
    shortName: "Aetna",
    name: "Aetna (commercial)",
    scope: "Aetna's policy page does not state which plans it covers; confirm with Aetna for the member's plan.",
    window: {
      kind: "days",
      days: 45,
      startsFrom: "the first dose",
      qualifies: "New to therapy, a restart after at least 6 months off (3 months for Xolair), a switch to a therapy the patient hasn't had, or a gap in therapy.",
      headline: "Aetna's policy covers the hospital for up to 45 days for a new start, restart, switch, or gap: through {last}.",
      quote: "This policy covers therapy in a hospital outpatient setting (up to 45 days) when any of the following apply: The patient is new to therapy or restarting after not being on therapy for at least 6 months (3 months for Xolair). The patient is switching to a therapy they haven’t had before. The patient has had a gap in therapy.",
    },
    firstDose: "“For drugs given in multiple doses, the first dose may be given at the doctor’s or provider's preferred location — if the drug is available and not in short supply.”",
    listNote: "Aetna lists drugs by name, with the date each became part of the policy (no HCPCS codes).",
    writtenFrom: { effectiveDate: null, criteriaHash: "ebcb9d07661d7990", transcribedOn: "2026-11-19", reviewedBy: null },
  },
  cigna: {
    key: "cigna",
    shortName: "Cigna",
    name: "Cigna",
    scope: "“Under many benefit plans, medically necessary services must be rendered in the least intensive setting that is appropriate for the delivery of the services and supplies.”",
    window: {
      kind: "none",
      note: "Cigna's policy 1605 states no initial period in the hospital; the hospital site needs its criteria from the first dose.",
      quote: "When coverage criteria are met for the injectable medication, this coverage policy is used to determine the medical necessity of the requested site of care.",
    },
    listNote: "Cigna's drug list (Specialty Care Options) is on a part of Cigna's site that its robots.txt closes to automated tools, so it is not loaded. Check it on Cigna for HCP.",
    writtenFrom: { effectiveDate: "2026-06-15", criteriaHash: "56c35bc193b07367", transcribedOn: "2026-11-19", reviewedBy: null },
  },
  anthem: {
    key: "anthem",
    shortName: "Anthem/Wellpoint",
    name: "Anthem / Wellpoint (CG-MED-83)",
    scope: "A clinical guideline each Anthem or Wellpoint plan chooses to adopt; in Washington, Wellpoint's Apple Health plan uses it. Confirm the member's plan and its own drug list.",
    window: {
      kind: "none",
      note: "CG-MED-83 states no initial period in the hospital; the hospital site needs its criteria from the first dose.",
      quote:
        "An outpatient IV infusion or injectable therapy service in the hospital outpatient department or hospital outpatient clinic site of care for the use of an infused pharmacologic or biologic agent is considered medically necessary when there are no other geographically accessible appropriate alternative sites for the individual to undergo the IV infusion or injectable therapy service.",
    },
    listNote: "No public Washington (Wellpoint Apple Health) drug list for CG-MED-83 was found, so drugs are not listed here.",
    writtenFrom: { effectiveDate: "2026-10-01", criteriaHash: "07a3945950fd05f1", transcribedOn: "2026-11-19", reviewedBy: null },
  },
};

/* ------------------------------------------------------------------ */
/* Calculator                                                          */
/* ------------------------------------------------------------------ */

export interface SocListEntryView {
  code: string | null;
  label: string;
  addedDate: string | null;
  oncologyStar: boolean;
  homeInfusionEligible: "Yes" | "No" | null;
}

export interface SocCheckInput {
  rule: SocPayerRule;
  /** Null when the payer publishes no usable list (Cigna, Anthem) or the drug was not found on it. */
  entry: SocListEntryView | null;
  /** CodeRx's copy of the payer's list; null when none is loaded. */
  list: { count: number; date: string | null } | null;
  /** This course is a new start or a restart (or, for Aetna, a switch or a gap), so an initial period can apply. */
  newCourse: boolean;
  /** First hospital dose of this course, YYYY-MM-DD (day 1 of any initial period). */
  firstHospitalDose: string;
  /** Hospital doses given so far in this course. */
  hospitalDosesGiven: number;
  /** The next scheduled dose, if known. */
  nextDose: string | null;
  /** Days before the period ends to have the move or the exception in place. */
  leadDays: number;
  today: string;
}

export interface SocCheckResult {
  onList: "yes" | "from-later-date" | "no" | "unknown";
  /** `last` is the last day the period covers (the first dose is day 1). */
  window: { kind: "days"; last: string; daysLeft: number; approximate: boolean } | { kind: "doses"; doses: number; remaining: number } | { kind: "none" };
  /** The date to have home infusion (or another approved site) or an approved exception in place. */
  actBy: string | null;
  nextDoseInWindow: boolean | null;
  headline: string;
  steps: string[];
}

const DAY = 86_400_000;
const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const addDays = (iso: string, days: number) => new Date(toMs(iso) + days * DAY).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((toMs(to) - toMs(from)) / DAY);
const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function socCheck(input: SocCheckInput): SocCheckResult {
  const { rule, entry, today } = input;
  const serviceDate = input.nextDose ?? today;
  const onList: SocCheckResult["onList"] = !input.list ? "unknown" : !entry ? "no" : entry.addedDate && entry.addedDate > serviceDate ? "from-later-date" : "yes";
  const steps: string[] = [];

  if (onList === "no") {
    return {
      onList,
      window: { kind: "none" },
      actBy: null,
      nextDoseInWindow: null,
      headline: `Not found in CodeRx's copy of ${rule.shortName}'s site-of-care list (${input.list!.count} entries${input.list!.date ? `, dated ${fmt(input.list!.date)}` : ""}).`,
      steps: [
        `If ${rule.shortName} lists the drug under another name or code (a brand, a biosimilar, or a new code), its site-of-care policy applies: check ${rule.shortName}'s own list.`,
        "The drug may still need its own prior authorization.",
        "The list changes monthly: check again before the next authorization.",
      ],
    };
  }

  let window: SocCheckResult["window"];
  let actBy: string | null;
  let nextDoseInWindow: boolean | null = null;
  let headline: string;

  if (rule.oncologyDoses && entry?.oncologyStar) {
    const remaining = Math.max(0, rule.oncologyDoses.doses - input.hospitalDosesGiven);
    window = { kind: "doses", doses: rule.oncologyDoses.doses, remaining };
    actBy = remaining === 0 ? today : null;
    nextDoseInWindow = remaining > 0;
    headline =
      remaining > 0
        ? `As monotherapy, ${remaining} more hospital infusion${remaining === 1 ? "" : "s"} before UHC's site-of-care policy applies.`
        : "As monotherapy, UHC's site-of-care policy now applies to further hospital infusions.";
    steps.push("If the patient is on combination chemotherapy in the hospital, the policy applies once the drug continues as monotherapy.");
    steps.push("Once the policy applies, the hospital needs UHC's approval under its other criteria. A new start is one of the reasons it lists for a short time (its example is 4 weeks).");
  } else if (rule.window.kind === "days" && rule.window.days && input.newCourse) {
    const last = addDays(input.firstHospitalDose, rule.window.days - 1);
    const daysLeft = daysBetween(today, last);
    window = { kind: "days", last, daysLeft, approximate: !!rule.window.approximate };
    actBy = addDays(last, -input.leadDays);
    if (input.nextDose) nextDoseInWindow = input.nextDose <= last;
    if (rule.window.approval && daysLeft >= 0) steps.push(rule.window.approval);
    headline =
      daysLeft >= 0
        ? `${(rule.window.headline ?? "The initial period runs through {last}.").replace("{last}", fmt(last))} ${daysLeft === 0 ? "The last day is today." : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left.`}`
        : `${rule.shortName}'s initial period for this course ended on ${fmt(last)}.`;
  } else if (rule.window.kind === "days") {
    window = { kind: "none" };
    actBy = today;
    headline = `For continuing therapy, ${rule.shortName}'s initial period does not apply: hospital infusion needs its criteria now.`;
  } else {
    window = { kind: "none" };
    actBy = today;
    headline = rule.window.note ?? `${rule.shortName} states no initial hospital period: hospital infusion needs its criteria from the first dose.`;
  }

  if (onList === "from-later-date") headline = `This drug comes under ${rule.shortName}'s site-of-care policy on ${fmt(entry!.addedDate!)}. ${headline}`;
  if (onList === "unknown") steps.push(`${rule.shortName}'s drug list is not loaded here (${rule.listNote}) Confirm the drug is on it.`);
  for (const c of rule.checks ?? []) steps.push(c);
  if (rule.firstDose && input.hospitalDosesGiven === 0) steps.push(`First dose: ${rule.firstDose}`);
  if (nextDoseInWindow === false) steps.push(`The next dose (${fmt(input.nextDose!)}) falls after this period: it needs an approved exception, or home infusion or another approved site.`);
  const move = entry?.homeInfusionEligible === "No" ? `arrange another approved site (${rule.shortName} marks this drug not eligible for home infusion)` : "start the home infusion referral (or arrange another approved site)";
  if (actBy) steps.push(`By ${fmt(actBy < today ? today : actBy)}: either request an exception (if a criterion under Payer rules fits and is documented) or ${move}.`);
  if (entry?.homeInfusionEligible === "Yes") steps.push(`${rule.shortName}'s list marks this drug “Home infusion eligible: ${entry.homeInfusionEligible}”.`);
  if (rule.exceptionLimit) steps.push(`If an exception is approved, the policy says: “${rule.exceptionLimit.quote}”`);
  return { onList, window, actBy, nextDoseInWindow, headline, steps };
}
