import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, Disclaimer, NoData, PageHeader, Section, TableScroll, td, th } from "@/components/layout-bits";
import { ProvenanceFooter } from "@/components/provenance";
import { Watchlist, type WatchEvent } from "@/components/tools/watchlist";
import { cachedQuarterlyChanges } from "@/lib/data/cached";
import type { LimitChange } from "@/lib/data/tools";
import { formatDate, formatMoney, formatPeriod } from "@/lib/format";

export const metadata: Metadata = {
  title: "What changed this quarter",
  description: "Quarter-over-quarter changes in Medicare Part B drug payment limits, new and terminated drug HCPCS codes, and CMS NDC–HCPCS crosswalk additions and removals.",
  alternates: { canonical: "/tools/changes" },
};

type SP = Promise<Record<string, string | string[] | undefined>>;

const pct = (n: number) => `${n > 0 ? "+" : ""}${n}%`;

function LimitTable({ rows, caption }: { rows: LimitChange[]; caption: string }) {
  if (!rows.length) return <NoData>No changes in this direction.</NoData>;
  return (
    <TableScroll label={caption}>
      <table className="w-full min-w-[40rem] border-collapse">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {["HCPCS", "Description", "Previous", "Now", "Change"].map((h) => (
              <th key={h} scope="col" className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.code}>
              <td className={td}>
                <Link href={`/hcpcs/${c.code}`} className="code-chip font-semibold whitespace-nowrap text-brand hover:underline">
                  {c.code}
                </Link>
              </td>
              <td className={`${td} text-ink-muted`}>
                {c.shortDescription ?? "—"}
                {c.dosage ? <span className="block text-xs">per {c.dosage}</span> : null}
              </td>
              <td className={`${td} code-chip`}>{formatMoney(c.before)}</td>
              <td className={`${td} code-chip`}>{formatMoney(c.after)}</td>
              <td className={`${td} code-chip font-semibold ${c.changePct > 0 ? "text-ok" : "text-danger"}`}>{pct(c.changePct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

function CodeList({ items, empty, date }: { items: { code: string; longDescription: string | null; date: string | null }[]; empty: string; date: string }) {
  if (!items.length) return <NoData>{empty}</NoData>;
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {items.map((c) => (
        <li key={c.code} className="rounded-lg border hairline bg-surface p-3 text-sm">
          <Link href={`/hcpcs/${c.code}`} className="code-chip font-semibold text-brand hover:underline">
            {c.code}
          </Link>{" "}
          <span className="text-ink">{c.longDescription}</span>
          {c.date ? (
            <span className="block text-xs text-ink-muted">
              {date} {formatDate(c.date)}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export default async function ChangesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const requested = typeof sp.period === "string" && /^\d{4}-Q[1-4]$/.test(sp.period) ? sp.period : null;
  const d = await cachedQuarterlyChanges(requested);
  if (!d.period) {
    return (
      <>
        <PageHeader title="What changed this quarter" />
        <NoData />
      </>
    );
  }
  const drugChanges = d.limitChanges.filter((c) => c.isDrug);
  const increases = drugChanges.filter((c) => c.changePct > 0).slice(0, 25);
  const decreases = drugChanges.filter((c) => c.changePct < 0).slice(0, 25);
  const xwByCode = new Map<string, { added: number; removed: number }>();
  for (const x of d.crosswalk.added) if (x.hcpcsCode) xwByCode.set(x.hcpcsCode, { added: (xwByCode.get(x.hcpcsCode)?.added ?? 0) + 1, removed: xwByCode.get(x.hcpcsCode)?.removed ?? 0 });
  for (const x of d.crosswalk.removed) if (x.hcpcsCode) xwByCode.set(x.hcpcsCode, { added: xwByCode.get(x.hcpcsCode)?.added ?? 0, removed: (xwByCode.get(x.hcpcsCode)?.removed ?? 0) + 1 });

  const events: WatchEvent[] = [
    ...d.limitChanges.map((c) => ({ code: c.code, text: `Payment limit ${formatMoney(c.before)} → ${formatMoney(c.after)} (${pct(c.changePct)})` })),
    ...d.added.map((c) => ({ code: c.code, text: "Added to the payment limit file" })),
    ...d.removed.map((c) => ({ code: c.code, text: "No longer in the payment limit file" })),
    ...d.newCodes.map((c) => ({ code: c.code, text: "New HCPCS code this quarter" })),
    ...d.terminatedCodes.map((c) => ({ code: c.code, text: `Terminated (${formatDate(c.terminationDate)})` })),
    ...[...xwByCode].map(([code, n]) => ({ code, text: `CMS crosswalk: ${n.added} NDC(s) added, ${n.removed} removed` })),
  ];

  return (
    <>
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ href: "/tools", label: "Tools" }, { label: "What changed this quarter" }]} />}
        title={`What changed in ${formatPeriod(d.period)}`}
        subtitle={d.previous ? `Compared with ${formatPeriod(d.previous)}, using the current CMS release of each quarter (including CMS revisions).` : "No earlier quarter is imported to compare with."}
      />
      <form action="/tools/changes" method="get" className="mb-8 flex flex-wrap items-end gap-2" aria-label="Choose a quarter">
        <label className="text-sm font-semibold text-ink">
          Quarter
          <select name="period" defaultValue={d.period} className="mt-1 block min-h-11 rounded-lg border border-rule-strong bg-surface-raised px-3 text-sm text-ink">
            {d.periods.map((p) => (
              <option key={p} value={p}>
                {formatPeriod(p)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="inline-flex min-h-11 items-center rounded-lg border border-rule-strong bg-surface px-4 font-semibold text-ink hover:border-brand">
          Show
        </button>
      </form>

      <dl className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Drug payment limits changed", drugChanges.length],
          ["New drug codes", d.newCodes.length],
          ["Terminated drug codes", d.terminatedCodes.length],
          ["Crosswalk NDC changes", d.crosswalk.added.length + d.crosswalk.removed.length],
        ].map(([label, n]) => (
          <div key={label} className="rounded-xl border hairline bg-surface p-4">
            <dt className="text-xs font-semibold tracking-wide text-ink-faint uppercase">{label}</dt>
            <dd className="mt-1 font-display text-3xl font-semibold text-ink num">{Number(n).toLocaleString()}</dd>
          </div>
        ))}
      </dl>

      <div className="mb-10">
        <Watchlist events={events} limitChanges={drugChanges} period={d.period} />
      </div>

      <Section id="increases" number="01" title="Largest payment-limit increases" description="Drug codes whose Part B payment limit per billing unit rose the most from the previous quarter (top 25 by percent).">
        <LimitTable rows={increases} caption={`Largest increases, ${formatPeriod(d.period)}`} />
      </Section>
      <Section id="decreases" number="02" title="Largest payment-limit decreases" description="Drug codes whose payment limit fell the most (top 25 by percent). Large drops often follow new competition, such as biosimilar or generic entry.">
        <LimitTable rows={decreases} caption={`Largest decreases, ${formatPeriod(d.period)}`} />
      </Section>
      <Section id="new-codes" number="03" title="New drug codes" description="Drug-related HCPCS codes first appearing in this quarter’s CMS file. A new permanent code often replaces billing under an unclassified code (such as J3490, J9999, or C9399) — review claims you billed that way.">
        <CodeList items={d.newCodes.map((c) => ({ code: c.code, longDescription: c.longDescription, date: c.addedDate }))} empty="No new drug codes this quarter." date="Added" />
      </Section>
      <Section id="terminated" number="04" title="Terminated drug codes" description="Drug-related codes with a termination date recorded this quarter. Check the CMS cross-reference on each code page.">
        <CodeList items={d.terminatedCodes.map((c) => ({ code: c.code, longDescription: c.longDescription, date: c.terminationDate }))} empty="No drug codes were terminated this quarter." date="Terminated" />
      </Section>
      <Section id="payment-file" number="05" title="Payment limit file membership" description="Codes added to or removed from the CMS Part B payment limit file compared with the previous quarter.">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Added ({d.added.length})</h3>
            <CodeList items={d.added.map((c) => ({ code: c.code, longDescription: c.shortDescription, date: null }))} empty="None." date="" />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Removed ({d.removed.length})</h3>
            <CodeList items={d.removed.map((c) => ({ code: c.code, longDescription: c.shortDescription, date: null }))} empty="None." date="" />
          </div>
        </div>
      </Section>
      <Section
        id="crosswalk"
        number="06"
        title="NDC–HCPCS crosswalk changes"
        description={d.crosswalk.previous ? `NDC-to-code pairs added to or removed from the CMS ASP crosswalk between ${formatPeriod(d.crosswalk.previous)} and ${formatPeriod(d.crosswalk.period)}.` : "Only one crosswalk quarter is available for this period."}
      >
        {d.crosswalk.previous ? (
          <TableScroll label="Crosswalk changes by code">
            <table className="w-full min-w-[32rem] border-collapse">
              <caption className="sr-only">Crosswalk changes by HCPCS code</caption>
              <thead>
                <tr>
                  {["HCPCS", "NDCs added", "NDCs removed", "Examples"].map((h) => (
                    <th key={h} scope="col" className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...xwByCode]
                  .sort((a, b) => b[1].added + b[1].removed - (a[1].added + a[1].removed) || a[0].localeCompare(b[0]))
                  .slice(0, 40)
                  .map(([code, n]) => {
                    const examples = [...d.crosswalk.added.filter((x) => x.hcpcsCode === code).map((x) => `+ ${x.formatted}`), ...d.crosswalk.removed.filter((x) => x.hcpcsCode === code).map((x) => `− ${x.formatted}`)].slice(0, 3);
                    return (
                      <tr key={code}>
                        <td className={td}>
                          <Link href={`/hcpcs/${code}`} className="code-chip font-semibold text-brand hover:underline">
                            {code}
                          </Link>
                        </td>
                        <td className={`${td} code-chip text-ok`}>{n.added}</td>
                        <td className={`${td} code-chip text-danger`}>{n.removed}</td>
                        <td className={`${td} code-chip text-xs text-ink-muted`}>{examples.join(" · ")}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </TableScroll>
        ) : (
          <NoData />
        )}
      </Section>
      <ProvenanceFooter sources={d.provenance} />
      <div className="mt-10">
        <Disclaimer />
      </div>
    </>
  );
}
