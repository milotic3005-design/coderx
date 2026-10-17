/**
 * Billing-unit arithmetic for HCPCS-coded drugs.
 *
 * Conventions implemented (educational; payer rules vary and must be verified):
 * - Units are reported in multiples of the dosage in the HCPCS descriptor; a dose
 *   that is not an exact multiple is rounded UP to the next whole unit.
 * - For single-dose containers, the billable units for the discarded amount are
 *   ceil(total amount opened ÷ billing unit) − administered units. When that is 0,
 *   no separate discarded quantity is billable.
 * - Discarded-drug reporting does not apply to multi-dose containers.
 * CodeRx never recommends a modifier; it shows the arithmetic and cites the source.
 */

export type Dimension = "mass" | "volume" | "unit" | "iu" | "meq" | "mmol" | "activity" | "count";

interface UnitDef {
  key: UnitKey;
  label: string;
  dimension: Dimension;
  /** Multiplier to the dimension's base (mass: mcg, volume: mL, activity: µCi). */
  factor: number;
}

export type UnitKey = "g" | "mg" | "mcg" | "ng" | "l" | "ml" | "unit" | "iu" | "meq" | "mmol" | "mci" | "uci" | "each";

export const UNITS: Record<UnitKey, UnitDef> = {
  g: { key: "g", label: "g", dimension: "mass", factor: 1_000_000 },
  mg: { key: "mg", label: "mg", dimension: "mass", factor: 1_000 },
  mcg: { key: "mcg", label: "mcg", dimension: "mass", factor: 1 },
  ng: { key: "ng", label: "ng", dimension: "mass", factor: 0.001 },
  l: { key: "l", label: "L", dimension: "volume", factor: 1_000 },
  ml: { key: "ml", label: "mL", dimension: "volume", factor: 1 },
  unit: { key: "unit", label: "units", dimension: "unit", factor: 1 },
  iu: { key: "iu", label: "IU", dimension: "iu", factor: 1 },
  meq: { key: "meq", label: "mEq", dimension: "meq", factor: 1 },
  mmol: { key: "mmol", label: "mmol", dimension: "mmol", factor: 1 },
  mci: { key: "mci", label: "mCi", dimension: "activity", factor: 1_000 },
  uci: { key: "uci", label: "µCi", dimension: "activity", factor: 1 },
  each: { key: "each", label: "each", dimension: "count", factor: 1 },
};

const UNIT_ALIASES: Record<string, UnitKey> = {
  g: "g",
  gm: "g",
  gram: "g",
  grams: "g",
  mg: "mg",
  milligram: "mg",
  milligrams: "mg",
  mcg: "mcg",
  ug: "mcg",
  "µg": "mcg",
  microgram: "mcg",
  micrograms: "mcg",
  ng: "ng",
  l: "l",
  liter: "l",
  ml: "ml",
  cc: "ml",
  milliliter: "ml",
  milliliters: "ml",
  unit: "unit",
  units: "unit",
  u: "unit",
  iu: "iu",
  "i.u.": "iu",
  "i.u": "iu",
  meq: "meq",
  mmol: "mmol",
  mci: "mci",
  millicurie: "mci",
  millicuries: "mci",
  uci: "uci",
  "µci": "uci",
  microcurie: "uci",
  microcuries: "uci",
  ea: "each",
  each: "each",
};

export function resolveUnit(raw: string | null | undefined): UnitKey | null {
  if (!raw) return null;
  return UNIT_ALIASES[raw.trim().toLowerCase()] ?? null;
}

export function convert(amount: number, from: UnitKey, to: UnitKey): number | null {
  const a = UNITS[from];
  const b = UNITS[to];
  if (a.dimension !== b.dimension) return null;
  return (amount * a.factor) / b.factor;
}

export interface ParsedDosage {
  amount: number;
  unit: UnitKey;
  /** Text the amount was read from. */
  source: string;
}

/**
 * Parse a CMS "HCPCS Code Dosage" value ("10 MG", "0.5 ML", "150 IU", "1 EA").
 * Returns null for non-numeric descriptors such as "Per infusion" or "Up to 10 mCi".
 */
export function parseCmsDosage(text: string | null | undefined): ParsedDosage | null {
  if (!text) return null;
  const m = text.trim().match(/^(\d[\d,]*(?:\.\d+)?)\s*([A-Za-zµ.]+)$/);
  if (!m) return null;
  const amount = Number(m[1].replace(/,/g, ""));
  const unit = resolveUnit(m[2]);
  if (!unit || !Number.isFinite(amount) || amount <= 0) return null;
  return { amount, unit, source: text.trim() };
}

/**
 * Derive a billing unit from a HCPCS long descriptor ("Injection, pembrolizumab, 1 mg").
 * Only the last dosage expression is used, and only when it is unambiguous: a descriptor
 * with several different amounts — a combination product ("3 mg and … 125 mg") or a dose
 * range ("greater than 3 mg, but less than or equal to 6 mg") — gives no unit unless the
 * last amount is its own "per" clause ("(25 mg per cc); per 0.5 cc") or the text says
 * "500 ml = 1 unit". "2.7 mg per 0.1 ml" is a concentration, not a billing unit.
 */
export function parseDescriptorDosage(descriptor: string | null | undefined): ParsedDosage | null {
  if (!descriptor) return null;
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(mg|mcg|micrograms?|milligrams?|grams?|gm|g|ml|cc|units?|iu|i\.u\.|meq|mmol|millicuries?|microcuries?|mci|uci)(?=$|[\s,;).])/gi;
  // A clause of its own like ", per ml" or ", per milligram" bills one of that unit, whatever
  // concentrations the rest of the text mentions ("300-399 mg/ml iodine concentration, per ml").
  const perClause = descriptor.match(/(?:^|[,;])\s*per\s+(milligrams?|micrograms?|microcuries?|millicuries?|ml|milliliters?|cc|iu|i\.u\.)(?=$|[\s,;).])/i);
  if (perClause) {
    const u = resolveUnit(perClause[1].replace(/s$/i, ""));
    if (u) return { amount: 1, unit: u, source: descriptor };
  }
  const matches = [...descriptor.matchAll(re)];
  if (matches.length === 0) {
    if (/\bper\s+(?:i\.u\.|iu\b)/i.test(descriptor)) return { amount: 1, unit: "iu", source: descriptor };
    return null;
  }
  // "(500 ml = 1 unit)": the descriptor states the billing unit outright.
  const equals = descriptor.match(/(\d[\d,]*(?:\.\d+)?)\s*(ml|cc)\s*=\s*1\s*unit\b/i);
  if (equals) return { amount: Number(equals[1].replace(/,/g, "")), unit: "ml", source: descriptor };
  // Billed per dose, source, or package: the amount is a cap or a strength, not the unit.
  if (/\bper (?:study|treatment) dose\b|\bper source\b/i.test(descriptor)) return null;
  const read = (m: RegExpMatchArray) => ({ amount: Number(m[1].replace(/,/g, "")), unit: resolveUnit(m[2]) });
  const last = matches[matches.length - 1];
  const { amount, unit } = read(last);
  if (!unit || !Number.isFinite(amount) || amount <= 0) return null;
  // A band ("greater than 10 mg", "1 cc or less"), a rate ("50 ml per hour"), a count
  // ("2 cc, each"), or an equation ("100 calories = 1 unit") does not name the billing unit.
  // "Up to 4 mg" does: one unit covers up to that amount.
  const before = descriptor.slice(0, last.index);
  const after = descriptor.slice((last.index ?? 0) + last[0].length);
  if (/(?:greater|less|more|fewer) than\s*$|equal to\s*$|exceed(?:s|ing)?\s*$|[=<>≤≥]\s*$/i.test(before)) return null;
  if (/^\s*(?:or (?:less|greater|more|fewer)\b|per (?:hour|minute|day|week|month|kg)\b|\/\s*(?:hr|hour|day|kg|ml)\b|daily\b|,?\s*each\b|,?\s*per (?:bottle|package|pack|kit|carton|box)\b|=)/i.test(after)) return null;
  const distinct = new Set(matches.map((m) => { const r = read(m); return `${r.amount} ${r.unit}`; }));
  if (distinct.size > 1 && !/(?:^|[;,])\s*per\s*$/i.test(descriptor.slice(0, last.index))) return null;
  return { amount, unit, source: descriptor };
}

/** Ceil that ignores binary floating-point noise (e.g. 3.0000000000000004 → 3). */
export function ceilUnits(x: number): number {
  return Math.ceil(Math.round(x * 1e9) / 1e9);
}

function round(x: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

export type ContainerType = "single-dose" | "multi-dose" | "unknown";

export interface CalculatorInput {
  dose: number;
  doseUnit: UnitKey;
  billingUnitAmount: number;
  billingUnitUnit: UnitKey;
  /** Amount of drug in one container (vial, syringe, package item). */
  containerAmount?: number | null;
  containerUnit?: UnitKey | null;
  /** Number of containers opened; defaults to the minimum needed for the dose. */
  containersOpened?: number | null;
  /** Known discarded amount; overrides the container-based estimate. */
  discardedAmount?: number | null;
  discardedUnit?: UnitKey | null;
  containerType: ContainerType;
  /** Medicare payment limit per billing unit, for a derived estimate only. */
  paymentLimitPerUnit?: number | null;
}

export interface CalculationStep {
  label: string;
  expression: string;
  value: string;
}

export interface CalculatorResult {
  ok: true;
  unitLabel: string;
  /** Dose ÷ billing unit before rounding. */
  rawUnits: number;
  administeredUnits: number;
  roundedUp: boolean;
  containersOpened: number | null;
  totalOpened: number | null;
  utilizationPct: number | null;
  discardedAmount: number | null;
  /** ceil(total opened ÷ unit). */
  totalUnitsOpened: number | null;
  /** Billable units attributable to the discarded amount (single-dose containers). */
  discardedUnits: number | null;
  estimatedAllowedAdministered: number | null;
  estimatedAllowedDiscarded: number | null;
  steps: CalculationStep[];
  warnings: string[];
}

export interface CalculatorError {
  ok: false;
  errors: { field: keyof CalculatorInput; message: string }[];
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("en-US") : round(n, 4).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function calculateBillingUnits(input: CalculatorInput): CalculatorResult | CalculatorError {
  const errors: CalculatorError["errors"] = [];
  const positive = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;

  if (!positive(input.dose)) errors.push({ field: "dose", message: "Enter a dose greater than zero." });
  if (!positive(input.billingUnitAmount))
    errors.push({ field: "billingUnitAmount", message: "Enter the HCPCS billing unit amount (for example, 10 for “10 mg”)." });
  if (input.containerAmount != null && !positive(input.containerAmount))
    errors.push({ field: "containerAmount", message: "Container amount must be greater than zero." });
  if (input.containersOpened != null && !(Number.isInteger(input.containersOpened) && input.containersOpened > 0))
    errors.push({ field: "containersOpened", message: "Containers opened must be a whole number of at least 1." });
  if (input.discardedAmount != null && !(typeof input.discardedAmount === "number" && input.discardedAmount >= 0))
    errors.push({ field: "discardedAmount", message: "Discarded amount cannot be negative." });
  if (errors.length) return { ok: false, errors };

  const unit = input.billingUnitUnit;
  const unitLabel = UNITS[unit].label;
  const dose = convert(input.dose, input.doseUnit, unit);
  if (dose == null) {
    return {
      ok: false,
      errors: [
        {
          field: "doseUnit",
          message: `The dose is in ${UNITS[input.doseUnit].label} but the billing unit is in ${unitLabel}. These cannot be converted automatically — convert using the product labeling.`,
        },
      ],
    };
  }

  const steps: CalculationStep[] = [];
  const warnings: string[] = [];
  const perUnit = input.billingUnitAmount;

  if (input.doseUnit !== unit) {
    steps.push({
      label: "Convert dose to billing-unit measure",
      expression: `${fmt(input.dose)} ${UNITS[input.doseUnit].label} → ${unitLabel}`,
      value: `${fmt(dose)} ${unitLabel}`,
    });
  }

  const rawUnits = dose / perUnit;
  const administeredUnits = ceilUnits(rawUnits);
  const roundedUp = administeredUnits !== round(rawUnits, 9);
  steps.push({
    label: "Dose ÷ billing unit",
    expression: `${fmt(dose)} ${unitLabel} ÷ ${fmt(perUnit)} ${unitLabel}`,
    value: `${fmt(rawUnits)} units`,
  });
  steps.push({
    label: "Administered HCPCS units (whole units, rounded up)",
    expression: `ceil(${fmt(rawUnits)})`,
    value: `${administeredUnits} units`,
  });
  if (roundedUp) {
    warnings.push(
      `The dose is not an exact multiple of the ${fmt(perUnit)} ${unitLabel} billing unit, so ${fmt(rawUnits)} was rounded up to ${administeredUnits}. Medicare instructions describe rounding up; other payers may differ.`,
    );
  }

  let containersOpened: number | null = null;
  let totalOpened: number | null = null;
  let discardedAmount: number | null = null;

  if (input.discardedAmount != null) {
    const discarded = convert(input.discardedAmount, input.discardedUnit ?? unit, unit);
    if (discarded == null) {
      return { ok: false, errors: [{ field: "discardedUnit", message: "Discarded amount must use the same kind of unit as the billing unit." }] };
    }
    discardedAmount = discarded;
    totalOpened = dose + discarded;
    steps.push({
      label: "Total amount opened (administered + discarded, entered)",
      expression: `${fmt(dose)} + ${fmt(discarded)} ${unitLabel}`,
      value: `${fmt(totalOpened)} ${unitLabel}`,
    });
  } else if (input.containerAmount != null) {
    const container = convert(input.containerAmount, input.containerUnit ?? unit, unit);
    if (container == null) {
      return { ok: false, errors: [{ field: "containerUnit", message: "Container amount must use the same kind of unit as the billing unit." }] };
    }
    const minimum = ceilUnits(dose / container);
    containersOpened = input.containersOpened ?? minimum;
    if (containersOpened < minimum) {
      warnings.push(`${containersOpened} container(s) cannot hold the dose; at least ${minimum} are needed.`);
    }
    totalOpened = containersOpened * container;
    discardedAmount = Math.max(0, totalOpened - dose);
    steps.push({
      label: "Containers opened",
      expression: input.containersOpened ? "entered" : `ceil(${fmt(dose)} ÷ ${fmt(container)} ${unitLabel})`,
      value: `${containersOpened}`,
    });
    steps.push({
      label: "Total amount opened",
      expression: `${containersOpened} × ${fmt(container)} ${unitLabel}`,
      value: `${fmt(totalOpened)} ${unitLabel}`,
    });
    steps.push({
      label: "Remaining (unused) amount",
      expression: `${fmt(totalOpened)} − ${fmt(dose)} ${unitLabel}`,
      value: `${fmt(discardedAmount)} ${unitLabel}`,
    });
  }

  let utilizationPct: number | null = null;
  let totalUnitsOpened: number | null = null;
  let discardedUnits: number | null = null;

  if (totalOpened != null && totalOpened > 0) {
    utilizationPct = round((dose / totalOpened) * 100, 1);
    steps.push({
      label: "Utilization",
      expression: `${fmt(dose)} ÷ ${fmt(totalOpened)} × 100`,
      value: `${utilizationPct}%`,
    });
    if (input.containerType === "multi-dose") {
      warnings.push(
        "Multi-dose containers: Medicare discarded-drug reporting applies to single-dose containers only, so no discarded units are calculated.",
      );
    } else {
      totalUnitsOpened = ceilUnits(totalOpened / perUnit);
      discardedUnits = Math.max(0, totalUnitsOpened - administeredUnits);
      steps.push({
        label: "Billable units in amount opened",
        expression: `ceil(${fmt(totalOpened)} ÷ ${fmt(perUnit)})`,
        value: `${totalUnitsOpened} units`,
      });
      steps.push({
        label: "Units attributable to the discarded amount",
        expression: `${totalUnitsOpened} − ${administeredUnits}`,
        value: `${discardedUnits} units`,
      });
      if (discardedAmount && discardedAmount > 0 && discardedUnits === 0) {
        warnings.push(
          "The discarded amount is covered by the rounded-up administered units, so no separate discarded units result from this arithmetic.",
        );
      }
      if (input.containerType === "unknown") {
        warnings.push("Container type is unknown. Discarded-drug rules depend on whether the container is single-dose; confirm with the product labeling.");
      }
    }
  }

  let estimatedAllowedAdministered: number | null = null;
  let estimatedAllowedDiscarded: number | null = null;
  if (input.paymentLimitPerUnit != null && Number.isFinite(input.paymentLimitPerUnit)) {
    estimatedAllowedAdministered = round(administeredUnits * input.paymentLimitPerUnit, 2);
    steps.push({
      label: "Derived Medicare allowed amount (administered)",
      expression: `${administeredUnits} × $${input.paymentLimitPerUnit.toFixed(3)}`,
      value: money(estimatedAllowedAdministered),
    });
    if (discardedUnits != null && discardedUnits > 0) {
      estimatedAllowedDiscarded = round(discardedUnits * input.paymentLimitPerUnit, 2);
      steps.push({
        label: "Derived Medicare allowed amount (discarded units)",
        expression: `${discardedUnits} × $${input.paymentLimitPerUnit.toFixed(3)}`,
        value: money(estimatedAllowedDiscarded),
      });
    }
  }

  return {
    ok: true,
    unitLabel,
    rawUnits: round(rawUnits, 6),
    administeredUnits,
    roundedUp,
    containersOpened,
    totalOpened: totalOpened == null ? null : round(totalOpened, 6),
    utilizationPct,
    discardedAmount: discardedAmount == null ? null : round(discardedAmount, 6),
    totalUnitsOpened,
    discardedUnits,
    estimatedAllowedAdministered,
    estimatedAllowedDiscarded,
    steps,
    warnings,
  };
}
