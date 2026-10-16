"use client";

import { Download, Plus, Star, X } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState, useSyncExternalStore } from "react";
import type { LimitChange } from "@/lib/data/tools";
import { normalizeHcpcs } from "@/lib/hcpcs";
import { downloadCsv } from "./download";

const KEY = "coderx:watchlist";
const EVENT = "coderx:watchlist";
/** Used when localStorage is unavailable (private mode): the list lasts for this visit only. */
let memory = "[]";

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function snapshot(): string {
  try {
    return window.localStorage.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
}

function parse(raw: string): string[] {
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list.filter((c): c is string => typeof c === "string" && !!normalizeHcpcs(c)).slice(0, 200) : [];
  } catch {
    return [];
  }
}

function save(list: string[]) {
  memory = JSON.stringify(list);
  try {
    window.localStorage.setItem(KEY, memory);
  } catch {
    // Storage unavailable; `memory` keeps the list for this visit.
  }
  window.dispatchEvent(new Event(EVENT));
}

export interface WatchEvent {
  code: string;
  text: string;
}

/**
 * A personal list of HCPCS codes kept in this browser only. Shows this quarter's
 * changes for those codes; the full lists below stay unfiltered.
 */
export function Watchlist({ events, limitChanges, period }: { events: WatchEvent[]; limitChanges: LimitChange[]; period: string }) {
  const id = useId();
  // The server snapshot is an empty list, so server and first client render match.
  const raw = useSyncExternalStore(subscribe, snapshot, () => "[]");
  const codes = useMemo(() => parse(raw), [raw]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const update = save;
  const add = () => {
    const parts = draft.split(/[\s,;]+/).filter(Boolean);
    const valid = parts.map((p) => normalizeHcpcs(p)).filter((c): c is string => !!c);
    if (!valid.length) {
      setError("Enter HCPCS Level II codes such as J9312.");
      return;
    }
    setError(parts.length !== valid.length ? "Some entries were not HCPCS Level II codes and were skipped." : null);
    update([...new Set([...codes, ...valid])].slice(0, 200));
    setDraft("");
  };
  const mine = events.filter((e) => codes.includes(e.code));

  return (
    <div className="rounded-xl border hairline bg-surface p-5 sm:p-6">
      <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-ink">
        <Star aria-hidden="true" className="h-5 w-5 text-accent" /> Your watchlist
      </h2>
      <p className="mt-1 text-sm text-ink-muted">Codes you follow, saved in this browser only. Changes for them this quarter appear here.</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={`${id}-add`} className="text-sm font-semibold text-ink">
            Add codes
          </label>
          <input
            id={`${id}-add`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="J9312, Q5115"
            autoComplete="off"
            className="mt-1 block min-h-11 w-56 rounded-lg border border-rule-strong bg-surface-raised px-3 font-mono text-sm text-ink placeholder:text-ink-faint"
          />
        </div>
        <button type="button" onClick={add} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-rule-strong px-3 text-sm font-semibold text-ink hover:border-brand hover:text-brand">
          <Plus aria-hidden="true" className="h-4 w-4" /> Add
        </button>
        <button
          type="button"
          onClick={() =>
            downloadCsv(`coderx-payment-limit-changes-${period}.csv`, [
              ["hcpcs", "short_description", "dosage", "previous_limit", "new_limit", "change_pct", "on_watchlist"],
              ...limitChanges.map((c) => [c.code, c.shortDescription, c.dosage, c.before, c.after, c.changePct, codes.includes(c.code) ? "yes" : ""]),
            ])
          }
          className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-rule-strong px-3 text-sm font-semibold text-ink hover:border-brand hover:text-brand"
        >
          <Download aria-hidden="true" className="h-4 w-4" /> All limit changes (CSV)
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      {codes.length ? (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Watched codes">
          {codes.map((c) => (
            <li key={c} className="inline-flex items-center gap-1 rounded-full border border-rule-strong py-0.5 pr-1 pl-3 text-sm">
              <Link href={`/hcpcs/${c}`} className="code-chip font-semibold text-brand hover:underline">
                {c}
              </Link>
              <button type="button" onClick={() => update(codes.filter((x) => x !== c))} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-paper-sunken hover:text-ink">
                <X aria-hidden="true" className="h-3.5 w-3.5" />
                <span className="sr-only">Remove {c}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-4" aria-live="polite">
        {!codes.length ? (
          <p className="text-sm text-ink-muted">Your watchlist is empty.</p>
        ) : mine.length ? (
          <ul className="space-y-1.5 text-sm">
            {mine.map((e) => (
              <li key={`${e.code}-${e.text}`} className="flex gap-2">
                <span className="code-chip font-semibold text-ink">{e.code}</span>
                <span className="text-ink-muted">{e.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">No changes this quarter for the codes you follow.</p>
        )}
      </div>
    </div>
  );
}
