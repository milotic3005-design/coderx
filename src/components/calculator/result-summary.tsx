"use client";

import { ArrowUp, CircleAlert, CircleCheck, CircleSlash } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CalculatorResult } from "@/lib/billing";
import { MUE_SERVICE_LABELS, mueStatus, type MueEntry } from "@/lib/mue";

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function mueSummary(entries: MueEntry[] | null | undefined, units: number) {
  const m = entries?.find((e) => e.serviceType === "practitioner") ?? entries?.[0];
  if (!m) return null;
  return { status: mueStatus(units, m.value), value: m.value, setting: MUE_SERVICE_LABELS[m.serviceType].short };
}

/**
 * The calculation's headline numbers. On wide screens the card stays pinned at the top
 * of the result column while the form scrolls; on phones a bottom bar carries the same
 * numbers whenever the card is out of view.
 */
export function ResultSummary({ result, code, mue, onView }: { result: CalculatorResult; code?: string | null; mue?: MueEntry[] | null; onView: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin: "-64px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const jw = result.discardedUnits;
  const total = result.administeredUnits + (jw ?? 0);
  const m = mueSummary(mue, total);
  const allowed = result.estimatedAllowedAdministered;

  return (
    <>
      <div className="z-10 bg-paper lg:sticky lg:top-16 lg:-my-3 lg:py-3">
        <div ref={ref} className="rounded-xl border hairline bg-surface p-5 shadow-card">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Administered HCPCS units</dt>
              <dd className="mt-1 font-display text-5xl font-semibold text-ink num">{result.administeredUnits}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Discarded (JW) units</dt>
              <dd className="mt-1 font-display text-5xl font-semibold text-ink num">{jw ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold tracking-wide text-ink-faint uppercase">MUE{m ? ` · ${m.setting}` : ""}</dt>
              <dd className="mt-2 text-sm font-semibold">
                {!m ? (
                  <span className="text-ink-muted">{code ? "Not published" : "Load a code"}</span>
                ) : m.status === "within" ? (
                  <span className="inline-flex items-center gap-1 text-ok">
                    <CircleCheck aria-hidden="true" className="h-4 w-4" /> Within {m.value}
                  </span>
                ) : m.status === "exceeds" ? (
                  <span className="inline-flex items-center gap-1 text-danger">
                    <CircleAlert aria-hidden="true" className="h-4 w-4" /> Exceeds {m.value}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-accent">
                    <CircleSlash aria-hidden="true" className="h-4 w-4" /> MUE 0
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Derived allowed</dt>
              <dd className="mt-2 code-chip text-sm font-semibold text-ink">
                {allowed != null ? usd(allowed) : "—"}
                {result.estimatedAllowedDiscarded != null ? <span className="block font-sans text-xs font-normal text-ink-muted">+ {usd(result.estimatedAllowedDiscarded)} JW</span> : null}
              </dd>
            </div>
          </dl>
          <p className="mt-3 border-t hairline pt-3 text-sm text-ink-muted">
            {result.rawUnits} before rounding{code ? ` · ${code}` : ""}
            {result.discardedAmount != null ? ` · ${result.discardedAmount} ${result.unitLabel} unused` : " · add container details for discarded units"}
          </p>
        </div>
      </div>

      {/* Phones: keep the headline numbers reachable while the form is in view. */}
      <div
        aria-hidden={inView}
        inert={inView}
        className={`fixed inset-x-0 bottom-0 z-30 border-t hairline bg-surface-raised/95 px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] shadow-card backdrop-blur transition-transform duration-200 lg:hidden print:hidden ${
          inView ? "translate-y-full" : "translate-y-0"
        }`}
      >
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-ink">
            <span className="font-display text-2xl font-semibold num">{result.administeredUnits}</span> units
            {jw ? <span className="text-ink-muted"> · JW {jw}</span> : null}
            {m ? <span className={m.status === "exceeds" ? "text-danger" : m.status === "within" ? "text-ok" : "text-accent"}> · MUE {m.status === "within" ? "✓" : m.status === "exceeds" ? "over" : "0"}</span> : null}
          </p>
          <button type="button" onClick={onView} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-semibold text-paper hover:bg-brand-strong dark:text-paper-sunken">
            <ArrowUp aria-hidden="true" className="h-4 w-4" /> View result
          </button>
        </div>
      </div>
    </>
  );
}
