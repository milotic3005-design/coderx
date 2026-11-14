import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, Callout, Disclaimer, KeyValueGrid, PageHeader, Section, TableScroll, td, th } from "@/components/layout-bits";
import { ProvenanceFooter } from "@/components/provenance";
import { cachedWaCoverage } from "@/lib/data/cached";
import { UMP_PDL_URL, type CoverageGroup, type WaCoverageData } from "@/lib/data/wa-coverage";
import { MAX_PRODUCTS } from "@/lib/rxnorm";
import { NADAC_LABEL, type CoverageRow, type YesNoUnknown } from "@/lib/wa-coverage";

export const metadata: Metadata = {
  title: "Washington drug coverage",
  description: "Is a drug on Washington Apple Health, Medicare Part D, and exchange plan formularies, at what tier, and with what prior authorization, step therapy, and quantity limits — matched by RxNorm codes, with each source's date and the NADAC reference price.",
  alternates: { canonical: "/tools/wa-coverage" },
};

type SP = Promise<Record<string, string | string[] | undefined>>;

const PATH = "/tools/wa-coverage";
const EXAMPLES = [
  { q: "atorvastatin", label: "generic" },
  { q: "Ozempic", label: "brand with PA" },
  { q: "Enbrel", label: "biologic" },
  { q: "Viagra", label: "often not covered" },
  { q: "Remicade", label: "infusion" },
];

const YNU: Record<YesNoUnknown, { label: string; className: string }> = {
  yes: { label: "Yes", className: "font-semibold text-ink" },
  no: { label: "No", className: "text-ink" },
  unknown: { label: "Unknown", className: "text-accent" },
};
const BENEFIT: Record<CoverageRow["benefitType"], string> = { pharmacy: "Pharmacy", medical: "Medical", unknown: "Unknown" };

function Ynu({ value }: { value: YesNoUnknown }) {
  return <span className={YNU[value].className}>{YNU[value].label}</span>;
}

const lookupHref = (q: string) => `${PATH}?q=${encodeURIComponent(q)}`;
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 })}`;

function RowsTable({ group }: { group: CoverageGroup }) {
  return (
    <TableScroll label={`${group.title}: coverage`}>
      <table className="w-full min-w-[64rem] border-collapse">
        <caption className="sr-only">{group.title}: coverage by plan</caption>
        <thead>
          <tr>
            <th scope="col" className={th}>
              Plan
            </th>
            <th scope="col" className={th}>
              Covered
            </th>
            <th scope="col" className={th}>
              Tier or status
            </th>
            <th scope="col" className={th}>
              PA
            </th>
            <th scope="col" className={th}>
              Step therapy
            </th>
            <th scope="col" className={th}>
              Quantity limit
            </th>
            <th scope="col" className={th}>
              Cost-sharing rule
            </th>
            <th scope="col" className={th}>
              Benefit
            </th>
            <th scope="col" className={th}>
              Notes
            </th>
          </tr>
        </thead>
        <tbody>
          {group.rows.map((r) => (
            <tr key={r.plan}>
              <th scope="row" className={`${td} text-left font-semibold text-ink`}>
                {r.plan}
              </th>
              <td className={td}>
                {r.covered === "unknown" && r.coveredNote ? <span className="text-ink">Varies by plan</span> : <Ynu value={r.covered} />}
                {r.coveredNote ? <span className="block text-xs text-ink-muted">{r.coveredNote}</span> : null}
              </td>
              <td className={td}>{r.tier ?? <span className="text-ink-muted">—</span>}</td>
              <td className={td}>
                <Ynu value={r.priorAuth} />
              </td>
              <td className={td}>
                <Ynu value={r.stepTherapy} />
              </td>
              <td className={td}>
                <Ynu value={r.quantityLimit} />
              </td>
              <td className={`${td} max-w-[16rem] text-xs`}>{r.costSharing ?? <span className="text-ink-muted">Not stated</span>}</td>
              <td className={td}>{BENEFIT[r.benefitType]}</td>
              <td className={`${td} max-w-[26rem] text-xs text-ink-muted`}>{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

/** "Listed on 20 of 20 plans. Among those: PA on 20, …" for an insurer's plans; plans where a restriction covers only some forms are counted apart. */
function exchangeSummary(rows: CoverageRow[]): string {
  const listed = rows.filter((r) => r.covered === "yes");
  if (!listed.length) return `Not listed on any of ${rows.length} plans.`;
  const count = (key: "priorAuth" | "stepTherapy" | "quantityLimit", label: string) => {
    const all = listed.filter((r) => r[key] === "yes").length;
    const some = listed.filter((r) => r[key] === "unknown").length;
    return `${label} on ${all}${some ? ` (on some forms only: ${some} more)` : ""}`;
  };
  return `Listed on ${listed.length} of ${rows.length} plans. Among those: ${count("priorAuth", "PA")}, ${count("stepTherapy", "step therapy")}, ${count("quantityLimit", "quantity limit")}.`;
}

function GroupBlock({ group }: { group: CoverageGroup }) {
  return (
    <div className="mb-8">
      <h3 className="mb-2 text-lg font-semibold text-ink">{group.title}</h3>
      {group.state === "missing" ? <Callout tone="warning">{group.note}</Callout> : null}
      {group.state === "link-only" ? (
        <Callout>
          {group.note}{" "}
          <a href={UMP_PDL_URL} className="font-semibold text-brand underline" rel="noopener noreferrer">
            UMP preferred drug list (PDF, HCA)
          </a>
        </Callout>
      ) : null}
      {group.state === "ok" ? (
        group.key.startsWith("exchange_") ? (
          <>
            <p className="mb-2 text-sm text-ink">{exchangeSummary(group.rows)}</p>
            <details className="rounded-lg border hairline bg-surface px-3 py-2">
              <summary className="cursor-pointer text-sm font-semibold text-brand">Show each plan ({group.rows.length})</summary>
              <div className="mt-3">
                <RowsTable group={group} />
              </div>
            </details>
          </>
        ) : (
          <RowsTable group={group} />
        )
      ) : null}
      <ProvenanceFooter sources={group.provenance} />
    </div>
  );
}

function Results({ data }: { data: WaCoverageData }) {
  const { lookup } = data;
  if (lookup.kind === "none") {
    return (
      <Callout tone="warning" title="RxNorm does not recognize this name">
        Check the spelling, or try the brand or generic name. CodeRx looks drugs up in RxNorm (the National Library of Medicine&apos;s drug vocabulary) and does not guess.
      </Callout>
    );
  }
  if (lookup.kind === "too-broad") {
    return (
      <Callout tone="warning" title="This name is too broad">
        RxNorm lists {lookup.products} products for it (the limit is {MAX_PRODUCTS}). Try a brand name or a more specific generic name, for example &ldquo;insulin glargine&rdquo; instead of &ldquo;insulin&rdquo;.
      </Callout>
    );
  }
  if (lookup.kind === "suggestions") {
    return (
      <div className="mb-10">
        <Callout tone="warning" title="No exact match in RxNorm">
          RxNorm has no drug by exactly this name. Its closest names are below; CodeRx does not pick one for you.
        </Callout>
        <ul aria-label="RxNorm's closest names" className="mt-3 flex flex-wrap gap-2">
          {lookup.suggestions.map((s) => (
            <li key={s}>
              <Link href={lookupHref(s)} className="inline-flex min-h-10 items-center rounded-full border border-rule-strong px-3 text-sm text-ink hover:border-brand hover:text-brand">
                {s}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const { match } = lookup;
  return (
    <>
      <Section id="match" number="01" title="What was matched" description="Coverage is looked up by these RxNorm product IDs (RxCUIs) and their NDCs, not by name.">
        <KeyValueGrid
          columns={3}
          items={[
            { label: "Searched for", value: match.matchedName },
            { label: "RxNorm products", value: String(match.products.length) },
            { label: "NDCs", value: String(match.ndcs.length) },
          ]}
        />
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-semibold text-brand">Show the products</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-muted">
            {match.products.map((p) => (
              <li key={p.rxcui}>
                {p.name} <span className="code-chip">RxCUI {p.rxcui}</span>
              </li>
            ))}
          </ul>
        </details>
      </Section>

      <Section id="coverage" number="02" title="Coverage by plan" description="Formulary status as each plan publishes it. A cost-sharing rule is what the plan states for that tier, not what a patient will pay.">
        {data.groups.map((g) => (
          <GroupBlock key={g.key} group={g} />
        ))}
      </Section>

      <Section id="nadac" number="03" title="Reference price (NADAC)" description={NADAC_LABEL}>
        {data.reference ? (
          <>
            {data.reference.prices.length ? (
              <TableScroll label="NADAC by product">
                <table className="w-full min-w-[44rem] border-collapse">
                  <caption className="sr-only">NADAC per pricing unit by product</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={th}>
                        Product (NADAC description)
                      </th>
                      <th scope="col" className={th}>
                        Brand or generic
                      </th>
                      <th scope="col" className={th}>
                        NADAC per unit
                      </th>
                      <th scope="col" className={th}>
                        NDCs
                      </th>
                      <th scope="col" className={th}>
                        Effective
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reference.prices.map((p) => (
                      <tr key={`${p.product}|${p.unit}|${p.brandOrGeneric}|${p.nadacClass ?? ""}`}>
                        <th scope="row" className={`${td} text-left font-semibold text-ink`}>
                          {p.product}
                        </th>
                        <td className={td}>{p.brandOrGeneric === "unknown" ? `Unknown (class ${p.nadacClass})` : p.brandOrGeneric === "brand" ? "Brand" : "Generic"}</td>
                        <td className={`${td} font-mono`}>
                          {p.low === p.high ? money(p.low) : `${money(p.low)} – ${money(p.high)}`} per {p.unit}
                        </td>
                        <td className={td}>{p.ndcCount}</td>
                        <td className={td}>{p.effectiveDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            ) : null}
            <p className="mt-2 text-sm text-ink-muted">{data.reference.reason}</p>
            <ProvenanceFooter sources={data.reference.provenance} />
          </>
        ) : (
          <Callout tone="warning">NADAC is not loaded into CodeRx yet.</Callout>
        )}
      </Section>

      <Section id="method" number="04" title="How to read this">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-muted">
          <li>&ldquo;Unknown&rdquo; means the source does not settle the answer; the Notes column says why. CodeRx shows unknown rather than guess.</li>
          <li>PA, step therapy, and quantity limit read &ldquo;Yes&rdquo; only when every listed strength and form has it, and &ldquo;No&rdquo; only when none does.</li>
          <li>A drug not listed under any of its current RxNorm product IDs shows as not on the formulary. It may still be covered by a formulary exception, or under the medical benefit when given in a clinic.</li>
          <li>Exchange plans: Washington runs its own exchange, so insurers do not all publish machine-readable formularies. Only those that publish Washington plans this way are shown, for the plan year in their files.</li>
          <li>Part D: CMS&apos;s file gives formularies and how many plans use each, not plan names, so the Part D row counts plans.</li>
        </ul>
      </Section>
    </>
  );
}

export default async function WaCoveragePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const q = (typeof sp.q === "string" ? sp.q : "").trim().replace(/\s+/g, " ").slice(0, 100);
  let data: WaCoverageData | null = null;
  let failed = false;
  if (q) {
    try {
      data = await cachedWaCoverage(q);
    } catch (error) {
      console.error(JSON.stringify({ level: "error", scope: "tools.wa-coverage", message: error instanceof Error ? error.message : String(error) }));
      failed = true;
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ href: "/tools", label: "Tools" }, { label: "Washington drug coverage" }]} />}
        title="Washington drug coverage"
        subtitle="Is a drug on the formulary of Washington Apple Health, Medicare Part D plans in Washington, and exchange plans, at what tier, and with what prior authorization, step therapy, and quantity limits. Each answer shows its source and date."
      />

      <form action={PATH} method="get" className="mb-6 flex flex-wrap items-end gap-2" aria-label="Choose a drug">
        <label className="text-sm font-semibold text-ink">
          Drug name (brand or generic)
          <input name="q" defaultValue={q} placeholder="e.g. Ozempic or atorvastatin" autoComplete="off" maxLength={100} className="mt-1 block min-h-11 w-72 max-w-full rounded-lg border border-rule-strong bg-surface-raised px-3 text-base text-ink" />
        </label>
        <button type="submit" className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 font-semibold text-paper hover:bg-brand-strong dark:text-paper-sunken">
          Check coverage
        </button>
      </form>

      {!q ? (
        <>
          <p className="mb-2 text-sm font-semibold text-ink">Examples</p>
          <ul className="mb-10 flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <li key={e.q}>
                <Link href={lookupHref(e.q)} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-rule-strong px-3 text-sm text-ink hover:border-brand hover:text-brand">
                  <span className="font-semibold">{e.q}</span> {e.label}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {failed ? (
        <Callout tone="danger" title="The lookup could not finish">
          RxNorm (NLM) or the CodeRx database did not answer. Try again in a minute.
        </Callout>
      ) : null}
      {data ? <Results data={data} /> : null}

      <div className="mt-10 space-y-3">
        <p className="text-sm font-semibold text-ink">Formulary reference only, not a coverage determination or a patient&apos;s cost. Confirm with the plan.</p>
        <p className="text-xs text-ink-muted">
          This product uses publicly available data from the U.S. National Library of Medicine (NLM), National Institutes of Health, Department of Health and Human Services; NLM is not responsible for the product and does not endorse or recommend this or any other product.
        </p>
        <Disclaimer />
      </div>
    </>
  );
}
