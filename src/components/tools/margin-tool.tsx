"use client";

import { Download, Lock, Play, Upload } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { MAX_AUDIT_ITEMS, parseAuditText, type AuditInputLine } from "@/lib/audit-input";
import type { Provenance } from "@/lib/data/provenance";
import type { AuditRow } from "@/lib/data/tools";
import { formatPeriod } from "@/lib/format";
import { DEFAULT_MARGIN_OPTIONS, medicareMargin, type MarginResult } from "@/lib/margin";
import { TableScroll, td, th } from "../layout-bits";
import { ProvenanceFooter } from "../provenance";
import { downloadCsv, readTextFile } from "./download";

const EXAMPLE = `HCPCS,NDC,Your cost (illustrative numbers — replace with your own)
J9312,50242-0051-21,812.50
,50242-0053-06,3610.00
Q5115,,34.10
J1745,,`;

const usd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Line {
  input: AuditInputLine;
  basis: "package" | "unit";
  code: string | null;
  units: number | null;
  limit: number | null;
  coinsurancePct: number | null;
  dosage: string | null;
  result: MarginResult | null;
  note: string | null;
}

function evaluate(input: AuditInputLine, row: AuditRow | undefined, options: typeof DEFAULT_MARGIN_OPTIONS): Line {
  const base = { input, basis: input.ndc11 ? ("package" as const) : ("unit" as const), code: input.hcpcs, units: null, limit: null, coinsurancePct: null, dosage: null, result: null };
  if (!row) return { ...base, note: "Not checked." };
  let units: number | null = null;
  let limit: number | null = null;
  let coins: number | null = null;
  let dosage: string | null = null;
  let code = input.hcpcs;
  if (input.ndc11) {
    const xw = row.ndc?.crosswalk ?? [];
    const entry = (input.hcpcs ? xw.find((x) => x.hcpcsCode === input.hcpcs) : null) ?? (xw.length === 1 ? xw[0] : null);
    if (!entry) return { ...base, note: xw.length ? `CMS crosswalks this NDC to ${xw.map((x) => x.hcpcsCode ?? "NOC").join(", ")}; add the HCPCS code to choose one.` : "Not on the current CMS NDC–HCPCS crosswalk, so billable units per package are unknown." };
    code = entry.hcpcsCode;
    units = entry.billUnitsPerPackage != null ? Number(entry.billUnitsPerPackage) : null;
    limit = entry.payment?.limit != null ? Number(entry.payment.limit) : null;
    coins = entry.payment?.coinsurancePct != null ? Number(entry.payment.coinsurancePct) : null;
    dosage = entry.payment?.dosage ?? entry.hcpcsDosage;
  } else if (row.code?.payment) {
    units = 1;
    limit = row.code.payment.limit != null ? Number(row.code.payment.limit) : null;
    coins = row.code.payment.coinsurancePct != null ? Number(row.code.payment.coinsurancePct) : null;
    dosage = row.code.payment.dosage;
  }
  const line = { ...base, code, units, limit, coinsurancePct: coins, dosage };
  if (limit == null || units == null) return { ...line, note: "No current Part B payment limit published by CMS." };
  if (input.amount == null) return { ...line, note: "Enter your cost to compare." };
  return { ...line, result: medicareMargin({ paymentLimit: limit, units, coinsurancePct: coins, cost: input.amount }, options), note: null };
}

export function MarginTool() {
  const id = useId();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [sent, setSent] = useState<AuditInputLine[]>([]);
  const [meta, setMeta] = useState<{ provenance?: Provenance[]; paymentPeriod?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seq, setSeq] = useState("2");
  const [coins, setCoins] = useState(true);
  const parsed = useMemo(() => parseAuditText(text).filter((p) => p.hcpcs || p.ndc11), [text]);
  const options = { sequestrationPct: Number(seq) >= 0 && Number(seq) <= 10 ? Number(seq) : 2, includeCoinsurance: coins };
  const lines = rows ? sent.map((input, i) => evaluate(input, rows[i], options)) : [];
  const underwater = lines.filter((l) => l.result?.status === "underwater").length;
  const thin = lines.filter((l) => l.result?.status === "thin").length;

  async function run() {
    const items = parsed.slice(0, MAX_AUDIT_ITEMS);
    setBusy(true);
    setError(null);
    try {
      // Only codes and NDCs are sent; costs stay in this browser.
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: items.map((p) => ({ hcpcs: p.hcpcs, ndc: p.ndc11 ? p.ndcRaw : null })) }),
      });
      const body = (await res.json()) as { data: AuditRow[] | null; meta: { provenance?: Provenance[]; paymentPeriod?: string | null }; error: { message: string } | null };
      if (!res.ok || !body.data) throw new Error(body.error?.message ?? `Request failed (${res.status}).`);
      setSent(items);
      setRows(body.data);
      setMeta(body.meta);
    } catch (e) {
      setRows(null);
      setError(e instanceof Error ? e.message : "The lookup failed.");
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    downloadCsv(`coderx-margin-${new Date().toLocaleDateString("en-CA")}.csv`, [
      ["line", "hcpcs", "ndc", "cost_basis", "billable_units", "payment_limit_per_unit", "coinsurance_pct", "medicare_allowed", "expected_revenue", "your_cost", "margin", "margin_pct", "status", "note"],
      ...lines.map((l) => [
        l.input.line,
        l.code,
        l.input.ndcRaw,
        l.basis === "package" ? "per NDC package" : "per billing unit",
        l.units,
        l.limit,
        l.coinsurancePct,
        l.result?.allowed,
        l.result?.expected,
        l.input.amount,
        l.result?.margin,
        l.result?.marginPct,
        l.result?.status,
        l.note,
      ]),
    ]);
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby={`${id}-in`} className="rounded-xl border hairline bg-surface p-5 sm:p-6">
        <h2 id={`${id}-in`} className="font-display text-xl font-semibold text-ink">
          1 · Your items and costs
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          One line per item: an NDC with your cost <span className="font-semibold text-ink">per package</span>, or a HCPCS code alone with your cost <span className="font-semibold text-ink">per billing unit</span>. Add the HCPCS code to an NDC line when CMS crosswalks the NDC to more than one code.
        </p>
        <p className="mt-2 flex items-start gap-2 rounded-lg bg-brand-tint/50 px-3 py-2 text-sm text-ink">
          <Lock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          Your costs never leave this browser. Only the codes and NDCs are sent to CodeRx to look up CMS payment limits and billable units.
        </p>
        <label htmlFor={`${id}-text`} className="mt-4 block text-sm font-semibold text-ink">
          Items
        </label>
        <textarea
          id={`${id}-text`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          spellCheck={false}
          placeholder={"50242-0051-21, 812.50\nQ5115, 34.10"}
          className="mt-1.5 block w-full rounded-lg border border-rule-strong bg-surface-raised px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-faint"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-rule-strong px-4 text-sm font-semibold text-ink focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--focus)] hover:border-brand">
            <Upload aria-hidden="true" className="h-4 w-4" /> Open a CSV or text file
            <input
              type="file"
              accept=".csv,.txt,.tsv,text/csv,text/plain"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  setText(await readTextFile(f));
                } catch (err) {
                  setError(err instanceof Error ? err.message : "The file could not be read.");
                }
                e.target.value = "";
              }}
            />
          </label>
          <button type="button" onClick={() => setText(EXAMPLE)} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-brand hover:underline">
            Load an example
          </button>
        </div>
        <fieldset className="mt-4 grid gap-4 border-t hairline pt-4 sm:grid-cols-2">
          <legend className="sr-only">Assumptions</legend>
          <div>
            <label htmlFor={`${id}-seq`} className="text-sm font-semibold text-ink">
              Sequestration (% of Medicare’s share)
            </label>
            <input
              id={`${id}-seq`}
              value={seq}
              onChange={(e) => setSeq(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              className="mt-1.5 block min-h-11 w-28 rounded-lg border border-rule-strong bg-surface-raised px-3 text-base text-ink"
            />
          </div>
          <label className="flex min-h-11 cursor-pointer items-start gap-2 self-end text-sm text-ink">
            <input type="checkbox" checked={coins} onChange={(e) => setCoins(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]" />
            Count the patient’s coinsurance as collected (CMS file percentage — 20%, or less for drugs with an inflation-adjusted coinsurance)
          </label>
        </fieldset>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t hairline pt-4">
          <button
            type="button"
            onClick={run}
            disabled={!parsed.length || busy}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand px-5 font-semibold text-paper hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50 dark:text-paper-sunken"
          >
            <Play aria-hidden="true" className="h-4 w-4" /> {busy ? "Looking up…" : `Compare${parsed.length ? ` (${Math.min(parsed.length, MAX_AUDIT_ITEMS)})` : ""}`}
          </button>
          <p className="text-sm text-ink-muted" aria-live="polite">
            {parsed.length ? `${parsed.length} item${parsed.length === 1 ? "" : "s"} recognized.` : "No codes or NDCs recognized yet."}
          </p>
        </div>
      </section>

      {error ? (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger-tint/50 p-4 text-sm text-ink">
          {error}
        </p>
      ) : null}

      {rows ? (
        <section aria-labelledby={`${id}-out`} className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id={`${id}-out`} className="font-display text-2xl font-semibold text-ink">
                2 · Margin per item
              </h2>
              <p className="mt-1 text-sm text-ink-muted">
                {underwater} underwater · {thin} under 5% · Medicare payment limits {meta?.paymentPeriod ? formatPeriod(meta.paymentPeriod) : ""}
              </p>
            </div>
            <button type="button" onClick={exportCsv} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-rule-strong px-4 text-sm font-semibold text-ink hover:border-brand hover:text-brand">
              <Download aria-hidden="true" className="h-4 w-4" /> Export CSV
            </button>
          </div>
          <TableScroll label="Margin results">
            <table className="w-full min-w-[56rem] border-collapse">
              <caption className="sr-only">Expected Medicare revenue compared with your cost</caption>
              <thead>
                <tr>
                  {["Item", "Billable units", "Limit / unit", "Medicare allowed", "Expected revenue", "Your cost", "Margin"].map((h) => (
                    <th key={h} scope="col" className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.input.line}>
                    <td className={td}>
                      {l.code ? (
                        <Link href={`/hcpcs/${l.code}`} className="code-chip font-semibold whitespace-nowrap text-brand hover:underline">
                          {l.code}
                        </Link>
                      ) : null}
                      {l.input.ndcRaw ? <span className="block code-chip text-xs whitespace-nowrap text-ink-muted">{l.input.ndcRaw}</span> : null}
                      <span className="block text-xs text-ink-faint">{l.basis === "package" ? "cost per package" : "cost per billing unit"}</span>
                    </td>
                    <td className={`${td} code-chip`}>{l.units ?? "—"}</td>
                    <td className={`${td} code-chip`}>
                      {l.limit != null ? `$${l.limit.toFixed(3)}` : "—"}
                      {l.dosage ? <span className="block font-sans text-xs text-ink-muted">per {l.dosage}</span> : null}
                    </td>
                    <td className={`${td} code-chip`}>{l.result ? usd(l.result.allowed) : "—"}</td>
                    <td className={`${td} code-chip`}>
                      {l.result ? usd(l.result.expected) : "—"}
                      {l.result ? <span className="block font-sans text-xs text-ink-muted">coinsurance {l.coinsurancePct ?? 20}%</span> : null}
                    </td>
                    <td className={`${td} code-chip`}>{l.input.amount != null ? usd(l.input.amount) : "—"}</td>
                    <td className={td}>
                      {l.result ? (
                        <>
                          <span className={`code-chip font-semibold ${l.result.status === "underwater" ? "text-danger" : l.result.status === "thin" ? "text-accent" : "text-ok"}`}>
                            {usd(l.result.margin)}
                            {l.result.marginPct != null ? ` (${l.result.marginPct}%)` : ""}
                          </span>
                          <span className="block text-xs text-ink-muted">{l.result.status === "underwater" ? "Underwater" : l.result.status === "thin" ? "Under 5%" : "Positive"}</span>
                        </>
                      ) : (
                        <span className="text-sm text-ink-muted">{l.note}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <p className="text-xs text-ink-muted">
            Expected revenue = payment limit × billable units, with Medicare’s share reduced by sequestration{coins ? " and the patient’s coinsurance counted as collected" : ""}. Derived arithmetic — not a payment determination; it excludes deductibles, bad debt, contract terms, 340B, and administration fees.
          </p>
          <ProvenanceFooter sources={(meta?.provenance ?? []).filter((p) => p.sourceKey === "cms_payment_limits" || p.sourceKey === "cms_ndc_hcpcs")} />
        </section>
      ) : null}
    </div>
  );
}
