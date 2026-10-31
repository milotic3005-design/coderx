import type { ParsedDosage } from "@/lib/billing";
import type { HcpcsDetail } from "@/lib/data/queries";
import { formatDate, formatMoney } from "@/lib/format";
import { LINE_AMOUNT_MULTIPLE, lineAmountsByPlanType, PLAN_ORDER, PLAN_TYPE_LABELS, pooledByPlanType, summarizeRates, type PlanType } from "@/lib/hospital-rates";
import { NoData, TableScroll, td, th } from "./layout-bits";

type Rates = HcpcsDetail["hospitalRates"];

const usd = (n: number | null) => (n == null ? "—" : formatMoney(n, 2));


export function HospitalRatesTable({ code, rates, billingUnit, unitText, paymentLimit, detail = true }: { code: string; rates: Rates; billingUnit: ParsedDosage | null; unitText: string | null; paymentLimit: number | null; detail?: boolean }) {
  if (!rates.hospitals.length) return <NoData>No hospital price transparency files are imported yet.</NoData>;
  const summaries = summarizeRates(rates.rows, billingUnit, paymentLimit);
  const pooled = pooledByPlanType(summaries, paymentLimit);
  const lines = lineAmountsByPlanType(summaries);
  if (!summaries.length) return <NoData>None of the imported MultiCare files list an outpatient facility rate for {code}.</NoData>;
  const name = (key: string) => rates.hospitals.find((h) => h.key === key)?.name ?? key;
  const perUnitLabel = unitText ? `per ${unitText}` : "per billing unit";
  return (
    <div className="space-y-4">
      {pooled.length ? (
        <TableScroll label={`MultiCare negotiated rates for ${code} by plan type`}>
          <table className="w-full min-w-[34rem] border-collapse">
            <caption className="sr-only">
              MultiCare outpatient negotiated rates for {code} {perUnitLabel}, all hospitals, by plan type
            </caption>
            <thead>
              <tr>
                {["Plan type", "Contracts", `Min / median / max ${perUnitLabel}`, "Median vs CMS limit"].map((h) => (
                  <th key={h} scope="col" className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pooled.map((p) => (
                <tr key={p.planType}>
                  <th scope="row" className={`${td} text-left font-semibold text-ink`}>
                    {PLAN_TYPE_LABELS[p.planType]}
                  </th>
                  <td className={`${td} code-chip`}>{p.contracts}</td>
                  <td className={`${td} code-chip whitespace-nowrap`}>
                    {usd(p.min)} / <span className="font-semibold text-ink">{usd(p.median)}</span> / {usd(p.max)}
                  </td>
                  <td className={`${td} code-chip`}>{p.medianPct != null ? `${p.medianPct}% (${p.minPct}–${p.maxPct}%)` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      ) : (
        <NoData>The MultiCare files price {code} for outpatients only as case rates, percentages, or algorithms, or in a measure that does not convert to the CMS billing unit.</NoData>
      )}
      {lines.length ? (
        <ul className="space-y-1 text-sm text-ink-muted">
          {lines.map((l) => (
            <li key={l.planType}>
              <span className="font-semibold text-ink">{PLAN_TYPE_LABELS[l.planType]}:</span> {l.contracts} contract amount{l.contracts === 1 ? "" : "s"} over {LINE_AMOUNT_MULTIPLE}× the CMS limit per unit ({usd(l.min)}–{usd(l.max)}, median {usd(l.median)}) — too large for a per-unit rate; likely a payment per claim line, not shown above.
            </li>
          ))}
        </ul>
      ) : null}
      {detail ? (
        <TableScroll label={`MultiCare negotiated rates for ${code} by hospital`}>
          <table className="w-full min-w-[46rem] border-collapse">
            <caption className="sr-only">
              Outpatient negotiated rates for {code} {perUnitLabel} by MultiCare hospital and plan type
            </caption>
            <thead>
              <tr>
                {["Hospital", "Plan type", "Contracts", "Min", "Median", "Max", "Median vs CMS limit", "Other contracts", "Gross charge"].map((h) => (
                  <th key={h} scope="col" className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summaries
                .sort((a, b) => name(a.hospitalKey).localeCompare(name(b.hospitalKey)) || PLAN_ORDER.indexOf(a.planType as PlanType) - PLAN_ORDER.indexOf(b.planType as PlanType))
                .map((s) => (
                  <tr key={`${s.hospitalKey}-${s.planType}`}>
                    <th scope="row" className={`${td} text-left font-semibold text-ink`}>
                      {name(s.hospitalKey)}
                    </th>
                    <td className={td}>{PLAN_TYPE_LABELS[s.planType as PlanType] ?? s.planType}</td>
                    <td className={`${td} code-chip`}>{s.perUnit.length}</td>
                    <td className={`${td} code-chip`}>{usd(s.min)}</td>
                    <td className={`${td} code-chip font-semibold`}>{usd(s.median)}</td>
                    <td className={`${td} code-chip`}>{usd(s.max)}</td>
                    <td className={`${td} code-chip`}>{s.medianPctOfLimit != null ? `${s.medianPctOfLimit}%` : "—"}</td>
                    <td className={`${td} code-chip`}>{s.otherContracts + s.lineAmounts.length}</td>
                    <td className={`${td} code-chip whitespace-nowrap`}>{s.grossPerUnit ? `${usd(s.grossPerUnit.min)}–${usd(s.grossPerUnit.max)}` : "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </TableScroll>
      ) : null}
      <p className="text-xs text-ink-muted">
        From each hospital&apos;s federally required price transparency file ({rates.hospitals.map((h) => `${h.name}: ${formatDate(h.lastUpdatedOn)}`).join("; ")}). Outpatient facility rates priced by fee schedule or percent of billed charges, converted to the CMS billing unit when the file&apos;s drug measure allows it. Payer and plan names are not
        shown; plan type is derived from the plan name in each file. &ldquo;Other contracts&rdquo; are case rates, percent- or algorithm-only terms, measures that do not convert, and amounts over {LINE_AMOUNT_MULTIPLE}× the CMS limit per unit.
      </p>
    </div>
  );
}
