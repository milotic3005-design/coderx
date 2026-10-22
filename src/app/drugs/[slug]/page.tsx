import type { Metadata } from "next";
import { headers } from "next/headers";
import { Calculator, GitCompareArrows, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActiveBadge, ClassBadge, DataStatusBadge, FamilyBadge, NocBadge } from "@/components/badges";
import { RecordView } from "@/components/client-bits";
import { BillingUnitCard, CodeHistoryTable, ExternalSourceLink, LimitationsList, PaymentHistoryTable, PerDiemCodes, PerDiemReimbursement } from "@/components/detail-blocks";
import { Breadcrumbs, Callout, Disclaimer, KeyValueGrid, NoData, PageHeader, Section, SectionNav, TableScroll, td, th } from "@/components/layout-bits";
import { ProvenanceFooter } from "@/components/provenance";
import { GlanceStrip, type GlanceAction, type GlanceItem } from "@/components/glance";
import { StickyRecordBar } from "@/components/sticky-record-bar";
import { CoverageLinks } from "@/components/tool-blocks";
import { cachedDrugDetail } from "@/lib/data/cached";
import { EXCLUDE_FLAG_LABELS, formatDate, formatMoney, formatNumber, formatPeriod, PRODUCT_CLASS_LABELS, titleCase } from "@/lib/format";
import { slugSchema } from "@/lib/api/validation";
import { SITE } from "@/lib/site";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const parsed = slugSchema.safeParse((await params).slug);
  if (!parsed.success) return { title: "Drug not found", robots: { index: false } };
  const d = await cachedDrugDetail(parsed.data);
  if (!d) return { title: "Drug not found", robots: { index: false } };
  const name = d.drug.brandName ? `${d.drug.displayName} (${d.drug.genericName})` : d.drug.displayName;
  const codes = d.drug.hcpcsCodes.length ? `HCPCS ${d.drug.hcpcsCodes.join(", ")}` : "HCPCS coding";
  return {
    title: `${name} — ${codes}, NDCs and billing units`,
    description: `${name}: ${codes}, NDC packages with billable units, and Medicare Part B payment limits, with CMS and FDA sources.`.slice(0, 300),
    alternates: { canonical: `/drugs/${d.drug.slug}` },
    // Pages without any CMS coding data are thin; keep them crawlable but unindexed.
    robots: d.drug.hcpcsCodes.length ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { title: `${name} · ${SITE.name}`, url: `/drugs/${d.drug.slug}` },
  };
}

export default async function DrugPage({ params }: { params: Params }) {
  const parsed = slugSchema.safeParse((await params).slug);
  if (!parsed.success) notFound();
  const d = await cachedDrugDetail(parsed.data);
  if (!d) notFound();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const drug = d.drug;
  const manufacturers = [...new Map(d.products.filter((p) => p.manufacturerSlug).map((p) => [p.manufacturerSlug!, p.manufacturerName!])).entries()];
  const currentCodes = d.codes.filter((c) => c.relationship?.isCurrent);
  const formerCodes = d.codes.filter((c) => !c.relationship?.isCurrent);
  const excluded = d.packages.filter((k) => k.listingStatus === "excluded");
  const primaryCode = currentCodes.find((c) => c.isActive) ?? currentCodes[0] ?? null;
  const primaryPay = primaryCode?.payments[0] && primaryCode.payments[0].period === d.latestPaymentPeriod ? primaryCode.payments[0] : null;
  const primaryLimit = primaryPay ? (primaryPay.paymentLimit !== null ? formatMoney(primaryPay.paymentLimit) : primaryPay.paymentLimitText) : null;
  const activePackages = d.packages.filter((k) => k.isActive).length;
  const glance: GlanceItem[] = [
    {
      label: currentCodes.length > 1 ? "HCPCS codes" : "HCPCS code",
      value: currentCodes.length ? <span className="code-chip">{currentCodes.map((c) => c.code).join(", ")}</span> : "None",
      hint: currentCodes.length ? "Via the CMS NDC crosswalk" : d.nocRelationship ? "Billed with a NOC code" : "No CMS crosswalk row",
    },
    {
      label: "Billing unit",
      value: primaryCode?.billingUnit.text ? <span className="code-chip">{primaryCode.billingUnit.text}</span> : "—",
      hint: primaryCode ? `One unit of ${primaryCode.code}` : "No linked code",
    },
    {
      label: "Part B payment limit",
      value: primaryLimit ? <span className="code-chip">{primaryLimit}</span> : "None",
      hint: primaryPay ? `${primaryCode!.code} · ${formatPeriod(primaryPay.period)}` : "No current limit",
    },
    {
      label: "NDC packages",
      value: <span className="code-chip">{activePackages}</span>,
      hint: `active of ${d.packages.length} in the FDA directory`,
    },
  ];
  if (d.reference || d.biosimilars.length) {
    glance.push({
      label: d.reference ? "Reference product" : "Biosimilars",
      value: d.reference ? d.reference.displayName : <span className="code-chip">{d.biosimilars.length}</span>,
      hint: "FDA Purple Book",
    });
  }
  const refSlug = d.reference?.slug ?? (d.biosimilars.length ? drug.slug : null);
  const glanceActions: GlanceAction[] = [
    ...(primaryCode ? [{ href: `/calculator?code=${primaryCode.code}`, label: "Calculate units", icon: <Calculator aria-hidden="true" className="h-4 w-4" />, primary: true }] : []),
    ...(refSlug ? [{ href: `/tools/biosimilars?ref=${refSlug}#ref-${refSlug}`, label: "Compare biosimilars", icon: <GitCompareArrows aria-hidden="true" className="h-4 w-4" /> }] : []),
    { href: "#coverage", label: "Coverage & policy", icon: <ShieldCheck aria-hidden="true" className="h-4 w-4" /> },
  ];

  const nav = [
    { id: "overview", label: "Overview" },
    { id: "hcpcs", label: "HCPCS coding" },
    { id: "ndc-packages", label: "NDC packages" },
    { id: "billing-units", label: "Billing units" },
    { id: "reimbursement", label: "Reimbursement" },
    { id: "related", label: "Related products & codes" },
    { id: "coverage", label: "Coverage & policy" },
    { id: "history", label: "Code history" },
    { id: "sources", label: "Data sources" },
    { id: "limitations", label: "Limitations" },
  ];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Drug",
    name: drug.displayName,
    nonProprietaryName: drug.genericName ?? undefined,
    activeIngredient: drug.activeIngredients.join(", ") || undefined,
    manufacturer: manufacturers.map(([, name]) => ({ "@type": "Organization", name })),
    administrationRoute: drug.routes.map((r) => titleCase(r)).join(", ") || undefined,
    code: drug.hcpcsCodes.map((c) => ({ "@type": "MedicalCode", codeValue: c, codingSystem: "HCPCS Level II" })),
    url: `${SITE.url}/drugs/${drug.slug}`,
  };

  return (
    <>
      <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <RecordView href={`/drugs/${drug.slug}`} title={drug.displayName} kind="drug" subtitle={[drug.genericName, drug.hcpcsCodes.join(", ")].filter(Boolean).join(" · ")} />
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ href: "/search", label: "Search" }, { label: drug.displayName }]} />}
        title={drug.displayName}
        subtitle={
          <>
            {drug.brandName && drug.genericName ? <span className="text-ink">{drug.genericName}</span> : null}
            {drug.dosageForms.length ? <span> · {drug.dosageForms.map((f) => titleCase(f)).join("; ")}</span> : null}
          </>
        }
        badges={
          <>
            <ClassBadge productClass={drug.productClass} />
            <ActiveBadge active={d.isActive} endDate={drug.activeUntil} inactiveLabel={drug.isListed ? `Marketing ended ${formatDate(drug.activeUntil)}` : "Not in the active FDA directory"} />
            {drug.hcpcsCodes.map((c) => (
              <Link key={c} href={`/hcpcs/${c}`} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-rule-strong bg-surface px-2.5 text-sm hover:border-brand">
                <FamilyBadge code={c} />
                <span className="code-chip font-semibold text-ink">{c}</span>
              </Link>
            ))}
            {d.nocRelationship ? <NocBadge /> : null}
          </>
        }
      />

      <GlanceStrip items={glance} actions={glanceActions} />
      <StickyRecordBar
        title={drug.displayName}
        subtitle={[drug.genericName, currentCodes.map((c) => c.code).join(", ")].filter(Boolean).join(" · ")}
        facts={primaryLimit && primaryPay ? [{ label: `per ${primaryPay.dosageDescriptor ?? "unit"}`, value: primaryLimit }] : []}
        action={primaryCode ? { href: `/calculator?code=${primaryCode.code}`, label: "Calculate units" } : undefined}
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[13rem_1fr]">
        <div>
          <SectionNav items={nav} />
        </div>
        <div className="min-w-0">
          {!drug.isListed ? (
            <div className="mb-6">
              <Callout tone="warning" title="Historical record">
                None of this drug’s products are in the active FDA NDC Directory. They appear in the FDA “excluded” file because CMS crosswalked at least one of their NDCs.
              </Callout>
            </div>
          ) : null}

          <Section id="overview" number="01" title="Overview" description="Product attributes as listed by the labeler in the FDA NDC Directory.">
            <KeyValueGrid
              columns={3}
              items={[
                { label: "Brand (proprietary) name", value: drug.brandName ?? "None — marketed under its generic name" },
                { label: "Generic (nonproprietary) name", value: drug.genericName ?? SITE.noData },
                { label: "Active ingredient(s)", value: drug.activeIngredients.length ? drug.activeIngredients.join("; ") : SITE.noData },
                { label: "Strength(s)", value: drug.strengths.length ? drug.strengths.join("; ") : SITE.noData, mono: true },
                { label: "Dosage form(s)", value: drug.dosageForms.length ? drug.dosageForms.map((f) => titleCase(f)).join("; ") : SITE.noData },
                { label: "Route(s)", value: drug.routes.length ? drug.routes.map((r) => titleCase(r)).join("; ") : SITE.noData },
                {
                  label: "Manufacturer / labeler",
                  value: manufacturers.length ? (
                    <span className="flex flex-col">
                      {manufacturers.map(([slug, name]) => (
                        <Link key={slug} href={`/manufacturers/${slug}`} className="text-brand hover:underline">
                          {name}
                        </Link>
                      ))}
                    </span>
                  ) : (
                    SITE.noData
                  ),
                },
                { label: "Product class", value: `${PRODUCT_CLASS_LABELS[drug.productClass] ?? drug.productClass} (derived from FDA marketing category${drug.biosimilarStatus ? " and Purple Book license type" : ""})` },
                { label: "Marketing category", value: drug.marketingCategories.join("; ") || "—" },
                { label: "Application number(s)", value: drug.applicationNumbers.join(", ") || "None listed (unapproved products have none)", mono: true },
                { label: "Earliest marketing start", value: formatDate(drug.earliestMarketingStart) },
                { label: "Products / packages indexed", value: `${drug.productCount} / ${drug.packageCount}` },
              ]}
            />
            {drug.pharmClasses.length ? (
              <p className="mt-4 text-sm text-ink-muted">
                <span className="font-semibold text-ink">FDA pharmacologic class: </span>
                {drug.pharmClasses.join("; ")}
              </p>
            ) : null}
            {d.aliases.length ? (
              <p className="mt-3 text-sm text-ink-muted">
                <span className="font-semibold text-ink">Also searchable as: </span>
                {d.aliases.map((a) => a.alias).join(" · ")}
              </p>
            ) : null}
            <p className="mt-3 text-sm">
              <ExternalSourceLink href={`https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=${encodeURIComponent(d.packages[0]?.packageNdc ?? drug.genericName ?? drug.displayName)}`}>
                Prescribing information on DailyMed (NLM)
              </ExternalSourceLink>
            </p>
            <ProvenanceFooter sources={[d.releases.fda, excluded.length ? d.releases.fdaExcluded : null]} />
          </Section>

          <Section
            id="hcpcs"
            number="02"
            title="HCPCS coding"
            description="Drug codes appear here only when a CMS NDC–HCPCS crosswalk lists at least one of this drug’s NDC packages. CodeRx never assigns a code from the name or ingredient."
          >
            {d.codes.length ? (
              <ul className="space-y-3">
                {[...currentCodes, ...formerCodes].map((c) => (
                  <li key={c.code} className="rounded-xl border hairline bg-surface p-4 sm:p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/hcpcs/${c.code}`} className="code-chip text-xl font-semibold text-brand hover:underline">
                        {c.code}
                      </Link>
                      <FamilyBadge code={c.code} />
                      <ActiveBadge active={c.isActive} endDate={c.terminationDate} inactiveLabel={`Terminated ${formatDate(c.terminationDate)}`} />
                      {c.isNoc ? <NocBadge /> : null}
                      <DataStatusBadge status="derived" />
                    </div>
                    <p className="mt-2 text-ink">{c.longDescription}</p>
                    <p className="mt-1 text-sm text-ink-muted">
                      {c.relationship?.notes}{" "}
                      {c.relationship ? (
                        <span className="code-chip">
                          CMS quarters {formatPeriod(c.relationship.firstPeriod)} – {formatPeriod(c.relationship.lastPeriod)}
                        </span>
                      ) : null}
                      {!c.relationship?.isCurrent ? <span className="ml-1 font-semibold text-accent">Not in the latest CMS crosswalk.</span> : null}
                    </p>
                    {c.family ? <p className="mt-2 text-xs text-ink-muted">{c.family.context}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <NoData>
                No CMS NDC–HCPCS crosswalk row links this drug’s NDCs to a HCPCS code. That does not mean no code applies — CMS crosswalks are not comprehensive. Check the payer’s instructions; a not-otherwise-classified code may apply.
              </NoData>
            )}
            {d.nocRelationship ? (
              <div className="mt-4">
                <Callout tone="info" title="CMS NOC crosswalk">
                  {d.nocRelationship.notes} Quarters: {formatPeriod(d.nocRelationship.firstPeriod)} – {formatPeriod(d.nocRelationship.lastPeriod)}.
                </Callout>
              </div>
            ) : null}
            <ProvenanceFooter sources={[d.releases.crosswalk, d.releases.hcpcs]} extra={d.codes.length ? [{ status: "derived", note: "Drug-to-code links are aggregated from NDC-level CMS crosswalk rows." }] : undefined} />
            <h3 id="per-diem" className="mt-8 mb-1 text-sm font-semibold text-ink">
              Home infusion per diem (S-codes)
            </h3>
            <p className="mb-3 text-sm text-ink-muted">
              When a home infusion pharmacy dispenses this drug, the drug is billed with the code above and each day of pharmacy services, supplies, and equipment with a per diem S-code. CMS publishes no drug-to-per-diem crosswalk, so CodeRx picks the therapy category from the FDA pharmacologic class and route. S-codes are not payable by Medicare; confirm the code against the payer contract.
            </p>
            <PerDiemCodes perDiem={d.perDiem} />
            <ProvenanceFooter
              sources={[d.releases.fda, d.perDiem.matches.length ? d.releases.hcpcs : null]}
              extra={d.perDiem.matches.length ? [{ status: "derived", note: "Therapy category matched from the FDA Established Pharmacologic Class and route (and the CMS clotting-factor flag); descriptors from the CMS HCPCS file." }] : undefined}
            />
          </Section>

          <Section id="ndc-packages" number="03" title="NDC packages" description="Package NDCs from the FDA directory, normalized to the 11-digit 5-4-2 format used on claims.">
            {d.packages.length ? (
              <TableScroll label={`NDC packages for ${drug.displayName}`}>
                <table className="w-full min-w-[62rem] border-collapse">
                  <caption className="sr-only">NDC packages for {drug.displayName}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={th}>11-digit NDC</th>
                      <th scope="col" className={th}>FDA NDC</th>
                      <th scope="col" className={th}>Package description</th>
                      <th scope="col" className={th}>Strength · form</th>
                      <th scope="col" className={th}>Labeler</th>
                      <th scope="col" className={th}>HCPCS · units / NDC</th>
                      <th scope="col" className={th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.packages.map((k) => (
                      <tr key={`${k.ndc11}-${k.productId}`}>
                        <th scope="row" className={`${td} text-left whitespace-nowrap`}>
                          <Link href={`/ndc/${k.ndcFormatted}`} className="code-chip font-semibold text-brand hover:underline">
                            {k.ndcFormatted}
                          </Link>
                        </th>
                        <td className={`${td} code-chip whitespace-nowrap text-ink-muted`}>{k.packageNdc}</td>
                        <td className={`${td} min-w-[16rem] text-ink-muted`}>{k.description ?? "—"}</td>
                        <td className={`${td} min-w-[10rem]`}>
                          <span className="code-chip">{k.strength || "—"}</span>
                          <span className="block text-xs text-ink-muted">{k.dosageForm ? titleCase(k.dosageForm) : ""}</span>
                        </td>
                        <td className={`${td} min-w-[10rem] text-ink-muted`}>{k.labelerName ?? "—"}</td>
                        <td className={`${td} whitespace-nowrap`}>
                          {k.crosswalk.length
                            ? k.crosswalk.map((x) => (
                                <span key={`${x.hcpcsCode}-${x.ndcRaw}`} className={`block code-chip ${x.isCurrent ? "" : "text-ink-faint"}`}>
                                  {x.hcpcsCode ?? "NOC"} · {formatNumber(x.billUnitsPerPackage)} units
                                  {x.isCurrent ? "" : ` (${formatPeriod(x.latestPeriod)})`}
                                </span>
                              ))
                            : <span className="text-xs text-ink-faint">Not in CMS crosswalk</span>}
                        </td>
                        <td className={`${td} text-xs whitespace-nowrap`}>
                          {k.listingStatus === "listed" ? (
                            k.isActive ? (
                              <span className="text-ok">Listed</span>
                            ) : (
                              <span className="text-accent">Marketing ended {formatDate(k.marketingEnd)}</span>
                            )
                          ) : (
                            <span className="text-accent">{k.excludeFlag ? EXCLUDE_FLAG_LABELS[k.excludeFlag] : "Excluded listing"}</span>
                          )}
                          {k.sample ? <span className="block text-ink-faint">Sample package</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            ) : (
              <NoData />
            )}
            <ProvenanceFooter sources={[d.releases.fda, excluded.length ? d.releases.fdaExcluded : null, d.releases.crosswalk]} />
          </Section>

          <Section id="billing-units" number="04" title="Billing units">
            {d.codes.length ? (
              <div className="space-y-3">
                {currentCodes.length ? currentCodes.map((c) => <BillingUnitCard key={c.code} code={c.code} unit={c.billingUnit} paymentLimit={c.payments[0]?.period === d.latestPaymentPeriod ? c.payments[0]?.paymentLimit : null} period={c.payments[0]?.period} />) : formerCodes.map((c) => <BillingUnitCard key={c.code} code={c.code} unit={c.billingUnit} />)}
                <p className="text-sm text-ink-muted">Billable units per package for each NDC are listed in the NDC packages table above (CMS “BILLUNITSPKG”).</p>
              </div>
            ) : (
              <NoData />
            )}
            <ProvenanceFooter sources={[d.releases.payment, d.releases.hcpcs]} />
          </Section>

          <Section
            id="reimbursement"
            number="05"
            title="Reimbursement"
            description="Medicare Part B payment limits for the codes above, then how the home infusion per diem S-codes are paid. Commercial payer rates, AWP, and WAC are not included."
          >
            {d.codes.some((c) => c.payments.length) ? (
              <div className="space-y-8">
                {d.codes
                  .filter((c) => c.payments.length)
                  .map((c) => (
                    <div key={c.code}>
                      <h3 className="mb-3 flex flex-wrap items-baseline gap-2 text-base font-semibold text-ink">
                        <span className="code-chip text-brand">{c.code}</span>
                        <span>
                          {c.payments[0].paymentLimit !== null ? formatMoney(c.payments[0].paymentLimit) : c.payments[0].paymentLimitText} per {c.payments[0].dosageDescriptor ?? "unit"} ·{" "}
                          {formatPeriod(c.payments[0].period)}
                        </span>
                      </h3>
                      <PaymentHistoryTable payments={c.payments} caption={`Medicare Part B payment limits for ${c.code}`} />
                    </div>
                  ))}
              </div>
            ) : (
              <NoData />
            )}
            <ProvenanceFooter sources={[d.releases.payment]} />
            <h3 id="per-diem-reimbursement" className="mt-8 mb-3 text-sm font-semibold text-ink">
              Home infusion per diem (S-codes)
            </h3>
            <PerDiemReimbursement perDiem={d.perDiem} latestPaymentPeriod={d.latestPaymentPeriod} stateFeeSchedules={d.stateFeeSchedules} />
            {d.perDiem.matches.length ? <ProvenanceFooter sources={[d.releases.hcpcs, d.releases.payment, ...d.stateFeeSchedules.map((s) => s.release)]} /> : null}
          </Section>

          <Section id="related" number="06" title="Related products and codes">
            {d.reference ? (
              <div className="mb-5 rounded-xl border hairline bg-surface p-4">
                <p className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Reference product (FDA Purple Book)</p>
                <Link href={`/drugs/${d.reference.slug}`} className="mt-1 block text-lg font-semibold text-brand hover:underline">
                  {d.reference.displayName}
                </Link>
                <p className="text-sm text-ink-muted">
                  {d.reference.genericName}
                  {d.reference.hcpcsCodes.length ? ` · billed with ${d.reference.hcpcsCodes.join(", ")}` : ""}
                </p>
                {d.biosimilarRelationship ? (
                  <p className="mt-1 text-xs text-ink-muted">
                    <DataStatusBadge status="official-fda" /> {d.biosimilarRelationship.notes}
                  </p>
                ) : null}
              </div>
            ) : null}
            {d.biosimilars.length ? (
              <>
                <h3 className="mb-3 text-sm font-semibold text-ink">Biosimilars referencing {drug.displayName} (FDA Purple Book)</h3>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {d.biosimilars.map((b) => (
                    <li key={b.slug} className="rounded-lg border hairline bg-surface p-3">
                      <Link href={`/drugs/${b.slug}`} className="font-semibold text-brand hover:underline">
                        {b.displayName}
                      </Link>
                      <span className="block text-xs text-ink-muted">
                        {b.genericName} · {b.biosimilarStatus === "interchangeable" ? "Interchangeable" : "Biosimilar"}
                        {b.hcpcsCodes.length ? ` · ${b.hcpcsCodes.join(", ")}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {d.sameCodeDrugs.length ? (
              <>
                <h3 className="mt-6 mb-3 text-sm font-semibold text-ink">Other drugs crosswalked to the same code(s)</h3>
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {d.sameCodeDrugs.map((b) => (
                    <li key={b.slug} className="rounded-lg border hairline bg-surface p-3">
                      <Link href={`/drugs/${b.slug}`} className="font-semibold text-brand hover:underline">
                        {b.displayName}
                      </Link>
                      <span className="block text-xs text-ink-muted">
                        {b.genericName} · {b.hcpcsCodes.join(", ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {!d.reference && !d.biosimilars.length && !d.sameCodeDrugs.length ? <NoData /> : null}
            <ProvenanceFooter sources={[d.reference || d.biosimilars.length ? d.releases.purpleBook : null, d.sameCodeDrugs.length ? d.releases.crosswalk : null]} />
          </Section>

          <Section
            id="coverage"
            number="07"
            title="Coverage and policy"
            description="Medicare coverage is set nationally (NCDs) and by each Medicare Administrative Contractor (LCDs and Billing & Coding articles). These links open the official documents."
          >
            <CoverageLinks
              keywords={[
                ...(d.drug.genericName ? [{ label: d.drug.genericName.toLowerCase(), value: d.drug.genericName.toLowerCase() }] : []),
                ...d.codes.filter((c) => c.isActive).slice(0, 3).map((c) => ({ label: c.code, value: c.code })),
              ]}
            />
          </Section>

          <Section id="history" number="08" title="Code history" description="Quarterly changes to the HCPCS codes linked to this drug.">
            {d.codeHistory.length ? (
              <div className="space-y-6">
                {d.codes.map((c) => (
                  <div key={c.code}>
                    <h3 className="mb-2 text-sm font-semibold text-ink">
                      <span className="code-chip">{c.code}</span>
                    </h3>
                    <CodeHistoryTable history={d.codeHistory.filter((h) => h.code === c.code)} caption={`History for ${c.code}`} />
                  </div>
                ))}
              </div>
            ) : (
              <NoData />
            )}
            <ProvenanceFooter sources={[d.releases.hcpcs]} />
          </Section>

          <Section id="sources" number="09" title="Data sources">
            <ProvenanceFooter sources={d.provenance} />
            <p className="mt-3 text-sm text-ink-muted">
              Every import with its checksum is listed on the <Link href="/sources" className="font-semibold text-brand hover:underline">data sources</Link> page.
            </p>
          </Section>

          <Section id="limitations" number="10" title="Limitations and disclaimers">
            <LimitationsList
              items={[
                "FDA NDC Directory data is submitted by labelers; FDA notes that inclusion does not mean the information was verified or that a product is approved, covered, or reimbursable.",
                "HCPCS links are derived from CMS NDC–HCPCS crosswalks, which support ASP-based Part B payment and are not a complete list of billable NDCs.",
                "Product class (brand, generic, biosimilar) is derived from the FDA marketing category and Purple Book license type, not from a commercial compendium.",
                "Payment limits are Medicare Part B national limits; they do not reflect payer contracts, OPPS rates, 340B pricing, or acquisition cost.",
                "Home infusion per diem S-codes are matched by therapy category from the FDA pharmacologic class and route, not from a CMS crosswalk. Payers choose which per diem codes they accept, and the right code can depend on the dosing schedule, infusion method, or daily volume.",
              ]}
            />
            <div className="mt-6">
              <Disclaimer />
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
