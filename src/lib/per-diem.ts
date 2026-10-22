/**
 * Home infusion per diem S-codes. S9325–S9590 bill a home infusion pharmacy's
 * services, supplies, and equipment for each day a patient is on therapy; the drug
 * itself is billed separately with its own HCPCS code. Payers pick the per diem by
 * therapy category, so CodeRx derives the category from two official fields only:
 * the FDA Established Pharmacologic Class (EPC) and route in the NDC Directory, and
 * the clotting-factor column of the CMS payment limit file. It never reads the drug
 * name. CMS publishes no drug-to-per-diem crosswalk, so every result is labeled
 * derived and needs payer verification.
 */

/** Route groups that matter for home infusion, from FDA NDC Directory route names. */
export type RouteKind = "iv" | "sc" | "im" | "neuraxial";

const ROUTE_KINDS: [RouteKind, RegExp][] = [
  ["iv", /^(INTRAVENOUS|PARENTERAL|INTRA-ARTERIAL|INTRAVASCULAR)/],
  ["sc", /^SUBCUTANEOUS/],
  ["im", /^INTRAMUSCULAR/],
  ["neuraxial", /^(EPIDURAL|INTRATHECAL|PERINEURAL|INTRASPINAL|INFILTRATION)/],
];

export function routeKinds(routes: string[]): Set<RouteKind> {
  const out = new Set<RouteKind>();
  for (const r of routes) for (const [kind, re] of ROUTE_KINDS) if (re.test(r.trim().toUpperCase())) out.add(kind);
  return out;
}

export interface PerDiemCode {
  code: string;
  /** Plain-language use; the CMS descriptor is shown next to it. */
  when: string;
  /** When set and this is the only code whose routes include one of the drug's routes, it is marked suggested. */
  routes?: RouteKind[];
}

export interface PerDiemTherapy {
  id: string;
  label: string;
  codes: PerDiemCode[];
  note?: string;
}

interface TherapyRule extends PerDiemTherapy {
  /** Matched against EPC names with the " [EPC]" suffix removed. */
  epc?: RegExp;
  exclude?: RegExp;
  routes: RouteKind[];
}

const PAYER_CHOICE = "Payers use either the general per diem or the detailed codes, not both — follow the contract.";

const PAIN_CODES: PerDiemCode[] = [
  { code: "S9325", when: "General pain management per diem" },
  { code: "S9326", when: "Continuous infusion (24 hours or more)" },
  { code: "S9327", when: "Intermittent infusion (less than 24 hours)" },
  { code: "S9328", when: "Implanted pump" },
];

/** Checked in order; a drug can match more than one category. Rules sharing an id add evidence to one match. */
const RULES: TherapyRule[] = [
  {
    id: "anti-hemophilic",
    label: "Anti-hemophilic agent",
    epc: /\bFactor (VIII|IX|VIIa|X|XIII)\b|Antihemophilic|von Willebrand|Coagulation Factor|Prothrombin Complex/i,
    routes: ["iv", "sc"],
    codes: [{ code: "S9345", when: "Anti-hemophilic agent infusion (e.g., factor VIII)" }],
  },
  {
    id: "alpha-1",
    label: "Alpha-1 proteinase inhibitor",
    epc: /alpha.?1.{0,3}(Proteinase|Antitrypsin)/i,
    routes: ["iv"],
    codes: [{ code: "S9346", when: "Alpha-1-proteinase inhibitor infusion" }],
  },
  {
    id: "enzyme-replacement",
    label: "Enzyme replacement",
    epc: /Lysosomal|Enzyme Replacement/i,
    routes: ["iv"],
    codes: [{ code: "S9357", when: "Enzyme replacement IV therapy" }],
  },
  {
    id: "anti-tnf",
    label: "Anti-TNF",
    epc: /Tumor Necrosis Factor (Blocker|Blocking)/i,
    routes: ["iv"],
    codes: [{ code: "S9359", when: "Anti-TNF intravenous therapy (e.g., infliximab)" }],
  },
  {
    id: "rsv-antibody",
    label: "RSV monoclonal antibody",
    epc: /Respiratory Syncytial Virus/i,
    routes: ["im", "iv"],
    codes: [{ code: "S9562", when: "Palivizumab or another RSV monoclonal antibody" }],
  },
  {
    id: "immunotherapy",
    label: "Immunotherapy (immune globulin)",
    epc: /Immunoglobulin|Immune Globulin/i,
    routes: ["iv", "sc", "im"],
    codes: [
      { code: "S9338", when: "Infused immunotherapy — IV, or subcutaneous by pump", routes: ["iv", "sc"] },
      { code: "S9563", when: "Injected immunotherapy (not an infusion)", routes: ["sc", "im"] },
    ],
  },
  {
    id: "anti-infective",
    label: "Antibiotic, antiviral, or antifungal",
    epc: /Antibacterial|Antimicrobial|Antimycobacterial|Antifungal|Antiprotozoal|Antimalarial|Anti-?infective|Penem\b|Cephalosporin|Penicillin|Aminoglycoside|Glycopeptide|Tetracycline-class|Polymyxin|Monobactam|Echinocandin|Neuraminidase Inhibitor|virus|viral|\bHIV\b|SARS-CoV-2/i,
    exclude: /Vector|Gene Therapy|Oncolytic/i,
    routes: ["iv"],
    codes: [
      { code: "S9500", when: "Once every 24 hours" },
      { code: "S9501", when: "Once every 12 hours" },
      { code: "S9502", when: "Once every 8 hours" },
      { code: "S9503", when: "Once every 6 hours" },
      { code: "S9504", when: "Once every 4 hours" },
      { code: "S9497", when: "Once every 3 hours" },
      { code: "S9494", when: "General per diem — only when the payer does not use the dosing-frequency codes above" },
    ],
    note: "Pick the code that matches the prescribed dosing interval.",
  },
  {
    id: "hematopoietic",
    label: "Hematopoietic hormone",
    epc: /Erythropoiesis|Leukocyte Growth Factor|Colony.Stimulating|Granulocyte|Thrombopoietin/i,
    routes: ["iv", "sc"],
    codes: [{ code: "S9537", when: "Hematopoietic hormone injection (e.g., erythropoietin, G-CSF, GM-CSF)" }],
  },
  {
    id: "interferon",
    label: "Interferon",
    epc: /^Interferon[\s-]?(alpha|beta|gamma)\b/i,
    exclude: /Block|Antagon|Inhibit/i,
    routes: ["sc", "im", "iv"],
    codes: [{ code: "S9559", when: "Interferon injection" }],
  },
  {
    id: "hormonal",
    label: "Hormonal therapy",
    epc: /Gonadotropin.Releasing Hormone|\bGnRH\b|Estrogen Receptor Antagonist/i,
    routes: ["sc", "im"],
    codes: [{ code: "S9560", when: "Hormonal therapy injection (e.g., leuprolide, goserelin)" }],
  },
  {
    id: "growth-hormone",
    label: "Growth hormone",
    epc: /Growth Hormone|Somatropin|Somatotropin/i,
    exclude: /Releas|Antagon|Secretagogue|Inhibit/i,
    routes: ["sc", "im"],
    codes: [{ code: "S9558", when: "Growth hormone injection" }],
  },
  {
    id: "prostacyclin",
    label: "Long-term controlled-rate infusion",
    epc: /Prostacycl/i,
    routes: ["iv", "sc"],
    codes: [{ code: "S9347", when: "Uninterrupted, long-term, controlled-rate IV or subcutaneous infusion (e.g., epoprostenol)" }],
  },
  {
    id: "inotrope",
    label: "Sympathomimetic / inotropic agent",
    epc: /beta1-Adrenergic Agonist|Phosphodiesterase 3 Inhibitor|Catecholamine|Inotrop/i,
    routes: ["iv"],
    codes: [{ code: "S9348", when: "Sympathomimetic or inotropic infusion (e.g., dobutamine)" }],
  },
  {
    id: "pain",
    label: "Pain management",
    epc: /Opioid Agonist/i,
    exclude: /Partial Opioid Agonist/i,
    routes: ["iv", "sc", "neuraxial"],
    codes: PAIN_CODES,
    note: PAYER_CHOICE,
  },
  {
    // Local anesthetics count only as epidural or nerve-block infusions, not IV (e.g., lidocaine for arrhythmia).
    id: "pain",
    label: "Pain management",
    epc: /Local Anesthetic/i,
    routes: ["neuraxial"],
    codes: PAIN_CODES,
    note: PAYER_CHOICE,
  },
  {
    id: "chemotherapy",
    label: "Chemotherapy",
    epc: /Alkylating|Platinum-based|Nucleoside Metabolic Inhibitor|Folate Analog Metabolic Inhibitor|Anthracycline|Anthracenedione|Topoisomerase Inhibitor|Vinca Alkaloid|Microtubule Inhibitor|Proteasome Inhibitor|Kinase Inhibitor|Antibody.?Drug Conjugate|Cytolytic Antibody|Programmed Death|PD-L1|CTLA-4|Cytotoxic T-Lymphocyte Antigen|HER2|Epidermal Growth Factor Receptor|Vascular Endothelial Growth Factor|Hypomethylating|Histone Deacetylase|T.Cell Engager|Antineoplastic|Podophyllotoxin/i,
    routes: ["iv", "sc"],
    codes: [
      { code: "S9329", when: "General chemotherapy per diem" },
      { code: "S9330", when: "Continuous infusion (24 hours or more)" },
      { code: "S9331", when: "Intermittent infusion (less than 24 hours)" },
    ],
    note: PAYER_CHOICE,
  },
  {
    id: "corticosteroid",
    label: "Corticosteroid",
    epc: /^Corticosteroid$/i,
    routes: ["iv"],
    codes: [{ code: "S9490", when: "Corticosteroid infusion" }],
  },
  {
    id: "anti-emetic",
    label: "Anti-emetic",
    epc: /Serotonin.?3 Receptor Antagonist|Neurokinin.?1 Receptor Antagonist|Substance P/i,
    routes: ["iv", "sc", "im"],
    codes: [
      { code: "S9351", when: "Continuous or intermittent infusion", routes: ["iv"] },
      { code: "S9370", when: "Intermittent injection", routes: ["sc", "im"] },
    ],
  },
  {
    id: "anticoagulant",
    label: "Anticoagulant",
    epc: /Anti-?coagulant|Heparin|Direct Thrombin Inhibitor|Factor Xa Inhibitor/i,
    exclude: /Antagonist|Antidote|Reversal/i,
    routes: ["iv", "sc"],
    codes: [
      { code: "S9336", when: "Continuous infusion (e.g., heparin drip)", routes: ["iv"] },
      { code: "S9372", when: "Intermittent injection", routes: ["sc"] },
    ],
    note: "Heparin used only to flush or lock a catheter is not anticoagulant therapy; do not bill these per diems for flushes.",
  },
  {
    id: "insulin",
    label: "Insulin",
    epc: /^Insulin/i,
    exclude: /Secretagogue|Sensitiz/i,
    routes: ["iv", "sc"],
    codes: [{ code: "S9353", when: "Continuous insulin infusion" }],
    note: "Applies only to continuous infusion, not routine self-injected insulin.",
  },
  {
    id: "diuretic",
    label: "Diuretic",
    epc: /Diuretic/i,
    routes: ["iv"],
    codes: [{ code: "S9361", when: "Diuretic IV therapy" }],
  },
  {
    id: "chelation",
    label: "Chelation",
    epc: /Chelat/i,
    routes: ["iv", "sc", "im"],
    codes: [{ code: "S9355", when: "Chelation therapy" }],
  },
  {
    id: "tpn",
    label: "Total parenteral nutrition",
    epc: /^Amino Acids?$|Lipid Emulsion|Parenteral Nutrition/i,
    routes: ["iv"],
    codes: [
      { code: "S9364", when: "General TPN per diem" },
      { code: "S9365", when: "Up to 1 liter per day" },
      { code: "S9366", when: "More than 1 and up to 2 liters per day" },
      { code: "S9367", when: "More than 2 and up to 3 liters per day" },
      { code: "S9368", when: "More than 3 liters per day" },
    ],
    note: PAYER_CHOICE,
  },
];

const UNCLASSIFIED: PerDiemTherapy = {
  id: "not-otherwise-classified",
  label: "Not otherwise classified",
  codes: [
    { code: "S9379", when: "Infusion therapy with no specific per diem code", routes: ["iv", "neuraxial"] },
    { code: "S9542", when: "Injectable therapy with no specific per diem code", routes: ["sc", "im"] },
  ],
  note: "No specific category was found in this drug’s FDA pharmacologic class. Use a specific code instead when the therapy is one CodeRx cannot detect: hydration (S9373–S9377), tocolytic (S9349), anti-spasmodic (S9363), blood products (S9538), or irrigation (S9590).",
};

/**
 * Medicare pays no per diem. Its home infusion therapy services benefit pays per infusion
 * day (subsequent visit, initial visit) for drugs given through a covered DME infusion pump.
 * Categories follow the CMS descriptors of these codes.
 */
export const MEDICARE_HIT_CATEGORIES = [
  { category: 1, codes: ["G0068", "G0088"], label: "IV anti-infective, pain management, chelation, pulmonary hypertension, inotropic, or other IV drug (not chemotherapy)" },
  { category: 2, codes: ["G0069", "G0089"], label: "Subcutaneous immunotherapy or other subcutaneous infusion" },
  { category: 3, codes: ["G0070", "G0090"], label: "IV chemotherapy or other highly complex drug" },
] as const;

export const CMS_HIT_RATES_URL = "https://www.cms.gov/medicare/payment/fee-for-service-providers/home-infusion-therapy/billing-and-rates";

/** Every per diem code CodeRx can show, for looking up CMS descriptors in one query. */
export const PER_DIEM_CODES: string[] = [...new Set([...RULES, UNCLASSIFIED].flatMap((r) => r.codes.map((c) => c.code)))];

export type PerDiemBasis = "fda-epc" | "cms-clotting-factor" | "route-only";

export interface PerDiemMatch {
  therapy: Omit<PerDiemTherapy, "codes">;
  codes: (PerDiemCode & { suggested: boolean })[];
  basis: PerDiemBasis;
  /** The official values that triggered the match (EPC names or the CMS flag). */
  evidence: string[];
}

export interface PerDiemResult {
  status: "matched" | "unclassified" | "not-applicable";
  matches: PerDiemMatch[];
  /** Why no per diem applies, when status is "not-applicable". */
  reason: string | null;
}

/** The distinguishing part of a per diem's CMS long descriptor, before the shared "administrative services, …" text. */
export function perDiemDescriptor(longDescription: string): string {
  return longDescription.split(/[;,]\s*(?:including\s+)?administrative services/i)[0].trim();
}

/** EPC names without the " [EPC]" suffix; other class types (MoA, CS, PE) are ignored. */
export function epcNames(pharmClasses: string[]): string[] {
  return pharmClasses.filter((c) => /\[EPC\]\s*$/i.test(c)).map((c) => c.replace(/\s*\[EPC\]\s*$/i, "").trim());
}

/** The CMS payment limit file's clotting-factor column is blank for every other drug. */
export function isClottingFactorFlag(value: string | null | undefined): boolean {
  const v = (value ?? "").trim();
  return v !== "" && !/^(n|no|0|false)$/i.test(v);
}

/** Suggests a code only when the drug's routes fit exactly one; IV-and-subcutaneous products stay unmarked. */
function withSuggestion(codes: PerDiemCode[], kinds: Set<RouteKind>): PerDiemMatch["codes"] {
  const fits = codes.filter((c) => c.routes?.some((r) => kinds.has(r)));
  return codes.map((c) => ({ ...c, suggested: fits.length === 1 && c === fits[0] }));
}

export function perDiemFor(input: { pharmClasses: string[]; routes: string[]; clottingFactorCodes?: string[] }): PerDiemResult {
  // Some FDA listings (e.g., factor kits) give no route at all: consider every route but suggest none.
  const routeUnknown = !input.routes.some((r) => r.trim());
  const kinds = routeUnknown ? new Set<RouteKind>(ROUTE_KINDS.map(([k]) => k)) : routeKinds(input.routes);
  const suggestFrom = routeUnknown ? new Set<RouteKind>() : kinds;
  const epcs = epcNames(input.pharmClasses);
  if (!kinds.size) {
    return { status: "not-applicable", matches: [], reason: `Home infusion per diems apply to infused or injected therapy; FDA lists this drug’s route(s) as ${input.routes.join(", ").toLowerCase()}.` };
  }
  if (epcs.some((e) => /Vaccine/i.test(e))) {
    return { status: "not-applicable", matches: [], reason: "Vaccines are billed with vaccine product and administration codes, not home infusion per diems." };
  }

  const matches: PerDiemMatch[] = [];
  for (const rule of RULES) {
    if (!rule.routes.some((r) => kinds.has(r))) continue;
    const evidence = epcs.filter((e) => rule.epc?.test(e) && !rule.exclude?.test(e));
    let basis: PerDiemBasis = "fda-epc";
    if (rule.id === "anti-hemophilic" && input.clottingFactorCodes?.length) {
      evidence.unshift(`CMS payment limit file lists ${input.clottingFactorCodes.join(", ")} as a clotting factor`);
      basis = "cms-clotting-factor";
    }
    if (!evidence.length) continue;
    const existing = matches.find((m) => m.therapy.id === rule.id);
    if (existing) existing.evidence.push(...evidence);
    else matches.push({ therapy: { id: rule.id, label: rule.label, note: rule.note }, codes: withSuggestion(rule.codes, suggestFrom), basis, evidence });
  }
  if (matches.length) return { status: "matched", matches, reason: null };

  const { codes, ...therapy } = UNCLASSIFIED;
  return {
    status: "unclassified",
    matches: [{ therapy, codes: withSuggestion(codes, suggestFrom), basis: "route-only", evidence: epcs.length ? epcs : ["No FDA pharmacologic class (EPC) listed"] }],
    reason: null,
  };
}
