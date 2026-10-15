import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActiveBadge, ClassBadge } from "@/components/badges";
import { RecordView } from "@/components/client-bits";
import { Breadcrumbs, Disclaimer, KeyValueGrid, NoData, PageHeader, Section, TableScroll, td, th } from "@/components/layout-bits";
import { ProvenanceFooter } from "@/components/provenance";
import { cachedManufacturerDetail } from "@/lib/data/cached";
import { slugSchema } from "@/lib/api/validation";
import { titleCase } from "@/lib/format";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const parsed = slugSchema.safeParse((await params).slug);
  if (!parsed.success) return { title: "Manufacturer not found", robots: { index: false } };
  const d = await cachedManufacturerDetail(parsed.data);
  if (!d) return { title: "Manufacturer not found", robots: { index: false } };
  return {
    title: `${d.manufacturer.name} — products and HCPCS codes`,
    description: `Clinician-administered products labeled by ${d.manufacturer.name}, with HCPCS codes from CMS NDC–HCPCS crosswalks.`,
    alternates: { canonical: `/manufacturers/${d.manufacturer.slug}` },
    robots: d.manufacturer.hcpcsCodes.length ? { index: true, follow: true } : { index: false, follow: true },
  };
}

export default async function ManufacturerPage({ params }: { params: Params }) {
  const parsed = slugSchema.safeParse((await params).slug);
  if (!parsed.success) notFound();
  const d = await cachedManufacturerDetail(parsed.data);
  if (!d) notFound();
  const m = d.manufacturer;

  return (
    <>
      <RecordView href={`/manufacturers/${m.slug}`} title={m.name} kind="manufacturer" subtitle={`Labeler ${m.labelerCodes.join(", ")}`} />
      <PageHeader eyebrow={<Breadcrumbs items={[{ href: "/search", label: "Search" }, { label: m.name }]} />} title={m.name} subtitle="Labeler in the FDA NDC Directory" />
      <div className="max-w-5xl">
        <Section id="overview" number="01" title="Overview">
          <KeyValueGrid
            columns={3}
            items={[
              { label: "FDA labeler code(s)", value: m.labelerCodes.join(", "), mono: true },
              { label: "Products in CodeRx index", value: `${m.productCount} (${m.activeProductCount} active)` },
              { label: "Name variants in FDA data", value: m.altNames.length ? m.altNames.join("; ") : "None" },
            ]}
          />
          {m.hcpcsCodes.length ? (
            <p className="mt-5 text-sm text-ink-muted">
              <span className="font-semibold text-ink">HCPCS codes in the latest CMS crosswalk: </span>
              {m.hcpcsCodes.map((c, i) => (
                <span key={c}>
                  {i ? ", " : ""}
                  <Link href={`/hcpcs/${c}`} className="code-chip font-semibold text-brand hover:underline">
                    {c}
                  </Link>
                </span>
              ))}
            </p>
          ) : null}
          <ProvenanceFooter sources={d.provenance} />
        </Section>
        <Section id="drugs" number="02" title="Drugs">
          {d.drugs.length ? (
            <TableScroll label={`Drugs labeled by ${m.name}`}>
              <table className="w-full min-w-[44rem] border-collapse">
                <caption className="sr-only">Drugs labeled by {m.name}</caption>
                <thead>
                  <tr>
                    <th scope="col" className={th}>Drug</th>
                    <th scope="col" className={th}>Form · route</th>
                    <th scope="col" className={th}>Class</th>
                    <th scope="col" className={th}>HCPCS</th>
                    <th scope="col" className={th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {d.drugs.map((drug) => (
                    <tr key={drug.slug}>
                      <th scope="row" className={`${td} text-left`}>
                        <Link href={`/drugs/${drug.slug}`} className="font-semibold text-brand hover:underline">
                          {drug.displayName}
                        </Link>
                        <span className="block text-xs font-normal text-ink-muted">{drug.genericName}</span>
                      </th>
                      <td className={`${td} text-ink-muted`}>
                        {drug.dosageForms.slice(0, 2).map((f) => titleCase(f)).join("; ")}
                        <span className="block text-xs">{drug.routes.slice(0, 3).map((r) => titleCase(r)).join("; ")}</span>
                      </td>
                      <td className={td}>
                        <ClassBadge productClass={drug.productClass} />
                      </td>
                      <td className={`${td} code-chip`}>{drug.hcpcsCodes.join(", ") || "—"}</td>
                      <td className={td}>
                        <ActiveBadge active={drug.isActive} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          ) : (
            <NoData />
          )}
        </Section>
        <Disclaimer compact />
      </div>
    </>
  );
}
