import { ArrowRight, BookOpenCheck, Calculator, FileSearch, GitCompareArrows, History, Layers, Link2, ScanLine, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { headers } from "next/headers";
import { RecentlyViewed } from "@/components/client-bits";
import { DataStatusBadge, FamilyBadge } from "@/components/badges";
import { Disclaimer } from "@/components/layout-bits";
import { SearchCombobox } from "@/components/search-combobox";
import { cachedHomeData } from "@/lib/data/cached";
import { formatDate, formatDateTime, formatPeriod } from "@/lib/format";
import { SITE } from "@/lib/site";

const EXAMPLES = [
  { q: "Keytruda", note: "brand name" },
  { q: "rituximab", note: "generic + biosimilars" },
  { q: "J9312", note: "HCPCS code" },
  { q: "0006-3026-02", note: "10-digit NDC" },
  { q: "00006302602", note: "11-digit NDC" },
  { q: "infliximab biosimilar", note: "keywords" },
  { q: "IVIG", note: "abbreviation" },
  { q: "C9399", note: "NOC code" },
];

const STEPS = [
  { icon: FileSearch, title: "Search anything", body: "Brand or generic name, any HCPCS code, an NDC in any format, or a manufacturer. Suggestions are grouped and explain why they matched." },
  { icon: ScanLine, title: "Read the coding", body: "See the descriptor, billing unit, code family, effective and termination dates, NDC packages with billable units, and Medicare payment limits." },
  { icon: ShieldCheck, title: "Verify the source", body: "Every section names the CMS or FDA file it came from, its effective period, when it was published and imported, and links to the original." },
];

const FEATURES = [
  { icon: Link2, title: "Official NDC ↔ HCPCS links only", body: "Package-to-code relationships come from CMS crosswalk rows — never inferred from similar names or ingredients." },
  { icon: History, title: "Quarterly history since 2021", body: "Quarterly Part B payment limits, CMS revisions to posted quarters, and HCPCS code changes and terminations." },
  { icon: GitCompareArrows, title: "Biosimilars and references", body: "Biosimilar and interchangeable products linked to their reference biologic through FDA Purple Book license numbers." },
  { icon: Calculator, title: "Tools that show their work", body: "A unit calculator with the CMS MUE check, JW/JZ claim lines, and a vial optimizer — plus a chargemaster audit, margin analyzer, biosimilar comparator, and quarterly change report." },
  { icon: Layers, title: "Every code family", body: "J, Q, C, A, P, and S codes with billing context — including non-Medicare S-codes and the CMS NOC code list." },
  { icon: BookOpenCheck, title: "Honest about gaps", body: "When no authoritative public data exists for a field, CodeRx says so instead of filling it in." },
];

export default async function HomePage() {
  const data = await cachedHomeData();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE.name,
    url: SITE.url,
    description: SITE.description,
    potentialAction: { "@type": "SearchAction", target: `${SITE.url}/search?q={search_term_string}`, "query-input": "required name=search_term_string" },
  };

  return (
    <>
      <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />

      <section aria-labelledby="hero-title" className="ledger relative -mx-4 border-b hairline px-4 pt-14 pb-14 sm:-mx-6 sm:px-6 sm:pt-20 lg:-mx-8 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <p className="rise flex flex-wrap items-center gap-2 text-sm font-semibold text-brand">
            <span className="code-chip rounded-md bg-brand-tint px-2 py-0.5">{data.paymentPeriod ? formatPeriod(data.paymentPeriod) : "CMS & FDA"}</span>
            Public CMS &amp; FDA data, traced to the source file
          </p>
          <h1 id="hero-title" className="rise mt-5 font-display text-[2.6rem] leading-[1.02] font-semibold tracking-tight text-ink [animation-delay:60ms] sm:text-6xl lg:text-[4.4rem]">
            Find the code. Count the units. <span className="text-brand italic">Trace every number.</span>
          </h1>
          <p className="rise mt-5 max-w-2xl text-lg text-ink-muted [animation-delay:120ms] sm:text-xl">{SITE.tagline} HCPCS codes, NDC billing units, CMS crosswalks, and Medicare Part B payment limits for clinician-administered drugs.</p>
          <div className="rise relative z-20 mt-8 [animation-delay:180ms]">
            <SearchCombobox size="hero" globalShortcut />
            <p className="mt-3 hidden text-sm text-ink-faint sm:block">
              Press <kbd className="code-chip rounded border border-rule-strong bg-surface px-1.5 py-0.5 text-xs text-ink">/</kbd> to search from anywhere on this page.
            </p>
          </div>
          <div className="rise mt-7 [animation-delay:240ms]">
            <h2 className="text-xs font-semibold tracking-wider text-ink-faint uppercase">Try an example</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {EXAMPLES.map((e) => (
                <li key={e.q}>
                  <Link
                    href={`/search?q=${encodeURIComponent(e.q)}`}
                    className="group inline-flex min-h-10 items-center gap-2 rounded-full border border-rule-strong bg-surface/80 px-3.5 text-sm transition-colors hover:border-brand"
                  >
                    <span className="code-chip font-semibold text-ink group-hover:text-brand">{e.q}</span>
                    <span className="text-xs text-ink-faint">{e.note}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section aria-label="What is indexed" className="-mx-4 border-b hairline bg-surface/60 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <dl className="mx-auto grid max-w-7xl grid-cols-2 divide-rule py-6 sm:grid-cols-4 sm:divide-x">
          {[
            { label: "HCPCS Level II codes", value: data.counts.codes, note: `${data.counts.drug_codes.toLocaleString()} drug-related` },
            { label: "Drugs indexed", value: data.counts.drugs, note: "from the FDA NDC Directory" },
            { label: "NDC packages", value: data.counts.packages, note: "listed and CMS-crosswalked" },
            { label: "Part B payment limits", value: data.counts.paid, note: data.paymentPeriod ? `effective ${formatPeriod(data.paymentPeriod)}` : "" },
          ].map((s) => (
            <div key={s.label} className="px-2 py-3 sm:px-6">
              <dt className="text-xs font-semibold tracking-wide text-ink-faint uppercase">{s.label}</dt>
              <dd className="mt-1 font-display text-3xl font-semibold text-ink num">{s.value.toLocaleString()}</dd>
              <dd className="text-xs text-ink-muted">{s.note}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mx-auto mt-10 max-w-7xl">
        <RecentlyViewed />
      </div>

      <section aria-labelledby="steps-title" className="mx-auto mt-14 max-w-7xl">
        <h2 id="steps-title" className="font-display text-3xl font-semibold tracking-tight text-ink">How CodeRx works</h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative rounded-xl border hairline bg-surface p-6">
              <span aria-hidden="true" className="code-chip absolute top-5 right-5 text-sm text-ink-faint">
                0{i + 1}
              </span>
              <s.icon aria-hidden="true" className="h-6 w-6 text-brand" />
              <h3 className="mt-4 text-lg font-semibold text-ink">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <div className="mx-auto mt-14 grid max-w-7xl gap-10 lg:grid-cols-[1.25fr_1fr]">
        <section aria-labelledby="features-title">
          <h2 id="features-title" className="font-display text-3xl font-semibold tracking-tight text-ink">Built for people who submit the claim</h2>
          <p className="mt-2 max-w-2xl text-ink-muted">Pharmacists, infusion centers, coders, revenue-cycle and prior-authorization teams — anyone who needs the code, the unit, and the evidence.</p>
          <ul className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-3">
                <f.icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
                <div>
                  <h3 className="font-semibold text-ink">{f.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-muted">{f.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="new-title" className="rounded-xl border hairline bg-surface p-6">
          <h2 id="new-title" className="font-display text-2xl font-semibold tracking-tight text-ink">
            New drug codes {data.hcpcsPeriod ? <span className="text-brand">{formatPeriod(data.hcpcsPeriod)}</span> : null}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">Drug-related codes added in the latest CMS HCPCS quarterly file.</p>
          {data.newCodes.length ? (
            <ul className="mt-4 divide-y divide-rule">
              {data.newCodes.map((c) => (
                <li key={c.code}>
                  <Link href={`/hcpcs/${c.code}`} className="group flex min-h-12 items-start gap-3 py-2.5">
                    <span className="code-chip w-14 shrink-0 font-semibold text-brand group-hover:underline">{c.code}</span>
                    <span className="min-w-0 text-sm text-ink">
                      {c.longDescription}
                      <span className="block text-xs text-ink-faint">Added {formatDate(c.addedDate)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-ink-muted">No drug codes were added in the latest quarter, or the HCPCS file has not been imported yet.</p>
          )}
          <Link href="/codes/j" className="mt-4 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-brand hover:underline">
            Browse all J-codes <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </section>
      </div>

      <section aria-labelledby="sources-title" className="mx-auto mt-14 max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="sources-title" className="font-display text-3xl font-semibold tracking-tight text-ink">Where the data comes from</h2>
            <p className="mt-2 max-w-2xl text-ink-muted">Government publications only, imported on a schedule that matches each publisher. No AWP, WAC, or commercial payer rates.</p>
          </div>
          <Link href="/sources" className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-brand hover:underline">
            Every release and checksum <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.sources.map((s) => (
            <li key={s.sourceKey} className="flex flex-col rounded-xl border hairline bg-surface p-5">
              <div className="flex items-center justify-between gap-2">
                <DataStatusBadge status={s.status} />
                {s.period ? <span className="code-chip text-sm text-ink-muted">{formatPeriod(s.period)}</span> : null}
              </div>
              <h3 className="mt-3 font-semibold text-ink">{s.dataset}</h3>
              <p className="mt-1 text-xs text-ink-muted">
                {s.organization} · published {s.publicationLabel ?? formatDate(s.publicationDate)} · imported {formatDateTime(s.importedAt)}
              </p>
            </li>
          ))}
        </ul>
        {!data.sources.length ? <p className="mt-4 text-sm text-ink-muted">No data has been imported yet. See the README for ingestion instructions.</p> : null}
      </section>

      <section aria-labelledby="families-title" className="mx-auto mt-14 max-w-7xl">
        <h2 id="families-title" className="font-display text-2xl font-semibold tracking-tight text-ink">Jump to a code family</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {["J", "Q", "C", "A", "P", "S"].map((f) => (
            <li key={f}>
              <Link href={`/codes/${f.toLowerCase()}`} className="inline-flex min-h-11 items-center gap-2 rounded-lg border hairline bg-surface px-3 hover:border-brand">
                <FamilyBadge code={f} size="md" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="mx-auto mt-14 max-w-7xl">
        <Disclaimer />
      </div>
    </>
  );
}
