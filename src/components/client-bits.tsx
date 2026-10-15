"use client";

import { Check, Copy, History, Moon, Sun, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useState, useSyncExternalStore } from "react";
import { addRecentView, clearRecent, getRecentSearches, getRecentViews, type RecentView } from "./recent-store";

/** Toggle between light and dark; defaults to the operating-system preference. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const dark = mounted && resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface hover:text-ink"
      aria-label={mounted ? `Switch to ${dark ? "light" : "dark"} theme` : "Toggle color theme"}
    >
      {dark ? <Sun aria-hidden="true" className="h-5 w-5" /> : <Moon aria-hidden="true" className="h-5 w-5" />}
    </button>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        } catch {
          setCopied(false);
        }
      }}
      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-rule-strong bg-surface px-3 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand"
    >
      {copied ? <Check aria-hidden="true" className="h-4 w-4 text-ok" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
      <span>{copied ? "Copied" : label}</span>
      <span className="sr-only" aria-live="polite">
        {copied ? `${text} copied to clipboard` : ""}
      </span>
    </button>
  );
}

/** Records the current detail page in the browser-only "recently viewed" list. */
export function RecordView(props: Omit<RecentView, "at">) {
  const { href, title, kind, subtitle } = props;
  useEffect(() => {
    addRecentView({ href, title, kind, subtitle });
  }, [href, title, kind, subtitle]);
  return null;
}

function useRecent() {
  const [state, setState] = useState<{ views: RecentView[]; searches: string[] } | null>(null);
  useEffect(() => {
    const load = () => setState({ views: getRecentViews(), searches: getRecentSearches() });
    load();
    window.addEventListener("coderx:recent", load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener("coderx:recent", load);
      window.removeEventListener("storage", load);
    };
  }, []);
  return state;
}

/** Home-page panel listing what this browser looked up recently (never sent to the server). */
export function RecentlyViewed() {
  const recent = useRecent();
  if (!recent || (!recent.views.length && !recent.searches.length)) return null;
  return (
    <section aria-labelledby="recent-title" className="rounded-xl border hairline bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="recent-title" className="flex items-center gap-2 text-sm font-semibold text-ink">
          <History aria-hidden="true" className="h-4 w-4 text-brand" />
          Recently accessed on this device
        </h2>
        <button type="button" onClick={() => clearRecent()} className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-semibold text-ink-muted hover:bg-paper-sunken hover:text-ink">
          <Trash2 aria-hidden="true" className="h-3.5 w-3.5" /> Clear
        </button>
      </div>
      {recent.views.length ? (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {recent.views.slice(0, 6).map((v) => (
            <li key={v.href}>
              <Link href={v.href} className="flex min-h-11 flex-col justify-center rounded-lg border hairline px-3 py-2 hover:border-brand">
                <span className={`font-semibold text-ink ${v.kind === "hcpcs" || v.kind === "ndc" ? "code-chip" : ""}`}>{v.title}</span>
                {v.subtitle ? <span className="truncate text-xs text-ink-muted">{v.subtitle}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {recent.searches.length ? (
        <p className="mt-3 flex flex-wrap gap-2 text-sm">
          {recent.searches.slice(0, 6).map((q) => (
            <Link key={q} href={`/search?q=${encodeURIComponent(q)}`} className="rounded-full border hairline px-3 py-1 text-ink-muted hover:border-brand hover:text-brand">
              {q}
            </Link>
          ))}
        </p>
      ) : null}
    </section>
  );
}
