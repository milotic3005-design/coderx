"use client";

import { FileText } from "lucide-react";
import { useId } from "react";
import type { CalculatorResult, ContainerType } from "@/lib/billing";
import { buildClaimLines, claimLineText, NDC_QUALIFIERS, ndcSegment, type NdcQualifier } from "@/lib/claims";
import { formatPeriod } from "@/lib/format";
import { MDRP_UNIT_TYPES, qualifierForUnitType } from "@/lib/medicaid";
import { CopyButton } from "../client-bits";
import { TableScroll, td, th } from "../layout-bits";
import type { CalculatorPackage } from "../billing-calculator";

export function suggestedQualifier(pkg: CalculatorPackage | null): NdcQualifier | "" {
  if (!pkg) return "";
  // The CMS Medicaid unit type is authoritative for the NDC; fall back to the FDA package text.
  const medicaid = qualifierForUnitType(pkg.medicaidUnitType);
  if (medicaid) return medicaid;
  if (pkg.isPowder) return "UN";
  if (pkg.mlPerItem) return "ML";
  return "";
}

export function ClaimLines({
  code,
  result,
  dose,
  containerType,
  pkg,
  containerAmount,
  qualifier,
  onQualifier,
}: {
  code: string;
  result: CalculatorResult;
  dose: number;
  containerType: ContainerType;
  pkg: CalculatorPackage | null;
  containerAmount: number | null;
  qualifier: NdcQualifier | "";
  onQualifier: (q: NdcQualifier | "") => void;
}) {
  const id = useId();
  const { lines, notes } = buildClaimLines({
    hcpcsCode: code,
    result,
    dose,
    containerType,
    ndc11: pkg?.ndc11 ?? null,
    qualifier: qualifier || null,
    containerAmount,
    mlPerContainer: pkg?.mlPerItem ?? null,
  });
  const text = lines.map(claimLineText).join("\n");
  const suggested = suggestedQualifier(pkg);

  return (
    <div className="rounded-xl border hairline bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-ink-faint uppercase">
            <FileText aria-hidden="true" className="h-4 w-4" /> Claim lines
          </p>
          <p className="mt-1 text-sm text-ink-muted">HCPCS units, discarded-drug modifier, and the NDC segment for this administration.</p>
        </div>
        <CopyButton text={text} label="Copy lines" />
      </div>

      {pkg ? (
        <div className="mt-4 grid gap-1.5 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-3">
          <label htmlFor={`${id}-q`} className="text-sm font-semibold text-ink">
            NDC unit qualifier
          </label>
          <select
            id={`${id}-q`}
            value={qualifier}
            onChange={(e) => onQualifier(e.target.value as NdcQualifier | "")}
            aria-describedby={`${id}-q-hint`}
            className="min-h-11 rounded-lg border border-rule-strong bg-surface-raised px-3 text-sm text-ink"
          >
            <option value="">Choose…</option>
            {NDC_QUALIFIERS.map((q) => (
              <option key={q.key} value={q.key}>
                {q.label}
              </option>
            ))}
          </select>
          <p id={`${id}-q-hint`} className="text-xs text-ink-muted sm:col-span-2">
            {qualifier ? NDC_QUALIFIERS.find((q) => q.key === qualifier)?.hint : "Payers specify the qualifier."}
            {pkg.medicaidUnitType && qualifierForUnitType(pkg.medicaidUnitType)
              ? ` The CMS Medicaid Drug Rebate Program lists this NDC's unit type as ${pkg.medicaidUnitType} (${MDRP_UNIT_TYPES[pkg.medicaidUnitType] ?? pkg.medicaidUnitType}${pkg.medicaidPeriod ? `, ${formatPeriod(pkg.medicaidPeriod)}` : ""}); state Medicaid programs expect the matching qualifier, ${qualifierForUnitType(pkg.medicaidUnitType)}.`
              : suggested
                ? ` The FDA package text describes ${pkg.isPowder ? "a powder" : `${pkg.mlPerItem} mL per container`}, so ${suggested} is a common choice — confirm with the payer.`
                : ""}
          </p>
        </div>
      ) : null}

      <div className="mt-4">
        <TableScroll label="Claim lines">
          <table className="w-full border-collapse [&_td]:px-2.5 [&_th]:px-2.5">
            <caption className="sr-only">Claim lines for {code}</caption>
            <thead>
              <tr>
                  <th scope="col" className={th}>
                  HCPCS · modifier
                </th>
                <th scope="col" className={th}>
                  Units
                </th>
                <th scope="col" className={th}>
                  NDC segment
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.role}>
                  <td className={td}>
                    <span className="code-chip font-semibold whitespace-nowrap text-ink">
                      {l.hcpcsCode}
                      {l.modifier ? `-${l.modifier}` : ""}
                    </span>
                    <span className="block text-xs text-ink-muted">{l.role === "administered" ? "administered" : "discarded"}</span>
                  </td>
                  <td className={`${td} code-chip text-ink`}>{l.units}</td>
                  <td className={`${td} code-chip whitespace-nowrap text-ink`}>
                    {l.ndc11 ? ndcSegment(l.ndc11, l.qualifier, l.ndcQuantity) : "—"}
                    {l.ndc11 && l.qualifier && l.ndcQuantity == null ? <span className="block font-sans text-xs text-ink-muted">quantity: enter per payer</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </div>

      {notes.length ? (
        <ul className="mt-3 space-y-1 text-xs text-ink-muted">
          {notes.map((n) => (
            <li key={n}>• {n}</li>
          ))}
        </ul>
      ) : null}

      <details className="mt-3 text-xs text-ink-muted">
        <summary className="inline-flex min-h-9 cursor-pointer items-center font-semibold text-brand">Where these go on a claim</summary>
        <ul className="mt-1 space-y-1">
          <li>
            <span className="font-semibold text-ink">Paper CMS-1500:</span> HCPCS, modifier, and units in item 24D/24G; the NDC segment in the shaded area of 24A (spacing between parts varies by payer).
          </li>
          <li>
            <span className="font-semibold text-ink">Electronic 837P:</span> SV101-2 code, SV101-3 modifier, SV104 units; LIN03 NDC, CTP04 NDC quantity, CTP05-1 unit qualifier.
          </li>
          <li>
            <span className="font-semibold text-ink">Institutional (UB-04 / 837I):</span> HCPCS and units by revenue line (FL 44/46); NDC segment in FL 43 or LIN/CTP.
          </li>
        </ul>
      </details>
    </div>
  );
}
