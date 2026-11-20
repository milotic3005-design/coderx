"use client";

/**
 * One-patient site-of-care check. Runs in the browser: nothing typed here is saved or sent.
 * The drug is picked from the payer's own list (codes for UHC, Premera and Regence; names for Aetna).
 */
import Link from "next/link";
import { useState } from "react";
import { socCheck, type SocListEntryView, type SocPayerKey, type SocPayerRule } from "@/lib/soc/rules";

export interface SocCalculatorPayer {
  key: SocPayerKey;
  rule: SocPayerRule;
  entries: SocListEntryView[] | null;
  listDate: string | null;
  /** The payer's own list (or the policy that prints it), to check a drug not found in CodeRx's copy. */
  listUrl: string | null;
  changedSinceReview: boolean;
}

const NOT_ON_LIST = "__not_on_list__";
const field = "mt-1 block min-h-11 w-full rounded-lg border border-rule-strong bg-surface-raised px-3 text-base text-ink";
const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const entryText = (e: SocListEntryView) => `${e.code ? `${e.code} — ` : ""}${e.label}${e.oncologyStar ? " (oncology ★)" : ""}`;

export function SocCalculator({ payers, today }: { payers: SocCalculatorPayer[]; today: string }) {
  const [payerKey, setPayerKey] = useState<SocPayerKey>(payers[0].key);
  const [filter, setFilter] = useState("");
  const [choice, setChoice] = useState("");
  const [firstDose, setFirstDose] = useState(today);
  const [dosesGiven, setDosesGiven] = useState("1");
  const [nextDose, setNextDose] = useState("");
  const [leadDays, setLeadDays] = useState("14");
  // Unticked until the user confirms the course meets this payer's conditions: unticked gives the cautious answer.
  const [newCourse, setNewCourse] = useState(false);

  const payer = payers.find((p) => p.key === payerKey)!;
  const entries = payer.entries ?? [];
  // A few hundred entries at most, so filtering on every keystroke needs no memo.
  const q = filter.trim().toLowerCase();
  const shown = entries.map((e, i) => ({ e, i })).filter(({ e }) => !q || entryText(e).toLowerCase().includes(q));
  const entry = choice && choice !== NOT_ON_LIST ? (entries[Number(choice)] ?? null) : null;
  const ready = !!firstDose && (payer.entries === null || choice !== "");
  const result = ready
    ? socCheck({
        rule: payer.rule,
        entry,
        list: payer.entries ? { count: payer.entries.length, date: payer.listDate } : null,
        newCourse,
        firstHospitalDose: firstDose,
        hospitalDosesGiven: Math.max(0, Number(dosesGiven) || 0),
        nextDose: nextDose || null,
        leadDays: Number(leadDays),
        today,
      })
    : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <form className="space-y-4" aria-label="Patient site-of-care check" onSubmit={(e) => e.preventDefault()}>
        <p className="rounded-lg bg-paper-sunken px-3 py-2 text-xs text-ink-muted">Nothing you enter here is saved or sent. No patient names or IDs are needed.</p>
        <label className="block text-sm font-semibold text-ink">
          Payer
          <select
            className={field}
            value={payerKey}
            onChange={(e) => {
              setPayerKey(e.target.value as SocPayerKey);
              setChoice("");
              setFilter("");
              setNewCourse(false);
            }}
          >
            {payers.map((p) => (
              <option key={p.key} value={p.key}>
                {p.rule.name}
              </option>
            ))}
          </select>
        </label>
        {payer.entries ? (
          <>
            <label className="block text-sm font-semibold text-ink">
              Find the drug in {payer.rule.shortName}&apos;s list
              <input className={field} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={payer.entries.some((e) => e.code) ? "Code or name, e.g. J1745 or infliximab" : "Name, e.g. Entyvio"} autoComplete="off" />
            </label>
            <label className="block text-sm font-semibold text-ink">
              Drug ({shown.length} of {entries.length}
              {payer.listDate ? `, list dated ${fmt(payer.listDate)}` : ""})
              <select className={field} size={6} value={choice} onChange={(e) => setChoice(e.target.value)}>
                {shown.map(({ e, i }) => (
                  <option key={i} value={String(i)}>
                    {entryText(e)}
                  </option>
                ))}
                <option value={NOT_ON_LIST}>I can&apos;t find the drug on this list</option>
              </select>
            </label>
          </>
        ) : (
          <p className="text-sm text-ink-muted">{payer.rule.listNote}</p>
        )}
        {payer.rule.window.qualifies ? (
          <label className="flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={newCourse} onChange={(e) => setNewCourse(e.target.checked)} />
            <span>
              <span className="font-semibold">This course qualifies for {payer.rule.shortName}&apos;s initial period</span>
              <span className="block text-ink-muted">{payer.rule.window.qualifies}</span>
            </span>
          </label>
        ) : null}
        <label className="block text-sm font-semibold text-ink">
          {payer.rule.window.dayOneLabel ?? "First hospital dose of this course"}
          <input type="date" className={field} value={firstDose} onChange={(e) => setFirstDose(e.target.value)} required />
        </label>
        <label className="block text-sm font-semibold text-ink">
          Hospital doses given so far in this course
          <input type="number" min={0} max={99} className={field} value={dosesGiven} onChange={(e) => setDosesGiven(e.target.value)} />
        </label>
        <label className="block text-sm font-semibold text-ink">
          Next scheduled dose (optional)
          <input type="date" className={field} value={nextDose} onChange={(e) => setNextDose(e.target.value)} />
        </label>
        <label className="block text-sm font-semibold text-ink">
          Have the move or exception ready this many days before the period ends
          <select className={field} value={leadDays} onChange={(e) => setLeadDays(e.target.value)}>
            {["7", "14", "21", "30"].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
      </form>

      <div aria-live="polite">
        {result ? (
          <section aria-label="Result" className="rounded-xl border hairline bg-surface p-5">
            {payer.changedSinceReview ? (
              <p role="alert" className="mb-3 rounded-lg bg-accent-tint px-3 py-2 text-sm text-ink">
                {payer.rule.shortName} changed its criteria wording since this rule was written. Check the new wording under Payer rules before relying on the window below.
              </p>
            ) : null}
            <p className="text-lg font-semibold text-ink">{result.headline}</p>
            {result.window.kind === "days" ? (
              <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-xs font-semibold tracking-wide text-ink-faint uppercase">{result.window.approximate ? "If approved, about through" : "Last day of the period"}</dt>
                  <dd className="font-semibold text-ink">{fmt(result.window.last)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Act by</dt>
                  <dd className="font-semibold text-ink">{result.actBy ? fmt(result.actBy < today ? today : result.actBy) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Next dose</dt>
                  <dd className="font-semibold text-ink">{result.nextDoseInWindow == null ? "—" : result.nextDoseInWindow ? "Within the period" : "After the period"}</dd>
                </div>
              </dl>
            ) : null}
            {result.window.kind === "days" && result.window.approximate ? <p className="mt-2 text-xs text-ink-muted">{payer.rule.shortName} gives this length as an example (&ldquo;e.g., 4 weeks&rdquo;); it sets the length when it approves the hospital.</p> : null}
            <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-ink">
              {result.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <p className="mt-4 text-sm text-ink-muted">
              The payer&apos;s exception criteria, in its own words, are under <a href={`#rules-${payer.key}`} className="font-semibold text-brand underline">Payer rules</a>.
              {payer.listUrl ? (
                <>
                  {" "}
                  The list itself:{" "}
                  <a href={payer.listUrl} className="font-semibold text-brand underline" rel="noopener noreferrer">
                    {payer.rule.shortName}&apos;s site-of-care list
                  </a>
                  .
                </>
              ) : null}
              {entry?.code ? (
                <>
                  {" "}
                  To compare what each site earns for this drug, see{" "}
                  <Link href={`/tools/site-of-care?code=${entry.code}`} className="font-semibold text-brand underline">
                    HOPD vs home for {entry.code}
                  </Link>
                  .
                </>
              ) : null}
            </p>
          </section>
        ) : (
          <p className="text-sm text-ink-muted">Pick the drug and the first hospital dose date to see the period.</p>
        )}
      </div>
    </div>
  );
}
