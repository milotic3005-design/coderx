import { CircleAlert, CircleCheck, CircleSlash } from "lucide-react";
import { MAI_TEXT, MUE_INFO_URL, MUE_SERVICE_LABELS, mueStatus, type MueEntry } from "@/lib/mue";

function Status({ units, value }: { units: number; value: number }) {
  const s = mueStatus(units, value);
  if (s === "within")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-ok-tint px-2 py-0.5 text-xs font-semibold text-ok">
        <CircleCheck aria-hidden="true" className="h-3.5 w-3.5" /> Within ({units} of {value})
      </span>
    );
  if (s === "exceeds")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-danger-tint px-2 py-0.5 text-xs font-semibold text-danger">
        <CircleAlert aria-hidden="true" className="h-3.5 w-3.5" /> Exceeds by {units - value}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent-tint px-2 py-0.5 text-xs font-semibold text-ink">
      <CircleSlash aria-hidden="true" className="h-3.5 w-3.5 text-accent" /> MUE 0: not reportable
    </span>
  );
}

/** Compares calculated units with the published CMS MUE for each setting. */
export function MueCheck({ code, entries, administeredUnits, discardedUnits }: { code: string; entries: MueEntry[]; administeredUnits: number; discardedUnits: number | null }) {
  const total = administeredUnits + (discardedUnits ?? 0);
  const showTotal = !!discardedUnits;
  return (
    <div className="rounded-xl border hairline bg-surface p-5">
      <p className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Max units per day · CMS MUE</p>
      {entries.length ? (
        <ul className="mt-3 divide-y divide-rule">
          {entries.map((m) => (
            <li key={m.serviceType} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-ink">
                  {MUE_SERVICE_LABELS[m.serviceType].short} <span className="code-chip font-normal text-ink-muted">· MUE {m.value}</span>
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="sr-only">Administered units:</span>
                  <Status units={administeredUnits} value={m.value} />
                  {showTotal ? (
                    <>
                      <span className="text-xs text-ink-muted">
                        <span aria-hidden="true">with JW</span>
                        <span className="sr-only">Administered plus discarded units:</span>
                      </span>
                      <Status units={total} value={m.value} />
                    </>
                  ) : null}
                </div>
              </div>
              {m.adjudicationIndicator && m.adjudicationIndicator in MAI_TEXT ? (
                <p className="mt-1 text-xs text-ink-muted">
                  MAI {m.adjudicationIndicator}: {MAI_TEXT[m.adjudicationIndicator as 1 | 2 | 3]}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">No published MUE for {code}. CMS keeps some MUE values confidential, so this does not mean there is no daily limit.</p>
      )}
      <p className="mt-3 text-xs text-ink-muted">
        {showTotal ? `“With JW” compares administered + discarded units (${total}); confirm with your MAC how JW units count toward the MUE. ` : ""}
        Units for the same patient and date across claim lines add up for date-of-service edits.{" "}
        <a href={MUE_INFO_URL} rel="noopener noreferrer" className="font-semibold text-brand hover:underline">
          CMS MUEs
        </a>
      </p>
    </div>
  );
}
