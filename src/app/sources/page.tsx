import type { Metadata } from "next";
import { DataStatusBadge } from "@/components/badges";
import { ExternalSourceLink } from "@/components/detail-blocks";
import { Callout, PageHeader, TableScroll, td, th } from "@/components/layout-bits";
import { cachedSources } from "@/lib/data/cached";
import { formatBytes, formatDate, formatDateTime, formatPeriod } from "@/lib/format";
import { SOURCES, type SourceKey } from "@/ingest/sources";
import { SCOPE_STATEMENT } from "@/ingest/scope";

export const metadata: Metadata = {
  title: "Data sources and releases",
  description: "Every CMS and FDA file CodeRx has imported, with publication dates, effective periods, checksums, and record counts.",
  alternates: { canonical: "/sources" },
};

export default async function SourcesPage() {
  const { releases } = await cachedSources();
  return (
    <>
      <PageHeader
        title="Data sources"
        subtitle="Every value in CodeRx comes from a government file listed below. Each import is recorded with its URL, SHA-256 checksum, effective dates, and an import report."
      />
      <div className="mb-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {(Object.keys(SOURCES) as SourceKey[]).map((key) => {
          const s = SOURCES[key];
          const current = releases.filter((r) => r.sourceKey === key && r.isCurrent && r.releaseStatus === "succeeded");
          const latest = [...current].sort((a, b) => (b.period ?? "").localeCompare(a.period ?? ""))[0];
          return (
            <section key={key} aria-labelledby={`src-${key}`} className="flex flex-col rounded-xl border hairline bg-surface p-5">
              <DataStatusBadge status={s.badge} />
              <h2 id={`src-${key}`} className="mt-3 font-semibold text-ink">
                {s.dataset}
              </h2>
              <p className="mt-1 text-sm text-ink-muted">
                {s.organization} · updated {s.cadence}
              </p>
              <p className="mt-2 text-xs text-ink-muted">{s.licenseNote}</p>
              <p className="mt-3 text-sm">
                {latest ? (
                  <>
                    Current: <span className="code-chip font-semibold text-ink">{formatPeriod(latest.period)}</span> · imported {formatDateTime(latest.importedAt)}
                  </>
                ) : (
                  <span className="text-accent">Not imported yet</span>
                )}
              </p>
              <p className="mt-auto pt-3 text-sm">
                <ExternalSourceLink href={s.landingPageUrl}>Publisher page</ExternalSourceLink>
              </p>
            </section>
          );
        })}
      </div>
      <div className="mb-6">
        <Callout tone="info" title="Scope of the FDA index">
          {SCOPE_STATEMENT}
        </Callout>
      </div>
      <h2 className="mb-3 font-display text-2xl font-semibold text-ink">Import log</h2>
      <TableScroll label="Imported releases">
        <table className="w-full min-w-[70rem] border-collapse text-sm">
          <caption className="sr-only">All imported source releases</caption>
          <thead>
            <tr>
              <th scope="col" className={th}>#</th>
              <th scope="col" className={th}>Source · period</th>
              <th scope="col" className={th}>Published</th>
              <th scope="col" className={th}>Effective</th>
              <th scope="col" className={th}>Imported</th>
              <th scope="col" className={`${th} text-right`}>Records</th>
              <th scope="col" className={th}>File · size · SHA-256</th>
              <th scope="col" className={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {releases.map((r) => (
              <tr key={r.releaseId}>
                <th scope="row" className={`${td} code-chip text-left text-ink-faint`}>
                  {r.releaseId}
                </th>
                <td className={td}>
                  <span className="font-semibold text-ink">{SOURCES[r.sourceKey as SourceKey]?.shortName ?? r.sourceKey}</span>
                  <span className="block code-chip text-xs text-ink-muted">{formatPeriod(r.period)}</span>
                </td>
                <td className={`${td} text-ink-muted`}>{r.publicationLabel ?? formatDate(r.publicationDate)}</td>
                <td className={`${td} whitespace-nowrap text-ink-muted`}>{r.effectiveStart ? `${formatDate(r.effectiveStart)} – ${formatDate(r.effectiveEnd)}` : "Snapshot"}</td>
                <td className={`${td} whitespace-nowrap text-ink-muted`}>{formatDateTime(r.importedAt)}</td>
                <td className={`${td} code-chip text-right`}>{r.recordCount?.toLocaleString() ?? "—"}</td>
                <td className={`${td} max-w-[22rem] text-xs text-ink-muted`}>
                  <a href={r.url} className="font-semibold break-all text-brand hover:underline" rel="noopener noreferrer">
                    {r.fileName ?? r.url}
                  </a>
                  <span className="block">{formatBytes(r.byteSize)}</span>
                  {r.checksum ? <span className="block code-chip break-all text-ink-faint">{r.checksum}</span> : null}
                </td>
                <td className={td}>
                  {r.releaseStatus === "succeeded" ? (
                    <span className="font-semibold text-ok">{r.isCurrent ? "Current" : "Succeeded"}</span>
                  ) : r.releaseStatus === "superseded" ? (
                    <span className="text-ink-muted">Superseded</span>
                  ) : (
                    <span className="font-semibold text-danger" title={r.error ?? undefined}>
                      Failed
                      {r.error ? <span className="block text-xs font-normal text-ink-muted">{r.error.slice(0, 160)}</span> : null}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      {!releases.length ? <p className="mt-4 text-sm text-ink-muted">No imports have run yet.</p> : null}
    </>
  );
}
