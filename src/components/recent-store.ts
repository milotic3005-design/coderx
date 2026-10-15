"use client";

/**
 * Recent searches and recently viewed pages, stored only in this browser
 * (localStorage). Nothing is sent to the server. Users can clear them at any time.
 */
const SEARCH_KEY = "coderx:recent-searches";
const VIEW_KEY = "coderx:recent-views";
const MAX = 8;

export interface RecentView {
  href: string;
  title: string;
  kind: "drug" | "hcpcs" | "ndc" | "manufacturer";
  subtitle?: string;
  at: number;
}

function read<T>(key: string): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, value: T[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event("coderx:recent"));
  } catch {
    // Storage disabled (private mode, quota) — recent items are a convenience only.
  }
}

export function getRecentSearches(): string[] {
  return read<string>(SEARCH_KEY).filter((s) => typeof s === "string" && s.length <= 100);
}

export function addRecentSearch(query: string) {
  const q = query.trim();
  if (!q || q.length > 100) return;
  write(SEARCH_KEY, [q, ...getRecentSearches().filter((s) => s.toLowerCase() !== q.toLowerCase())].slice(0, MAX));
}

export function getRecentViews(): RecentView[] {
  return read<RecentView>(VIEW_KEY).filter((v) => v && typeof v.href === "string" && v.href.startsWith("/"));
}

export function addRecentView(view: Omit<RecentView, "at">) {
  write(VIEW_KEY, [{ ...view, at: Date.now() }, ...getRecentViews().filter((v) => v.href !== view.href)].slice(0, MAX));
}

export function clearRecent() {
  write(SEARCH_KEY, []);
  write(VIEW_KEY, []);
}
