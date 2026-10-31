"use client";

/**
 * Command palette (Ctrl+K / ⌘K): jump to any drug, code, NDC, or tool from anywhere.
 * A native modal <dialog> (focus trap and Escape built in) with a WAI-ARIA combobox
 * and listbox inside. Suggestions come from the same /api/suggest endpoint as search.
 */
import { ArrowRight, Calculator, ClipboardCheck, Command, CornerDownLeft, Database, FileSearch, GitCompareArrows, History, Hospital, LoaderCircle, Moon, Scale, ScanLine, Search, Sun, Wrench } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { normalizeHcpcs } from "@/lib/hcpcs";
import { formatNdc11, parseNdc } from "@/lib/ndc";
import { getRecentViews } from "./recent-store";

export const OPEN_PALETTE_EVENT = "coderx:open-palette";

interface Item {
  id: string;
  group: string;
  title: string;
  subtitle?: string | null;
  icon: ReactNode;
  /** Navigate to this URL, or run `run`. */
  href?: string;
  run?: () => void;
  keywords?: string;
}

interface SuggestGroup {
  label: string;
  items: { title: string; subtitle: string | null; href: string; matchLabel: string }[];
}

const icon = (C: typeof Search) => <C aria-hidden="true" className="h-4 w-4" />;

const NAV_ITEMS: Omit<Item, "id" | "group">[] = [
  { title: "Billing-unit calculator", subtitle: "Units, MUE check, JW/JZ claim lines, vial optimizer", href: "/calculator", icon: icon(Calculator), keywords: "units dose vial jw jz mue claim" },
  { title: "Vial barcode scanner", subtitle: "Scan a vial or carton: NDC, code, units, lot, expiry", href: "/tools/scan", icon: icon(ScanLine), keywords: "scan barcode camera vial gs1 datamatrix lot expiry" },
  { title: "Chargemaster & formulary audit", subtitle: "Check a list of codes and NDCs", href: "/tools/audit", icon: icon(ClipboardCheck), keywords: "cdm audit crosswalk ndc list" },
  { title: "Margin analyzer", subtitle: "Your cost vs. Medicare payment", href: "/tools/margin", icon: icon(Scale), keywords: "cost margin underwater asp" },
  { title: "Site of care: HOPD vs home", subtitle: "Where a therapy is paid more, by payer", href: "/tools/site-of-care", icon: icon(Hospital), keywords: "site of care hopd hospital outpatient home infusion opps apc eapg apple health commercial" },
  { title: "Biosimilar comparator", subtitle: "Reference products and biosimilars", href: "/tools/biosimilars", icon: icon(GitCompareArrows), keywords: "biosimilar reference purple book" },
  { title: "What changed this quarter", subtitle: "Payment-limit movers, new and terminated codes", href: "/tools/changes", icon: icon(History), keywords: "changes quarter new terminated watchlist rss feed" },
  { title: "All tools", href: "/tools", icon: icon(Wrench), keywords: "tools" },
  { title: "Search all records", href: "/search", icon: icon(FileSearch), keywords: "search" },
  { title: "Data sources & releases", href: "/sources", icon: icon(Database), keywords: "sources cms fda releases" },
];

const isMac = () => /Mac|iPhone|iPad/.test(navigator.userAgent);
const noop = () => () => {};

/** "⌘K" on Apple devices, "Ctrl K" elsewhere (server render uses the generic form). */
export function useShortcutLabel() {
  return useSyncExternalStore(noop, () => (isMac() ? "⌘K" : "Ctrl K"), () => "Ctrl K");
}

export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}

export function CommandPalette() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [query, setQuery] = useState("");
  const [suggest, setSuggest] = useState<SuggestGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<Item[]>([]);
  // The list renders only while open: nothing theme- or storage-dependent is server-rendered.
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => {
    const d = dialogRef.current;
    if (!d || d.open) return;
    setRecent(
      getRecentViews()
        .slice(0, 4)
        .map((v, i) => ({ id: `recent-${i}`, group: "Recently viewed", title: v.title, subtitle: v.subtitle, href: v.href, icon: icon(History) })),
    );
    setIsOpen(true);
    d.showModal();
    inputRef.current?.focus();
  }, []);

  const close = useCallback(() => dialogRef.current?.close(), []);

  // Global shortcut and the header button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (dialogRef.current?.open) close();
        else open();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, open);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, open);
    };
  }, [open, close]);

  // Debounced suggestions.
  useEffect(() => {
    const q = query.trim();
    abortRef.current?.abort();
    if (!q) return;
    const timer = window.setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`, { signal: controller.signal, headers: { Accept: "application/json" } });
        const json = await res.json();
        setSuggest(res.ok ? (json.data.groups as SuggestGroup[]) : []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setSuggest([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 140);
    return () => window.clearTimeout(timer);
  }, [query]);

  const items: Item[] = useMemo(() => {
    const q = query.trim();
    const lower = q.toLowerCase();
    const out: Item[] = [];
    const nav = NAV_ITEMS.map((n, i) => ({ ...n, id: `nav-${i}`, group: "Go to" }));
    const themeItem: Item = {
      id: "theme",
      group: "Preferences",
      title: resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme",
      icon: resolvedTheme === "dark" ? icon(Sun) : icon(Moon),
      run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
      keywords: "theme dark light mode",
    };
    if (!q) return [...recent, ...nav, themeItem];

    const code = normalizeHcpcs(q);
    if (code) {
      out.push({ id: "code-open", group: "Actions", title: `Open ${code}`, subtitle: "HCPCS code page", href: `/hcpcs/${code}`, icon: icon(ArrowRight) });
      out.push({ id: "code-calc", group: "Actions", title: `Calculate units for ${code}`, subtitle: "Billing-unit calculator", href: `/calculator?code=${code}`, icon: icon(Calculator) });
    }
    const ndc = parseNdc(q);
    if (ndc.kind === "package") out.push({ id: "ndc-open", group: "Actions", title: `Open NDC ${formatNdc11(ndc.ndc11)}`, subtitle: "NDC package page", href: `/ndc/${formatNdc11(ndc.ndc11)}`, icon: icon(ArrowRight) });
    const words = lower.split(/\s+/).filter(Boolean);
    for (const n of [...nav, themeItem]) {
      const hay = `${n.title} ${n.subtitle ?? ""} ${n.keywords ?? ""}`.toLowerCase();
      if (words.every((w) => hay.includes(w))) out.push({ ...n, group: n.group === "Preferences" ? "Preferences" : "Tools & pages" });
    }
    suggest.forEach((g, gi) =>
      g.items.slice(0, 5).forEach((s, si) => out.push({ id: `s-${gi}-${si}`, group: g.label, title: s.title, subtitle: [s.subtitle, s.matchLabel].filter(Boolean).join(" · "), href: s.href, icon: icon(Search) })),
    );
    out.push({ id: "search-all", group: "Search", title: `Search all records for “${q}”`, href: `/search?q=${encodeURIComponent(q)}`, icon: icon(FileSearch) });
    return out;
  }, [query, suggest, recent, resolvedTheme, setTheme]);

  const safeActive = items.length ? Math.min(active, items.length - 1) : -1;

  const choose = (item: Item | undefined) => {
    if (!item) return;
    close();
    if (item.run) item.run();
    else if (item.href) router.push(item.href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (items.length ? (Math.min(i, items.length - 1) + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (items.length ? (Math.min(i, items.length - 1) - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(items[safeActive]);
    }
  };

  // Keep the active option scrolled into view.
  useEffect(() => {
    document.getElementById(`${id}-opt-${safeActive}`)?.scrollIntoView({ block: "nearest" });
  }, [safeActive, id]);

  let lastGroup = "";
  return (
    <dialog
      ref={dialogRef}
      aria-label="Command palette"
      onClose={() => {
        setIsOpen(false);
        setQuery("");
        setSuggest([]);
        setActive(0);
      }}
      onClick={(e) => {
        // Clicking the backdrop (the dialog element itself) closes it.
        if (e.target === dialogRef.current) close();
      }}
      className="fixed inset-x-0 top-[12vh] mx-auto w-[calc(100%-2rem)] max-w-xl overflow-hidden rounded-xl border hairline bg-surface-raised p-0 text-ink shadow-card backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex items-center gap-3 border-b hairline px-4">
        {loading ? <LoaderCircle aria-hidden="true" className="h-5 w-5 shrink-0 animate-spin text-ink-faint" /> : <Search aria-hidden="true" className="h-5 w-5 shrink-0 text-ink-faint" />}
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={safeActive >= 0 ? `${id}-opt-${safeActive}` : undefined}
          aria-autocomplete="list"
          aria-label="Search or jump to"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search a drug, code, or NDC — or jump to a tool"
          autoComplete="off"
          spellCheck={false}
          className="h-14 min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-faint focus-visible:outline-none"
        />
        <kbd className="hidden rounded border border-rule-strong px-1.5 py-0.5 font-mono text-[0.7rem] text-ink-faint sm:inline">esc</kbd>
      </div>
      <ul id={`${id}-list`} role="listbox" aria-label="Results" className="max-h-[min(60vh,26rem)] overflow-y-auto p-2">
        {(isOpen ? items : []).map((item, i) => {
          const header = item.group !== lastGroup ? item.group : null;
          lastGroup = item.group;
          const selected = i === safeActive;
          return (
            <li key={item.id} role="presentation">
              {header ? (
                <p role="presentation" className="px-2 pt-2 pb-1 text-[0.7rem] font-semibold tracking-wider text-ink-faint uppercase">
                  {header}
                </p>
              ) : null}
              <div
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={selected}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(item)}
                className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 ${selected ? "bg-brand-tint text-ink" : "text-ink"}`}
              >
                <span className={selected ? "text-brand" : "text-ink-faint"}>{item.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{item.title}</span>
                  {item.subtitle ? <span className="block truncate text-xs text-ink-muted">{item.subtitle}</span> : null}
                </span>
                {selected ? <CornerDownLeft aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-faint" /> : null}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-4 border-t hairline px-4 py-2 text-xs text-ink-faint">
        <span>
          <kbd className="font-mono">↑↓</kbd> move
        </span>
        <span>
          <kbd className="font-mono">↵</kbd> open
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          <Command aria-hidden="true" className="h-3 w-3" /> CodeRx
        </span>
      </div>
    </dialog>
  );
}

/** Header button that opens the palette; doubles as the search entry point on phones. */
export function CommandPaletteButton() {
  const label = useShortcutLabel();
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      aria-label={`Open command palette (${label})`}
      aria-keyshortcuts="Control+K Meta+K"
      className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-2.5 text-ink-muted transition-colors hover:bg-surface hover:text-ink md:hidden xl:inline-flex"
    >
      <Search aria-hidden="true" className="h-5 w-5 xl:hidden" />
      <kbd className="hidden rounded border border-rule-strong px-1.5 py-0.5 font-mono text-[0.7rem] xl:inline">{label}</kbd>
    </button>
  );
}
