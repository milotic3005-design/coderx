import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActiveBadge, FamilyBadge, NocBadge } from "@/components/badges";
import { Breadcrumbs, Callout, PageHeader, TableScroll, td, th } from "@/components/layout-bits";
import { ProvenanceFooter } from "@/components/provenance";
import { cachedFamilyListing } from "@/lib/data/cached";
import { formatDate, formatMoney, formatPeriod } from "@/lib/format";
import { CODE_FAMILIES } from "@/lib/hcpcs";

type Params = Promise<{ family: string }>;
type SP = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const letter = (await params).family.toUpperCase();
  const f = CODE_FAMILIES[letter];
  if (!f) return { title: "Code family not found", robots: { index: false } };
  return { title: `${letter}-codes — ${f.name}`, description: f.context.slice(0, 280), alternates: { canonical: `/codes/${letter.toLowerCase()}` } };
}

const PAGE_SIZE = 100;

export default async function FamilyPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const letter = (await params).family.toUpperCase();
  if (!/^[A-Z]$/.test(letter) || !CODE_FAMILIES[letter]) notFound();
  const sp = await searchParams;
  const page = Math.max(1, Math.min(500, Number(typeof sp.page === "string" ? sp.page : 1) || 1));
  const status = sp.status === "active" || sp.status === "inactive" ? sp.status : "all";
  const drugOnly = sp.drug === "1";
  const data = await cachedFamilyListing(letter, page, PAGE_SIZE, status, drugOnly);
  if (!data) notFound();
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const qs = (p: number) => `/codes/${letter.toLowerCase()}?${new URLSearchParams({ ...(status !== "all" ? { status } : {}), ...(drugOnly ? { drug: "1" } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ href: "/codes", label: "Code families" }, { label: `${letter}-codes` }]} />}
        title={
          <span className="flex items-center gap-3">
            <FamilyBadge code={letter} size="md" /> {data.family.name}
          </span>
        }
        subtitle={`${data.total.toLocaleString()} codes${status !== "all" ? ` (${status})` : ""}${drugOnly ? ", drug-related only" : ""}`}
      />
      <div className="mb-6">
        <Callout tone={data.family.medicare === "non-medicare" ? "warning" : "info"} title="Billing context">
          {data.family.context}
        </Callout>
      </div>
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 text-sm" aria-label="Filter codes">
        <label>
          <span className="block font-semibold text-ink">Status</span>
          <select name="status" defaultValue={status} className="mt-1 min-h-11 rounded-lg border border-rule-strong bg-surface-raised px-3">
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Terminated</option>
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" name="drug" value="1" defaultChecked={drugOnly} className="h-4 w-4 accent-[var(--brand)]" /> Drug-related only
        </label>
        <button type="submit" className="min-h-11 rounded-lg border border-rule-strong bg-surface px-4 font-semibold hover:border-brand">
          Apply
        </button>
      </form>
      <TableScroll label={`${letter}-codes`}>
        <table className="w-full min-w-[48rem] border-collapse">
          <caption className="sr-only">
            {letter}-codes, page {page} of {totalPages}
          </caption>
          <thead>
            <tr>
              <th scope="col" className={th}>Code</th>
              <th scope="col" className={th}>Long descriptor</th>
              <th scope="col" className={`${th} text-right`}>Payment limit {data.paymentPeriod ? `(${formatPeriod(data.paymentPeriod)})` : ""}</th>
              <th scope="col" className={th}>Added</th>
              <th scope="col" className={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.code}>
                <th scope="row" className={`${td} text-left`}>
                  <Link href={`/hcpcs/${r.code}`} className="code-chip font-semibold text-brand hover:underline">
                    {r.code}
                  </Link>
                </th>
                <td className={`${td} min-w-[22rem] text-ink`}>
                  {r.longDescription}
                  {r.isNoc ? (
                    <span className="ml-2 align-middle">
                      <NocBadge />
                    </span>
                  ) : null}
                </td>
                <td className={`${td} code-chip text-right whitespace-nowrap`}>
                  {r.paymentLimit ? (
                    <>
                      {formatMoney(r.paymentLimit)}
                      <span className="block text-xs text-ink-faint">per {r.dosage}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className={`${td} whitespace-nowrap text-ink-muted`}>{formatDate(r.addedDate)}</td>
                <td className={td}>
                  <ActiveBadge active={r.isActive} inactiveLabel={`Ended ${formatDate(r.terminationDate)}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <nav aria-label="Pagination" className="mt-6 flex items-center justify-between text-sm">
        {page > 1 ? (
          <Link href={qs(page - 1)} rel="prev" className="inline-flex min-h-11 items-center rounded-lg border hairline px-4 font-semibold hover:border-brand">
            Previous
          </Link>
        ) : (
          <span />
        )}
        <span className="text-ink-muted">
          Page {page} of {totalPages}
        </span>
        {page < totalPages ? (
          <Link href={qs(page + 1)} rel="next" className="inline-flex min-h-11 items-center rounded-lg border hairline px-4 font-semibold hover:border-brand">
            Next
          </Link>
        ) : (
          <span />
        )}
      </nav>
      <ProvenanceFooter sources={data.provenance} />
    </>
  );
}
