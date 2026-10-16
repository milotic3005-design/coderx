import type { CalculatorResult, ContainerType } from "@/lib/billing";
import type { Provenance } from "@/lib/data/provenance";
import { formatPeriod } from "@/lib/format";
import { MUE_SERVICE_LABELS, mueStatus, type MueEntry } from "@/lib/mue";
import { SITE } from "@/lib/site";

const CONTAINER: Record<ContainerType, string> = { "single-dose": "Single-dose", "multi-dose": "Multi-dose", unknown: "Not specified" };

/**
 * A one-page summary of the calculation, rendered only when printing. It contains no
 * patient fields — CodeRx never collects patient information.
 */
export function PrintWorksheet(props: {
  code: string | null;
  descriptor: string | null;
  billingUnit: string;
  billingUnitSource: string | null;
  dose: string;
  ndc: { formatted: string; description: string | null } | null;
  containerAmount: string | null;
  containerType: ContainerType;
  result: CalculatorResult;
  mue: MueEntry[] | null;
  claimText: string | null;
  paymentLimit: number | null;
  paymentSource: string | null;
  sources: (Provenance | null | undefined)[];
}) {
  const r = props.result;
  const generated = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const rows: [string, string][] = [
    ["HCPCS code", props.code ? `${props.code} — ${props.descriptor ?? ""}` : "Not loaded (manual entry)"],
    ["Billing unit", `${props.billingUnit}${props.billingUnitSource ? ` (${props.billingUnitSource})` : ""}`],
    ["Dose", props.dose],
    ["NDC", props.ndc ? `${props.ndc.formatted}${props.ndc.description ? ` — ${props.ndc.description}` : ""}` : "—"],
    ["Amount per container", props.containerAmount ?? "—"],
    ["Container type", CONTAINER[props.containerType]],
    ["Administered HCPCS units", `${r.administeredUnits} (${r.rawUnits} before rounding up)`],
    ["Units attributable to discarded drug", r.discardedUnits == null ? "Not calculated" : `${r.discardedUnits}${r.discardedAmount != null ? ` (${r.discardedAmount} ${r.unitLabel} unused)` : ""}`],
  ];
  if (r.utilizationPct != null) rows.push(["Utilization", `${r.utilizationPct}% of ${r.totalOpened} ${r.unitLabel} opened`]);
  if (r.estimatedAllowedAdministered != null)
    rows.push([
      "Derived Medicare amount (not a payment determination)",
      `$${r.estimatedAllowedAdministered.toFixed(2)} administered${r.estimatedAllowedDiscarded != null ? ` · $${r.estimatedAllowedDiscarded.toFixed(2)} discarded units` : ""} at $${props.paymentLimit?.toFixed(3)} per unit${props.paymentSource ? ` (${props.paymentSource})` : ""}`,
    ]);

  return (
    <div className="hidden text-[11pt] leading-snug text-black print:block" aria-hidden="true">
      <div className="flex items-baseline justify-between border-b border-black pb-2">
        <p className="text-lg font-semibold">{SITE.name} billing worksheet</p>
        <p className="text-sm">Generated {generated}</p>
      </div>
      <table className="mt-3 w-full border-collapse text-sm">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-gray-300">
              <th scope="row" className="w-56 py-1.5 pr-3 text-left align-top font-semibold">
                {k}
              </th>
              <td className="py-1.5 align-top">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {props.mue ? (
        <>
          <p className="mt-4 font-semibold">CMS MUE (max units per day)</p>
          {props.mue.length ? (
            <ul className="mt-1 text-sm">
              {props.mue.map((m) => (
                <li key={m.serviceType}>
                  {MUE_SERVICE_LABELS[m.serviceType].long}: {m.value} — {m.adjudicationText ?? ""} — administered units {mueStatus(r.administeredUnits, m.value).replace("-", " ")}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">No published MUE for this code.</p>
          )}
        </>
      ) : null}
      {props.claimText ? (
        <>
          <p className="mt-4 font-semibold">Claim lines</p>
          <pre className="mt-1 font-mono text-xs whitespace-pre-wrap">{props.claimText}</pre>
        </>
      ) : null}
      <p className="mt-4 font-semibold">Formula</p>
      <ol className="mt-1 list-decimal pl-5 text-xs">
        {r.steps.map((s, i) => (
          <li key={`${s.label}-${i}`}>
            {s.label}: {s.expression} = {s.value}
          </li>
        ))}
      </ol>
      {r.warnings.length ? (
        <ul className="mt-2 text-xs">
          {r.warnings.map((w) => (
            <li key={w}>Note: {w}</li>
          ))}
        </ul>
      ) : null}
      <p className="mt-4 font-semibold">Sources</p>
      <ul className="mt-1 text-xs">
        {props.sources
          .filter((s): s is Provenance => !!s)
          .map((s) => (
            <li key={s.releaseId}>
              {s.organization} — {s.dataset}
              {s.period ? ` (${formatPeriod(s.period)})` : ""} — {s.url}
            </li>
          ))}
      </ul>
      <p className="mt-4 border-t border-black pt-2 text-xs">
        {SITE.disclaimer} No patient information is entered into or stored by {SITE.name}. Verify payer requirements before submitting a claim.
      </p>
    </div>
  );
}
