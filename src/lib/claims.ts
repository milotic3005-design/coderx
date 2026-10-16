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

export function buildClaimLines(input: ClaimLinesInput): { lines: ClaimLine[]; notes: string[] } {
  const notes: string[] = [];
  const { result } = input;
  const singleDose = input.containerType === "single-dose";
  const discarded = singleDose && result.discardedUnits != null && result.discardedUnits > 0 ? result.discardedUnits : 0;
  const ndc = input.ndc11 ?? null;
  const q = ndc ? (input.qualifier ?? null) : null;

  // NDC quantity: milliliters split in proportion to drug administered vs discarded; whole containers for UN.
  let adminQty: number | null = null;
  let wasteQty: number | null = null;
  if (q === "ML" && input.mlPerContainer && input.containerAmount) {
    const mlPerMeasure = input.mlPerContainer / input.containerAmount;
    adminQty = round3(input.dose * mlPerMeasure);
    wasteQty = result.discardedAmount != null ? round3(result.discardedAmount * mlPerMeasure) : null;
  } else if (q === "UN" && result.containersOpened != null) {
    adminQty = result.containersOpened;
    if (discarded) notes.push("With UN, the whole containers opened are shown on the administered line. Payers differ on whether and how to split the unit count onto the JW line — enter the quantity your payer requires.");
  } else if (q) {
    notes.push(`Enter the NDC quantity in ${q} for each line; CodeRx cannot derive it from the published package data.`);
  }

  const lines: ClaimLine[] = [
    {
      role: "administered",
      hcpcsCode: input.hcpcsCode,
      modifier: singleDose && result.discardedUnits === 0 ? "JZ" : null,
      units: result.administeredUnits,
      ndc11: ndc,
      qualifier: q,
      ndcQuantity: adminQty,
    },
  ];
  if (discarded) {
    lines.push({ role: "discarded", hcpcsCode: input.hcpcsCode, modifier: "JW", units: discarded, ndc11: ndc, qualifier: q, ndcQuantity: q === "ML" ? wasteQty : null });
  }

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
