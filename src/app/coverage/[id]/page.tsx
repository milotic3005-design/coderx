import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icd10Groups } from "@/components/icd10-list";
import { Breadcrumbs, Callout, Disclaimer, KeyValueGrid, PageHeader, Section } from "@/components/layout-bits";
import { ProvenanceFooter } from "@/components/provenance";
import { mcdArticleUrl } from "@/ingest/parsers/cms-mcd";
import { cachedCoverageArticle } from "@/lib/data/cached";
import { formatDate } from "@/lib/format";

type Params = Promise<{ id: string }>;

const normalize = (id: string) => (/^A\d{4,6}$/i.test(id) ? id.toUpperCase() : null);

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const id = normalize((await params).id);
  const d = id ? await cachedCoverageArticle(id) : null;
  return d ? { title: `${d.article.displayId}: ${d.article.title}`, description: `Covered ICD-10-CM codes and drug HCPCS codes in Medicare article ${d.article.displayId}.`, alternates: { canonical: `/coverage/${d.article.displayId}` } } : { title: "Medicare article" };
}

export default async function CoverageArticlePage({ params }: { params: Params }) {
  const id = normalize((await params).id);
  const d = id ? await cachedCoverageArticle(id) : null;
  if (!d) notFound();
  const a = d.article;
  return (
    <>
      <PageHeader eyebrow={<Breadcrumbs items={[{ href: "/tools", label: "Tools" }, { label: `Medicare article ${a.displayId}` }]} />} title={a.title} subtitle={`Medicare Coverage Database article ${a.displayId}`} />
      <Section id="article" number="01" title="Article">
        <KeyValueGrid
          columns={3}
          items={[
            { label: "Contractor", value: a.contractors.join(", ") || "—" },
            { label: "States (A/B MAC)", value: a.states.join(", ") || "—" },
            { label: "Effective", value: `${formatDate(a.effectiveDate)}${a.endDate ? ` – ${formatDate(a.endDate)}` : ""}` },
            { label: "Contractor numbers", value: a.contractorNumbers.join(", ") || "—", mono: true },
            {
              label: "Official article",
              value: (
                <a href={mcdArticleUrl(a.articleId, a.version)} rel="noopener noreferrer">
                  {a.displayId} on cms.gov (version {a.version})
                </a>
              ),
            },
          ]}
        />
        <div className="mt-4">
          <Callout tone="info">Read the article&apos;s coding instructions on CMS — which codes go together, documentation, and frequency limits — before billing. CodeRx lists the codes, not the instructions.</Callout>
        </div>
      </Section>
      <Section id="drugs" number="02" title="Drug codes in this article" description="HCPCS Level II drug codes the article lists (other codes it lists are not shown).">
        <ul className="flex flex-wrap gap-2">
          {d.codes.map((c) => (
            <li key={c.code}>
              <Link href={`/hcpcs/${c.code}`} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-rule-strong px-3 text-sm text-ink hover:border-brand hover:text-brand">
                <span className="code-chip font-semibold">{c.code}</span> {c.description ?? ""}
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      <Section id="icd10" number="03" title={`Covered ICD-10-CM codes (${d.icd10.length.toLocaleString()})`} description="Diagnosis codes the article lists as supporting medical necessity, grouped as in the article, with CMS's descriptions.">
        <Icd10Groups rows={d.icd10} label={`Covered ICD-10-CM codes in ${a.displayId}`} />
      </Section>
      <ProvenanceFooter sources={[d.release]} />
      <div className="mt-10">
        <Disclaimer />
      </div>
    </>
  );
}
