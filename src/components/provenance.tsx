import { ExternalLink } from "lucide-react";
import type { DataStatus, Provenance } from "@/lib/data/provenance";
import { formatDate, formatDateTime, formatPeriod } from "@/lib/format";
import { DataStatusBadge } from "./badges";

/**
 * The provenance strip shown under every material data section: organization,
 * dataset, publication date, effective dates, import date, direct link, and status.
 */
export function ProvenanceFooter({
  sources,
  extra,
  status,
}: {
  sources: (Provenance | null | undefined)[];
  /** Additional derived/manual status to show alongside the sources. */
  extra?: { status: DataStatus; note: string }[];
  status?: DataStatus;
}) {
  const list = sources.filter((s): s is Provenance => !!s);
  if (!list.length && !extra?.length) return null;
  return (
    <aside aria-label="Data provenance" className="mt-5 rounded-lg border border-dashed border-rule bg-paper/60 px-4 py-3 text-xs leading-relaxed text-ink-muted">
      <p className="mb-1.5 font-semibold tracking-wide text-ink-faint uppercase">Source</p>
      <ul className="space-y-2">
        {list.map((s) => (
          <li key={s.releaseId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <DataStatusBadge status={status ?? s.status} />
            <span className="font-semibold text-ink">{s.organization}</span>
            <span>{s.dataset}</span>
            {s.period ? <span className="code-chip text-ink">{formatPeriod(s.period)}</span> : null}
            <span aria-hidden="true">·</span>
            <span>
              Effective {s.effectiveStart ? `${formatDate(s.effectiveStart)}${s.effectiveEnd ? ` – ${formatDate(s.effectiveEnd)}` : ""}` : "as of publication"}
            </span>
            <span aria-hidden="true">·</span>
            <span>Published {s.publicationLabel ?? formatDate(s.publicationDate)}</span>
            <span aria-hidden="true">·</span>
            <span>Imported {formatDateTime(s.importedAt)}</span>
            <a href={s.url} className="inline-flex items-center gap-1 font-semibold text-brand underline-offset-2 hover:underline" rel="noopener noreferrer">
              Source file <ExternalLink aria-hidden="true" className="h-3 w-3" />
              <span className="sr-only">(opens {s.organization} website)</span>
            </a>
          </li>
        ))}
        {extra?.map((e) => (
          <li key={e.note} className="flex flex-wrap items-center gap-2">
            <DataStatusBadge status={e.status} />
            <span>{e.note}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
