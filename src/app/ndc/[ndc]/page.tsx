import type { Metadata } from "next";
import { Calculator, ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ActiveBadge, DataStatusBadge, FamilyBadge } from "@/components/badges";
import { CopyButton, RecordView } from "@/components/client-bits";
import { LimitationsList } from "@/components/detail-blocks";
import { Breadcrumbs, Callout, Disclaimer, EmptyState, KeyValueGrid, NoData, PageHeader, Section, SectionNav, TableScroll, td, th } from "@/components/layout-bits";
import { GlanceStrip, type GlanceAction, type GlanceItem } from "@/components/glance";
import { ProvenanceFooter } from "@/components/provenance";
import { StickyRecordBar } from "@/components/sticky-record-bar";
import { cachedNdcDetail } from "@/lib/data/cached";
import { EXCLUDE_FLAG_LABELS, formatDate, formatMoney, formatNumber, formatPeriod, titleCase } from "@/lib/format";
import { formatNdc11, parseNdc } from "@/lib/ndc";
import { SITE } from "@/lib/site";

type Params = Promise<{ ndc: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const parsed = parseNdc(decodeURIComponent((await params).ndc));
  if (parsed.kind !== "package") return { title: "NDC lookup", robots: { index: false } };
  const formatted = formatNdc11(parsed.ndc11);
  return {
    title: `NDC ${formatted}`,
    description: `NDC ${formatted}: FDA listing, CMS NDC–HCPCS crosswalk, and billable units per package.`,
    alternates: { canonical: `/ndc/${formatted}` },
    // Package pages largely duplicate their drug page; keep them crawlable but unindexed.
    robots: { index: false, follow: true },
  };
}

export default async function NdcPage({ params }: { params: Params }) {
  const raw = decodeURIComponent((await params).ndc);
  const parsed = parseNdc(raw);

  if (parsed.kind === "ambiguous") {
    return (
      <div className="mx-auto max-w-3xl py-12">
        <h1 className="font-display text-3xl font-semibold text-ink">Which NDC did you mean?</h1>
        <p className="mt-3 text-ink-muted">
          <span className="code-chip">{raw}</span> has 10 digits and no hyphens, so the segment layout is ambiguous. It can be read three ways:
        </p>
        <ul className="mt-5 space-y-2">
          {parsed.candidates.map((c) => (
            <li key={c.ndc11}>
              <Link href={`/ndc/${formatNdc11(c.ndc11)}`} className="flex min-h-12 items-center justify-between rounded-lg border hairline bg-surface px-4 hover:border-brand">
                <span className="code-chip font-semibold text-brand">{formatNdc11(c.ndc11)}</span>
                <span className="text-sm text-ink-muted">if the original layout was {c.format}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-sm text-ink-muted">
          Or <Link href={`/search?q=${encodeURIComponent(raw)}`} className="font-semibold text-brand hover:underline">search all three at once</Link>.
        </p>
      </div>
    );
  }
  if (parsed.kind === "product") permanentRedirect(`/search?q=${encodeURIComponent(raw)}`);
  if (parsed.kind !== "package") {
    return (
      <div className="mx-auto max-w-3xl py-12">
        <EmptyState title="That is not a valid NDC">
          <p>{parsed.reason}</p>
          <p className="mt-2">Valid layouts: 4-4-2, 5-3-2, 5-4-1 (10 digits) or 5-4-2 / 11 digits.</p>
        </EmptyState>
      </div>
    );
  }

  const formatted = formatNdc11(parsed.ndc11);
  if (raw !== formatted) permanentRedirect(`/ndc/${formatted}`);
  const d = await cachedNdcDetail(parsed.ndc11);
  if (!d) notFound();

  const primary = d.fda[0];
  const currentRows = d.crosswalk.filter((x) => x.isCurrent);
  const title = primary ? `${[primary.product.proprietaryName, primary.product.proprietaryNameSuffix].filter(Boolean).join(" ")}` : (d.crosswalk[0]?.drugName ?? "NDC package");

  const mainCode = d.codes.find((c) => c.crosswalk?.isCurrent) ?? d.codes[0] ?? null;
  const units = mainCode?.crosswalk?.billUnitsPerPackage != null ? Number(mainCode.crosswalk.billUnitsPerPackage) : null;
  const pay = mainCode?.payments[0];
  const limit = pay && pay.paymentLimit !== null ? Number(pay.paymentLimit) : null;
  const perPackage = units != null && limit != null ? units * limit : null;
  const fdaStatus = !primary ? "Not found" : primary.isActive ? "Listed" : primary.package.listingStatus === "excluded" ? "Excluded" : "Ended";
  const glance: GlanceItem[] = [
    { label: d.codes.length > 1 ? "HCPCS codes" : "HCPCS code", value: d.codes.length ? <span className="code-chip">{d.codes.map((c) => c.code).join(", ")}</span> : "None", hint: d.codes.length ? "CMS NDC–HCPCS crosswalk" : "Not on a CMS crosswalk" },
    { label: "Billable units / package", value: units != null ? <span className="code-chip">{formatNumber(units)}</span> : "—", hint: mainCode?.billingUnit.text ? `units of ${mainCode.billingUnit.text}` : "From the CMS crosswalk" },
    { label: "Payment per package", value: perPackage != null ? <span className="code-chip">{formatMoney(perPackage, 2)}</span> : "—", hint: perPackage != null && pay ? `Derived: units × ${formatMoney(limit)} (${formatPeriod(pay.period)})` : "No current payment limit" },
    { label: "FDA listing", value: fdaStatus, hint: primary?.manufacturerName ?? primary?.product.labelerName ?? "FDA NDC Directory", tone: fdaStatus === "Listed" ? "default" : "attention" },
  ];
  const glanceActions: GlanceAction[] = [
    ...(mainCode ? [{ href: `/calculator?code=${mainCode.code}&ndc=${formatted}`, label: "Calculate with this NDC", icon: <Calculator aria-hidden="true" className="h-4 w-4" />, primary: true }] : []),
    { href: "/tools/audit", label: "Audit a list of NDCs", icon: <ClipboardCheck aria-hidden="true" className="h-4 w-4" /> },
  ];

  const nav = [
    { id: "overview", label: "Overview" },
    { id: "hcpcs", label: "HCPCS & billing units" },
    { id: "reimbursement", label: "Reimbursement" },
    { id: "related", label: "Related" },
    { id: "sources", label: "Data sources" },
    { id: "limitations", label: "Limitations" },
  ];

  return (
    <>
      <RecordView href={`/ndc/${formatted}`} title={formatted} kind="ndc" subtitle={title} />
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ href: "/search", label: "Search" }, ...(primary?.drugSlug ? [{ href: `/drugs/${primary.drugSlug}`, label: primary.drugName ?? "Drug" }] : []), { label: `NDC ${formatted}` }]} />}
        title={
          <>
            <span className="code-chip">{formatted}</span>
            <span className="mt-2 block text-2xl font-normal text-ink-muted sm:text-3xl">{title}</span>
          </>
        }
        badges={
          <>
            {primary ? (
              <ActiveBadge active={primary.isActive} endDate={primary.package.marketingEnd} inactiveLabel={primary.package.listingStatus === "listed" ? `Marketing ended ${formatDate(primary.package.marketingEnd)}` : "Not in active FDA listing"} />
            ) : (
              <DataStatusBadge status="verification-needed" />
            )}
            {d.codes.map((c) => (
              <Link key={c.code} href={`/hcpcs/${c.code}`} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-rule-strong bg-surface px-2.5 text-sm hover:border-brand">
                <FamilyBadge code={c.code} />
                <span className="code-chip font-semibold text-ink">{c.code}</span>
              </Link>
            ))}
          </>
        }
        actions={<CopyButton text={formatted} label="Copy NDC" />}
      />

      <GlanceStrip items={glance} actions={glanceActions} />
      <StickyRecordBar
        title={formatted}
        subtitle={title}
        facts={[
          ...(mainCode ? [{ label: "HCPCS", value: mainCode.code }] : []),
          ...(units != null ? [{ label: "units / pkg", value: formatNumber(units) }] : []),
        ]}
        action={mainCode ? { href: `/calculator?code=${mainCode.code}&ndc=${formatted}`, label: "Calculate" } : undefined}
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[13rem_1fr]">
        <div>
          <SectionNav items={nav} />
        </div>
        <div className="min-w-0">
          {d.fda.length > 1 ? (
            <div className="mb-6">
              <Callout tone="warning" title="Conflict in the FDA directory">
                This package NDC appears under {d.fda.length} FDA product records. Both are shown below; confirm against the product labeling.
              </Callout>
            </div>
          ) : null}
          {!d.fda.length ? (
            <div className="mb-6">
              <Callout tone="warning" title="No FDA directory record found">
                CMS lists this NDC in its crosswalk, but it is not in the FDA NDC Directory files CodeRx imported (active or excluded). Verify the product with the labeler or FDA.
              </Callout>
            </div>
          ) : null}

          <Section id="overview" number="01" title="Overview">
            <h3 className="mb-3 text-sm font-semibold text-ink">NDC formats</h3>
            <KeyValueGrid
              columns={3}
              items={[
                { label: "11-digit (5-4-2)", value: formatted, mono: true },
                { label: "11-digit, no hyphens (claims)", value: d.ndc11, mono: true },
                { label: "FDA 10-digit", value: primary?.package.packageNdc ?? SITE.noData, mono: true },
              ]}
            />
            {d.fda.map((f) => (
              <div key={f.product.productId} className="mt-6">
                <KeyValueGrid
                  columns={3}
                  items={[
                    { label: "Product", value: [f.product.proprietaryName, f.product.proprietaryNameSuffix].filter(Boolean).join(" ") || SITE.noData },
                    { label: "Generic name", value: f.product.nonproprietaryName ?? SITE.noData },
                    { label: "Package description", value: f.package.description ?? SITE.noData },
                    { label: "Strength", value: f.product.strengths.join("; ") || SITE.noData, mono: true },
                    { label: "Dosage form", value: f.product.dosageForm ? titleCase(f.product.dosageForm) : SITE.noData },
                    { label: "Route", value: f.product.routes.map((r) => titleCase(r)).join("; ") || SITE.noData },
                    {
                      label: "Labeler",
                      value: f.manufacturerSlug ? (
                        <Link href={`/manufacturers/${f.manufacturerSlug}`} className="text-brand hover:underline">
                          {f.product.labelerName}
                        </Link>
                      ) : (
                        (f.product.labelerName ?? SITE.noData)
                      ),
                    },
                    { label: "Marketing start", value: formatDate(f.package.marketingStart ?? f.product.marketingStart) },
                    { label: "Marketing end", value: f.package.marketingEnd ? formatDate(f.package.marketingEnd) : "None listed" },
                    { label: "Listing status", value: f.package.listingStatus === "listed" ? "In the active FDA NDC Directory" : (f.package.excludeFlag ? EXCLUDE_FLAG_LABELS[f.package.excludeFlag] : "Excluded listing") },
                    { label: "Marketing category", value: [f.product.marketingCategory, f.product.applicationNumber].filter(Boolean).join(" · ") || "—" },
                    { label: "Sample package", value: f.package.sample ? "Yes" : "No" },
                  ]}
                />
              </div>
            ))}
            <ProvenanceFooter sources={[primary?.package.listingStatus === "excluded" ? d.releases.fdaExcluded : d.releases.fda]} />
          </Section>

          <Section id="hcpcs" number="02" title="HCPCS coding and billing units" description="Official CMS crosswalk rows for this NDC, newest first.">
            {d.crosswalk.length ? (
              <TableScroll label={`CMS crosswalk rows for NDC ${formatted}`}>
                <table className="w-full min-w-[52rem] border-collapse">
                  <caption className="sr-only">CMS crosswalk rows for NDC {formatted}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={th}>HCPCS</th>
                      <th scope="col" className={th}>HCPCS dosage</th>
                      <th scope="col" className={`${th} text-right`}>Pkg size × qty</th>
                      <th scope="col" className={`${th} text-right`}>Units / item</th>
                      <th scope="col" className={`${th} text-right`}>Units / NDC</th>
                      <th scope="col" className={th}>Crosswalk</th>
                      <th scope="col" className={th}>Quarters</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.crosswalk.map((x) => (
                      <tr key={`${x.hcpcsCode}-${x.ndcRaw}`} className={x.isCurrent ? "" : "text-ink-muted"}>
                        <th scope="row" className={`${td} text-left`}>
                          {x.hcpcsCode ? (
                            <Link href={`/hcpcs/${x.hcpcsCode}`} className="code-chip font-semibold text-brand hover:underline">
                              {x.hcpcsCode}
                            </Link>
                          ) : (
                            <span className="code-chip">NOC ({x.nocGenericName})</span>
                          )}
                        </th>
                        <td className={`${td} code-chip`}>{x.hcpcsDosage ?? "—"}</td>
                        <td className={`${td} code-chip text-right`}>
                          {formatNumber(x.packageSize)} × {formatNumber(x.packageQuantity)}
                        </td>
                        <td className={`${td} code-chip text-right`}>{formatNumber(x.billUnitsPerItem)}</td>
                        <td className={`${td} code-chip text-right font-semibold text-ink`}>{formatNumber(x.billUnitsPerPackage)}</td>
                        <td className={td}>{x.types.join(", ")}</td>
                        <td className={`${td} code-chip text-xs whitespace-nowrap`}>
                          {formatPeriod(x.periods[0])}
                          {x.periods.length > 1 ? ` – ${formatPeriod(x.periods.at(-1)!)}` : ""}
                          {!x.isCurrent ? <span className="block font-semibold text-accent">Not in latest file</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            ) : (
              <NoData>No CMS NDC–HCPCS crosswalk row was located for this NDC. CMS crosswalks are not a complete list of billable NDCs; confirm coding with the payer.</NoData>
            )}
            <ProvenanceFooter sources={[d.releases.crosswalk]} />
          </Section>

          <Section id="reimbursement" number="03" title="Reimbursement" description="Medicare Part B payment limits for the crosswalked code(s).">
            {d.codes.some((c) => c.payments.length) ? (
              <ul className="space-y-3">
                {d.codes
                  .filter((c) => c.payments.length)
                  .map((c) => {
                    const p = c.payments[0];
                    const units = currentRows.find((x) => x.hcpcsCode === c.code)?.billUnitsPerPackage;
                    const perPackage = p.paymentLimit !== null && units ? Number(p.paymentLimit) * Number(units) : null;
                    return (
                      <li key={c.code} className="rounded-xl border hairline bg-surface p-5">
                        <p className="text-sm text-ink-muted">
                          <Link href={`/hcpcs/${c.code}`} className="code-chip font-semibold text-brand hover:underline">
                            {c.code}
                          </Link>{" "}
                          · {formatPeriod(p.period)} · effective {formatDate(p.effectiveStart)} – {formatDate(p.effectiveEnd)}
                        </p>
                        <p className="mt-1 font-display text-3xl font-semibold text-ink">
                          <span className="code-chip">{p.paymentLimit !== null ? formatMoney(p.paymentLimit) : p.paymentLimitText}</span>
                          <span className="ml-2 text-base font-normal text-ink-muted">per {p.dosageDescriptor ?? "billing unit"}</span>
                        </p>
                        <p className="mt-1 text-xs text-ink-muted">
                          <DataStatusBadge status="official-cms" /> {p.methodology}
                        </p>
                        {perPackage !== null ? (
                          <p className="mt-3 text-sm text-ink">
                            <DataStatusBadge status="derived" /> {formatNumber(units)} units × {formatMoney(p.paymentLimit)} = <span className="code-chip font-semibold">{formatMoney(perPackage, 2)}</span> per 11-digit NDC package (arithmetic only; not a payment determination).
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
              </ul>
            ) : (
              <NoData />
            )}
            <ProvenanceFooter sources={[d.releases.payment]} />
          </Section>

          <Section id="related" number="04" title="Related">
            <ul className="space-y-2 text-sm">
              {d.fda
                .filter((f) => f.drugSlug)
                .map((f) => (
                  <li key={f.drugSlug}>
                    Drug page:{" "}
                    <Link href={`/drugs/${f.drugSlug}`} className="font-semibold text-brand hover:underline">
                      {f.drugName}
                    </Link>
                  </li>
                ))}
              {d.codes.map((c) => (
                <li key={c.code}>
                  HCPCS:{" "}
                  <Link href={`/hcpcs/${c.code}`} className="code-chip font-semibold text-brand hover:underline">
                    {c.code}
                  </Link>{" "}
                  <span className="text-ink-muted">{c.longDescription}</span>
                </li>
              ))}
              <li>
                <Link href={`/calculator?${d.codes[0] ? `code=${d.codes[0].code}&` : ""}ndc=${formatted}`} className="font-semibold text-brand hover:underline">
                  Open the billing-unit calculator with this NDC
                </Link>
              </li>
            </ul>
          </Section>

          <Section id="sources" number="05" title="Data sources">
            <ProvenanceFooter sources={d.provenance} />
          </Section>

          <Section id="limitations" number="06" title="Limitations and disclaimers">
            <LimitationsList
              items={[
                "FDA directory content is submitted by labelers and is not verified by FDA; an NDC does not denote approval or coverage.",
                "A missing crosswalk row does not mean the NDC cannot be billed; CMS crosswalks support ASP-based Part B payment only.",
                "Package-level dollar figures are simple multiplication of published values and are labeled as derived.",
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
