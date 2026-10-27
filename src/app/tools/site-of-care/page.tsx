import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, Callout, Disclaimer, KeyValueGrid, PageHeader, Section } from "@/components/layout-bits";
import { ProvenanceFooter } from "@/components/provenance";
import { SiteOfCareTool } from "@/components/tools/site-of-care-tool";
import { cachedSiteOfCare } from "@/lib/data/cached";
import { formatMoney, formatPeriod } from "@/lib/format";
import { normalizeHcpcs } from "@/lib/hcpcs";

export const metadata: Metadata = {
  title: "Site of care: HOPD vs home infusion",
  description:
    "Compare what one infusion therapy is paid per month in a hospital outpatient department versus a home infusion pharmacy without Medicare HIT certification — Medicare (CMS OPPS Addendum A and B, ASP), Washington Apple Health (HCA fee schedule), and your commercial terms.",
  alternates: { canonical: "/tools/site-of-care" },
};

type SP = Promise<Record<string, string | string[] | undefined>>;

/** CMS status indicator meanings (OPPS Addendum D1), for the codes a drug commonly carries. */
const SI_MEANING: Record<string, string> = {
  K: "Paid separately (non-pass-through drug or biological)",
  G: "Paid separately (pass-through drug or biological)",
  N: "Packaged: no separate payment",
  A: "Paid under a fee schedule other than the OPPS",
  B: "Not recognized by the OPPS on an outpatient hospital bill",
  E1: "Not covered by Medicare",
  E2: "Not paid: no pricing information or claims data",
  M: "Not billable to the MAC by hospitals",
};

const EXAMPLES = [
  { code: "J1569", label: "Immune globulin (Gammagard Liquid)" },
  { code: "J1745", label: "Infliximab" },
  { code: "J9312", label: "Rituximab" },
  { code: "J0897", label: "Denosumab" },
];

const param = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const numParam = (v: string | string[] | undefined) => {
  const s = param(v);
  return /^\d{1,5}(\.\d{1,3})?$/.test(s) ? s : "";
};

export default async function SiteOfCarePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const raw = param(sp.code);
  const code = raw ? normalizeHcpcs(raw) : null;
  const data = code ? await cachedSiteOfCare(code) : null;

  return (
    <>
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ href: "/tools", label: "Tools" }, { label: "Site of care" }]} />}
        title="Site of care: HOPD vs home infusion"
        subtitle="Where one therapy is paid more each month: your hospital outpatient department or your home infusion pharmacy (not a Medicare home infusion therapy supplier). Medicare rates come from CMS; Apple Health supply and pump fees from the HCA schedule; EAPG, pharmacy, and contract amounts are yours and stay in this browser."
      />

      <form action="/tools/site-of-care" method="get" className="mb-6 flex flex-wrap items-end gap-2" aria-label="Choose a drug code">
        <label className="text-sm font-semibold text-ink">
          Drug HCPCS code
          <input name="code" defaultValue={code ?? raw} placeholder="e.g. J1569" autoComplete="off" className="mt-1 block min-h-11 w-40 rounded-lg border border-rule-strong bg-surface-raised px-3 text-base text-ink uppercase" />
        </label>
        <label className="text-sm font-semibold text-ink">
          Units per administration
          <input name="units" defaultValue={numParam(sp.units)} inputMode="decimal" className="mt-1 block min-h-11 w-40 rounded-lg border border-rule-strong bg-surface-raised px-3 text-base text-ink" />
        </label>
        <button type="submit" className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 font-semibold text-paper hover:bg-brand-strong dark:text-paper-sunken">
          Compare
        </button>
      </form>

      {!code ? (
        <>
          {raw ? (
            <Callout tone="warning" title="Not a HCPCS Level II code">
              Enter a drug code such as J1569 (five characters: a letter and four digits).
            </Callout>
          ) : null}
          <p className="mb-2 text-sm font-semibold text-ink">Examples</p>
          <ul className="mb-10 flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <li key={e.code}>
                <Link href={`/tools/site-of-care?code=${e.code}`} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-rule-strong px-3 text-sm text-ink hover:border-brand hover:text-brand">
                  <span className="code-chip font-semibold">{e.code}</span> {e.label}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : !data?.found ? (
        <Callout tone="warning" title={`${code} is not in the CMS HCPCS file`}>
          No authoritative public data was located for this field.
        </Callout>
      ) : (
        <>
          <Section id="drug" number="01" title={`${data.code} at a glance`} description={data.longDescription ?? undefined}>
            <KeyValueGrid
              columns={3}
              items={[
                { label: "CMS billing unit", value: data.asp?.dosage ?? "No authoritative public data was located for this field." },
                {
                  label: `Part B payment limit${data.asp ? ` (${formatPeriod(data.asp.period)})` : ""}`,
                  value: data.asp?.limit != null ? `${formatMoney(data.asp.limit)} per unit` : "No authoritative public data was located for this field.",
                  mono: true,
                },
                {
                  label: `OPPS status${data.opps ? ` (${formatPeriod(data.opps.period)})` : ""}`,
                  value: data.opps ? (
                    <>
                      <span className="code-chip font-semibold">{data.opps.statusIndicator ?? "—"}</span> {SI_MEANING[data.opps.statusIndicator ?? ""] ?? "See CMS Addendum D1"}
                      {data.opps.paymentRate != null ? <span className="block text-sm text-ink-muted">{formatMoney(data.opps.paymentRate)} per unit · APC {data.opps.apc}</span> : null}
                      {data.opps.note ? <span className="block text-sm text-ink-muted">{data.opps.note}</span> : null}
                    </>
                  ) : (
                    "No authoritative public data was located for this field."
                  ),
                },
              ]}
            />
            {!data.isDrug ? (
              <div className="mt-4">
                <Callout tone="warning">CMS does not flag {data.code} as a drug code; the comparison may not apply.</Callout>
              </div>
            ) : null}
          </Section>
          <div className="mb-10">
            <SiteOfCareTool key={data.code} data={data} initialUnits={numParam(sp.units)} initialPerMonth={numParam(sp.perMonth) || "1"} />
          </div>
          <Section id="method" number="02" title="How the comparison works">
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-muted">
              <li>
                <span className="font-semibold text-ink">Medicare HOPD:</span> the drug is paid at its Addendum B rate when its status indicator is K or G, and not separately when it is N (packaged). Drug administration is paid by APC from Addendum A, with 60% of each rate adjusted by your wage index (42 CFR 419.43) and, if it applies to your hospital, the 340B remedy offset ratio CMS publishes in the addenda.
              </li>
              <li>
                <span className="font-semibold text-ink">Medicare at home without HIT certification:</span> no payment for home infusion therapy services or per diem S-codes. The drug is paid from the CMS payment limit file only when Part B covers it at home and you bill as a DMEPOS supplier; otherwise it is a Part D claim at the plan&apos;s rate.
              </li>
              <li>
                <span className="font-semibold text-ink">Apple Health:</span> HCA pays hospital outpatient claims by EAPG, which needs 3M&apos;s licensed grouper and your hospital&apos;s conversion factor, so you enter that payment. Home supplies and pumps use the HCA home infusion fee schedule{data.hca?.effectiveDate ? ` effective ${data.hca.effectiveDate}` : ""}.
              </li>
              <li>
                <span className="font-semibold text-ink">Not modeled:</span> outlier payments, the rural sole community hospital adjustment, the cap on a single line&apos;s coinsurance, Medicare Advantage, and patient bad debt.
              </li>
            </ul>
          </Section>
          <ProvenanceFooter sources={data.provenance} />
        </>
      )}
      <div className="mt-10">
        <Disclaimer />
      </div>
    </>
  );
}
