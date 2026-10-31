import type { Metadata } from "next";
import Link from "next/link";
import { BenchmarkLockButton, BenchmarkUnlockForm } from "@/components/benchmark-lock";
import { HospitalRatesTable } from "@/components/hospital-rates";
import { Breadcrumbs, Callout, Disclaimer, PageHeader, Section } from "@/components/layout-bits";
import { ProvenanceFooter } from "@/components/provenance";
import { cachedHcpcsDetail } from "@/lib/data/cached";
import { formatMoney, formatPeriod } from "@/lib/format";
import { benchmarkUnlocked } from "@/lib/benchmark-access";
import { normalizeHcpcs } from "@/lib/hcpcs";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "MultiCare price benchmark",
  description: "Negotiated outpatient drug rates from MultiCare hospitals' federally required price transparency files, per CMS billing unit and against the Medicare payment limit, by plan type. No payer names.",
  alternates: { canonical: "/tools/price-benchmark" },
};

type SP = Promise<Record<string, string | string[] | undefined>>;
const EXAMPLES = ["J9312", "J1745", "J1569", "J0897"];

export default async function PriceBenchmarkPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const raw = typeof sp.code === "string" ? sp.code : "";
  const code = raw ? normalizeHcpcs(raw) : null;
  const unlocked = await benchmarkUnlocked();
  const here = `/tools/price-benchmark${code ? `?code=${code}` : ""}`;
  if (!unlocked) {
    return (
      <>
        <PageHeader eyebrow={<Breadcrumbs items={[{ href: "/tools", label: "Tools" }, { label: "MultiCare price benchmark" }]} />} title="MultiCare price benchmark" />
        <div className="mb-10 max-w-xl">
          <BenchmarkUnlockForm next={here} denied={sp.access === "denied"} />
        </div>
        <Disclaimer />
      </>
    );
  }
  const d = code ? await cachedHcpcsDetail(code) : null;
  const latest = d?.payments[0] && d.payments[0].period === d.latestPaymentPeriod ? d.payments[0] : null;
  const limit = latest?.paymentLimit != null ? Number(latest.paymentLimit) : null;

  return (
    <>
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ href: "/tools", label: "Tools" }, { label: "MultiCare price benchmark" }]} />}
        title={d ? `MultiCare price benchmark: ${d.code.code}` : "MultiCare price benchmark"}
        subtitle="What MultiCare's Washington hospitals have negotiated for a drug, per CMS billing unit and against the Medicare Part B payment limit, by plan type — from each hospital's federally required price transparency file. Payer and plan names are not shown."
      />
      <form action="/tools/price-benchmark" method="get" className="mb-6 flex flex-wrap items-end gap-2" aria-label="Choose a drug code">
        <label className="text-sm font-semibold text-ink">
          Drug HCPCS code
          <input name="code" defaultValue={code ?? raw} placeholder="e.g. J9312" autoComplete="off" className="mt-1 block min-h-11 w-40 rounded-lg border border-rule-strong bg-surface-raised px-3 text-base text-ink uppercase" />
        </label>
        <button type="submit" className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 font-semibold text-paper hover:bg-brand-strong dark:text-paper-sunken">
          Show rates
        </button>
      </form>
      <div className="-mt-3 mb-6">
        <BenchmarkLockButton next={here} />
      </div>
      {!d ? (
        <>
          {raw ? (
            <Callout tone="warning" title={code ? `${code} is not in the CMS HCPCS file` : "Not a HCPCS Level II code"}>
              {code ? SITE.noData : "Enter a drug code such as J9312 (a letter and four digits)."}
            </Callout>
          ) : null}
          <p className="mb-2 text-sm font-semibold text-ink">Examples</p>
          <ul className="mb-10 flex flex-wrap gap-2">
            {EXAMPLES.map((c) => (
              <li key={c}>
                <Link href={`/tools/price-benchmark?code=${c}`} className="code-chip inline-flex min-h-10 items-center rounded-full border border-rule-strong px-3 text-sm font-semibold text-ink hover:border-brand hover:text-brand">
                  {c}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <Section
            id="rates"
            number="01"
            title={d.code.longDescription ?? d.code.code}
            description={`CMS billing unit: ${d.billingUnit.text ?? "not stated"}. Medicare Part B payment limit: ${limit != null ? `${formatMoney(limit)} per unit (${formatPeriod(latest!.period)})` : "none published"}.`}
          >
            <HospitalRatesTable code={d.code.code} rates={d.hospitalRates} billingUnit={d.billingUnit.parsed} unitText={d.billingUnit.text} paymentLimit={limit} />
            <p className="mt-4 text-sm">
              <Link href={`/tools/site-of-care?code=${d.code.code}`} className="font-semibold text-brand hover:underline">
                Use these as commercial terms in the site-of-care comparison
              </Link>
            </p>
          </Section>
          <ProvenanceFooter sources={[d.releases.payment, ...d.hospitalRates.hospitals.map((h) => h.release)]} />
        </>
      )}
      <div className="mt-10">
        <Disclaimer />
      </div>
    </>
  );
}
