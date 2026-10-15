import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ActiveBadge, DataStatusBadge, FamilyBadge, NocBadge, NonMedicareBadge } from "@/components/badges";
import { CopyButton, RecordView } from "@/components/client-bits";
import { BillingUnitCard, CodeHistoryTable, CrosswalkTable, ExternalSourceLink, LimitationsList, PaymentHistoryTable, Sparkline } from "@/components/detail-blocks";
import { Breadcrumbs, Callout, Disclaimer, KeyValueGrid, NoData, PageHeader, Section, SectionNav } from "@/components/layout-bits";
import { ProvenanceFooter } from "@/components/provenance";
import { cachedHcpcsDetail } from "@/lib/data/cached";
import { formatDate, formatMoney, formatPeriod } from "@/lib/format";
import { COVERAGE_CODES, NOC_CONTEXT, normalizeHcpcs, PRICING_INDICATORS } from "@/lib/hcpcs";
import { SITE } from "@/lib/site";

type Params = Promise<{ code: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const code = normalizeHcpcs((await params).code);
  if (!code) return { title: "HCPCS code not found", robots: { index: false } };
  const detail = await cachedHcpcsDetail(code);
  if (!detail) return { title: `${code} not found`, robots: { index: false } };
  const desc = `${code}: ${detail.code.longDescription}. Billing unit, code family, effective dates, CMS NDC crosswalk, and Medicare payment limit history with sources.`;
  return {
    title: `${code} — ${detail.code.longDescription}`,
    description: desc.slice(0, 300),
    alternates: { canonical: `/hcpcs/${code}` },
    // Non-drug codes carry little unique content here; keep them out of search indexes.
    robots: detail.code.isDrug ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { title: `${code} — ${detail.code.longDescription}`, description: desc.slice(0, 200), url: `/hcpcs/${code}` },
  };
}

export default async function HcpcsPage({ params }: { params: Params }) {
  const raw = decodeURIComponent((await params).code);
  const code = normalizeHcpcs(raw);
  if (!code) notFound();
  if (code !== raw) permanentRedirect(`/hcpcs/${code}`);
  const d = await cachedHcpcsDetail(code);
  if (!d) notFound();
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  const latest = d.payments[0];
  const isCurrentPayment = latest && latest.period === d.latestPaymentPeriod;
  const currentCrosswalk = d.crosswalk.filter((x) => x.isCurrent);
  const pastCrosswalk = d.crosswalk.filter((x) => !x.isCurrent);
  const nonMedicare = d.family?.medicare === "non-medicare";
  const pricing = d.code.pricingIndicators.map((p) => `${p} — ${PRICING_INDICATORS[p] ?? "Unknown"}`).join("; ");

  const nav = [
    { id: "overview", label: "Overview" },
    { id: "billing-units", label: "Billing units" },
    { id: "reimbursement", label: "Reimbursement" },
    { id: "ndc-packages", label: "NDC packages" },
    { id: "related", label: "Related products & codes" },
    { id: "history", label: "Code history" },
    { id: "sources", label: "Data sources" },
    { id: "limitations", label: "Limitations" },
  ];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "MedicalCode",
    codeValue: code,
    codingSystem: "HCPCS Level II",
    name: d.code.longDescription,
    url: `${SITE.url}/hcpcs/${code}`,
  };

  const limitations = [
    "A HCPCS code being valid does not mean Medicare or any other payer covers the item; coverage is determined by the payer and the MAC.",
    "CMS publishes NDC–HCPCS crosswalks to support ASP-based Part B payment; they are not a comprehensive list of NDCs that may be billed with this code.",
    "Payment limits are national Medicare Part B limits per billing unit, before deductible, coinsurance, and sequestration. They are not commercial payer rates.",
    "Hospital outpatient (OPPS) payment rates and status indicators are not included in this release.",
  ];
  if (nonMedicare) limitations.unshift("This is a non-Medicare code. Whether a payer recognizes it, and how it is paid, varies by payer and contract.");
  if (d.code.isNoc) limitations.unshift(NOC_CONTEXT);

  return (
    <>
      <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <RecordView href={`/hcpcs/${code}`} title={code} kind="hcpcs" subtitle={d.code.shortDescription ?? d.code.longDescription} />
      <PageHeader
        eyebrow={
          <Breadcrumbs
            items={[
              { href: "/codes", label: "Code families" },
              { href: `/codes/${code.charAt(0).toLowerCase()}`, label: `${code.charAt(0)}-codes` },
              { label: code },
            ]}
          />
        }
        title={
          <>
            <span className="code-chip">{code}</span>
            <span className="mt-2 block text-2xl font-normal text-ink-muted sm:text-3xl">{d.code.longDescription}</span>
          </>
        }
        badges={
          <>
            <FamilyBadge code={code} size="md" />
            <ActiveBadge active={d.isActive} endDate={d.code.terminationDate} inactiveLabel={`Terminated ${formatDate(d.code.terminationDate)}`} />
            {d.code.isNoc ? <NocBadge /> : null}
            {nonMedicare ? <NonMedicareBadge /> : null}
            {d.code.droppedFromFile ? <DataStatusBadge status="historical" /> : null}
          </>
        }
        actions={<CopyButton text={code} label="Copy code" />}
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[13rem_1fr]">
        <div>
          <SectionNav items={nav} />
        </div>
        <div className="min-w-0">
          {!d.isActive ? (
            <div className="mb-6">
              <Callout tone="warning" title={`${code} is terminated (historical record)`}>
                CMS lists a termination date of {formatDate(d.code.terminationDate)}.
                {d.crossReferences.some((x) => x.direction === "to") ? (
                  <>
                    {" "}
                    The CMS cross-reference field points to{" "}
                    {d.crossReferences
                      .filter((x) => x.direction === "to")
                      .map((x, i) => (
                        <span key={x.code}>
                          {i ? ", " : ""}
                          <Link href={`/hcpcs/${x.code}`}>{x.code}</Link>
                        </span>
                      ))}
                    .
                  </>
                ) : (
                  " CMS did not publish a cross-reference code for it."
                )}
              </Callout>
            </div>
          ) : null}
          {d.notPayable.length ? (
            <div className="mb-6">
              <Callout tone="danger" title="Listed as not payable under Medicare Part B">
                CMS lists {code} in “Drugs Not Payable Under Part B” for {formatPeriod(d.notPayable[0].period)} because the manufacturer (
                {d.notPayable[0].manufacturer ?? "not named"}) does not have a Medicaid National Drug Rebate Agreement in effect.
              </Callout>
            </div>
          ) : null}

          <Section id="overview" number="01" title="Overview" description="Descriptors and administrative fields exactly as published in the CMS HCPCS quarterly file.">
            <KeyValueGrid
              items={[
                { label: "Long descriptor", value: d.code.longDescription },
                { label: "Short descriptor", value: d.code.shortDescription ?? "—", mono: true },
                { label: "Code family", value: d.family ? `${d.family.letter} — ${d.family.name}` : "—" },
                { label: "Status", value: d.isActive ? "Active" : `Terminated ${formatDate(d.code.terminationDate)}` },
                { label: "Added to HCPCS", value: formatDate(d.code.addedDate) },
                { label: "Action effective date", value: formatDate(d.code.actionEffectiveDate) },
                { label: "Termination date", value: d.code.terminationDate ? formatDate(d.code.terminationDate) : "None" },
                { label: "Medicare coverage code", value: d.code.coverageCode ? `${d.code.coverageCode} — ${COVERAGE_CODES[d.code.coverageCode] ?? "Unknown"}` : "—" },
                { label: "Pricing indicator", value: pricing || "—" },
                { label: "NOC list", value: d.code.isNoc ? "On the CMS NOC code list" : "Not on the CMS NOC list" },
              ]}
            />
            {d.family ? (
              <div className="mt-6">
                <Callout tone={nonMedicare ? "warning" : "info"} title={`Billing context: ${d.family.letter}-codes`}>
                  {d.family.context}
                </Callout>
              </div>
            ) : null}
            {d.code.isNoc ? (
              <div className="mt-4">
                <Callout tone="info" title="Not otherwise classified">
                  {NOC_CONTEXT}
                </Callout>
              </div>
            ) : null}
            <ProvenanceFooter sources={[d.releases.hcpcs]} />
          </Section>

          <Section id="billing-units" number="02" title="Billing units" description="Units are reported in multiples of the dosage in the code descriptor.">
            <BillingUnitCard code={code} unit={d.billingUnit} paymentLimit={isCurrentPayment ? latest?.paymentLimit : null} period={isCurrentPayment ? latest?.period : null} />
            <ProvenanceFooter
              sources={[d.billingUnit.source === "cms_payment_limits" ? d.releases.payment : d.releases.hcpcs]}
              extra={d.billingUnit.source === "hcpcs_descriptor" ? [{ status: "derived", note: "Billing unit parsed from the descriptor text." }] : undefined}
            />
          </Section>

          <Section
            id="reimbursement"
            number="03"
            title="Reimbursement"
            description="Medicare Part B drug payment limits per billing unit, by quarter, from the CMS payment limit (ASP) files."
          >
            {latest ? (
              <div className="mb-6 grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
                <div className="rounded-xl border hairline bg-surface p-5">
                  <p className="text-xs font-semibold tracking-wide text-ink-faint uppercase">
                    {isCurrentPayment ? "Current" : "Most recent"} Medicare Part B payment limit · {formatPeriod(latest.period)}
                  </p>
                  <p className="mt-1 font-display text-4xl font-semibold text-ink">
                    <span className="code-chip">{latest.paymentLimit !== null ? formatMoney(latest.paymentLimit) : (latest.paymentLimitText ?? "—")}</span>
                    <span className="ml-2 text-base font-normal text-ink-muted">per {latest.dosageDescriptor ?? "billing unit"}</span>
                  </p>
                  <p className="mt-2 text-sm text-ink-muted">
                    Effective {formatDate(latest.effectiveStart)} – {formatDate(latest.effectiveEnd)} · {latest.methodology}
                    {latest.aspDataPeriod ? ` · based on ${formatPeriod(latest.aspDataPeriod)} ASP data` : ""}
                    {latest.coinsurancePct ? ` · coinsurance ${Number(latest.coinsurancePct).toFixed(3)}%` : ""}
                  </p>
                  {latest.notes ? <p className="mt-2 text-sm text-ink">CMS note: “{latest.notes}”</p> : null}
                  {!isCurrentPayment ? (
                    <p className="mt-2 text-sm font-semibold text-accent">
                      Not in the latest payment limit file ({d.latestPaymentPeriod ? formatPeriod(d.latestPaymentPeriod) : "latest"}). Shown for history only.
                    </p>
                  ) : null}
                </div>
                <Sparkline values={[...d.payments].reverse().filter((p) => p.paymentLimit !== null).map((p) => ({ period: p.period, value: Number(p.paymentLimit) }))} label="Payment limit trend" />
              </div>
            ) : (
              <div className="mb-6">
                <NoData>
                  {SITE.noData} CMS did not publish a Part B payment limit for {code} in the quarters imported
                  {d.code.isNoc ? " — NOC codes are typically priced by the Medicare Administrative Contractor" : ""}.
                </NoData>
              </div>
            )}
            <h3 className="mb-3 text-sm font-semibold text-ink">Quarterly history</h3>
            <PaymentHistoryTable payments={d.payments} caption={`Medicare Part B payment limits for ${code} by quarter`} />
            <div className="mt-6 rounded-xl border hairline bg-surface p-5 text-sm">
              <p className="font-semibold text-ink">Hospital outpatient (OPPS) payment</p>
              <p className="mt-1 text-ink-muted">
                {SITE.noData} OPPS rates are published in CMS Addendum B, which is distributed under the AMA CPT license and is not ingested by CodeRx.{" "}
                <ExternalSourceLink href="https://www.cms.gov/medicare/payment/prospective-payment-systems/hospital-outpatient-pps/quarterly-addenda-updates">CMS quarterly addenda</ExternalSourceLink>
              </p>
            </div>
            <ProvenanceFooter sources={[d.releases.payment]} />
          </Section>

          <Section
            id="ndc-packages"
            number="04"
            title="NDC packages"
            description="Packages CMS assigns to this code in its NDC–HCPCS crosswalks, with billable units per package. Only official crosswalk rows are shown."
          >
            <CrosswalkTable
              entries={currentCrosswalk}
              caption={`NDCs crosswalked to ${code} in the latest CMS file`}
              paymentLimit={isCurrentPayment ? latest?.paymentLimit : null}
              latestPeriod={d.latestCrosswalkPeriod}
            />
            {isCurrentPayment && currentCrosswalk.length ? (
              <p className="mt-2 text-xs text-ink-muted">
                <DataStatusBadge status="derived" /> “Derived $ / NDC” = billable units per NDC × the current payment limit. It is arithmetic for orientation, not a payment amount.
              </p>
            ) : null}
            {pastCrosswalk.length ? (
              <details className="mt-6">
                <summary className="inline-flex min-h-10 cursor-pointer items-center text-sm font-semibold text-brand">
                  Show {pastCrosswalk.length} NDC(s) from earlier quarters that are not in the latest file
                </summary>
                <div className="mt-3">
                  <CrosswalkTable entries={pastCrosswalk} caption={`Historical crosswalk rows for ${code}`} latestPeriod={d.latestCrosswalkPeriod} />
                </div>
              </details>
            ) : null}
            <ProvenanceFooter sources={[d.releases.crosswalk]} />
          </Section>

          <Section id="related" number="05" title="Related products and codes">
            <h3 className="mb-3 text-sm font-semibold text-ink">Drugs whose NDCs CMS crosswalks to {code}</h3>
            {d.linkedDrugs.length ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {d.linkedDrugs.map((drug) => (
                  <li key={drug.slug} className="rounded-lg border hairline bg-surface p-3">
                    <Link href={`/drugs/${drug.slug}`} className="font-semibold text-brand hover:underline">
                      {drug.displayName}
                    </Link>
                    <span className="block text-xs text-ink-muted">{drug.genericName}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                      <DataStatusBadge status="derived" />
                      {drug.relationship.notes}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <NoData />
            )}
            {d.relatedBiologics.length ? (
              <>
                <h3 className="mt-6 mb-3 text-sm font-semibold text-ink">Biosimilar and reference products (FDA Purple Book)</h3>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {d.relatedBiologics.map((b) => (
                    <li key={b.slug} className="rounded-lg border hairline bg-surface p-3">
                      <span className="text-xs font-semibold tracking-wide text-ink-faint uppercase">{b.relation === "reference" ? "Reference product" : b.biosimilarStatus === "interchangeable" ? "Interchangeable biosimilar" : "Biosimilar"}</span>
                      <Link href={`/drugs/${b.slug}`} className="block font-semibold text-brand hover:underline">
                        {b.displayName}
                      </Link>
                      <span className="block text-xs text-ink-muted">{b.genericName}</span>
                      {b.hcpcsCodes.length ? (
                        <span className="mt-1 block text-sm">
                          Billed with{" "}
                          {b.hcpcsCodes.map((c, i) => (
                            <span key={c}>
                              {i ? ", " : ""}
                              <Link href={`/hcpcs/${c}`} className="code-chip font-semibold text-brand hover:underline">
                                {c}
                              </Link>
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {d.crossReferences.length ? (
              <>
                <h3 className="mt-6 mb-3 text-sm font-semibold text-ink">CMS cross-references</h3>
                <ul className="space-y-2 text-sm">
                  {d.crossReferences.map((x) => (
                    <li key={`${x.direction}-${x.code}`} className="flex flex-wrap items-center gap-2">
                      <DataStatusBadge status="official-cms" />
                      {x.direction === "to" ? "This code cross-references" : "Cross-referenced from"}
                      <Link href={`/hcpcs/${x.code}`} className="code-chip font-semibold text-brand hover:underline">
                        {x.code}
                      </Link>
                      <span className="text-ink-muted">{x.description ?? "(not in the imported HCPCS files)"}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-muted">CMS cross-reference codes point a deleted or non-Medicare code to a valid code or range; they are not necessarily one-to-one replacements.</p>
              </>
            ) : null}
            <ProvenanceFooter sources={[d.releases.crosswalk, d.relatedBiologics.length ? d.purpleBookRelease : null, d.crossReferences.length ? d.releases.hcpcs : null]} />
          </Section>

          <Section id="history" number="06" title="Code history" description="Changes detected between the CMS quarterly HCPCS files CodeRx has imported.">
            <CodeHistoryTable history={d.history} caption={`Quarterly change history for ${code}`} />
            <ProvenanceFooter sources={[d.releases.hcpcs]} />
          </Section>

          <Section id="sources" number="07" title="Data sources">
            <ProvenanceFooter sources={d.provenance} />
            <p className="mt-3 text-sm text-ink-muted">
              All imported releases, checksums, and import reports are listed on the <Link href="/sources" className="font-semibold text-brand hover:underline">data sources</Link> page.
            </p>
          </Section>

          <Section id="limitations" number="08" title="Limitations and disclaimers">
            <LimitationsList items={limitations} />
            <div className="mt-6">
              <Disclaimer />
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
