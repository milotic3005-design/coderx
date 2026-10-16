"use client";

import { CircleAlert, CircleCheck, CircleX, Download, Info, Play, Upload } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { MAX_AUDIT_ITEMS, parseAuditText } from "@/lib/audit-input";
import type { Provenance } from "@/lib/data/provenance";
import type { AuditRow, FindingLevel } from "@/lib/data/tools";
import { formatPeriod } from "@/lib/format";
import { MUE_SERVICE_LABELS } from "@/lib/mue";
import { TableScroll, td, th } from "../layout-bits";
import { ProvenanceFooter } from "../provenance";
import { downloadCsv, readTextFile } from "./download";

const EXAMPLE = `HCPCS,NDC,Description
J9312,50242-0051-21,Rituxan 100 mg vial
J9311,50242-0051-21,Pair to check
Q5115,,Truxima
S0189,,Terminated code
J3490,,Unclassified drug
,0006-3026-02,Keytruda 100 mg/4 mL`;

const LEVEL = {
  error: { icon: CircleX, cls: "text-danger", label: "Error" },
  warning: { icon: CircleAlert, cls: "text-accent", label: "Warning" },
  info: { icon: Info, cls: "text-brand", label: "Info" },
  ok: { icon: CircleCheck, cls: "text-ok", label: "OK" },
} satisfies Record<FindingLevel, unknown>;

interface Response {
  data: AuditRow[] | null;
  meta: { provenance?: Provenance[]; paymentPeriod?: string | null; crosswalkPeriod?: string | null };
  error: { message: string } | null;
}

export function AuditTool() {
  const id = useId();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [meta, setMeta] = useState<Response["meta"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "issues" | "errors">("all");
  const parsed = useMemo(() => parseAuditText(text), [text]);
  const runnable = parsed.filter((p) => p.hcpcs || p.ndc11);
  const sent = runnable.slice(0, MAX_AUDIT_ITEMS);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: sent.map((p) => ({ hcpcs: p.hcpcs, ndc: p.ndc11 ? p.ndcRaw : null })) }),
      });
      const body = (await res.json()) as Response;
      if (!res.ok || !body.data) throw new Error(body.error?.message ?? `Request failed (${res.status}).`);
      setRows(body.data);
      setMeta(body.meta);
    } catch (e) {
      setRows(null);
      setError(e instanceof Error ? e.message : "The audit could not be run.");
    } finally {
      setBusy(false);
    }
  }

  const shown = (rows ?? []).filter((r) => (filter === "all" ? true : filter === "errors" ? r.worst === "error" : r.worst === "error" || r.worst === "warning"));
  const counts = (rows ?? []).reduce<Record<FindingLevel, number>>((acc, r) => ({ ...acc, [r.worst]: acc[r.worst] + 1 }), { error: 0, warning: 0, info: 0, ok: 0 });

  function exportCsv() {
    if (!rows) return;
    const mue = (r: AuditRow, k: keyof typeof MUE_SERVICE_LABELS) => r.code?.mue.find((m) => m.serviceType === k)?.value ?? "";
    downloadCsv(`coderx-audit-${new Date().toISOString().slice(0, 10)}.csv`, [
      ["line", "input", "hcpcs", "hcpcs_status", "short_description", "ndc", "fda_status", "labeler", "crosswalk_codes", "pair_matches_cms", "payment_limit", "payment_dosage", "payment_period", "mue_practitioner", "mue_outpatient", "mue_dme", "result", "findings"],
      ...rows.map((r) => {
        const input = sent[r.index];
        return [
          input?.line,
          input?.raw,
          r.code?.code,
          r.code ? (!r.code.inFile ? "not in file" : r.code.isActive ? "active" : `terminated ${r.code.terminationDate}`) : "",
          r.code?.shortDescription,
          r.ndc?.formatted,
          r.ndc ? (r.ndc.fda ? (r.ndc.fda.isActive ? "listed" : r.ndc.fda.listingStatus === "excluded" ? `excluded ${r.ndc.fda.excludeFlag ?? ""}` : `ended ${r.ndc.fda.marketingEnd}`) : "not found") : "",
          r.ndc?.fda?.labeler,
          r.ndc?.crosswalk.map((x) => x.hcpcsCode ?? "NOC").join(" "),
          r.pairMatches == null ? "" : r.pairMatches ? "yes" : "no",
          r.code?.payment?.limit ?? r.code?.payment?.limitText ?? "",
          r.code?.payment?.dosage,
          r.code?.payment?.period,
          mue(r, "practitioner"),
          mue(r, "outpatient_hospital"),
          mue(r, "dme_supplier"),
          LEVEL[r.worst].label,
          r.findings.map((f) => `${LEVEL[f.level].label}: ${f.text}`).join(" | "),
        ];
      }),
    ]);
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby={`${id}-in`} className="rounded-xl border hairline bg-surface p-5 sm:p-6">
        <h2 id={`${id}-in`} className="font-display text-xl font-semibold text-ink">
          1 · Paste or upload your list
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          One line per chargemaster or formulary item: a HCPCS code, an NDC, or both (e.g. <span className="code-chip">J9312,50242-0051-21</span>). Comma-, tab-, or semicolon-separated exports work; other columns are ignored. Codes and NDCs only — never include patient information.
        </p>
        <label htmlFor={`${id}-text`} className="mt-4 block text-sm font-semibold text-ink">
          Items
        </label>
        <textarea
          id={`${id}-text`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={"J9312,50242-0051-21\nQ5115\n0006-3026-02"}
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
                  setError(null);
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
          <p className="text-xs text-ink-muted">The file is read in your browser; only the codes and NDCs are sent to CodeRx when you run the audit.</p>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t hairline pt-4">
          <button
            type="button"
            onClick={run}
            disabled={!sent.length || busy}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand px-5 font-semibold text-paper hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50 dark:text-paper-sunken"
          >
            <Play aria-hidden="true" className="h-4 w-4" /> {busy ? "Checking…" : `Run audit${sent.length ? ` (${sent.length})` : ""}`}
          </button>
          <p className="text-sm text-ink-muted" aria-live="polite">
            {parsed.length ? `${parsed.length} line${parsed.length === 1 ? "" : "s"} with a code or NDC.` : "No codes or NDCs recognized yet."}
            {runnable.length > MAX_AUDIT_ITEMS ? ` Only the first ${MAX_AUDIT_ITEMS} are checked per run.` : ""}
          </p>
        </div>
        {parsed.some((p) => p.problems.length) ? (
          <ul className="mt-3 space-y-1 text-sm text-danger">
            {parsed
              .filter((p) => p.problems.length)
              .slice(0, 8)
              .map((p) => (
                <li key={p.line}>
                  Line {p.line}: {p.problems.join(" ")}
                </li>
              ))}
          </ul>
        ) : null}
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
                2 · Results
              </h2>
              <p className="mt-1 text-sm text-ink-muted">
                {counts.error} with errors · {counts.warning} with warnings · {counts.info + counts.ok} OK or informational
                {meta?.paymentPeriod ? ` · payment limits ${formatPeriod(meta.paymentPeriod)}` : ""}
                {meta?.crosswalkPeriod ? ` · crosswalk ${formatPeriod(meta.crosswalkPeriod)}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={`${id}-filter`} className="text-sm font-semibold text-ink">
                Show
              </label>
              <select id={`${id}-filter`} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="min-h-11 rounded-lg border border-rule-strong bg-surface-raised px-3 text-sm text-ink">
                <option value="all">All rows</option>
                <option value="issues">Errors and warnings</option>
                <option value="errors">Errors only</option>
              </select>
              <button type="button" onClick={exportCsv} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-rule-strong px-4 text-sm font-semibold text-ink hover:border-brand hover:text-brand">
                <Download aria-hidden="true" className="h-4 w-4" /> Export CSV
              </button>
            </div>
          </div>
          <TableScroll label="Audit results">
            <table className="w-full min-w-[60rem] border-collapse">
              <caption className="sr-only">Audit results</caption>
              <thead>
                <tr>
                  <th scope="col" className={th}>
                    Line
                  </th>
                  <th scope="col" className={th}>
                    HCPCS
                  </th>
                  <th scope="col" className={th}>
                    NDC
                  </th>
                  <th scope="col" className={th}>
                    Payment limit
                  </th>
                  <th scope="col" className={th}>
                    MUE (office / OPPS)
                  </th>
                  <th scope="col" className={th}>
                    Findings
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const input = sent[r.index];
                  const mue = (k: "practitioner" | "outpatient_hospital") => r.code?.mue.find((m) => m.serviceType === k)?.value ?? "—";
                  return (
                    <tr key={r.index}>
                      <td className={`${td} code-chip text-ink-muted`}>{input?.line}</td>
                      <td className={td}>
                        {r.code ? (
                          <>
                            {r.code.inFile ? (
                              <Link href={`/hcpcs/${r.code.code}`} className="code-chip font-semibold whitespace-nowrap text-brand hover:underline">
                                {r.code.code}
                              </Link>
                            ) : (
                              <span className="code-chip font-semibold text-ink">{r.code.code}</span>
                            )}
                            <span className="block max-w-[14rem] text-xs text-ink-muted">{r.code.shortDescription ?? ""}</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={td}>
                        {r.ndc ? (
                          <>
                            <Link href={`/ndc/${r.ndc.formatted}`} className="code-chip font-semibold whitespace-nowrap text-brand hover:underline">
                              {r.ndc.formatted}
                            </Link>
                            <span className="block max-w-[14rem] text-xs text-ink-muted">{r.ndc.fda?.drugName ?? r.ndc.fda?.labeler ?? ""}</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={`${td} code-chip`}>
                        {r.code?.payment ? (
                          <>
                            {r.code.payment.limit != null ? `$${Number(r.code.payment.limit).toFixed(3)}` : (r.code.payment.limitText ?? "—")}
                            <span className="block font-sans text-xs text-ink-muted">per {r.code.payment.dosage ?? "unit"}</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={`${td} code-chip`}>{r.code ? `${mue("practitioner")} / ${mue("outpatient_hospital")}` : "—"}</td>
                      <td className={td}>
                        <ul className="space-y-1">
                          {r.findings.map((f) => {
                            const L = LEVEL[f.level];
                            return (
                              <li key={f.text} className="flex gap-1.5 text-sm text-ink">
                                <L.icon aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${L.cls}`} />
                                <span>
                                  <span className="sr-only">{L.label}: </span>
                                  {f.text}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
          {!shown.length ? <p className="text-sm text-ink-muted">No rows match this filter.</p> : null}
          <ProvenanceFooter sources={meta?.provenance ?? []} />
        </section>
      ) : null}
    </div>
  );
}
