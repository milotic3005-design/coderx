"use client";

import { Armchair, Plus, Save, Trash2, Upload } from "lucide-react";
import { useId, useState, useSyncExternalStore } from "react";
import { packChairs, planCapacity, type VisitType } from "@/lib/capacity";

const KEY = "coderx:capacity-scenario";
const COLORS = ["bg-brand/75", "bg-accent/75", "bg-ok/70", "bg-danger/60", "bg-ink-faint/60", "bg-brand/40"];

interface Scenario {
  chairs: string;
  hours: string;
  turnover: string;
  target: string;
  days: string;
  visits: { name: string; minutes: string; perDay: string }[];
}

const EXAMPLE: Scenario = {
  chairs: "10",
  hours: "10",
  turnover: "15",
  target: "85",
  days: "5",
  visits: [
    { name: "Injection or short infusion", minutes: "30", perDay: "20" },
    { name: "1–2 hour infusion", minutes: "120", perDay: "12" },
    { name: "Long infusion (4 h+)", minutes: "270", perDay: "4" },
  ],
};

const noop = () => () => {};
function savedSnapshot(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const n = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function CapacityPlanner() {
  const id = useId();
  const [s, setS] = useState<Scenario>(EXAMPLE);
  const [savedTick, setSavedTick] = useState(0);
  const saved = useSyncExternalStore(noop, savedSnapshot, () => null);
  const hasSaved = !!saved || savedTick > 0;

  const visits: VisitType[] = s.visits.map((v) => ({ name: v.name || "Unnamed", chairMinutes: n(v.minutes), perDay: n(v.perDay) }));
  const input = { chairs: n(s.chairs), openMinutes: n(s.hours) * 60, turnoverMinutes: n(s.turnover), targetPct: n(s.target), visits };
  const r = planCapacity(input);
  const pack = packChairs(input);
  const set = (patch: Partial<Scenario>) => setS((prev) => ({ ...prev, ...patch }));
  const setVisit = (i: number, patch: Partial<Scenario["visits"][number]>) => setS((prev) => ({ ...prev, visits: prev.visits.map((v, k) => (k === i ? { ...v, ...patch } : v)) }));
  const field = "mt-1 block min-h-11 w-full rounded-lg border border-rule-strong bg-surface-raised px-3 text-base text-ink";
  const over = r.utilizationPct > n(s.target);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section aria-labelledby={`${id}-in`} className="space-y-5 rounded-xl border hairline bg-surface p-5 sm:p-6">
        <h2 id={`${id}-in`} className="font-display text-xl font-semibold text-ink">
          Your unit
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 lg:grid-cols-3 xl:grid-cols-5">
          {(
            [
              ["chairs", "Chairs"],
              ["hours", "Hours open"],
              ["turnover", "Turnover (min)"],
              ["target", "Target use %"],
              ["days", "Days / week"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="text-sm font-semibold text-ink">
              {label}
              <input value={s[k]} onChange={(e) => set({ [k]: e.target.value })} inputMode="decimal" className={field} />
            </label>
          ))}
        </div>

        <fieldset>
          <legend className="text-sm font-semibold text-ink">Visit types</legend>
          <p className="mt-0.5 text-xs text-ink-muted">Chair time per visit (infusion plus pre- and post-observation) and visits per day. The rows start as a generic example — replace them with your own mix.</p>
          <ul className="mt-3 space-y-2">
            {s.visits.map((v, i) => (
              <li key={i} className="grid grid-cols-[auto_minmax(0,1fr)_5.5rem_5rem_auto] items-end gap-2">
                <span aria-hidden="true" className={`mb-4 h-3 w-3 rounded-sm ${COLORS[i % COLORS.length]}`} />
                <label className="text-xs font-semibold text-ink-muted">
                  Name
                  <input value={v.name} onChange={(e) => setVisit(i, { name: e.target.value })} className={field} />
                </label>
                <label className="text-xs font-semibold text-ink-muted">
                  Minutes
                  <input value={v.minutes} onChange={(e) => setVisit(i, { minutes: e.target.value })} inputMode="numeric" className={field} />
                </label>
                <label className="text-xs font-semibold text-ink-muted">
                  Per day
                  <input value={v.perDay} onChange={(e) => setVisit(i, { perDay: e.target.value })} inputMode="numeric" className={field} />
                </label>
                <button
                  type="button"
                  onClick={() => setS((prev) => ({ ...prev, visits: prev.visits.filter((_, k) => k !== i) }))}
                  className="mb-0.5 inline-flex h-11 w-11 items-center justify-center rounded-lg text-ink-muted hover:bg-paper-sunken hover:text-danger"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                  <span className="sr-only">Remove {v.name || "visit type"}</span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setS((prev) => ({ ...prev, visits: [...prev.visits, { name: "", minutes: "60", perDay: "1" }].slice(0, 12) }))}
            className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-rule-strong px-3 text-sm font-semibold text-ink hover:border-brand hover:text-brand"
          >
            <Plus aria-hidden="true" className="h-4 w-4" /> Add visit type
          </button>
        </fieldset>

        <div className="flex flex-wrap gap-2 border-t hairline pt-4">
          <button
            type="button"
            onClick={() => {
              try {
                window.localStorage.setItem(KEY, JSON.stringify(s));
                setSavedTick((t) => t + 1);
              } catch {
                // storage unavailable
              }
            }}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-rule-strong px-3 text-sm font-semibold text-ink hover:border-brand hover:text-brand"
          >
            <Save aria-hidden="true" className="h-4 w-4" /> Save in this browser
          </button>
          {hasSaved ? (
            <button
              type="button"
              onClick={() => {
                try {
                  const v = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Scenario | null;
                  if (v && Array.isArray(v.visits)) setS(v);
                } catch {
                  // ignore a damaged saved scenario
                }
              }}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-rule-strong px-3 text-sm font-semibold text-ink hover:border-brand hover:text-brand"
            >
              <Upload aria-hidden="true" className="h-4 w-4" /> Load saved
            </button>
          ) : null}
        </div>
      </section>

      <section aria-labelledby={`${id}-out`} aria-live="polite" className="min-w-0 space-y-4">
        <h2 id={`${id}-out`} className="font-display text-xl font-semibold text-ink">
          Capacity
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ["Chair use", `${r.utilizationPct}%`, over ? "Above your target" : `Target ${n(s.target)}%`, over],
              ["Chairs needed", String(r.chairsNeeded), `at ${n(s.target)}% use`, r.chairsNeeded > n(s.chairs)],
              ["Room for", `${r.headroomVisits}`, "more average visits / day", false],
              ["Visits / week", String(visits.reduce((t, v) => t + v.perDay, 0) * n(s.days)), `${n(s.days)} days`, false],
            ] as const
          ).map(([label, value, hint, warn]) => (
            <div key={label} className="rounded-xl border hairline bg-surface p-4">
              <dt className="text-xs font-semibold tracking-wide text-ink-faint uppercase">{label}</dt>
              <dd className={`mt-1 font-display text-3xl font-semibold num ${warn ? "text-danger" : "text-ink"}`}>{value}</dd>
              <dd className="text-xs text-ink-muted">{hint}</dd>
            </div>
          ))}
        </dl>

        <div className="rounded-xl border hairline bg-surface p-4">
          <p className="text-sm font-semibold text-ink">Demand by visit type</p>
          <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-paper-sunken" aria-hidden="true">
            {r.byType.map((t, i) => (
              <span key={t.name + i} className={COLORS[i % COLORS.length]} style={{ width: `${t.sharePct}%` }} />
            ))}
          </div>
          <ul className="mt-2 grid gap-1 text-xs text-ink-muted sm:grid-cols-2">
            {r.byType.map((t, i) => (
              <li key={t.name + i} className="flex items-center gap-2">
                <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-sm ${COLORS[i % COLORS.length]}`} />
                {t.name}: {t.visits}/day · {Math.round(t.minutes / 6) / 10} chair-hours · {t.sharePct}%
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border hairline bg-surface p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Armchair aria-hidden="true" className="h-4 w-4 text-brand" /> One day, longest visits first
          </p>
          <ul className="mt-3 space-y-1.5" aria-label="Chair schedule">
            {pack.chairs.map((c, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="w-14 shrink-0 code-chip text-xs text-ink-faint">Chair {i + 1}</span>
                <span role="img" className="flex h-4 flex-1 overflow-hidden rounded bg-paper-sunken" aria-label={`Chair ${i + 1}: ${Math.round(c.minutes)} of ${input.openMinutes} minutes booked`}>
                  {c.blocks.map((b, k) => (
                    <span key={k} className={`${COLORS[b.type % COLORS.length]} border-r border-surface`} style={{ width: `${input.openMinutes ? (b.minutes / input.openMinutes) * 100 : 0}%` }} />
                  ))}
                </span>
              </li>
            ))}
          </ul>
          {pack.overflow.length ? (
            <p role="alert" className="mt-3 text-sm font-semibold text-danger">
              Does not fit in one day: {pack.overflow.map((o) => `${o.count} × ${visits[o.type]?.name}`).join(", ")}.
            </p>
          ) : (
            <p className="mt-3 text-xs text-ink-muted">Every visit fits. A simple packing (longest first, least-booked chair) — real schedules also depend on start times, staffing, and pharmacy prep.</p>
          )}
          {r.tooLong.length ? <p className="mt-1 text-sm text-danger">Longer than the open day: {r.tooLong.join(", ")}.</p> : null}
        </div>
      </section>
    </div>
  );
}
