import type { Metadata } from "next";
import Link from "next/link";
import { FamilyBadge, NonMedicareBadge } from "@/components/badges";
import { PageHeader } from "@/components/layout-bits";
import { cachedFamilyCounts } from "@/lib/data/cached";
import { CODE_FAMILIES } from "@/lib/hcpcs";

export const metadata: Metadata = {
  title: "HCPCS Level II code families",
  description: "Browse HCPCS Level II codes by family — J, Q, C, A, P, S and more — with billing context for each.",
  alternates: { canonical: "/codes" },
};

export default async function CodesPage() {
  const counts = await cachedFamilyCounts();
  const byFamily = new Map(counts.map((c) => [c.family, c]));
  const letters = Object.keys(CODE_FAMILIES).sort((a, b) => Number(CODE_FAMILIES[b].drugRelevant) - Number(CODE_FAMILIES[a].drugRelevant) || a.localeCompare(b));
  return (
    <>
      <PageHeader title="Code families" subtitle="HCPCS Level II codes are grouped by their first letter. Drug-relevant families are listed first." />
      <ul className="grid gap-4 md:grid-cols-2">
        {letters.map((letter) => {
          const f = CODE_FAMILIES[letter];
          const c = byFamily.get(letter);
          return (
            <li key={letter}>
              <Link href={`/codes/${letter.toLowerCase()}`} className="flex h-full flex-col rounded-xl border hairline bg-surface p-5 transition-colors hover:border-brand">
                <div className="flex flex-wrap items-center gap-2">
                  <FamilyBadge code={letter} size="md" />
                  {f.medicare === "non-medicare" ? <NonMedicareBadge /> : null}
                  {f.drugRelevant ? <span className="text-xs font-semibold text-brand">Drug-relevant</span> : null}
                </div>
                <h2 className="mt-3 text-lg font-semibold text-ink">{f.name}</h2>
                <p className="mt-1 flex-1 text-sm text-ink-muted">{f.context}</p>
                {c ? (
                  <p className="mt-3 code-chip text-xs text-ink-faint">
                    {c.total.toLocaleString()} codes · {c.active.toLocaleString()} active · {c.drug.toLocaleString()} drug-related
                  </p>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
