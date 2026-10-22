import { Calculator, CircleAlert, ExternalLink } from "lucide-react";
import Link from "next/link";
import type { BillingUnitInfo, CrosswalkEntry, DrugDetail, PaymentPeriod } from "@/lib/data/queries";
import { formatDate, formatMoney, formatNumber, formatPeriod } from "@/lib/format";
import { ACTION_CODES, COVERAGE_CODES, PRICING_INDICATORS } from "@/lib/hcpcs";
import { CMS_HIT_RATES_URL, MEDICARE_HIT_CATEGORIES } from "@/lib/per-diem";
import { DataStatusBadge } from "./badges";
import { Callout, KeyValueGrid, NoData, TableScroll, td, th } from "./layout-bits";

/** Decorative trend line; the table next to it carries the same values for assistive tech. */
export function Sparkline({ values, label }: { values: { period: string; value: number }[]; label: string }) {
  const pts = values.filter((v) => Number.isFinite(v.value));
  if (pts.length < 2) return null;
  const w = 220;
  const h = 56;
  const min = Math.min(...pts.map((p) => p.value));
  const max = Math.max(...pts.map((p) => p.value));
  const span = max - min || 1;
  const coords = pts.map((p, i) => [4 + (i * (w - 8)) / (pts.length - 1), h - 6 - ((p.value - min) / span) * (h - 14)] as const);
  const d = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${d} L${coords.at(-1)![0].toFixed(1)} ${h} L${coords[0][0].toFixed(1)} ${h} Z`;
  return (
    <figure className="flex items-center gap-3">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-[220px]" aria-hidden="true" focusable="false">
        <path d={area} fill="var(--brand-glow)" />
        <path d={d} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {coords.map(([x, y], i) => (
          <circle key={pts[i].period} cx={x} cy={y} r={i === coords.length - 1 ? 3.5 : 2} fill={i === coords.length - 1 ? "var(--brand)" : "var(--surface)"} stroke="var(--brand)" strokeWidth="1.5" />
        ))}
      </svg>
      <figcaption className="text-xs text-ink-muted">
        {label}
        <br />
        <span className="code-chip text-ink">
          {formatPeriod(pts[0].period)} → {formatPeriod(pts.at(-1)!.period)}
        </span>
      </figcaption>
    </figure>
  );
}

export function PaymentHistoryTable({ payments, caption }: { payments: PaymentPeriod[]; caption: string }) {
  if (!payments.length) return <NoData />;
  const ordered = [...payments].sort((a, b) => b.period.localeCompare(a.period));
  return (
    <TableScroll label={caption}>
      <table className="w-full min-w-[46rem] border-collapse">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={th}>Quarter</th>
            <th scope="col" className={th}>Effective</th>
            <th scope="col" className={`${th} text-right`}>Payment limit</th>
            <th scope="col" className={th}>Per (billing unit)</th>
            <th scope="col" className={`${th} text-right`}>Coinsurance</th>
            <th scope="col" className={th}>Change</th>
            <th scope="col" className={th}>CMS notes</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((p, i) => {
            const prev = ordered[i + 1];
            const change =
              prev && p.paymentLimit !== null && prev.paymentLimit !== null && Number(prev.paymentLimit) !== 0
                ? ((Number(p.paymentLimit) - Number(prev.paymentLimit)) / Number(prev.paymentLimit)) * 100
                : null;
            return (
              <tr key={p.period}>
                <th scope="row" className={`${td} code-chip text-left font-semibold whitespace-nowrap text-ink`}>
                  {formatPeriod(p.period)}
                </th>
                <td className={`${td} whitespace-nowrap text-ink-muted`}>
                  {formatDate(p.effectiveStart)} – {formatDate(p.effectiveEnd)}
                </td>
                <td className={`${td} code-chip text-right font-semibold whitespace-nowrap text-ink`}>
                  {p.paymentLimit !== null ? formatMoney(p.paymentLimit) : p.paymentLimitText ? <span title="As published by CMS">{p.paymentLimitText}</span> : "—"}
                  {p.revisions.length ? (
                    <span className="mt-1 block text-[0.7rem] font-normal text-accent">
                      Revised · earlier posting {p.revisions.map((r) => formatMoney(r.paymentLimit)).join(", ")}
                    </span>
                  ) : null}
                </td>
                <td className={`${td} code-chip whitespace-nowrap`}>{p.dosageDescriptor ?? "—"}</td>
                <td className={`${td} code-chip text-right whitespace-nowrap`}>{p.coinsurancePct ? `${formatNumber(p.coinsurancePct, 3)}%` : "—"}</td>
                <td className={`${td} code-chip whitespace-nowrap ${change === null ? "text-ink-faint" : change >= 0 ? "text-ink" : "text-ink"}`}>
                  {change === null ? "—" : `${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(1)}%`}
                </td>
                <td className={`${td} min-w-[14rem] text-ink-muted`}>
                  {[p.notes, p.vaccineAwpPct ? `Vaccine AWP ${p.vaccineAwpPct}%` : null, p.bloodAwpPct ? `Blood AWP ${p.bloodAwpPct}%` : null, p.clottingFactor ? `Clotting factor: ${p.clottingFactor}` : null]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroll>
  );
}

const TYPE_LABEL: Record<string, string> = { ASP: "ASP", OPPS: "OPPS", AWP: "AWP", PREP: "PrEP", NOC: "NOC" };

export function CrosswalkTable({
  entries,
  caption,
  paymentLimit,
  showCode = false,
  latestPeriod,
}: {
  entries: CrosswalkEntry[];
  caption: string;
  paymentLimit?: string | null;
  showCode?: boolean;
  latestPeriod: string | null;
}) {
  if (!entries.length) return <NoData>No CMS NDC–HCPCS crosswalk rows were located. CMS notes its crosswalks are not a comprehensive list of all NDCs.</NoData>;
  const limit = paymentLimit !== null && paymentLimit !== undefined ? Number(paymentLimit) : null;
  return (
    <TableScroll label={caption}>
      <table className="w-full min-w-[60rem] border-collapse">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={th}>NDC (11-digit)</th>
            {showCode ? <th scope="col" className={th}>HCPCS</th> : null}
            <th scope="col" className={th}>CMS drug name · labeler</th>
            <th scope="col" className={`${th} text-right`}>Pkg size × qty</th>
            <th scope="col" className={`${th} text-right`}>Units / item</th>
            <th scope="col" className={`${th} text-right`}>Units / NDC</th>
            {limit !== null ? <th scope="col" className={`${th} text-right`}>Derived $ / NDC</th> : null}
            <th scope="col" className={th}>Crosswalk</th>
            <th scope="col" className={th}>Quarters</th>
            <th scope="col" className={th}>FDA listing</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={`${e.hcpcsCode}-${e.ndcRaw}`} className={e.isCurrent ? "" : "text-ink-muted"}>
              <th scope="row" className={`${td} text-left font-semibold whitespace-nowrap`}>
                {e.ndc11 ? (
                  <Link href={`/ndc/${e.ndcFormatted}`} className="code-chip text-brand hover:underline">
                    {e.ndcFormatted}
                  </Link>
                ) : (
                  <span className="code-chip" title="CMS alternate identifier (not an NDC)">
                    {e.ndcRaw} <span className="text-[0.7rem] font-normal text-ink-faint">alt ID</span>
                  </span>
                )}
              </th>
              {showCode ? (
                <td className={`${td} code-chip`}>
                  {e.hcpcsCode ? (
                    <Link href={`/hcpcs/${e.hcpcsCode}`} className="font-semibold text-brand hover:underline">
                      {e.hcpcsCode}
                    </Link>
                  ) : (
                    <span title={e.nocGenericName ?? undefined}>NOC</span>
                  )}
                </td>
              ) : null}
              <td className={`${td} min-w-[14rem]`}>
                <span className="font-semibold text-ink">{e.drugName ?? "—"}</span>
                <span className="block text-xs text-ink-muted">{e.labelerName ?? "—"}</span>
              </td>
              <td className={`${td} code-chip text-right whitespace-nowrap`}>
                {formatNumber(e.packageSize)} × {formatNumber(e.packageQuantity)}
              </td>
              <td className={`${td} code-chip text-right`}>{formatNumber(e.billUnitsPerItem)}</td>
              <td className={`${td} code-chip text-right font-semibold text-ink`}>{formatNumber(e.billUnitsPerPackage)}</td>
              {limit !== null ? (
                <td className={`${td} code-chip text-right whitespace-nowrap`}>
                  {e.isCurrent && e.billUnitsPerPackage ? formatMoney(Number(e.billUnitsPerPackage) * limit, 2) : "—"}
                </td>
              ) : null}
              <td className={`${td} whitespace-nowrap`}>{e.types.map((x) => TYPE_LABEL[x] ?? x).join(", ")}</td>
              <td className={`${td} code-chip text-xs whitespace-nowrap`}>
                {e.periods.length > 1 ? `${formatPeriod(e.periods[0])} – ${formatPeriod(e.periods.at(-1)!)}` : formatPeriod(e.periods[0])}
                {!e.isCurrent ? <span className="block text-[0.7rem] font-semibold text-accent">Not in {latestPeriod ? formatPeriod(latestPeriod) : "latest"} file</span> : null}
              </td>
              <td className={`${td} text-xs whitespace-nowrap`}>
                {e.fda ? (
                  e.fda.listingStatus === "listed" ? (
                    <span className="text-ok">Listed</span>
                  ) : (
                    <span className="text-accent">Excluded listing</span>
                  )
                ) : (
                  <span className="text-ink-faint">Not found</span>
                )}
                {e.fda?.drugSlug ? (
                  <Link href={`/drugs/${e.fda.drugSlug}`} className="block text-brand hover:underline">
                    {e.fda.drugName}
                  </Link>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

export function BillingUnitCard({ code, unit, paymentLimit, period }: { code: string; unit: BillingUnitInfo; paymentLimit?: string | null; period?: string | null }) {
  return (
    <div className="grid gap-4 rounded-xl border hairline bg-surface p-5 sm:grid-cols-[1fr_auto] sm:items-center">
      <div>
        <p className="text-xs font-semibold tracking-wide text-ink-faint uppercase">One HCPCS billing unit of {code}</p>
        {unit.text ? (
          <p className="mt-1 font-display text-3xl font-semibold text-ink">
            <span className="code-chip">{unit.text}</span>
          </p>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">The descriptor does not state a numeric dosage per unit.</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          {unit.source === "cms_payment_limits" ? (
            <>
              <DataStatusBadge status="official-cms" /> “HCPCS Code Dosage” column, CMS payment limit file {unit.period ? formatPeriod(unit.period) : ""}
            </>
          ) : unit.source === "hcpcs_descriptor" ? (
            <>
              <DataStatusBadge status="derived" /> Read from the HCPCS long descriptor; CMS did not publish a dosage column for this code.
            </>
          ) : (
            <DataStatusBadge status="verification-needed" />
          )}
        </div>
        {paymentLimit ? (
          <p className="mt-3 text-sm text-ink-muted">
            Medicare payment limit per unit{period ? ` (${formatPeriod(period)})` : ""}: <span className="code-chip font-semibold text-ink">{formatMoney(paymentLimit)}</span>
          </p>
        ) : null}
      </div>
      <Link
        href={`/calculator?code=${code}`}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-paper hover:bg-brand-strong dark:text-paper-sunken"
      >
        <Calculator aria-hidden="true" className="h-4 w-4" /> Calculate units
      </Link>
    </div>
  );
}

const CHANGE_LABEL: Record<string, string> = {
  baseline: "In earliest ingested file",
  added: "Added to HCPCS",
  descriptor_changed: "Descriptor changed",
  terminated: "Termination date set",
  reactivated: "Reactivated",
  dates_changed: "Dates changed",
  removed_from_file: "No longer in CMS file",
};

export function CodeHistoryTable({
  history,
  caption,
}: {
  history: { period: string; changeType: string; actionCode: string | null; longDescription: string | null; terminationDate: string | null; addedDate: string | null; actionEffectiveDate: string | null; previous: unknown }[];
  caption: string;
}) {
  if (!history.length) return <NoData />;
  return (
    <TableScroll label={caption}>
      <table className="w-full min-w-[40rem] border-collapse">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={th}>Quarterly file</th>
            <th scope="col" className={th}>Change</th>
            <th scope="col" className={th}>CMS action code</th>
            <th scope="col" className={th}>Details</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h) => {
            const prev = (h.previous ?? null) as Record<string, string | null> | null;
            return (
              <tr key={`${h.period}-${h.changeType}`}>
                <th scope="row" className={`${td} code-chip text-left font-semibold whitespace-nowrap`}>
                  {formatPeriod(h.period)}
                </th>
                <td className={`${td} whitespace-nowrap`}>{CHANGE_LABEL[h.changeType] ?? h.changeType}</td>
                <td className={`${td} whitespace-nowrap`}>{h.actionCode ? `${h.actionCode} — ${ACTION_CODES[h.actionCode] ?? "Unknown"}` : "—"}</td>
                <td className={`${td} min-w-[18rem] text-ink-muted`}>
                  {h.changeType === "descriptor_changed" && prev?.longDescription ? (
                    <>
                      <span className="block">
                        <span className="font-semibold text-ink">Now:</span> {h.longDescription}
                      </span>
                      <span className="block">
                        <span className="font-semibold text-ink">Before:</span> {prev.longDescription}
                      </span>
                    </>
                  ) : h.changeType === "terminated" ? (
                    <>Termination date {formatDate(h.terminationDate)}</>
                  ) : h.changeType === "dates_changed" ? (
                    <>
                      Added {formatDate(h.addedDate)} · action effective {formatDate(h.actionEffectiveDate)} · termination {formatDate(h.terminationDate)}
                    </>
                  ) : h.changeType === "added" || h.changeType === "baseline" ? (
                    <>Added date {formatDate(h.addedDate)}</>
                  ) : h.changeType === "removed_from_file" ? (
                    <>Last appeared in the previous quarterly file.</>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroll>
  );
}

export function ExternalSourceLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
      {children} <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
    </a>
  );
}

export function LimitationsList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 text-sm text-ink-muted">
      {items.map((it) => (
        <li key={it} className="flex gap-2">
          <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

/** Home infusion per diem S-codes for a drug, with the official values that selected them. */
export function PerDiemCodes({ perDiem }: { perDiem: DrugDetail["perDiem"] }) {
  if (perDiem.status === "not-applicable") return <NoData>{perDiem.reason}</NoData>;
  return (
    <ul className="space-y-3">
      {perDiem.matches.map((m) => (
        <li key={m.therapy.id} className="rounded-xl border hairline bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-base font-semibold text-ink">{m.therapy.label}</h4>
            <DataStatusBadge status="derived" />
            <DataStatusBadge status="verification-needed" />
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            <span className="font-semibold text-ink">{m.basis === "route-only" ? "No category matched · FDA class: " : "Matched on: "}</span>
            {m.evidence.join("; ")}
          </p>
          <ul className="mt-3">
            {m.codes.map((c) => (
              <li key={c.code} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t hairline py-2">
                <Link href={`/hcpcs/${c.code}`} className="code-chip w-14 font-semibold text-brand hover:underline">
                  {c.code}
                </Link>
                <span className="min-w-0 flex-1 text-sm text-ink">
                  {c.when}
                  {c.suggested ? <span className="ml-2 inline-block rounded-full bg-brand-tint px-2 text-[0.72rem] leading-5 font-semibold whitespace-nowrap text-brand">Fits this drug’s route</span> : null}
                  {c.isActive === false ? <span className="ml-2 text-xs font-semibold text-accent">Terminated</span> : null}
                  <span className="block text-xs text-ink-muted">{c.description ? `CMS: ${c.description}` : "Not in the imported CMS HCPCS file"}</span>
                </span>
              </li>
            ))}
          </ul>
          {m.therapy.note ? <p className="mt-2 text-xs text-ink-muted">{m.therapy.note}</p> : null}
        </li>
      ))}
    </ul>
  );
}

type PerDiemCode = DrugDetail["perDiem"]["matches"][number]["codes"][number];

/** One line per distinct value; "all N codes" when every code shares it. */
function byValue(codes: PerDiemCode[], value: (c: PerDiemCode) => string) {
  const groups = new Map<string, string[]>();
  for (const c of codes) groups.set(value(c), [...(groups.get(value(c)) ?? []), c.code]);
  if (groups.size === 1) return `${[...groups.keys()][0]}${codes.length > 1 ? ` (all ${codes.length} codes)` : ""}`;
  return (
    <span className="flex flex-col">
      {[...groups].map(([text, list]) => (
        <span key={text}>
          <span className="code-chip">{list.join(", ")}</span>: {text}
        </span>
      ))}
    </span>
  );
}

/** Payment terms for a drug's per diem S-codes, from the CMS HCPCS and payment limit files. */
type StateSchedule = DrugDetail["stateFeeSchedules"][number];

/** A published fee with the precision the state used (HCA lists some per-unit fees to four decimals). */
function stateFee(fee: StateSchedule["rows"][number]["fees"][number]) {
  if (fee.amount === null) return fee.text;
  const decimals = (fee.amount.split(".")[1] ?? "").length;
  return formatMoney(fee.amount, Math.min(4, Math.max(2, decimals)));
}

/** Whether a state pays the drug's per diem codes, from its published fee schedule. */
function stateValue(schedule: StateSchedule, perDiemCodes: string[]) {
  const listed = schedule.rows.filter((r) => perDiemCodes.includes(r.hcpcsCode));
  if (!listed.length) {
    return `Not on ${schedule.publisher}’s ${schedule.program} fee schedule (effective ${formatDate(schedule.effectiveDate)}), so these per diems are not separately paid. Home infusion is paid with the supply, pump, and nutrition codes in that schedule instead (below).`;
  }
  return (
    <span className="flex flex-col">
      {listed.map((r) => (
        <span key={`${r.hcpcsCode}-${r.modifier ?? ""}`}>
          <span className="code-chip">{r.hcpcsCode}</span>: {r.fees.filter((f) => f.amount !== null).map((f) => `${stateFee(f)} (${f.area.toLowerCase()})`).join(", ") || r.fees[0]?.text}
        </span>
      ))}
    </span>
  );
}

/** The full state schedule, collapsed: area columns with no published amount at all are left out. */
function StateFeeScheduleTable({ schedule }: { schedule: StateSchedule }) {
  const areas = (schedule.rows[0]?.fees ?? []).map((f) => f.area).filter((area) => schedule.rows.some((r) => r.fees.some((f) => f.area === area && f.amount !== null)));
  const caption = `${schedule.payer}: ${schedule.program} fee schedule, effective ${formatDate(schedule.effectiveDate)}`;
  return (
    <details className="mt-4 rounded-xl border hairline bg-surface">
      <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-semibold text-brand">
        {schedule.payer} home infusion fee schedule — {schedule.rows.length} codes, effective {formatDate(schedule.effectiveDate)}
      </summary>
      <div className="border-t hairline p-4">
        <TableScroll label={caption}>
          <table className="w-full min-w-[44rem] border-collapse">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                <th scope="col" className={th}>Code</th>
                <th scope="col" className={th}>Description (CMS)</th>
                {areas.map((a) => (
                  <th key={a} scope="col" className={`${th} text-right`}>
                    Max fee · {a}
                  </th>
                ))}
                <th scope="col" className={th}>PA / EPA</th>
                <th scope="col" className={th}>{schedule.publisher} comments</th>
              </tr>
            </thead>
            <tbody>
              {schedule.rows.map((r) => (
                <tr key={`${r.hcpcsCode}-${r.modifier ?? ""}`}>
                  <th scope="row" className={`${td} text-left whitespace-nowrap`}>
                    <Link href={`/hcpcs/${r.hcpcsCode}`} className="code-chip font-semibold text-brand hover:underline">
                      {r.hcpcsCode}
                    </Link>
                    {r.modifier ? <span className="code-chip text-ink-muted">-{r.modifier}</span> : null}
                  </th>
                  <td className={`${td} min-w-[10rem] text-ink-muted`}>{r.shortDescription ?? "—"}</td>
                  {areas.map((a) => {
                    const fee = r.fees.find((f) => f.area === a);
                    return (
                      <td key={a} className={`${td} code-chip text-right whitespace-nowrap`}>
                        {fee ? stateFee(fee) : "—"}
                      </td>
                    );
                  })}
                  <td className={`${td} text-xs whitespace-nowrap`}>{r.priorAuth ?? "—"}</td>
                  <td className={`${td} min-w-[14rem] text-xs text-ink-muted`}>{r.comments ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        <p className="mt-2 text-xs text-ink-muted">
          Maximum allowable fees as published by {schedule.publisher}, per billing unit of each code. {schedule.note}
        </p>
      </div>
    </details>
  );
}

export function PerDiemReimbursement({ perDiem, latestPaymentPeriod, stateFeeSchedules = [] }: { perDiem: DrugDetail["perDiem"]; latestPaymentPeriod: string | null; stateFeeSchedules?: StateSchedule[] }) {
  const codes = [...new Map(perDiem.matches.flatMap((m) => m.codes).map((c) => [c.code, c])).values()];
  if (!codes.length) return <NoData>No home infusion per diem applies to this drug (see HCPCS coding above).</NoData>;
  const notInFile = "Not in the imported CMS HCPCS file";
  const priced = codes.filter((c) => c.payment && c.payment.period === latestPaymentPeriod);
  return (
    <>
      <KeyValueGrid
        items={[
          {
            label: "Medicare",
            value: byValue(codes, (c) => (c.description === null ? notInFile : c.coverageCode ? `${COVERAGE_CODES[c.coverageCode] ?? "Unknown"} — CMS coverage code ${c.coverageCode}` : "No coverage code in the CMS file")),
          },
          {
            label: "Part B pricing indicator",
            value: byValue(codes, (c) => (c.description === null ? notInFile : c.pricingIndicators.length ? c.pricingIndicators.map((p) => `${p} — ${PRICING_INDICATORS[p] ?? "Unknown"}`).join("; ") : "None in the CMS file")),
          },
          {
            label: "National payment amount",
            value: priced.length ? (
              <span className="flex flex-col">
                {priced.map((c) => (
                  <span key={c.code}>
                    <span className="code-chip">{c.code}</span>: {c.payment!.paymentLimit !== null ? formatMoney(c.payment!.paymentLimit) : c.payment!.paymentLimitText} per {c.payment!.dosageDescriptor ?? "unit"}
                  </span>
                ))}
              </span>
            ) : (
              `None. No per diem code here is in the CMS Part B payment limit file${latestPaymentPeriod ? ` for ${formatPeriod(latestPaymentPeriod)}` : ""}; CMS sets no national per diem rate.`
            ),
          },
          ...stateFeeSchedules.map((s) => ({ label: s.payer, value: stateValue(s, codes.map((c) => c.code)) })),
          { label: "Billing unit", value: "1 unit = 1 day on service (the CMS descriptor ends “per diem”)" },
          { label: "Who sets the rate", value: "Each commercial plan’s contract or state Medicaid fee schedule. Some payers reduce a second per diem billed for the same day." },
          { label: "Billed separately", value: "The drug, with its own HCPCS code and units, and nursing visits — the CMS descriptor says “drugs and nursing visits coded separately”." },
        ]}
      />
      {stateFeeSchedules.map((s) => (
        <StateFeeScheduleTable key={s.release.releaseId} schedule={s} />
      ))}
      <div className="mt-4">
        <Callout tone="info" title="How Medicare pays for home infusion instead">
          <p>
            Medicare pays no per diem. Under its home infusion therapy services benefit, a qualified home infusion supplier is paid per infusion day, and only for drugs given through a Medicare-covered external infusion pump:
          </p>
          <ul className="mt-2 space-y-1">
            {MEDICARE_HIT_CATEGORIES.map((h) => (
              <li key={h.category}>
                Category {h.category} — {h.label}:{" "}
                <Link href={`/hcpcs/${h.codes[0]}`} className="code-chip">
                  {h.codes[0]}
                </Link>
                , first visit{" "}
                <Link href={`/hcpcs/${h.codes[1]}`} className="code-chip">
                  {h.codes[1]}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2">
            <ExternalSourceLink href={CMS_HIT_RATES_URL}>CMS home infusion therapy billing and rates</ExternalSourceLink>
          </p>
        </Callout>
      </div>
    </>
  );
}
