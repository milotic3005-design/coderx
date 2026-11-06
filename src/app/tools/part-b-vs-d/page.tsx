import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, Callout, Disclaimer, KeyValueGrid, PageHeader, Section } from "@/components/layout-bits";
import { ProvenanceFooter } from "@/components/provenance";
import { PartBDTool } from "@/components/tools/part-b-d-tool";
import { SOURCES } from "@/ingest/sources";
import { slugSchema } from "@/lib/api/validation";
import { resolveBenefitQuery } from "@/lib/data/benefit";
import { cachedBenefit } from "@/lib/data/cached";
import { formatMoney, formatPeriod } from "@/lib/format";
import { normalizeHcpcs } from "@/lib/hcpcs";
import { SI_MEANING } from "@/lib/opps";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Part B vs Part D",
  description: "Which Medicare benefit pays for a drug in each setting: Part A, Part B, the DME benefit, or Part D, from CMS's SAD lists, DME policies, OPPS status, and Washington Part D plans, with the dollars for each lawful pathway.",
  alternates: { canonical: "/tools/part-b-vs-d" },
};

type SP = Promise<Record<string, string | string[] | undefined>>;

const EXAMPLES = [
  { code: "J0490", label: "Belimumab (IV or subcutaneous)" },
  { code: "J3285", label: "Treprostinil (pump)" },
  { code: "J7507", label: "Tacrolimus (transplant)" },
  { code: "J0897", label: "Denosumab" },
];

const param = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const numParam = (v: string | string[] | undefined) => {
  const s = param(v);
  return /^\d{1,5}(\.\d{1,3})?$/.test(s) ? s : "";
};

function NotInCodeRx() {
  return (
    <Callout tone="warning" title="This drug is not in CodeRx">
      CodeRx indexes clinician-administered drugs and the oral, inhaled, and other drugs CMS assigns a HCPCS code. Outpatient oral drugs without a code are usually Part D.
    </Callout>
  );
}

export default async function PartBvsDPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const q = param(sp.q).trim();
  const parsedSlug = slugSchema.safeParse(param(sp.drug));
  const resolved = q ? await resolveBenefitQuery(q) : null;
  const code = normalizeHcpcs(param(sp.code)) ?? resolved?.code ?? null;
  const slug = (parsedSlug.success ? parsedSlug.data : null) ?? resolved?.slug ?? null;
  const data = code || slug ? await cachedBenefit(code ?? "", slug ?? "") : null;
  const labels = new Map(resolved?.choices.map((c) => [c.code, c.label]));
  const needsCode = !!data?.found && !data.code && data.codes.length > 1;

  return (
    <>
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ href: "/tools", label: "Tools" }, { label: "Part B vs Part D" }]} />}
        title="Part B vs Part D"
        subtitle="Which Medicare benefit pays for a drug in each setting, and what each lawful pathway pays. Part B and Part D are not a choice: a drug is not a Part D drug when Part A or B would pay for it as prescribed and administered, so the answer depends on the facts of the case."
      />

      <form action="/tools/part-b-vs-d" method="get" className="mb-6 flex flex-wrap items-end gap-2" aria-label="Choose a drug">
        <label className="text-sm font-semibold text-ink">
          Drug, HCPCS code, or NDC
          <input name="q" defaultValue={q || data?.code || data?.drug?.displayName || ""} placeholder="e.g. Benlysta or J0490" autoComplete="off" className="mt-1 block min-h-11 w-72 max-w-full rounded-lg border border-rule-strong bg-surface-raised px-3 text-base text-ink" />
        </label>
        <button type="submit" className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 font-semibold text-paper hover:bg-brand-strong dark:text-paper-sunken">
          Look up
        </button>
      </form>

      {!q && !data ? (
        <>
          <p className="mb-2 text-sm font-semibold text-ink">Examples</p>
          <ul className="mb-10 flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <li key={e.code}>
                <Link href={`/tools/part-b-vs-d?code=${e.code}`} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-rule-strong px-3 text-sm text-ink hover:border-brand hover:text-brand">
                  <span className="code-chip font-semibold">{e.code}</span> {e.label}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {(q || code || slug) && !data?.found ? <NotInCodeRx /> : null}

      {needsCode ? (
        <div className="mb-10">
          <p className="mb-2 text-sm font-semibold text-ink">{data.drug?.displayName ?? "This drug"} has more than one HCPCS code. Choose one: each can have a different answer.</p>
          <ul aria-label="HCPCS codes for this drug" className="flex flex-wrap gap-2">
            {data.codes.map((c) => (
              <li key={c}>
                <Link href={`/tools/part-b-vs-d?code=${c}${data.drug ? `&drug=${data.drug.slug}` : ""}`} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-rule-strong px-3 text-sm text-ink hover:border-brand hover:text-brand">
                  <span className="code-chip font-semibold">{c}</span> {labels.get(c) ?? ""}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data?.found && !needsCode ? (
        <>
          {data.missingSources.length ? (
            <div className="mb-6">
              <Callout tone="warning" title="Some CMS data is not loaded yet">
                Rows that depend on it say so: {data.missingSources.map((k) => SOURCES[k].shortName).join("; ")}.
              </Callout>
            </div>
          ) : null}
          <Section id="drug" number="01" title={data.code ? `${data.code} at a glance` : (data.drug?.displayName ?? "This drug")} description={data.description ?? undefined}>
            <KeyValueGrid
              columns={3}
              items={[
                { label: "CMS billing unit", value: data.asp?.dosage ?? SITE.noData },
                { label: `Part B payment limit${data.asp ? ` (${formatPeriod(data.asp.period)})` : ""}`, value: data.asp?.limit != null ? `${formatMoney(data.asp.limit)} per unit` : SITE.noData, mono: true },
                {
                  label: `OPPS status${data.opps ? ` (${formatPeriod(data.opps.period)})` : ""}`,
                  value: data.opps ? (
                    <>
                      <span className="code-chip font-semibold">{data.opps.statusIndicator ?? "—"}</span> {SI_MEANING[data.opps.statusIndicator ?? ""] ?? "See CMS Addendum D1"}
                    </>
                  ) : (
                    SITE.noData
                  ),
                },
              ]}
            />
          </Section>
          <PartBDTool key={`${data.code}-${data.drug?.slug}`} data={data} initialUnits={numParam(sp.units)} />
          <Section id="method" number="06" title="How this is decided">
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-muted">
              <li>Each row follows CMS rules from the statute and manuals. Noridian JF&apos;s self-administered drug list decides for Washington; other contractors&apos; lists are counted but do not change the answer.</li>
              <li>Medicare Advantage: the benefit answer is the same, but plan rules and rates differ.</li>
              <li>Being on a CMS list does not by itself meet coverage criteria. Check the LCD, the diagnosis, and the patient&apos;s plan before billing.</li>
            </ul>
          </Section>
          <ProvenanceFooter sources={data.provenance} />
        </>
      ) : null}

      <div className="mt-10 space-y-3">
        <p className="text-sm font-semibold text-ink">Guidance only, not a coverage determination.</p>
        <Disclaimer />
      </div>
    </>
  );
}
