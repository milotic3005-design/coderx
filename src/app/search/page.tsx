import { SlidersHorizontal } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Callout, Disclaimer, EmptyState } from "@/components/layout-bits";
import { ResultCard } from "@/components/result-card";
import { SearchCombobox } from "@/components/search-combobox";
import { searchParamsSchema, toSearchOptions } from "@/lib/api/validation";
import { CODE_FAMILIES } from "@/lib/hcpcs";
import { search, type SearchResult } from "@/lib/search/engine";
import { QUERY_TYPE_LABELS } from "@/lib/search/parse";
import { titleCase } from "@/lib/format";

type SP = Promise<Record<string, string | string[] | undefined>>;

function flat(sp: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    const val = Array.isArray(v) ? v.join(",") : v;
    if (val) out[k] = val;
  }
  return out;
}

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const q = flat(await searchParams).q?.slice(0, 100);
  return {
    title: q ? `Search: ${q}` : "Search",
    description: "Search drugs, HCPCS codes, NDCs, and manufacturers.",
    robots: { index: false, follow: true },
    alternates: { canonical: "/search" },
  };
}

function hrefWith(params: Record<string, string>, changes: Record<string, string | undefined>): string {
  const next = new URLSearchParams(params);
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined || v === "") next.delete(k);
    else next.set(k, v);
  }
  if (!("page" in changes)) next.delete("page");
  return `/search?${next.toString()}`;
}

const KIND_LABELS: Record<string, string> = { drug: "Drugs", hcpcs: "HCPCS codes", ndc: "NDC packages", manufacturer: "Manufacturers" };

function Filters({ params, result }: { params: Record<string, string>; result: SearchResult }) {
  const f = result.facets;
  const selectCls = "mt-1 block w-full min-h-11 rounded-lg border border-rule-strong bg-surface-raised px-3 text-sm text-ink";
  const kinds = (params.kind ?? "").split(",").filter(Boolean);
  const families = (params.family ?? "").toUpperCase().split(",").filter(Boolean);
  return (
    <form action="/search" method="get" className="space-y-5 text-sm" aria-label="Filter results">
      <input type="hidden" name="q" value={params.q ?? ""} />
      {params.sort ? <input type="hidden" name="sort" value={params.sort} /> : null}
      <fieldset>
        <legend className="text-xs font-semibold tracking-wider text-ink-faint uppercase">Record type</legend>
        <div className="mt-2 space-y-1">
          {(["drug", "hcpcs", "ndc", "manufacturer"] as const).map((k) => (
            <label key={k} className="flex min-h-9 items-center gap-2">
              <input type="checkbox" name="kind" value={k} defaultChecked={kinds.includes(k)} className="h-4 w-4 accent-[var(--brand)]" />
              <span className="text-ink">{KIND_LABELS[k]}</span>
              {f.kinds[k] ? <span className="ml-auto code-chip text-xs text-ink-faint">{f.kinds[k]}</span> : null}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-xs font-semibold tracking-wider text-ink-faint uppercase">Code family</legend>
        <div className="mt-2 grid grid-cols-2 gap-1">
          {["J", "Q", "C", "A", "P", "S"].map((letter) => (
            <label key={letter} className="flex min-h-9 items-center gap-2" title={CODE_FAMILIES[letter].name}>
              <input type="checkbox" name="family" value={letter} defaultChecked={families.includes(letter)} className="h-4 w-4 accent-[var(--brand)]" />
              <span className="code-chip text-ink">{letter}</span>
              {f.families[letter] ? <span className="code-chip text-xs text-ink-faint">{f.families[letter]}</span> : null}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-xs font-semibold tracking-wider text-ink-faint uppercase">Status</legend>
        <div className="mt-2 space-y-1">
          {[
            ["all", "All records"],
            ["active", `Active (${f.status.active})`],
            ["inactive", `Inactive / historical (${f.status.inactive})`],
          ].map(([v, l]) => (
            <label key={v} className="flex min-h-9 items-center gap-2">
              <input type="radio" name="status" value={v} defaultChecked={(params.status ?? "all") === v} className="h-4 w-4 accent-[var(--brand)]" />
              <span className="text-ink">{l}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="text-xs font-semibold tracking-wider text-ink-faint uppercase">Manufacturer</span>
        <select name="manufacturer" defaultValue={params.manufacturer ?? ""} className={selectCls}>
          <option value="">Any manufacturer</option>
          {f.manufacturers.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label} ({m.count})
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold tracking-wider text-ink-faint uppercase">Dosage form</span>
        <select name="form" defaultValue={params.form ?? ""} className={selectCls}>
          <option value="">Any form</option>
          {f.forms.map((m) => (
            <option key={m.value} value={m.value}>
              {titleCase(m.label)} ({m.count})
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold tracking-wider text-ink-faint uppercase">Route</span>
        <select name="route" defaultValue={params.route ?? ""} className={selectCls}>
          <option value="">Any route</option>
          {f.routes.map((m) => (
            <option key={m.value} value={m.value}>
              {titleCase(m.label)} ({m.count})
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold tracking-wider text-ink-faint uppercase">Brand or generic</span>
        <select name="brand" defaultValue={params.brand ?? ""} className={selectCls}>
          <option value="">Either</option>
          <option value="brand">Brand-named products</option>
          <option value="generic">Generic / unbranded names</option>
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold tracking-wider text-ink-faint uppercase">Biosimilar status</span>
        <select name="biosimilar" defaultValue={params.biosimilar ?? ""} className={selectCls}>
          <option value="">Any</option>
          <option value="any">Biosimilar or interchangeable</option>
          <option value="interchangeable">Interchangeable biosimilar</option>
          <option value="biosimilar">Biosimilar (not interchangeable)</option>
          <option value="reference">Reference product</option>
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold tracking-wider text-ink-faint uppercase">Reimbursement</span>
        <select name="payment" defaultValue={params.payment ?? ""} className={selectCls}>
          <option value="">Any</option>
          <option value="yes">Has a current Medicare payment limit ({f.payment})</option>
          <option value="no">No current payment limit</option>
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold tracking-wider text-ink-faint uppercase">Effective on date</span>
        <input type="date" name="effectiveOn" defaultValue={params.effectiveOn ?? ""} className={selectCls} />
        <span className="mt-1 block text-xs text-ink-faint">Codes added on or before, and not terminated before, this date.</span>
      </label>
      <div className="flex gap-2">
        <button type="submit" className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-brand px-4 font-semibold text-paper hover:bg-brand-strong dark:text-paper-sunken">
          Apply filters
        </button>
        <Link href={`/search?q=${encodeURIComponent(params.q ?? "")}`} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-rule-strong px-4 font-semibold text-ink hover:border-brand">
          Reset
        </Link>
      </div>
    </form>
  );
}

function Pagination({ params, result }: { params: Record<string, string>; result: SearchResult }) {
  if (result.totalPages <= 1) return null;
  const pages = new Set([1, result.page - 1, result.page, result.page + 1, result.totalPages].filter((p) => p >= 1 && p <= result.totalPages));
  const sorted = [...pages].sort((a, b) => a - b);
  return (
    <nav aria-label="Pagination" className="mt-8 flex flex-wrap items-center gap-1">
      {result.page > 1 ? (
        <Link href={hrefWith(params, { page: String(result.page - 1) })} className="inline-flex min-h-11 items-center rounded-lg border hairline px-3 text-sm font-semibold hover:border-brand" rel="prev">
          Previous
        </Link>
      ) : null}
      {sorted.map((p, i) => (
        <span key={p} className="flex items-center">
          {i > 0 && sorted[i - 1] !== p - 1 ? <span aria-hidden="true" className="px-1 text-ink-faint">…</span> : null}
          <Link
            href={hrefWith(params, { page: String(p) })}
            aria-current={p === result.page ? "page" : undefined}
            className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 text-sm font-semibold ${p === result.page ? "bg-brand text-paper dark:text-paper-sunken" : "border hairline hover:border-brand"}`}
          >
            <span className="sr-only">Page </span>
            {p}
          </Link>
        </span>
      ))}
      {result.page < result.totalPages ? (
        <Link href={hrefWith(params, { page: String(result.page + 1) })} className="inline-flex min-h-11 items-center rounded-lg border hairline px-3 text-sm font-semibold hover:border-brand" rel="next">
          Next
        </Link>
      ) : null}
    </nav>
  );
}

export default async function SearchPage({ searchParams }: { searchParams: SP }) {
  const params = flat(await searchParams);
  const q = (params.q ?? "").trim();

  if (!q) {
    return (
      <div className="mx-auto max-w-3xl py-12">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">Search CodeRx</h1>
        <p className="mt-2 text-ink-muted">Brand or generic names, HCPCS codes (J, Q, C, A, P, S), NDCs in any format, or manufacturers.</p>
        <div className="mt-6">
          <SearchCombobox size="hero" autoFocus />
        </div>
      </div>
    );
  }

  const parsed = searchParamsSchema.safeParse(params);
  if (!parsed.success) {
    return (
      <div className="mx-auto max-w-3xl py-12">
        <SearchCombobox defaultValue={q} size="hero" />
        <div className="mt-6">
          <Callout tone="warning" title="Some filters were not valid">
            <ul className="list-disc pl-5">
              {parsed.error.issues.map((i) => (
                <li key={i.path.join(".")}>
                  {i.path.join(".")}: {i.message}
                </li>
              ))}
            </ul>
            <p className="mt-2">
              <Link href={`/search?q=${encodeURIComponent(q.slice(0, 100))}`}>Search again without filters</Link>
            </p>
          </Callout>
        </div>
      </div>
    );
  }

  const result = await search(parsed.data.q, toSearchOptions(parsed.data));
  const filtersActive = ["kind", "family", "manufacturer", "form", "route", "brand", "biosimilar", "payment", "effectiveOn", "noc"].some((k) => params[k]) || (params.status && params.status !== "all");
  // Groups appear in the order of their best-ranked hit, so an exact code match leads the page.
  const groups = (["drug", "hcpcs", "ndc", "manufacturer"] as const)
    .filter((k) => result.hits.some((h) => h.kind === k))
    .sort((a, b) => result.hits.findIndex((h) => h.kind === a) - result.hits.findIndex((h) => h.kind === b));

  return (
    <div className="py-8">
      <div className="max-w-3xl">
        <SearchCombobox defaultValue={q} size="hero" key={q} />
      </div>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-b hairline pb-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            {result.total.toLocaleString()} result{result.total === 1 ? "" : "s"} for <span className="text-brand">“{result.query.display}”</span>
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Interpreted as: <span className="font-semibold text-ink">{QUERY_TYPE_LABELS[result.query.type]}</span>
            {result.query.hcpcsCode ? (
              <>
                {" "}
                · normalized to <span className="code-chip font-semibold text-ink">{result.query.hcpcsCode}</span>
              </>
            ) : null}
            {result.query.type === "ndc" && result.query.ndc11Candidates[0] ? (
              <>
                {" "}
                · 11-digit <span className="code-chip font-semibold text-ink">{result.query.ndc11Candidates[0]}</span>
              </>
            ) : null}
            {result.query.expansions.length ? <> · also searched “{result.query.expansions.map((e) => e.to).join("”, “")}”</> : null}
            <span className="text-ink-faint"> · {result.tookMs} ms</span>
          </p>
        </div>
        <form action="/search" method="get" className="flex items-center gap-2 text-sm">
          {Object.entries(params)
            .filter(([k]) => k !== "sort" && k !== "page")
            .map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          <label htmlFor="sort" className="font-semibold text-ink-muted">
            Sort
          </label>
          <select id="sort" name="sort" defaultValue={params.sort ?? "relevance"} className="min-h-11 rounded-lg border border-rule-strong bg-surface-raised px-3 text-ink">
            <option value="relevance">Relevance</option>
            <option value="name">Name A–Z</option>
            <option value="code">HCPCS code</option>
            <option value="newest">Newest</option>
          </select>
          <button type="submit" className="inline-flex min-h-11 items-center rounded-lg border border-rule-strong px-3 font-semibold text-ink hover:border-brand">
            Apply
          </button>
        </form>
      </div>

      {result.notices.length ? (
        <div className="mt-5 space-y-2">
          {result.notices.map((n) => (
            <Callout key={n} tone={result.ambiguous && n.includes("matches") ? "warning" : "info"}>
              {n}
            </Callout>
          ))}
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[17rem_1fr]">
        <aside aria-label="Filters" className="lg:sticky lg:top-24 lg:self-start">
          <details className="rounded-xl border hairline bg-surface p-4 lg:hidden" open={!!filtersActive}>
            <summary className="flex min-h-10 cursor-pointer items-center gap-2 font-semibold text-ink">
              <SlidersHorizontal aria-hidden="true" className="h-4 w-4" /> Filters{filtersActive ? " (active)" : ""}
            </summary>
            <div className="mt-4">
              <Filters params={params} result={result} />
            </div>
          </details>
          <div className="hidden rounded-xl border hairline bg-surface p-5 lg:block">
            <h2 className="mb-4 flex items-center gap-2 font-semibold text-ink">
              <SlidersHorizontal aria-hidden="true" className="h-4 w-4" /> Filters
            </h2>
            <Filters params={params} result={result} />
          </div>
        </aside>

        <div className="min-w-0">
          {result.hits.length === 0 ? (
            <EmptyState
              title="No matching records"
              action={
                <Link href="/search" className="inline-flex min-h-11 items-center rounded-lg border border-rule-strong px-4 text-sm font-semibold hover:border-brand">
                  Start a new search
                </Link>
              }
            >
              <ul className="list-disc space-y-1 pl-5 text-left">
                <li>Check the spelling, or try the generic name (for example “pembrolizumab” instead of a brand).</li>
                <li>HCPCS codes are one letter and four digits, like <span className="code-chip">J9271</span>.</li>
                <li>
                  NDCs can be entered as <span className="code-chip">0006-3026-02</span> or <span className="code-chip">00006302602</span>.
                </li>
                <li>CodeRx indexes clinician-administered products and every CMS-crosswalked NDC. For other NDCs use the FDA NDC Directory.</li>
                {filtersActive ? <li>Some filters are active — try resetting them.</li> : null}
              </ul>
            </EmptyState>
          ) : (
            <div className="space-y-8">
              {groups.map((kind) => (
                <section key={kind} aria-labelledby={`grp-${kind}`}>
                  <h2 id={`grp-${kind}`} className="mb-3 flex items-baseline gap-2 text-xs font-semibold tracking-wider text-ink-faint uppercase">
                    {KIND_LABELS[kind]}
                    <span className="code-chip normal-case">{result.hits.filter((h) => h.kind === kind).length} on this page</span>
                  </h2>
                  <ol className="space-y-3">
                    {result.hits
                      .filter((h) => h.kind === kind)
                      .map((hit) => (
                        <li key={`${hit.kind}-${hit.key}`}>
                          <ResultCard hit={hit} />
                        </li>
                      ))}
                  </ol>
                </section>
              ))}
              <Pagination params={params} result={result} />
            </div>
          )}
          <div className="mt-10">
            <Disclaimer compact />
          </div>
        </div>
      </div>
    </div>
  );
}
