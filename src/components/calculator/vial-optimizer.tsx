"use client";

import { FlaskConical } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { ceilUnits } from "@/lib/billing";
import { leastWastePlan, roundingCandidates, singleSizePlans, type VialPlan } from "@/lib/vials";
import type { CalculatorPackage } from "../billing-calculator";

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const HOPA_URL = "https://www.nccn.org/professionals/OrderTemplates/PDF/HOPA.pdf";

interface SizeOption {
  amount: number;
  labelers: string[];
  ndcs: string[];
  listed: boolean;
}

function describePlan(p: VialPlan, unitLabel: string) {
  return p.counts.map((c) => `${c.count} × ${fmt(c.amount)} ${unitLabel}`).join(" + ");
}

/**
 * Least-waste container combinations for the current dose, and whole-container dose
 * options within a rounding threshold. Decision support only.
 */
export function VialOptimizer({
  dose,
  unitLabel,
  packages,
  billingUnitAmount,
  paymentLimit,
  onUseDose,
}: {
  /** Dose in the billing-unit measure, or null when not entered. */
  dose: number | null;
  unitLabel: string;
  packages: CalculatorPackage[];
  billingUnitAmount: number | null;
  paymentLimit: number | null;
  onUseDose: (dose: number) => void;
}) {
  const id = useId();
  const sizes: SizeOption[] = useMemo(() => {
    const by = new Map<number, SizeOption>();
    for (const p of packages) {
      const s = by.get(p.amountPerItem) ?? { amount: p.amountPerItem, labelers: [], ndcs: [], listed: false };
      if (p.labeler && !s.labelers.includes(p.labeler)) s.labelers.push(p.labeler);
      s.ndcs.push(p.ndcFormatted);
      s.listed ||= p.fdaListed;
      by.set(p.amountPerItem, s);
    }
    return [...by.values()].sort((a, b) => a.amount - b.amount);
  }, [packages]);
  const [off, setOff] = useState<Set<number>>(() => new Set(sizes.filter((s) => !s.listed).map((s) => s.amount)));
  const [manual, setManual] = useState("");
  const [threshold, setThreshold] = useState("10");

  const manualSizes = manual
    .split(/[,;\s]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  const active = [...sizes.filter((s) => !off.has(s.amount)).map((s) => ({ amount: s.amount })), ...manualSizes.map((amount) => ({ amount }))];
  const pct = Number(threshold);
  const valid = dose != null && dose > 0 && active.length > 0;
  const best = valid ? leastWastePlan(dose!, active) : null;
  const singles = valid ? singleSizePlans(dose!, active) : [];
  const rounding = valid && pct >= 0 && pct <= 50 ? roundingCandidates(dose!, active, pct) : { down: null, up: null };

  const wasteUnits = (p: VialPlan) => (billingUnitAmount && dose ? Math.max(0, ceilUnits(p.total / billingUnitAmount) - ceilUnits(dose / billingUnitAmount)) : null);
  const wasteMoney = (p: VialPlan) => {
    const u = wasteUnits(p);
    return u != null && paymentLimit != null ? u * paymentLimit : null;
  };

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-xl border hairline bg-surface p-5 sm:p-6">
      <h2 id={`${id}-title`} className="flex items-center gap-2 font-display text-xl font-semibold text-ink">
        <FlaskConical aria-hidden="true" className="h-5 w-5 text-brand" /> Vial optimizer
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        The combination of container sizes that leaves the least drug unused, and whole-container doses within a rounding threshold. Sizes come from the CMS NDC crosswalk for this code (billable units per item × billing unit).
      </p>

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="space-y-4">
          <fieldset>
            <legend className="text-sm font-semibold text-ink">Container sizes stocked</legend>
            {sizes.length ? (
              <ul className="mt-2 space-y-2">
                {sizes.map((s) => (
                  <li key={s.amount}>
                    <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border border-rule-strong px-3 py-2 text-sm hover:border-brand">
                      <input
                        type="checkbox"
                        checked={!off.has(s.amount)}
                        onChange={(e) => {
                          const next = new Set(off);
                          if (e.target.checked) next.delete(s.amount);
                          else next.add(s.amount);
                          setOff(next);
                        }}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]"
                      />
                      <span className="min-w-0">
                        <span className="code-chip font-semibold text-ink">
                          {fmt(s.amount)} {unitLabel}
                        </span>
                        <span className="block text-xs text-ink-muted">
                          {s.labelers.join(", ") || "Labeler not listed"} · {s.ndcs.length} NDC{s.ndcs.length === 1 ? "" : "s"}
                          {s.listed ? "" : " · not in the active FDA directory"}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">No crosswalked package sizes for this code — add sizes below.</p>
            )}
          </fieldset>
          <div>
            <label htmlFor={`${id}-manual`} className="text-sm font-semibold text-ink">
              Other sizes ({unitLabel}, optional)
            </label>
            <input
              id={`${id}-manual`}
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="e.g. 100, 500"
              inputMode="decimal"
              autoComplete="off"
              className="mt-1.5 block min-h-11 w-full rounded-lg border border-rule-strong bg-surface-raised px-3 text-base text-ink placeholder:text-ink-faint"
            />
          </div>
          <div>
            <label htmlFor={`${id}-thr`} className="text-sm font-semibold text-ink">
              Rounding threshold (±%)
            </label>
            <input
              id={`${id}-thr`}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              aria-describedby={`${id}-thr-hint`}
              className="mt-1.5 block min-h-11 w-28 rounded-lg border border-rule-strong bg-surface-raised px-3 text-base text-ink"
            />
            <p id={`${id}-thr-hint`} className="mt-1 text-xs text-ink-muted">
              Use your institution’s policy. The{" "}
              <a href={HOPA_URL} rel="noopener noreferrer" className="font-semibold text-brand hover:underline">
                HOPA 2017 position statement
              </a>{" "}
              recommends rounding monoclonal antibodies and other biologics to the nearest vial within 10%.
            </p>
          </div>
        </div>

        <div aria-live="polite" className="min-w-0 space-y-4">
          {dose == null || !(dose > 0) ? (
            <p className="rounded-lg border border-dashed border-rule-strong bg-paper-sunken/60 p-4 text-sm text-ink-muted">Enter a dose above to see container combinations.</p>
          ) : !active.length ? (
            <p className="rounded-lg border border-dashed border-rule-strong bg-paper-sunken/60 p-4 text-sm text-ink-muted">Select or add at least one container size.</p>
          ) : (
            <>
              {best ? (
                <div className="rounded-lg border border-brand/40 bg-brand-tint/40 p-4">
                  <p className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Least unused drug for {fmt(dose)} {unitLabel}</p>
                  <p className="mt-1 code-chip text-lg font-semibold text-ink">{describePlan(best, unitLabel)}</p>
                  <p className="mt-1 text-sm text-ink-muted">
                    {best.vials} container{best.vials === 1 ? "" : "s"} · {fmt(best.total)} {unitLabel} opened · {fmt(best.waste)} {unitLabel} unused ({best.wastePct}%)
                    {wasteUnits(best) != null ? ` · ${wasteUnits(best)} discarded unit${wasteUnits(best) === 1 ? "" : "s"}` : ""}
                    {wasteMoney(best) != null ? ` (${usd(wasteMoney(best)!)} at the payment limit)` : ""}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-ink-muted">These sizes are too fine-grained to optimize here; reduce the number of sizes.</p>
              )}
              {singles.length > 1 || (singles.length === 1 && best && singles[0].total !== best.total) ? (
                <div>
                  <p className="text-sm font-semibold text-ink">One size only</p>
                  <ul className="mt-1 space-y-1 text-sm text-ink-muted">
                    {singles.map((p) => (
                      <li key={p.counts[0].amount}>
                        <span className="code-chip text-ink">{describePlan(p, unitLabel)}</span> — {fmt(p.waste)} {unitLabel} unused ({p.wastePct}%)
                        {wasteMoney(p) != null ? `, ${usd(wasteMoney(p)!)}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div>
                <p className="text-sm font-semibold text-ink">Whole-container doses within ±{Number.isFinite(pct) ? pct : "?"}%</p>
                {rounding.down || rounding.up ? (
                  <ul className="mt-2 space-y-2">
                    {[rounding.down, rounding.up]
                      .filter((c): c is NonNullable<typeof c> => !!c && c.dose !== dose)
                      .map((c) => (
                        <li key={c.dose} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border hairline px-3 py-2">
                          <span className="text-sm text-ink">
                            <span className="code-chip font-semibold">
                              {fmt(c.dose)} {unitLabel}
                            </span>{" "}
                            <span className="text-ink-muted">
                              ({c.changePct > 0 ? "+" : ""}
                              {c.changePct}%) · {describePlan(c.plan, unitLabel)} · no unused drug
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => onUseDose(c.dose)}
                            className="inline-flex min-h-10 items-center rounded-lg border border-rule-strong px-3 text-sm font-semibold text-ink hover:border-brand hover:text-brand"
                          >
                            Use {fmt(c.dose)} {unitLabel}
                          </button>
                        </li>
                      ))}
                    {(rounding.down?.dose === dose || rounding.up?.dose === dose) && <li className="text-sm text-ink-muted">The dose already uses whole containers.</li>}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-ink-muted">No whole-container dose falls within the threshold.</p>
                )}
                <p className="mt-2 text-xs text-ink-muted">
                  Decision support only. Rounding changes the dose the patient receives; it is a clinical decision for the prescriber and pharmacist under your institution’s policy (for example, rounding down only after toxicity-related dose reductions).
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
