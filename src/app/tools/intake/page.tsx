import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Breadcrumbs, Callout, Disclaimer, NoData, PageHeader, TableScroll, td, th } from "@/components/layout-bits";
import { PrintButton } from "@/components/print-button";
import { ProvenanceFooter } from "@/components/provenance";
import { coverageSearchUrl } from "@/components/tool-blocks";
import { STATE_FEE_SOURCES } from "@/ingest/sources";
import { cachedHcpcsDetail } from "@/lib/data/cached";
import { formatDate, formatMoney, formatPeriod } from "@/lib/format";
import { normalizeHcpcs } from "@/lib/hcpcs";
import { MDRP_UNIT_TYPES, qualifierForUnitType } from "@/lib/medicaid";
import { MUE_SERVICE_LABELS } from "@/lib/mue";
import { SI_MEANING } from "@/lib/opps";
import { readPackageDescription } from "@/lib/package-label";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Referral intake card",
  description: "One printable page per drug code for infusion referral intake: billing unit, MUEs, NDCs with claim qualifiers, Medicare hospital and home payment path, Washington Apple Health prior authorization, and related biologics. No patient fields.",
  alternates: { canonical: "/tools/intake" },
};

type SP = Promise<Record<string, string | string[] | undefined>>;

const EXAMPLES = ["J1569", "J1745", "J9312", "J0897"];

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border hairline bg-surface p-4 break-inside-avoid print:border-ink/30 print:p-3">
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-ink-faint uppercase">{title}</h2>
      <div className="space-y-1.5 text-sm text-ink">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="grid grid-cols-[9rem_minmax(0,1fr)] gap-2">
      <span className="text-ink-muted">{label}</span>
      <span>{children}</span>
    </p>
  );
}

export default async function IntakePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const raw = typeof sp.code === "string" ? sp.code : "";
  const code = raw ? normalizeHcpcs(raw) : null;
  const d = code ? await cachedHcpcsDetail(code) : null;

  const header = (
    <PageHeader
      eyebrow={<Breadcrumbs items={[{ href: "/tools", label: "Tools" }, { label: "Referral intake card" }]} />}
      title={d ? `Intake card: ${d.code.code}` : "Referral intake card"}
      subtitle={d ? (d.code.longDescription ?? undefined) : "One printable page per drug code for intake staff: how it bills, what Medicare and Apple Health need, and which NDCs map to it. No patient fields."}
    />
  );
  const form = (
    <form action="/tools/intake" method="get" className="mb-6 flex flex-wrap items-end gap-2 print:hidden" aria-label="Choose a drug code">
      <label className="text-sm font-semibold text-ink">
        Drug HCPCS code
        <input name="code" defaultValue={code ?? raw} placeholder="e.g. J1569" autoComplete="off" className="mt-1 block min-h-11 w-40 rounded-lg border border-rule-strong bg-surface-raised px-3 text-base text-ink uppercase" />
      </label>
      <button type="submit" className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 font-semibold text-paper hover:bg-brand-strong dark:text-paper-sunken">
        Make card
      </button>
      {d ? <PrintButton label="Print card" /> : null}
    </form>
  );

  if (!d) {
    return (
      <>
        {header}
        {form}
        {raw ? (
          <Callout tone="warning" title={code ? `${code} is not in the CMS HCPCS file` : "Not a HCPCS Level II code"}>
            {code ? SITE.noData : "Enter a drug code such as J1569 (a letter and four digits)."}
          </Callout>
        ) : null}
        <p className="mb-2 text-sm font-semibold text-ink">Examples</p>
        <ul className="mb-10 flex flex-wrap gap-2">
          {EXAMPLES.map((c) => (
            <li key={c}>
              <Link href={`/tools/intake?code=${c}`} className="code-chip inline-flex min-h-10 items-center rounded-full border border-rule-strong px-3 text-sm font-semibold text-ink hover:border-brand hover:text-brand">
                {c}
              </Link>
            </li>
          ))}
        </ul>
        <Disclaimer />
      </>
    );
  }

  const latest = d.payments[0] && d.payments[0].period === d.latestPaymentPeriod ? d.payments[0] : null;
  const ndcs = d.crosswalk
    .filter((x) => x.isCurrent && x.ndc11)
    .map((x) => {
      const facts = readPackageDescription(x.fda?.packageDescription);
      const unitType = x.medicaid?.unitType ?? null;
      return { x, facts, unitType, qualifier: qualifierForUnitType(unitType) };
    });
  const containers = new Set(ndcs.map((n) => n.facts.containerType));
  const singleDose = containers.has("single-dose");
  const appleHealthPa = d.appleHealthDrugFees.filter((f) => f.priorAuth);
  const si = d.opps?.statusIndicator ?? null;
  const products = [
    ...d.linkedDrugs.map((p) => ({ slug: p.slug, name: p.displayName, note: "billed with this code" })),
    ...d.relatedBiologics.map((b) => ({ slug: b.slug, name: b.displayName, note: `${b.relation === "reference" ? "reference product" : "biosimilar"}${b.hcpcsCodes.length ? ` · ${b.hcpcsCodes.join(", ")}` : ""}` })),
  ];

  const checklist: string[] = [
    "Confirm the patient's coverage and whether the drug is on the medical or the pharmacy benefit.",
    ...(appleHealthPa.length ? [`Apple Health (professional claims): ${appleHealthPa.map((f) => f.priorAuth).join(", ")} required — see HCA's prior authorization page.`] : []),
    "Medicare: check the MAC's LCDs and billing articles for covered diagnoses (coverage link below).",
    ...(singleDose ? ["Single-dose container: record any discarded amount (JW line) or bill JZ when none is discarded (Medicare Part B)."] : []),
    "Bill the 11-digit NDC with the N4 qualifier, unit qualifier, and quantity; Apple Health requires the NDC on professionally administered drug claims.",
    ...(si === "N" ? ["Medicare HOPD: this drug is packaged (status N) — no separate drug payment."] : []),
    "Home infusion (not a Medicare HIT supplier): Medicare pays the drug at home only under Part B DME rules or as Part D; no Medicare payment for home infusion services.",
  ];

  return (
    <>
      {header}
      {form}
      <p className="mb-4 text-xs text-ink-muted">
        Generated from CodeRx data on {formatDate(new Date().toISOString())}. No patient information is entered or stored. Verify payer requirements before scheduling.
      </p>
      {!d.isActive ? (
        <div className="mb-4">
          <Callout tone="danger" title="Terminated code">
            CMS lists a termination date of {formatDate(d.code.terminationDate)} for {d.code.code}. Check the cross-reference on the <Link href={`/hcpcs/${d.code.code}`}>code page</Link>.
          </Callout>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 print:grid-cols-2 print:gap-3">
        <Box title="Billing">
          <Row label="HCPCS code">
            <span className="code-chip font-semibold">{d.code.code}</span> {d.isActive ? "(active)" : "(terminated)"}
          </Row>
          <Row label="Billing unit">{d.billingUnit.text ?? SITE.noData}</Row>
          <Row label="Part B limit">{latest?.paymentLimit != null ? `${formatMoney(latest.paymentLimit)} per unit (${formatPeriod(latest.period)})` : SITE.noData}</Row>
          <Row label="Max units / day (MUE)">
            {d.mue.length ? d.mue.map((m) => `${MUE_SERVICE_LABELS[m.serviceType].short} ${m.value}`).join(" · ") : SITE.noData}
          </Row>
          <Row label="JW / JZ">
            {singleDose
              ? "Single-dose containers on the CMS crosswalk: JW for discarded drug, JZ when none (Medicare Part B)."
              : containers.has("multi-dose")
                ? "Multi-dose containers: JW and JZ do not apply."
                : "Container type is not stated in the FDA package text; check the label."}
          </Row>
        </Box>

        <Box title="Medicare">
          <Row label="Hospital outpatient">
            {d.opps ? (
              <>
                <span className="code-chip font-semibold">{si ?? "—"}</span> {SI_MEANING[si ?? ""] ?? "See CMS Addendum D1"}
                {d.opps.paymentRate != null ? ` · ${formatMoney(d.opps.paymentRate)} per unit` : ""} ({formatPeriod(d.opps.period)})
              </>
            ) : (
              SITE.noData
            )}
          </Row>
          <Row label="Home infusion">Part B pays the drug at home only under the DME benefit (e.g. a pump drug under the External Infusion Pump policy, or IVIG for primary immune deficiency); otherwise Part D. Home infusion therapy services are paid only to Medicare HIT suppliers.</Row>
          <Row label="Coverage">
            <a href={coverageSearchUrl(d.code.code)} rel="noopener noreferrer" className="font-semibold text-brand hover:underline print:text-ink">
              LCDs and articles for {d.code.code} (Medicare Coverage Database)
            </a>
          </Row>
        </Box>

        <Box title="Washington Apple Health">
          <Row label="Professional claims">
            {d.appleHealthDrugFees.length
              ? d.appleHealthDrugFees.map((f) => (
                  <span key={`${f.hcpcsCode}-${f.modifier ?? ""}`} className="block">
                    {f.modifier ? `${f.modifier}: ` : ""}
                    {f.fees[0]?.amount != null ? `${formatMoney(f.fees[0].amount, 2)} maximum allowable` : (f.fees[0]?.text ?? "—")}
                    {f.priorAuth ? <strong className="ml-1 text-accent">· {f.priorAuth}</strong> : " · no PA flag"}
                    {f.comments ? <span className="block text-xs text-ink-muted">{f.comments}</span> : null}
                  </span>
                ))
              : "Not on HCA's professional administered drug fee schedule."}
          </Row>
          <Row label="Hospital outpatient">Paid by EAPG (3M grouper weight × the hospital&apos;s conversion factor); certain high-cost drugs are paid outside EAPG.</Row>
          <Row label="Home infusion">HCA pays supply, pump, and parenteral nutrition codes from its home infusion schedule; per diem S-codes are not on it.</Row>
          <p className="text-xs text-ink-muted">{STATE_FEE_SOURCES.wa_hca_professional_drugs.note}</p>
        </Box>

        <Box title="Products">
          {products.length ? (
            <ul className="space-y-1">
              {products.map((p) => (
                <li key={p.slug}>
                  <Link href={`/drugs/${p.slug}`} className="font-semibold text-brand hover:underline print:text-ink">
                    {p.name}
                  </Link>{" "}
                  <span className="text-ink-muted">({p.note})</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-muted">{SITE.noData}</p>
          )}
          <p className="text-xs text-ink-muted">Reference and biosimilar links come from the FDA Purple Book; substitution follows FDA licensure, payer policy, and state law.</p>
        </Box>
      </div>

      <section className="mt-6 break-inside-avoid" aria-labelledby="ndc-heading">
        <h2 id="ndc-heading" className="mb-2 text-sm font-semibold tracking-wide text-ink-faint uppercase">
          NDCs on the current CMS crosswalk ({ndcs.length})
        </h2>
        {ndcs.length ? (
          <TableScroll label="NDCs for this code">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <caption className="sr-only">NDCs mapped to {d.code.code} with package, billing units, and claim unit qualifier</caption>
              <thead>
                <tr>
                  {["NDC (11-digit)", "Labeler", "Package", "Container", "Units / pkg", "Medicaid unit", "N4 qualifier"].map((h) => (
                    <th key={h} scope="col" className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ndcs.map(({ x, facts, unitType, qualifier }) => (
                  <tr key={x.ndcRaw}>
                    <td className={`${td} code-chip whitespace-nowrap`}>
                      <Link href={`/ndc/${x.ndcFormatted}`} className="font-semibold text-brand hover:underline print:text-ink">
                        {x.ndcFormatted}
                      </Link>
                    </td>
                    <td className={td}>{x.labelerName ?? "—"}</td>
                    <td className={`${td} text-ink-muted`}>{x.fda?.packageDescription ?? x.drugName ?? "—"}</td>
                    <td className={td}>{facts.containerType ?? "not stated"}</td>
                    <td className={`${td} code-chip`}>{x.billUnitsPerPackage ?? "—"}</td>
                    <td className={td}>{unitType ? `${unitType}${MDRP_UNIT_TYPES[unitType] ? ` (${MDRP_UNIT_TYPES[unitType]})` : ""}` : "—"}</td>
                    <td className={`${td} code-chip font-semibold`}>{qualifier ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        ) : (
          <NoData>No NDC is mapped to {d.code.code} on the current CMS crosswalk.</NoData>
        )}
      </section>

      <section className="mt-6 break-inside-avoid rounded-xl border hairline bg-surface p-4" aria-labelledby="check-heading">
        <h2 id="check-heading" className="mb-2 text-sm font-semibold tracking-wide text-ink-faint uppercase">
          Intake checklist
        </h2>
        <ul className="space-y-1.5 text-sm text-ink">
          {checklist.map((c) => (
            <li key={c} className="flex gap-2">
              <span aria-hidden="true" className="mt-1 inline-block h-3.5 w-3.5 shrink-0 rounded-sm border border-rule-strong" />
              {c}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm print:hidden">
          <Link href={`/calculator?code=${d.code.code}`} className="font-semibold text-brand hover:underline">
            Calculate units and claim lines
          </Link>{" "}
          ·{" "}
          <Link href={`/tools/site-of-care?code=${d.code.code}`} className="font-semibold text-brand hover:underline">
            Compare HOPD and home infusion
          </Link>
        </p>
      </section>

      <ProvenanceFooter sources={[d.releases.hcpcs, d.releases.payment, d.releases.crosswalk, d.releases.opps, d.releases.appleHealthDrugs, ...d.mueReleases.filter((r) => d.mue.some((m) => m.releaseId === r.releaseId))]} />
      <div className="mt-8">
        <Disclaimer />
      </div>
    </>
  );
}
