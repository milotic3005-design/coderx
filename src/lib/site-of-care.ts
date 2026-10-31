/**
 * Site-of-care comparison: what one therapy is paid per month in a hospital outpatient
 * department (HOPD, on-campus or excepted off-campus) versus a home infusion pharmacy
 * that is not a Medicare home infusion therapy (HIT) supplier.
 *
 * Official inputs: CMS OPPS Addendum B (the drug's status indicator and rate), Addendum A
 * (drug administration APC rates), the CMS Part B payment limit file, and the Washington
 * HCA home infusion fee schedule. Everything else (Apple Health EAPG and pharmacy
 * payments, commercial contract terms, Part D) is entered by the user and labeled so.
 * Derived arithmetic for planning, not a payment determination.
 */

export type Payer = "medicare" | "apple_health" | "commercial";
export type Frequency = "admin" | "week" | "month";
export type LineSource = "cms_opps_addendum_a" | "cms_opps_addendum_b" | "cms_payment_limits" | "wa_hca_home_infusion" | "you";

/** OPPS labor-related share: 60% of the APC rate is adjusted by the hospital's wage index (42 CFR 419.43). */
export const OPPS_LABOR_SHARE = 0.6;
export const WEEKS_PER_MONTH = 52 / 12;

export interface OppsDrugRate {
  statusIndicator: string | null;
  /** Payment rate per HCPCS unit. */
  paymentRate: number | null;
  /** Beneficiary copayment per unit (inflation-adjusted when CMS publishes one). */
  copayPerUnit: number | null;
}

export interface DrugInfo {
  code: string;
  /** CMS Part B payment limit per billing unit (ASP file). */
  aspLimit: number | null;
  /** Coinsurance percent from the ASP file (20 unless inflation-adjusted). */
  aspCoinsurancePct: number | null;
  /** Addendum B row; null when the code is not in Addendum B. */
  opps: OppsDrugRate | null;
}

export interface ApcRate {
  apc: string;
  title: string | null;
  statusIndicator: string | null;
  paymentRate: number;
  /** National unadjusted (or minimum) copayment; null means 20% of the rate. */
  copay: number | null;
}

export interface RemedyOffset {
  ratio: number;
  statusIndicators: string[];
}

export interface HcaFee {
  code: string;
  modifier: string | null;
  label: string;
  /** Maximum allowable fee for the chosen payment area; null for text such as "BR". */
  amount: number | null;
  text: string;
}

export type DrugBasis = { kind: "pct_asp"; pct: number } | { kind: "per_unit"; amount: number };
export type AdminBasis = { kind: "pct_medicare"; pct: number } | { kind: "per_visit"; amount: number };

export interface SiteOfCareInput {
  drug: DrugInfo;
  unitsPerAdmin: number;
  adminsPerMonth: number;
  hopd: {
    apcLines: { apc: ApcRate; count: number }[];
    wageIndex: number;
    applyRemedyOffset: boolean;
    remedyOffset: RemedyOffset | null;
    /** CMS caps a line's coinsurance at the inpatient deductible (stated in Addendum B notes). */
    copayCap: number | null;
  };
  medicare: {
    /** Part B pays the drug at home (DME infusion pump drug, or IVIG for PIDD) and the pharmacy bills as a DMEPOS supplier. */
    homePartB: boolean;
    /** Part B DME pump rental and supplies per month (user-entered, from the DMEPOS fee schedule). */
    homeDmePerMonth: number | null;
    /** Part D plan payment per billing unit (user-entered). */
    homePartDPerUnit: number | null;
  };
  appleHealth: {
    /** EAPG payment per HOPD visit, from the user's remittances. */
    hopdVisit: number | null;
    /** High-cost drug paid outside EAPG, per unit (user-entered); null when the drug is inside EAPG. */
    hopdDrugPerUnit: number | null;
    homeDrugPerUnit: number | null;
    homeDispensingFee: number | null;
    fillsPerMonth: number;
    hcaItems: { fee: HcaFee; quantity: number; frequency: Frequency }[];
    nursingPerVisit: number | null;
    nursingVisitsPerAdmin: number;
  };
  commercial: {
    hopdDrug: DrugBasis | null;
    hopdAdmin: AdminBasis | null;
    homeDrug: DrugBasis | null;
    perDiem: number | null;
    perDiemDaysPerMonth: number;
    nursingPerVisit: number | null;
    nursingVisitsPerAdmin: number;
    homeOtherPerMonth: number | null;
  };
  /** Optional drug acquisition cost per billing unit at each site. */
  cost: { hopdPerUnit: number | null; homePerUnit: number | null };
  sequestrationPct: number;
}

export interface Line {
  label: string;
  /** Allowed amount for the month. */
  amount: number;
  /** Medicare Part B coinsurance for the month (0 for other payers). */
  patientShare: number;
  /** Medicare Part B program payment, reduced by sequestration. */
  sequestered: boolean;
  source: LineSource;
  formula: string;
}

export interface SiteResult {
  /** "incomplete" when a needed input is missing; totals then cover only the lines shown. */
  status: "computed" | "incomplete";
  lines: Line[];
  allowed: number;
  patientShare: number;
  /** Expected revenue: program share after sequestration plus the patient share. */
  expected: number;
  missing: string[];
  notes: string[];
  cost: number | null;
  margin: number | null;
}

export interface PayerComparison {
  payer: Payer;
  hopd: SiteResult;
  home: SiteResult;
  /** Home minus HOPD expected revenue; null unless both are complete. */
  difference: number | null;
  better: "hopd" | "home" | "same" | null;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const money = (x: number) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;
const times = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ""));

/** Per-month multiplier for an item billed per administration, per week, or per month. */
export function perMonth(frequency: Frequency, adminsPerMonth: number): number {
  return frequency === "admin" ? adminsPerMonth : frequency === "week" ? WEEKS_PER_MONTH : 1;
}

/** Wage adjustment for an OPPS APC rate: labor share × wage index + non-labor share. */
export function wageFactor(wageIndex: number): number {
  return OPPS_LABOR_SHARE * wageIndex + (1 - OPPS_LABOR_SHARE);
}

function finish(lines: Line[], missing: string[], notes: string[], sequestrationPct: number, units: number, costPerUnit: number | null): SiteResult {
  const allowed = lines.reduce((t, l) => t + l.amount, 0);
  const patientShare = lines.reduce((t, l) => t + l.patientShare, 0);
  const expected = lines.reduce((t, l) => t + (l.amount - l.patientShare) * (l.sequestered ? 1 - sequestrationPct / 100 : 1) + l.patientShare, 0);
  const cost = costPerUnit != null ? r2(costPerUnit * units) : null;
  return {
    status: missing.length ? "incomplete" : "computed",
    lines: lines.map((l) => ({ ...l, amount: r2(l.amount), patientShare: r2(l.patientShare) })),
    allowed: r2(allowed),
    patientShare: r2(patientShare),
    expected: r2(expected),
    missing,
    notes,
    cost,
    margin: cost != null && !missing.length ? r2(expected - cost) : null,
  };
}

/** Medicare HOPD: the drug by its Addendum B status indicator, plus wage-adjusted administration APCs. */
function medicareHopd(input: SiteOfCareInput, units: number): { result: SiteResult; adminAllowed: number } {
  const { drug, hopd, adminsPerMonth } = input;
  const lines: Line[] = [];
  const missing: string[] = [];
  const notes: string[] = [];
  const si = drug.opps?.statusIndicator ?? null;
  if (!drug.opps) {
    missing.push(`OPPS Addendum B row for ${drug.code}`);
    notes.push("No authoritative public data was located for this field.");
  } else if ((si === "K" || si === "G") && drug.opps.paymentRate != null) {
    const allowed = drug.opps.paymentRate * units;
    const perVisit = (drug.opps.copayPerUnit ?? drug.opps.paymentRate * 0.2) * input.unitsPerAdmin;
    const capped = hopd.copayCap != null && perVisit > hopd.copayCap;
    if (capped) notes.push(`The drug's coinsurance is capped at the inpatient deductible (${money(hopd.copayCap!)}) per visit, as CMS states in Addendum B.`);
    const copay = (capped ? hopd.copayCap! : perVisit) * adminsPerMonth;
    lines.push({
      label: `Drug ${drug.code} (status ${si}, separately paid)`,
      amount: allowed,
      patientShare: copay,
      sequestered: true,
      source: "cms_opps_addendum_b",
      formula: `${money(drug.opps.paymentRate)} × ${times(units)} units`,
    });
  } else if (si === "N") {
    lines.push({ label: `Drug ${drug.code} (status N, packaged)`, amount: 0, patientShare: 0, sequestered: true, source: "cms_opps_addendum_b", formula: "No separate payment" });
    notes.push("Status N: Medicare packages this drug into the administration payment; the hospital is paid nothing separately for it.");
  } else {
    lines.push({ label: `Drug ${drug.code} (status ${si ?? "—"})`, amount: 0, patientShare: 0, sequestered: true, source: "cms_opps_addendum_b", formula: "Not paid under OPPS" });
    notes.push(`Status indicator ${si ?? "(blank)"}: not separately paid under the OPPS. See the CMS status indicator definitions (Addendum D1).`);
  }

  const factor = wageFactor(hopd.wageIndex);
  let adminAllowed = 0;
  for (const { apc, count } of hopd.apcLines) {
    if (!(count > 0)) continue;
    const offset = hopd.applyRemedyOffset && hopd.remedyOffset && apc.statusIndicator && hopd.remedyOffset.statusIndicators.includes(apc.statusIndicator) ? hopd.remedyOffset.ratio : 1;
    const each = apc.paymentRate * factor * offset;
    const n = count * adminsPerMonth;
    const allowed = each * n;
    adminAllowed += allowed;
    lines.push({
      label: `APC ${apc.apc} ${apc.title ?? ""}`.trim(),
      amount: allowed,
      patientShare: Math.min((apc.copay ?? apc.paymentRate * 0.2) * factor * offset, hopd.copayCap ?? Infinity) * n,
      sequestered: true,
      source: "cms_opps_addendum_a",
      formula: `${money(apc.paymentRate)} × wage factor ${factor.toFixed(4)}${offset !== 1 ? ` × remedy offset ${offset}` : ""} × ${times(n)}`,
    });
  }
  if (!hopd.apcLines.some((l) => l.count > 0)) missing.push("Drug administration APCs per visit");
  notes.push("Some administration services are conditionally packaged (status Q1) when billed with another separately paid service on the same claim; count only the APCs Medicare pays.");
  return { result: finish(lines, missing, notes, input.sequestrationPct, units, input.cost.hopdPerUnit), adminAllowed };
}

function medicareHome(input: SiteOfCareInput, units: number): SiteResult {
  const { drug, medicare } = input;
  const lines: Line[] = [];
  const missing: string[] = [];
  const notes = ["Not a Medicare home infusion therapy (HIT) supplier: no Medicare payment for home infusion professional services, and Medicare does not pay per diem S-codes."];
  if (medicare.homePartB) {
    if (drug.aspLimit == null) missing.push(`CMS payment limit for ${drug.code}`);
    else {
      const allowed = drug.aspLimit * units;
      lines.push({
        label: `Drug ${drug.code} (Part B, DME benefit)`,
        amount: allowed,
        patientShare: allowed * ((drug.aspCoinsurancePct ?? 20) / 100),
        sequestered: true,
        source: "cms_payment_limits",
        formula: `${money(drug.aspLimit)} × ${times(units)} units`,
      });
    }
    if (medicare.homeDmePerMonth != null) {
      lines.push({ label: "Pump rental and supplies (Part B DME)", amount: medicare.homeDmePerMonth, patientShare: medicare.homeDmePerMonth * 0.2, sequestered: true, source: "you", formula: "You entered, per month" });
    } else notes.push("Add the pump rental and supplies from the CMS DMEPOS fee schedule for Washington to include them.");
  } else if (medicare.homePartDPerUnit != null) {
    lines.push({ label: `Drug ${drug.code} (Part D plan)`, amount: medicare.homePartDPerUnit * units, patientShare: 0, sequestered: false, source: "you", formula: `${money(medicare.homePartDPerUnit)} you entered × ${times(units)} units` });
    notes.push("Part D pays the drug only; supplies, pump, and nursing are not covered under Part D.");
  } else missing.push("Part D plan payment per unit (or mark the drug as covered by Part B at home)");
  return finish(lines, missing, notes, input.sequestrationPct, units, input.cost.homePerUnit);
}

function appleHealthHopd(input: SiteOfCareInput, units: number): SiteResult {
  const ah = input.appleHealth;
  const lines: Line[] = [];
  const missing: string[] = [];
  if (ah.hopdVisit != null) lines.push({ label: "EAPG payment per visit", amount: ah.hopdVisit * input.adminsPerMonth, patientShare: 0, sequestered: false, source: "you", formula: `${money(ah.hopdVisit)} you entered × ${times(input.adminsPerMonth)} visits` });
  else missing.push("Apple Health EAPG payment per visit");
  if (ah.hopdDrugPerUnit != null) lines.push({ label: `Drug ${input.drug.code} (paid outside EAPG)`, amount: ah.hopdDrugPerUnit * units, patientShare: 0, sequestered: false, source: "you", formula: `${money(ah.hopdDrugPerUnit)} you entered × ${times(units)} units` });
  const notes = ["HCA pays outpatient hospital claims by EAPG (3M grouper weight × your hospital's conversion factor); certain high-cost drugs are paid outside EAPG. CodeRx cannot run the grouper, so enter amounts from your remittances."];
  return finish(lines, missing, notes, input.sequestrationPct, units, input.cost.hopdPerUnit);
}

function appleHealthHome(input: SiteOfCareInput, units: number): SiteResult {
  const ah = input.appleHealth;
  const lines: Line[] = [];
  const missing: string[] = [];
  const notes: string[] = [];
  if (ah.homeDrugPerUnit != null) lines.push({ label: `Drug ${input.drug.code} (pharmacy claim)`, amount: ah.homeDrugPerUnit * units, patientShare: 0, sequestered: false, source: "you", formula: `${money(ah.homeDrugPerUnit)} you entered × ${times(units)} units` });
  else missing.push("Apple Health drug payment per unit");
  if (ah.homeDispensingFee != null && ah.fillsPerMonth > 0) lines.push({ label: "Dispensing fee", amount: ah.homeDispensingFee * ah.fillsPerMonth, patientShare: 0, sequestered: false, source: "you", formula: `${money(ah.homeDispensingFee)} × ${times(ah.fillsPerMonth)} fills` });
  for (const item of ah.hcaItems) {
    if (!(item.quantity > 0)) continue;
    const label = `${item.fee.code}${item.fee.modifier ? `-${item.fee.modifier}` : ""} ${item.fee.label}`;
    if (item.fee.amount == null) {
      notes.push(`${label}: HCA lists "${item.fee.text}" (no fixed fee), so it is not counted.`);
      continue;
    }
    const n = item.quantity * perMonth(item.frequency, input.adminsPerMonth);
    lines.push({ label, amount: item.fee.amount * n, patientShare: 0, sequestered: false, source: "wa_hca_home_infusion", formula: `${money(item.fee.amount)} HCA maximum × ${times(r2(n))}` });
  }
  if (ah.nursingPerVisit != null && ah.nursingVisitsPerAdmin > 0) {
    const n = ah.nursingVisitsPerAdmin * input.adminsPerMonth;
    lines.push({ label: "Nursing visits", amount: ah.nursingPerVisit * n, patientShare: 0, sequestered: false, source: "you", formula: `${money(ah.nursingPerVisit)} you entered × ${times(n)} visits` });
  }
  notes.push("HCA pays the lesser of your usual charge and its maximum allowable fee; home infusion per diem S-codes are not on the HCA schedule.");
  return finish(lines, missing, notes, input.sequestrationPct, units, input.cost.homePerUnit);
}

function drugLine(basis: DrugBasis, drug: DrugInfo, units: number, site: string): Line | string {
  if (basis.kind === "per_unit") return { label: `Drug ${drug.code} (${site} contract)`, amount: basis.amount * units, patientShare: 0, sequestered: false, source: "you", formula: `${money(basis.amount)} you entered × ${times(units)} units` };
  if (drug.aspLimit == null) return `CMS payment limit for ${drug.code} (needed for % of ASP)`;
  return { label: `Drug ${drug.code} (${basis.pct}% of the CMS payment limit)`, amount: drug.aspLimit * (basis.pct / 100) * units, patientShare: 0, sequestered: false, source: "cms_payment_limits", formula: `${money(drug.aspLimit)} × ${basis.pct}% × ${times(units)} units` };
}

function commercialHopd(input: SiteOfCareInput, units: number, medicareAdminAllowed: number): SiteResult {
  const c = input.commercial;
  const lines: Line[] = [];
  const missing: string[] = [];
  if (c.hopdDrug) {
    const l = drugLine(c.hopdDrug, input.drug, units, "HOPD");
    if (typeof l === "string") missing.push(l);
    else lines.push(l);
  } else missing.push("HOPD drug contract term");
  if (c.hopdAdmin?.kind === "per_visit") lines.push({ label: "Administration (contract, per visit)", amount: c.hopdAdmin.amount * input.adminsPerMonth, patientShare: 0, sequestered: false, source: "you", formula: `${money(c.hopdAdmin.amount)} × ${times(input.adminsPerMonth)} visits` });
  else if (c.hopdAdmin?.kind === "pct_medicare") {
    if (medicareAdminAllowed > 0) lines.push({ label: `Administration (${c.hopdAdmin.pct}% of Medicare OPPS)`, amount: (medicareAdminAllowed * c.hopdAdmin.pct) / 100, patientShare: 0, sequestered: false, source: "cms_opps_addendum_a", formula: `${money(r2(medicareAdminAllowed))} Medicare APC total × ${c.hopdAdmin.pct}%` });
    else missing.push("Drug administration APCs (needed for % of Medicare)");
  } else missing.push("HOPD administration contract term");
  const notes = ["Contract allowed amounts include the patient's cost sharing."];
  return finish(lines, missing, notes, input.sequestrationPct, units, input.cost.hopdPerUnit);
}

function commercialHome(input: SiteOfCareInput, units: number): SiteResult {
  const c = input.commercial;
  const lines: Line[] = [];
  const missing: string[] = [];
  if (c.homeDrug) {
    const l = drugLine(c.homeDrug, input.drug, units, "home");
    if (typeof l === "string") missing.push(l);
    else lines.push(l);
  } else missing.push("Home drug contract term");
  if (c.perDiem != null && c.perDiemDaysPerMonth > 0) lines.push({ label: "Per diem (S-code)", amount: c.perDiem * c.perDiemDaysPerMonth, patientShare: 0, sequestered: false, source: "you", formula: `${money(c.perDiem)} × ${times(c.perDiemDaysPerMonth)} days` });
  if (c.nursingPerVisit != null && c.nursingVisitsPerAdmin > 0) {
    const n = c.nursingVisitsPerAdmin * input.adminsPerMonth;
    lines.push({ label: "Nursing visits", amount: c.nursingPerVisit * n, patientShare: 0, sequestered: false, source: "you", formula: `${money(c.nursingPerVisit)} × ${times(n)} visits` });
  }
  if (c.homeOtherPerMonth != null) lines.push({ label: "Other (supplies, pump)", amount: c.homeOtherPerMonth, patientShare: 0, sequestered: false, source: "you", formula: "You entered, per month" });
  return finish(lines, missing, ["Contract allowed amounts include the patient's cost sharing."], input.sequestrationPct, units, input.cost.homePerUnit);
}

function compare(payer: Payer, hopd: SiteResult, home: SiteResult): PayerComparison {
  if (hopd.status !== "computed" || home.status !== "computed") return { payer, hopd, home, difference: null, better: null };
  const difference = r2(home.expected - hopd.expected);
  return { payer, hopd, home, difference, better: Math.abs(difference) < 0.005 ? "same" : difference > 0 ? "home" : "hopd" };
}

/** Monthly expected revenue at each site for each payer. */
export function compareSites(input: SiteOfCareInput): PayerComparison[] {
  const units = input.unitsPerAdmin * input.adminsPerMonth;
  const mh = medicareHopd(input, units);
  return [
    compare("medicare", mh.result, medicareHome(input, units)),
    compare("apple_health", appleHealthHopd(input, units), appleHealthHome(input, units)),
    compare("commercial", commercialHopd(input, units, mh.adminAllowed), commercialHome(input, units)),
  ];
}

/**
 * Drug administration APC counts per visit as a starting point. Plain-language services
 * with the APC levels CMS assigned them in CY 2026 (Addendum B); check your remittances.
 * The additional-hour count follows the time rule: one more hour for each full hour
 * past the first, once the extra time exceeds 30 minutes.
 */
export const ADMIN_PRESETS = [
  { id: "complex", label: "Chemotherapy or complex biologic IV infusion", first: "5694", extra: "5692" },
  { id: "therapeutic", label: "Therapeutic IV infusion (non-chemotherapy)", first: "5693", extra: "5691" },
  { id: "push", label: "IV push", first: "5693", extra: null },
  { id: "injection", label: "Subcutaneous or intramuscular injection (no infusion that visit)", first: "5692", extra: null },
] as const;

export function additionalHours(minutes: number): number {
  return minutes > 90 ? Math.floor((minutes - 31) / 60) : 0;
}
