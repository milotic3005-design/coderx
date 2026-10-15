"use client";

/**
 * Universal search field with grouped type-ahead (WAI-ARIA 1.2 combobox + listbox).
 * Works without JavaScript: it is a plain GET form to /search.
 */
import { Clock, CornerDownLeft, LoaderCircle, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { addRecentSearch, getRecentSearches, getRecentViews } from "./recent-store";

interface SuggestItem {
  title: string;
  subtitle: string | null;
  href: string;
  badge: string | null;
  isActive: boolean;
  matchLabel: string;
}

interface SuggestGroup {
  kind: string;
  label: string;
  items: SuggestItem[];
}

interface Option extends SuggestItem {
  id: string;
  group: string;
}

const DEBOUNCE_MS = 150;

export function SearchCombobox({
  defaultValue = "",
  size = "compact",
  autoFocus = false,
  globalShortcut = false,
  label = "Search drugs, HCPCS codes, NDCs, or manufacturers",
}: {
  defaultValue?: string;
  size?: "hero" | "compact";
  autoFocus?: boolean;
  globalShortcut?: boolean;
  label?: string;
}) {
  const router = useRouter();
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [value, setValue] = useState(defaultValue);
  const [groups, setGroups] = useState<SuggestGroup[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState("");
  const [recentGroups, setRecentGroups] = useState<SuggestGroup[]>([]);

  const showingRecent = value.trim().length === 0;
  const visibleGroups = showingRecent ? recentGroups : groups;

  const options: Option[] = useMemo(
    () =>
      visibleGroups.flatMap((g, gi) =>
        g.items.map((item, ii) => ({ ...item, group: g.label, id: `${baseId}-opt-${gi}-${ii}` })),
      ),
    [visibleGroups, baseId],
  );

  const loadRecent = useCallback(() => {
    const searches = getRecentSearches();
    const views = getRecentViews();
    const out: SuggestGroup[] = [];
    if (searches.length)
      out.push({
        kind: "recent-search",
        label: "Recent searches",
        items: searches.slice(0, 5).map((q) => ({ title: q, subtitle: null, href: `/search?q=${encodeURIComponent(q)}`, badge: null, isActive: true, matchLabel: "Recent search" })),
      });
    if (views.length)
      out.push({
        kind: "recent-view",
        label: "Recently viewed",
        items: views.slice(0, 5).map((v) => ({ title: v.title, subtitle: v.subtitle ?? null, href: v.href, badge: null, isActive: true, matchLabel: "Recently viewed" })),
      });
    setRecentGroups(out);
  }, []);

  // Debounced fetch of suggestions.
  useEffect(() => {
    const q = value.trim();
    if (!q) {
      // Nothing to fetch; stale suggestions are hidden because the empty field shows recent items.
      abortRef.current?.abort();
      return;
    }
    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`, { signal: controller.signal, headers: { Accept: "application/json" } });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message ?? "Search failed");
        setGroups(json.data.groups as SuggestGroup[]);
        setNotices((json.data.notices as string[]) ?? []);
        setActive(-1);
        const n = (json.data.groups as SuggestGroup[]).reduce((sum, g) => sum + g.items.length, 0);
        setStatus(n ? `${n} suggestion${n === 1 ? "" : "s"} available. Use the up and down arrow keys to review.` : "No suggestions. Press Enter to search all records.");
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setGroups([]);
        setNotices([]);
        setStatus("Suggestions are unavailable right now. Press Enter to search.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [value]);

  // "/" focuses the search field from anywhere on the page.
  useEffect(() => {
    if (!globalShortcut) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [globalShortcut]);

  const go = (href: string, query?: string) => {
    if (query) addRecentSearch(query);
    setOpen(false);
    router.push(href);
  };

  const submit = (q: string) => {
    const query = q.trim();
    if (!query) return;
    addRecentSearch(query);
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(query)}`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) setOpen(true);
        if (options.length) setActive((i) => (i + 1) % options.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) setOpen(true);
        if (options.length) setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
        break;
      case "Enter":
        if (open && active >= 0 && options[active]) {
          e.preventDefault();
          go(options[active].href, showingRecent ? undefined : value);
        }
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          setOpen(false);
          setActive(-1);
        } else if (value) {
          e.preventDefault();
          setValue("");
        }
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  const hero = size === "hero";
  const busy = loading && !showingRecent;
  const expanded = open && (options.length > 0 || (!showingRecent && (notices.length > 0 || (!busy && value.trim().length > 0))));
  const activeId = active >= 0 && options[active] ? options[active].id : undefined;

  let flatIndex = -1;

  return (
    <form
      role="search"
      action="/search"
      method="get"
      onSubmit={(e) => {
        e.preventDefault();
        if (active >= 0 && options[active]) go(options[active].href, showingRecent ? undefined : value);
        else submit(value);
      }}
      className="relative w-full"
    >
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <div
        className={`group flex items-center gap-2 rounded-xl border bg-surface-raised transition-shadow focus-within:border-brand focus-within:shadow-[0_0_0_4px_var(--brand-glow)] ${
          hero ? "min-h-16 border-rule-strong px-4 shadow-card sm:min-h-[4.25rem] sm:px-5" : "min-h-12 border-rule-strong px-3"
        }`}
      >
        <Search aria-hidden="true" className={`shrink-0 text-ink-faint ${hero ? "h-6 w-6" : "h-5 w-5"}`} />
        <input
          ref={inputRef}
          id={inputId}
          name="q"
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded ? activeId : undefined}
          aria-describedby={`${baseId}-hint`}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={100}
          autoFocus={autoFocus}
          placeholder={hero ? "Try “Keytruda”, “J9312”, or “0006-3026-02”" : "Search drugs, codes, NDCs…"}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => {
            loadRecent();
            setOpen(true);
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          className={`min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-faint focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden ${
            hero ? "py-4 text-lg sm:text-xl" : "py-2.5 text-base"
          }`}
        />
        {busy ? <LoaderCircle aria-hidden="true" className="h-5 w-5 shrink-0 animate-spin text-ink-faint" /> : null}
        {value ? (
          <button
            type="button"
            onClick={() => {
              setValue("");
              inputRef.current?.focus();
            }}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-paper-sunken hover:text-ink"
            aria-label="Clear search"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="submit"
          className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-brand font-semibold text-paper transition-colors hover:bg-brand-strong dark:text-paper-sunken ${
            hero ? "h-11 px-4 sm:h-12 sm:px-5" : "h-9 px-3 text-sm"
          }`}
        >
          <span className={hero ? "" : "sr-only sm:not-sr-only"}>Search</span>
          <CornerDownLeft aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      <p id={`${baseId}-hint`} className="sr-only">
        Type at least one character to see suggestions. Use arrow keys to move through suggestions and Enter to open one, or press Enter to see all results.
      </p>
      <div aria-live="polite" role="status" className="sr-only">
        {status}
      </div>

      <div
        id={listId}
        role="listbox"
        aria-label="Search suggestions"
        hidden={!expanded}
        className="absolute inset-x-0 top-full z-40 mt-2 max-h-[min(70vh,34rem)] overflow-y-auto rounded-xl border border-rule-strong bg-surface-raised p-2 text-left shadow-card"
      >
        {!showingRecent && notices.length > 0 ? (
          <div role="presentation" className="mb-1 rounded-lg bg-accent-tint/60 px-3 py-2 text-xs text-ink-muted">
            {notices[0]}
          </div>
        ) : null}
        {visibleGroups.map((g, gi) => (
          <div key={g.kind} role="group" aria-labelledby={`${baseId}-grp-${gi}`} className="py-1">
            <div id={`${baseId}-grp-${gi}`} role="presentation" className="flex items-center gap-2 px-3 pt-1 pb-1.5 text-[0.7rem] font-semibold tracking-wider text-ink-faint uppercase">
              {g.kind.startsWith("recent") ? <Clock aria-hidden="true" className="h-3 w-3" /> : null}
              {g.label}
            </div>
            {g.items.map((item) => {
              flatIndex++;
              const idx = flatIndex;
              const opt = options[idx];
              const isActive = idx === active;
              return (
                <div
                  key={opt.id}
                  id={opt.id}
                  role="option"
                  aria-selected={isActive}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(item.href, showingRecent ? undefined : value)}
                  onMouseEnter={() => setActive(idx)}
                  className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ${isActive ? "bg-brand-tint ring-2 ring-brand ring-inset" : "hover:bg-paper-sunken"}`}
                >
                  {item.badge ? <span className="code-chip w-14 shrink-0 text-sm font-semibold text-brand">{item.badge}</span> : null}
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate font-semibold text-ink ${g.kind === "hcpcs" || g.kind === "ndc" ? "code-chip" : ""}`}>{item.title}</span>
                    {item.subtitle ? <span className="block truncate text-xs text-ink-muted">{item.subtitle}</span> : null}
                  </span>
                  {!item.isActive ? <span className="shrink-0 rounded-full bg-paper-sunken px-2 py-0.5 text-[0.68rem] font-semibold text-ink-muted">Historical</span> : null}
                </div>
              );
            })}
          </div>
        ))}
        {!showingRecent && !busy && options.length === 0 && value.trim() ? (
          <div role="presentation" className="px-3 py-3 text-sm text-ink-muted">
            No quick matches. Press <kbd className="code-chip rounded border hairline px-1">Enter</kbd> to search all records.
          </div>
        ) : null}
      </div>
    </form>
  );
}
