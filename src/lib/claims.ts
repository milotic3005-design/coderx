/**
 * Claim-line arithmetic for a drug administration: HCPCS units, the JW/JZ
 * discarded-drug modifiers, and the NDC segment (N4 qualifier, 11-digit NDC, unit
 * qualifier, quantity). Educational — payers differ on NDC quantity conventions,
 * and CodeRx never decides whether a modifier applies to a specific claim.
 */
import type { CalculatorResult, ContainerType } from "./billing";

export type NdcQualifier = "UN" | "ML" | "GR" | "F2" | "ME";

export const NDC_QUALIFIERS: { key: NdcQualifier; label: string; hint: string }[] = [
  { key: "ML", label: "ML — milliliter", hint: "Commonly used for liquids (solutions, suspensions)." },
  { key: "UN", label: "UN — unit (each)", hint: "Commonly used for powders reconstituted in the vial, and for each-type items." },
  { key: "GR", label: "GR — gram", hint: "Commonly used for creams, ointments, and bulk powders." },
  { key: "F2", label: "F2 — international unit", hint: "Used mainly for clotting factors billed in IU." },
  { key: "ME", label: "ME — milligram", hint: "Accepted by some payers; most bill at the UN or ML level." },
];

export interface ClaimLine {
  role: "administered" | "discarded";
  hcpcsCode: string;
  modifier: "JW" | "JZ" | null;
  units: number;
  ndc11: string | null;
  qualifier: NdcQualifier | null;
  /** NDC quantity for the line; null when it must be entered (payer-specific). */
  ndcQuantity: number | null;
}

export interface ClaimLinesInput {
  hcpcsCode: string;
  result: Pick<CalculatorResult, "administeredUnits" | "discardedUnits" | "discardedAmount" | "containersOpened">;
  /** Dose in the billing-unit measure. */
  dose: number;
  containerType: ContainerType;
  ndc11?: string | null;
  qualifier?: NdcQualifier | null;
  /** Drug amount in one container (billing-unit measure) and its volume, when known. */
  containerAmount?: number | null;
  mlPerContainer?: number | null;
}

function round3(x: number) {
  return Math.round(x * 1000) / 1000;
}

/** Medicare's largest unit count on one claim line; larger amounts span lines (CMS JW/JZ FAQs 16 and 18). */
export const MAX_UNITS_PER_LINE = 9999;

/** Full lines of 9,999 units, then the remainder. */
function lineUnits(total: number): number[] {
  if (total <= MAX_UNITS_PER_LINE) return [total];
  const out: number[] = Array(Math.floor(total / MAX_UNITS_PER_LINE)).fill(MAX_UNITS_PER_LINE);
  const rest = total - out.length * MAX_UNITS_PER_LINE;
  if (rest > 0) out.push(rest);
  return out;
}

/** Split an NDC quantity across lines in proportion to their units; the last line takes the rounding remainder. */
function splitQuantity(total: number | null, units: number[]): (number | null)[] {
  if (total == null) return units.map(() => null);
  const sum = units.reduce((a, b) => a + b, 0);
  let given = 0;
  return units.map((u, i) => {
    if (i === units.length - 1) return round3(total - given);
    const q = sum ? round3((total * u) / sum) : 0;
    given += q;
    return q;
  });
}

export function buildClaimLines(input: ClaimLinesInput): { lines: ClaimLine[]; notes: string[] } {
  const notes: string[] = [];
  const { result } = input;
  const singleDose = input.containerType === "single-dose";
  const discarded = singleDose && result.discardedUnits != null && result.discardedUnits > 0 ? result.discardedUnits : 0;
  const ndc = input.ndc11 ?? null;
  const q = ndc ? (input.qualifier ?? null) : null;
  const adminUnits = lineUnits(result.administeredUnits);
  const wasteUnits = discarded ? lineUnits(discarded) : [];
  const split = adminUnits.length > 1 || wasteUnits.length > 1;

  // NDC quantity: milliliters split in proportion to drug administered vs discarded; whole containers for UN.
  let adminQty: number | null = null;
  let wasteQty: number | null = null;
  if (q === "ML" && input.mlPerContainer && input.containerAmount) {
    const mlPerMeasure = input.mlPerContainer / input.containerAmount;
    adminQty = round3(input.dose * mlPerMeasure);
    wasteQty = result.discardedAmount != null ? round3(result.discardedAmount * mlPerMeasure) : null;
  } else if (q === "UN" && result.containersOpened != null) {
    if (split) notes.push("With UN, enter the container count your payer requires on each line; CodeRx does not divide whole containers across split lines.");
    else {
      adminQty = result.containersOpened;
      if (discarded) notes.push("With UN, the whole containers opened are shown on the administered line. Payers differ on whether and how to split the unit count onto the JW line — enter the quantity your payer requires.");
    }
  } else if (q) {
    notes.push(`Enter the NDC quantity in ${q} for each line; CodeRx cannot derive it from the published package data.`);
  }

  // Single-dose with nothing discarded: JZ on every line (FAQ 18). With a discarded amount: full
  // 9,999-unit lines carry JZ and the last administered line has no modifier, which the JW line
  // must be paired with (FAQ 16).
  const adminModifier = (i: number): ClaimLine["modifier"] => {
    if (!singleDose || result.discardedUnits == null) return null;
    if (result.discardedUnits === 0) return "JZ";
    return i < adminUnits.length - 1 ? "JZ" : null;
  };
  const adminQtys = splitQuantity(adminQty, adminUnits);
  const wasteQtys = splitQuantity(q === "ML" ? wasteQty : null, wasteUnits);
  const lines: ClaimLine[] = [
    ...adminUnits.map((units, i) => ({ role: "administered" as const, hcpcsCode: input.hcpcsCode, modifier: adminModifier(i), units, ndc11: ndc, qualifier: q, ndcQuantity: adminQtys[i] })),
    ...wasteUnits.map((units, i) => ({ role: "discarded" as const, hcpcsCode: input.hcpcsCode, modifier: "JW" as const, units, ndc11: ndc, qualifier: q, ndcQuantity: wasteQtys[i] })),
  ];

  if (adminUnits.length > 1) notes.push("A claim line holds at most 9,999 billing units, so the administered amount is split as described in CMS JW/JZ FAQs 16 and 18. Ask your MAC about any other multi-line requirements.");
  if (wasteUnits.length > 1) notes.push("The discarded amount is over 9,999 units and is split into JW lines; the CMS FAQs do not show this case, so confirm the format with your MAC.");
  if (input.containerType === "multi-dose") notes.push("JW and JZ apply to drugs from single-dose containers; neither is shown for a multi-dose container.");
  else if (input.containerType === "unknown") notes.push("Choose the container type to see the JW/JZ lines: they apply to single-dose containers only.");
  else if (result.discardedUnits == null) notes.push("Add the container amount to work out the discarded units (JW) or confirm none (JZ).");
  if (!ndc) notes.push("Choose an NDC to add the NDC segment. Medicare Part B does not require it on every claim; many Medicaid and commercial payers do.");
  return { lines, notes };
}

/** "N4" + 11-digit NDC (no hyphens) + unit qualifier + quantity, as on paper claims (spacing varies by payer). */
export function ndcSegment(ndc11: string, qualifier: NdcQualifier | null, quantity: number | null): string {
  const digits = ndc11.replace(/\D/g, "");
  const qty = quantity == null ? "" : String(round3(quantity));
  return `N4${digits}${qualifier ?? ""}${qty}`;
}

export function claimLineText(line: ClaimLine): string {
  const code = `${line.hcpcsCode}${line.modifier ? `-${line.modifier}` : ""}`.padEnd(9);
  const units = `${line.units} unit${line.units === 1 ? "" : "s"}`.padEnd(10);
  const ndc = line.ndc11 ? ndcSegment(line.ndc11, line.qualifier, line.ndcQuantity) : "(no NDC)";
  return `${code} ${units} ${ndc}   ${line.role === "administered" ? "administered" : "discarded (JW)"}`;
}
