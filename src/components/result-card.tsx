import { ChevronRight, CircleDollarSign } from "lucide-react";
import Link from "next/link";
import type { SearchHit } from "@/lib/search/engine";
import { formatDate } from "@/lib/format";
import { CODE_FAMILIES } from "@/lib/hcpcs";
import { ActiveBadge, ClassBadge, FamilyBadge, KindBadge, NocBadge, NonMedicareBadge } from "./badges";

export function ResultCard({ hit }: { hit: SearchHit }) {
  const isCode = hit.kind === "hcpcs" || hit.kind === "ndc";
  const family = hit.family ? CODE_FAMILIES[hit.family] : undefined;
  return (
    <article className="group relative rounded-xl border hairline bg-surface p-4 transition-colors hover:border-brand sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <KindBadge kind={hit.kind} />
        {hit.kind === "hcpcs" && hit.family ? <FamilyBadge code={hit.family} /> : null}
        {hit.kind === "hcpcs" && family?.medicare === "non-medicare" ? <NonMedicareBadge /> : null}
        {hit.isNoc ? <NocBadge /> : null}
        {hit.kind === "drug" ? <ClassBadge productClass={hit.productClass} /> : null}
        <ActiveBadge active={hit.isActive} endDate={hit.statusEndDate} inactiveLabel={hit.kind === "ndc" && hit.ndc?.listing !== "listed" ? "Not in active FDA listing" : "Historical / inactive"} />
      </div>
      <h3 className="mt-2.5 text-lg leading-snug font-semibold text-ink">
        <Link href={hit.href} className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none">
          <span className={isCode ? "code-chip" : ""}>{hit.title}</span>
          {hit.kind === "drug" && hit.subtitle ? <span className="sr-only"> — {hit.subtitle}</span> : null}
        </Link>
      </h3>
      {hit.subtitle ? <p className="mt-1 text-sm text-ink-muted">{hit.subtitle}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1 rounded-md bg-paper-sunken px-2 py-1 font-semibold text-ink-muted">
          <span className="sr-only">Why this matched: </span>
          {hit.match.label}
        </span>
        {hit.kind !== "hcpcs" && hit.codes.length ? (
          <span>
            HCPCS: <span className="code-chip font-semibold text-ink">{hit.codes.slice(0, 6).join(", ")}</span>
            {hit.codes.length > 6 ? ` +${hit.codes.length - 6} more` : ""}
          </span>
        ) : null}
        {hit.manufacturerNames.length && hit.kind !== "manufacturer" ? (
          <span>
            {hit.manufacturerNames.slice(0, 2).join("; ")}
            {hit.manufacturerNames.length > 2 ? ` +${hit.manufacturerNames.length - 2}` : ""}
          </span>
        ) : null}
        {hit.hasPayment ? (
          <span className="inline-flex items-center gap-1 text-ok">
            <CircleDollarSign aria-hidden="true" className="h-3.5 w-3.5" /> Medicare payment limit published
          </span>
        ) : null}
        {hit.kind === "hcpcs" && hit.effectiveDate ? <span>Added {formatDate(hit.effectiveDate)}</span> : null}
        {!hit.isActive && hit.statusEndDate ? <span>Ended {formatDate(hit.statusEndDate)}</span> : null}
      </div>
      <ChevronRight aria-hidden="true" className="absolute top-1/2 right-4 hidden h-5 w-5 -translate-y-1/2 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-brand sm:block" />
    </article>
  );
}
