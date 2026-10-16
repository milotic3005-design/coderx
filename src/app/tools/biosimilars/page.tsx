import type { Metadata } from "next";
import { Breadcrumbs, Disclaimer, NoData, PageHeader, Section } from "@/components/layout-bits";
import { ProvenanceFooter } from "@/components/provenance";
import { BiosimilarTable } from "@/components/tools/biosimilar-table";
import { cachedBiosimilarGroups } from "@/lib/data/cached";
import { formatPeriod } from "@/lib/format";

export const metadata: Metadata = {
  title: "Biosimilar comparator",
  description: "Reference biologics side by side with their FDA-licensed biosimilars: Medicare Part B payment limit per billing unit and for a dose you enter.",
  alternates: { canonical: "/tools/biosimilars" },
};

const slugId = (s: string) => `ref-${s.replace(/[^a-z0-9-]/gi, "")}`;
const generic = (g: { genericName: string | null; referenceName: string }) => (g.genericName ?? g.referenceName).toLowerCase();

export default async function BiosimilarsPage() {
  const { groups, paymentPeriod, provenance } = await cachedBiosimilarGroups();
  const repeated = new Set(groups.map(generic).filter((name, i, all) => all.indexOf(name) !== i));
  const label = (g: (typeof groups)[number]) => (repeated.has(generic(g)) ? `${generic(g)} (${g.referenceName})` : generic(g));
  return (
    <>
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ href: "/tools", label: "Tools" }, { label: "Biosimilar comparator" }]} />}
        title="Biosimilar comparator"
        subtitle={`Reference biologics and their FDA-licensed biosimilars (FDA Purple Book), with Medicare Part B payment limits for ${paymentPeriod ? formatPeriod(paymentPeriod) : "the latest quarter"}. Payment differences are not therapeutic guidance — interchangeability and substitution follow FDA licensure and state law.`}
      />
      {groups.length ? (
        <>
          <nav aria-label="Reference products" className="mb-8">
            <ul className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <li key={g.referenceSlug}>
                  <a href={`#${slugId(g.referenceSlug)}`} className="inline-flex min-h-10 items-center rounded-full border border-rule-strong px-3 text-sm font-semibold text-ink hover:border-brand hover:text-brand">
                    {label(g)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          {groups.map((g, i) => (
            <Section
              key={g.referenceSlug}
              id={slugId(g.referenceSlug)}
              number={String(i + 1).padStart(2, "0")}
              title={`${generic(g)} — ${g.referenceName}`}
              description={`Reference product: ${g.referenceName}. ${g.products.length - 1} biosimilar product${g.products.length - 1 === 1 ? "" : "s"} linked by the reference BLA in the Purple Book.`}
            >
              <BiosimilarTable group={g} />
            </Section>
          ))}
        </>
      ) : (
        <NoData />
      )}
      <ProvenanceFooter sources={provenance} />
      <p className="mt-3 text-xs text-ink-muted">
        “Per mg” divides the CMS payment limit by the billing unit in the CMS dosage column. Allowed amount = whole billing units for the dose × the payment limit; patient coinsurance uses the percentage in the CMS file. Derived arithmetic, before deductible and sequestration.
      </p>
      <div className="mt-10">
        <Disclaimer />
      </div>
    </>
  );
}
