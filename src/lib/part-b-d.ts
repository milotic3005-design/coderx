/**
 * Which Medicare benefit pays for a drug in each setting. Pure: no database, no network, and
 * it runs in the browser, so anything imported from the ingest layer must be `import type`.
 *
 * Part B and Part D are not a choice. A drug is not a Part D drug when Part A or B would pay
 * for it as prescribed and dispensed or administered, so the benefit follows the facts.
 *
 * Rule text checked 2026-11-05: Part D Manual Ch. 6 Rev. 18 (§10.12, §20.1, §20.2, Appendix C),
 * CMS's coverage table (March 2018), CMS publication 11333 (June 2020), and Medicare.gov's
 * vaccine coverage. Chapter 6's Appendix B says barbiturates and benzodiazepines are covered,
 * so they are not in the exclusions note. Nothing here decides from a drug's name.
 */
import type { DmePolicy } from "@/ingest/parsers/cms-lcd";

export type Setting = "inpatient" | "snf" | "hospice" | "hopd" | "home_pump" | "home_no_pump" | "ltc";
export type Verdict = "part_a" | "hospice" | "part_b" | "part_b_packaged" | "part_b_dme" | "part_d" | "not_part_b" | "check" | "not_applicable";
export type RouteChoice = "iv" | "subcutaneous" | "im" | "oral" | "other" | null;
export type QuestionKey = "transplant" | "cancer" | "antiemetic48h" | "pid" | "nebulizer" | "clottingFactor" | "dialysisEsa" | "permanentGi";

export interface SadFact {
  status: "not_listed" | "listed" | "route_specific" | "double_route" | "catch_all";
  products: string[];
  contractorsListing: number;
  contractorsTotal: number;
  displayId: string | null;
}

export interface BenefitFacts {
  code: string | null;
  isActive: boolean;
  isNoc: boolean;
  /** FDA route names, upper case. */
  routes: string[];
  productType: string | null;
  /** Null when the source has not been imported. */
  sad: SadFact | null;
  /** Null when the source has not been imported. */
  dmePolicies: DmePolicy[] | null;
  /** Null when the source has not been imported. */
  notPayable: boolean | null;
  oppsLoaded: boolean;
  oppsStatus: string | null;
}

export interface BenefitAnswers {
  route: RouteChoice;
  answers: Partial<Record<QuestionKey, boolean>>;
  dmeposEnrolled: boolean;
}

const LCD_URL = "https://www.cms.gov/medicare-coverage-database/view/lcd.aspx?lcdid=";
const CHAPTER_6 = "https://www.cms.gov/medicare/prescription-drug-coverage/prescriptiondrugcovcontra/downloads/part-d-benefits-manual-chapter-6.pdf";
const COVERAGE_TABLE = "https://www.cms.gov/files/document/medicare-drug-coverage-under-parts-b-and-d-508-final-v2pdf";

export const RULE_SOURCES = {
  part_d_definition: { title: "Social Security Act §1860D-2(e)(2)(B)", section: "42 U.S.C. §1395w-102(e)(2)(B)", url: "https://www.law.cornell.edu/uscode/text/42/1395w-102" },
  ch6_home_infusion: { title: "Part D Manual, Chapter 6", section: "§10.12", url: CHAPTER_6 },
  ch6_exclusions: { title: "Part D Manual, Chapter 6", section: "§20.1", url: CHAPTER_6 },
  ch6_appendix_c: { title: "Part D Manual, Chapter 6", section: "Appendix C", url: CHAPTER_6 },
  coverage_table: { title: "Medicare Drug Coverage Under Part A, Part B, and Part D", section: "CMS, revised March 2018", url: COVERAGE_TABLE },
  mbpm_sad: { title: "Medicare Benefit Policy Manual, Chapter 15", section: "§50.2", url: "https://www.cms.gov/regulations-and-guidance/guidance/manuals/downloads/bp102c15.pdf" },
  noridian_sad: { title: "Noridian JF Self-Administered Drug Exclusion List", section: "A53033", url: "https://www.cms.gov/medicare-coverage-database/view/article.aspx?articleid=53033" },
  sad_hopd: { title: "How Medicare Covers Self-Administered Drugs Given in Hospital Outpatient Settings", section: "CMS publication 11333, June 2020", url: "https://www.medicare.gov/sites/default/files/2020-07/11333-Outpatient-Self-Administered-Drugs.pdf" },
  opps: { title: "CMS OPPS Addendum B", section: "Status indicators", url: "https://www.cms.gov/medicare/payment/prospective-payment-systems/hospital-outpatient/addendum-a-b-updates" },
  not_payable: { title: "CMS Drugs Not Payable Under Part B", section: "ASP pricing files", url: "https://www.cms.gov/medicare/payment/part-b-drugs/asp-pricing-files" },
  lcd_pump: { title: "External Infusion Pumps LCD", section: "L33794", url: `${LCD_URL}33794` },
  lcd_ivig: { title: "Intravenous Immune Globulin LCD", section: "L33610", url: `${LCD_URL}33610` },
  lcd_immunosuppressive: { title: "Immunosuppressive Drugs LCD", section: "L33824", url: `${LCD_URL}33824` },
  lcd_antiemetic: { title: "Oral Antiemetic Drugs LCD", section: "L33827", url: `${LCD_URL}33827` },
  lcd_nebulizer: { title: "Nebulizers LCD", section: "L33370", url: `${LCD_URL}33370` },
  vaccines: { title: "Medicare.gov: Prescription drugs (outpatient)", section: "Vaccines", url: "https://www.medicare.gov/coverage/prescription-drugs-outpatient" },
  part_b_id: { title: "Medicare Part B Immunosuppressive Drug Benefit", section: "CMS", url: "https://www.cms.gov/partbid-provider" },
} as const;

export type RuleSourceKey = keyof typeof RULE_SOURCES;

export interface SettingResult {
  setting: Setting;
  verdict: Verdict;
  reason: string;
  modifier: "JA" | "JB" | null;
  notes: string[];
  sources: RuleSourceKey[];
}

type Outcome = Omit<SettingResult, "setting" | "modifier" | "notes"> & Partial<Pick<SettingResult, "modifier" | "notes">>;

const hasRoute = (f: BenefitFacts, route: string) => f.routes.includes(route);
const onPolicy = (f: BenefitFacts, policy: DmePolicy) => f.dmePolicies?.includes(policy) ?? false;
/** The J8 family is CMS's oral drug codes, so the code is evidence of the route when no FDA product is linked. */
const isOralCode = (f: BenefitFacts) => /^J8\d{3}$/.test(f.code ?? "");
const isOralOnly = (f: BenefitFacts, a: BenefitAnswers) => a.route === "oral" || (f.routes.length > 0 ? f.routes.every((r) => r === "ORAL") : isOralCode(f));

/** J8499 is non-chemotherapy, and antiemetics have their own policy. */
const isOralChemoCode = (f: BenefitFacts) => isOralCode(f) && f.code !== "J8499" && (f.routes.length === 0 || hasRoute(f, "ORAL")) && !onPolicy(f, "antiemetic");

/** Without a linked product the rules cannot tell what the drug is, and only a catch-all Part D answer would be left. */
const isIdentified = (f: BenefitFacts) => f.routes.length > 0 || f.productType != null || isOralCode(f);

export function questionsFor(f: BenefitFacts): { primary: QuestionKey[]; other: QuestionKey[] } {
  const primary: QuestionKey[] = [];
  if (onPolicy(f, "immunosuppressive")) primary.push("transplant");
  if (isOralChemoCode(f)) primary.push("cancer");
  if (onPolicy(f, "antiemetic")) primary.push("antiemetic48h");
  if (onPolicy(f, "ivig")) primary.push("pid");
  if (onPolicy(f, "nebulizer")) primary.push("nebulizer");
  return { primary, other: ["clottingFactor", "dialysisEsa", "permanentGi"] };
}

const STATUTORY: Partial<Record<QuestionKey, Outcome>> = {
  transplant: { verdict: "part_b_dme", reason: "Part B pays for immunosuppressives after a Medicare-covered transplant, billed to the DME contractor.", sources: ["lcd_immunosuppressive", "coverage_table"] },
  cancer: { verdict: "part_b_dme", reason: "Part B pays for an oral anticancer drug used for cancer when it has the same active ingredient and indication as IV chemotherapy, billed to the DME contractor.", sources: ["coverage_table", "ch6_appendix_c"] },
  antiemetic48h: { verdict: "part_b_dme", reason: "Part B pays for an oral antiemetic within 48 hours of chemotherapy as a full replacement for an IV antiemetic, billed to the DME contractor.", sources: ["lcd_antiemetic", "coverage_table"] },
  pid: { verdict: "part_b_dme", reason: "Part B pays for IVIG at home for primary immune deficiency, drug only: not the items and services to give it.", sources: ["lcd_ivig", "ch6_appendix_c"] },
  nebulizer: { verdict: "part_b_dme", reason: "Part B pays for inhalation drugs given by a nebulizer at home, as a DME supply.", sources: ["lcd_nebulizer", "coverage_table"] },
  clottingFactor: { verdict: "part_b", reason: "Part B pays for clotting factors for hemophilia patients who can use them without medical supervision.", sources: ["ch6_appendix_c"] },
  dialysisEsa: { verdict: "part_b", reason: "Part B pays for this through dialysis care: drugs for ESRD are in the ESRD payment, and other uses of the drug can be Part D.", sources: ["coverage_table"] },
  permanentGi: { verdict: "part_b_dme", reason: "Part B pays for parenteral nutrition for permanent dysfunction of the digestive tract, under the prosthetic benefit.", sources: ["coverage_table"] },
};

/** Cases where the law keeps a self-administered drug under Part B. The CMS table keeps pumps, nebulizers, and home IVIG out of long-term care. */
function statutoryCase(f: BenefitFacts, a: BenefitAnswers, place: "home" | "ltc"): Outcome | "unanswered" | "catch_all" | null {
  const { primary, other } = questionsFor(f);
  const homeOnly: QuestionKey[] = ["pid", "nebulizer", "clottingFactor"];
  const applies = (q: QuestionKey) => place === "home" || !homeOnly.includes(q);
  let unanswered = false;
  for (const q of primary.filter(applies)) {
    if (f.isNoc && q !== "cancer") return "catch_all";
    const answer = q === "nebulizer" ? (a.answers.nebulizer ?? true) : a.answers[q];
    if (answer === true) return STATUTORY[q]!;
    if (answer === undefined) unanswered = true;
  }
  for (const q of other.filter(applies)) if (a.answers[q] === true) return STATUTORY[q]!;
  return unanswered ? "unanswered" : null;
}

const NOT_PAYABLE: Outcome = { verdict: "check", reason: "CMS lists this code as not payable under Part B, which conflicts with this Part B case. Check before billing.", sources: ["not_payable"] };
const CATCH_ALL: Outcome = { verdict: "check", reason: "This is a catch-all code, so the code alone cannot show which product it is, or which benefit pays.", sources: ["opps"] };
const NO_PRODUCT: Outcome = { verdict: "check", reason: "CMS links no product to this code, so this row cannot be decided. Check the drug's route and form.", sources: ["coverage_table"] };
const VACCINE: Outcome = { verdict: "check", reason: "Which benefit pays depends on the vaccine. See the note below.", sources: ["vaccines", "coverage_table"] };
const CATCH_ALL_LIST: Outcome = { verdict: "check", reason: "This is a catch-all code, so the code alone cannot show which product it is. Check your product against the DME policy.", sources: ["lcd_pump"] };
const UNANSWERED: Outcome = { verdict: "check", reason: "Answer the question above to decide this row.", sources: ["coverage_table"] };
const INACTIVE: Outcome = { verdict: "check", reason: "This HCPCS code is inactive, so Part B cannot be billed under it. Find the current code.", sources: ["opps"] };
const missing = (what: string): Outcome => ({ verdict: "check", reason: `${what} has not been loaded yet, so this row cannot be decided.`, sources: ["coverage_table"] });

const PART_D_NOTES = ["Part D does not cover some uses whatever the setting, such as weight loss, fertility, and cosmetic use."];
const VACCINE_NOTE =
  "Vaccines: Part B covers influenza, pneumococcal, COVID-19, and hepatitis B (never completed a series, unknown history, or medium or high risk), and some vaccines after an injury or exposure. Other ACIP-recommended adult vaccines are Part D at no cost to the patient.";
const PART_B_ID_NOTE = "Part B-ID: a drug-only benefit for people whose ESRD-based Medicare ended 36 months after a transplant.";
const PART_D_DRUG_ONLY = "Part D pays for the drug only. Home infusion supplies and nursing are never covered under Part D.";

const dmeposNote = (a: BenefitAnswers) => (a.dmeposEnrolled ? "Your pharmacy can bill this as an enrolled DMEPOS supplier." : "This needs an enrolled DMEPOS supplier; Part D cannot pay because Part B would.");

function hopdStatus(f: BenefitFacts, modifier: "JA" | null, notes: string[]): Outcome {
  if (!f.oppsLoaded) return missing("CMS OPPS Addendum B");
  if (f.oppsStatus === "K" || f.oppsStatus === "G") return { verdict: "part_b", reason: "Part B pays for this drug separately in the hospital outpatient department.", modifier, notes, sources: ["opps"] };
  if (f.oppsStatus === "N") return { verdict: "part_b_packaged", reason: "Part B covers this drug, but its payment is packaged into the procedure or visit.", modifier, notes, sources: ["opps"] };
  return { verdict: "check", reason: f.oppsStatus ? `OPPS status ${f.oppsStatus} is not a separately paid or packaged drug status. Check Addendum B.` : "CMS's OPPS Addendum B has no status for this code.", modifier, notes, sources: ["opps"] };
}

function hopd(f: BenefitFacts, a: BenefitAnswers): Outcome {
  if (!f.code) return { verdict: "check", reason: "This drug has no HCPCS code linked by CMS, so Part B cannot be decided.", sources: ["opps"] };
  if (!f.isActive) return INACTIVE;
  if (f.notPayable === null) return missing("CMS's payment limit file");
  if (f.notPayable) return { verdict: "not_part_b", reason: "CMS lists this code as not payable under Part B.", sources: ["not_payable"] };
  if (!f.sad) return missing("The self-administered drug list");

  const selfAdministered: Outcome = {
    verdict: "not_part_b",
    reason: "On Noridian's self-administered drug list, so Part B does not pay. The hospital may bill the patient.",
    notes: ["A Part D plan may refund the patient only in limited cases, such as a drug on its formulary that could not reasonably be obtained at an in-network pharmacy."],
    sources: ["noridian_sad", "sad_hopd", "mbpm_sad"],
  };
  const contractors = f.sad.status === "not_listed" && f.sad.contractorsListing > 0 ? [`${f.sad.contractorsListing} of ${f.sad.contractorsTotal} Medicare contractor lists include this code as self-administered. Noridian's Washington list does not.`] : [];

  switch (f.sad.status) {
    case "listed":
      return selfAdministered;
    case "catch_all":
      return { verdict: "check", reason: "This is a catch-all code on Noridian's list, so the code alone does not decide. Check your product against these names.", notes: [`Listed products: ${f.sad.products.join("; ")}.`], sources: ["noridian_sad"] };
    case "route_specific":
      if (a.route === "iv") return hopdStatus(f, "JA", ["Bill with JA. A claim for this code with neither JA nor JB is denied."]);
      if (a.route === "subcutaneous") return { ...selfAdministered, modifier: "JB", notes: ["The subcutaneous form is denied as a benefit exclusion. A claim with neither JA nor JB is also denied."] };
      return { verdict: "check", reason: "Choose a route: on Noridian's list the subcutaneous form is excluded and the IV form is not.", sources: ["noridian_sad"] };
    case "double_route":
      if (a.route === "im") return hopdStatus(f, null, ["Noridian asks for no modifier on the IM form."]);
      if (a.route === "subcutaneous") return { ...selfAdministered, modifier: "JB" };
      return { verdict: "check", reason: "Choose a route: on Noridian's list the subcutaneous form is excluded and the IM form is not.", sources: ["noridian_sad"] };
  }

  if (f.isNoc) return CATCH_ALL;
  if (isOralOnly(f, a)) {
    if (f.dmePolicies === null) return missing("The DME policy list");
    const statutory = statutoryCase(f, a, "home");
    if (statutory === "unanswered") return UNANSWERED;
    if (statutory === "catch_all") return CATCH_ALL_LIST;
    if (statutory) return f.notPayable ? NOT_PAYABLE : statutory;
    return { verdict: "not_part_b", reason: "Oral drugs are usually self-administered, so Part B does not pay. The hospital may bill the patient.", sources: ["noridian_sad", "sad_hopd"] };
  }
  return hopdStatus(f, null, contractors);
}

function homePump(f: BenefitFacts): Outcome {
  if (f.dmePolicies === null) return missing("The DME policy list");
  if (!onPolicy(f, "pump")) return { verdict: "not_applicable", reason: "Not on Medicare's external infusion pump drug list, so the next row applies.", sources: ["lcd_pump"] };
  if (!f.isActive) return INACTIVE;
  if (f.isNoc) return CATCH_ALL_LIST;
  if (f.notPayable) return NOT_PAYABLE;
  return { verdict: "part_b_dme", reason: "Part B pays for this drug as a supply for a covered external infusion pump, billed to the DME contractor, when the pump is medically necessary.", sources: ["lcd_pump", "coverage_table"] };
}

/** Part D is the answer left when nothing else applies, so it needs the drug to be known first. */
function partD(f: BenefitFacts, reason: string, sources: RuleSourceKey[]): Outcome {
  if (f.isNoc) return CATCH_ALL;
  if (!isIdentified(f)) return NO_PRODUCT;
  if (f.productType === "VACCINE") return VACCINE;
  return { verdict: "part_d", reason, notes: PART_D_NOTES, sources: [...sources, "part_d_definition", "ch6_exclusions"] };
}

function homeNoPump(f: BenefitFacts, a: BenefitAnswers): Outcome {
  if (f.dmePolicies === null) return missing("The DME policy list");
  const statutory = statutoryCase(f, a, "home");
  if (statutory === "unanswered") return UNANSWERED;
  if (statutory === "catch_all") return CATCH_ALL_LIST;
  if (statutory) return !f.isActive ? INACTIVE : f.notPayable ? NOT_PAYABLE : statutory;
  return partD(f, PART_D_DRUG_ONLY, ["ch6_home_infusion"]);
}

function longTermCare(f: BenefitFacts, a: BenefitAnswers): Outcome {
  if (f.dmePolicies === null) return missing("The DME policy list");
  const statutory = statutoryCase(f, a, "ltc");
  if (statutory === "unanswered") return UNANSWERED;
  if (statutory === "catch_all") return CATCH_ALL_LIST;
  if (statutory) return !f.isActive ? INACTIVE : f.notPayable ? NOT_PAYABLE : statutory;
  return partD(f, "Part D pays here, even for drugs given by a pump or nebulizer, because a long-term care facility is not a home for the DME benefit.", ["coverage_table"]);
}

const finish = (f: BenefitFacts, a: BenefitAnswers, setting: Setting, o: Outcome): SettingResult => {
  const notes = [...(o.notes ?? [])];
  if (o.verdict === "part_b_dme") notes.push(dmeposNote(a));
  const showsTransplantNote = (setting === "home_no_pump" || setting === "ltc") && onPolicy(f, "immunosuppressive");
  if (showsTransplantNote) notes.push(PART_B_ID_NOTE);
  const showsVaccineNote = f.productType === "VACCINE" && (setting === "hopd" || setting === "home_no_pump" || setting === "ltc");
  if (showsVaccineNote) notes.push(VACCINE_NOTE);
  const sources = [...new Set([...o.sources, ...(showsTransplantNote ? (["part_b_id"] as const) : []), ...(showsVaccineNote ? (["vaccines"] as const) : [])])];
  return { setting, verdict: o.verdict, reason: o.reason, modifier: o.modifier ?? null, notes, sources };
};

/** The row for the home infusion pharmacy: the pump row when the pump benefit is in play at all, including when it needs a check. */
export function homeSummary(results: SettingResult[]): SettingResult {
  const pump = results.find((r) => r.setting === "home_pump");
  return pump && pump.verdict !== "not_applicable" ? pump : results.find((r) => r.setting === "home_no_pump")!;
}

export function decideBenefit(f: BenefitFacts, a: BenefitAnswers): SettingResult[] {
  const outcomes: Record<Setting, Outcome> = {
    inpatient: {
      verdict: "part_a",
      reason: "The hospital's Part A payment includes the drug, with no separate drug payment.",
      notes: ["If Part A days are used up or the stay is not covered, Part B or Part D may apply. Clotting factors are paid separately."],
      sources: ["ch6_appendix_c", "coverage_table"],
    },
    snf: {
      verdict: "part_a",
      reason: "The facility's Part A payment includes the drug, under consolidated billing.",
      notes: ["Certain high-intensity chemotherapy drugs are billed separately under Part B.", "If the stay is not covered by Part A, the long-term care row applies."],
      sources: ["coverage_table"],
    },
    hospice: {
      verdict: "hospice",
      reason: "The hospice benefit covers drugs for symptom control or pain relief related to the terminal illness.",
      notes: ["Drugs for an unrelated condition follow the other rows."],
      sources: ["coverage_table"],
    },
    hopd: hopd(f, a),
    home_pump: homePump(f),
    home_no_pump: homeNoPump(f, a),
    ltc: longTermCare(f, a),
  };
  return (Object.keys(outcomes) as Setting[]).map((setting) => finish(f, a, setting, outcomes[setting]));
}
