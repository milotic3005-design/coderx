import type { Metadata } from "next";
import { BenchmarkLockButton, BenchmarkUnlockForm } from "@/components/benchmark-lock";
import { Breadcrumbs, Callout, Disclaimer, PageHeader, Section } from "@/components/layout-bits";
import { ProvenanceFooter } from "@/components/provenance";
import { SocCalculator } from "@/components/tools/soc-calculator";
import { benchmarkUnlocked } from "@/lib/benchmark-access";
import { cachedSoc } from "@/lib/data/cached";
import { withRule, type SocPayerView } from "@/lib/data/soc";
/** Today in Washington: the tool counts days for patients in the Pacific time zone. */
const todayPacific = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());

export const metadata: Metadata = {
  title: "Site-of-care denial check",
  description: "Password-protected: payer site-of-care rules for infused drugs (UnitedHealthcare, Premera, Regence, Aetna, Cigna, Anthem), the hospital window for one patient, and what changed in this month's policies.",
  alternates: { canonical: "/tools/soc-check" },
  robots: { index: false, follow: false },
};

type SP = Promise<Record<string, string | string[] | undefined>>;
const PATH = "/tools/soc-check";
const fmt = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "not stated");
const entry = (e: { code: string | null; label: string }) => `${e.code ? `${e.code} ` : ""}${e.label}`;
/** A list a person can read: the PDF or policy that prints it; for a machine-readable file (Aetna's XML), the policy page. */
const readableList = (p: SocPayerView) => (!p.list ? null : p.list.url === p.policy?.url || p.list.url.toLowerCase().endsWith(".pdf") ? p.list.url : (p.policy?.url ?? null));

function Changes({ payers, today }: { payers: SocPayerView[]; today: string }) {
  const items: { key: string; payer: string; text: string; tone: "warning" | "info" }[] = [];
  for (const p of payers) {
    if (p.changedSinceReview) items.push({ key: `${p.key}-review`, payer: p.rule.name, tone: "warning", text: "Criteria wording changed since the rule here was written. Review the current wording below; the window may be out of date." });
    if (p.future) {
      const parts = [p.future.added.length ? `adds ${p.future.added.map(entry).join("; ")}` : "", p.future.removed.length ? `removes ${p.future.removed.map(entry).join("; ")}` : "", p.future.criteriaChanged ? "changes the criteria wording" : ""].filter(Boolean);
      items.push({ key: `${p.key}-future`, payer: p.rule.name, tone: "warning", text: `Posted a new version effective ${fmt(p.future.effectiveDate)}${parts.length ? ` that ${parts.join(", ")}` : " with no change to the drug list"}.` });
    }
    const upcoming = (p.list?.entries ?? []).filter((e) => e.addedDate && e.addedDate > today);
    if (upcoming.length) items.push({ key: `${p.key}-upcoming`, payer: p.rule.name, tone: "warning", text: `Coming under the policy: ${upcoming.map((e) => `${entry(e)} on ${fmt(e.addedDate)}`).join("; ")}.` });
    for (const h of p.history) {
      const parts = [h.changes.added.length ? `added ${h.changes.added.length} (${h.changes.added.slice(0, 8).map(entry).join("; ")}${h.changes.added.length > 8 ? "; …" : ""})` : "", h.changes.removed.length ? `removed ${h.changes.removed.length} (${h.changes.removed.slice(0, 8).map(entry).join("; ")}${h.changes.removed.length > 8 ? "; …" : ""})` : "", h.changes.criteriaChanged ? "criteria wording changed" : "", h.changes.upcoming.length ? `a future version was posted (effective ${h.changes.upcoming.map((u) => fmt(u.effectiveDate)).join(", ")})` : ""].filter(Boolean);
      items.push({ key: `${p.key}-${h.importedAt}`, payer: p.rule.name, tone: "info", text: `Refresh of ${fmt(h.importedAt.slice(0, 10))}: ${parts.join("; ")}.` });
    }
  }
  if (!items.length) return <p className="text-sm text-ink-muted">No changes detected since the policies were first loaded.</p>;
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.key} className={`rounded-lg border px-3 py-2 text-sm ${i.tone === "warning" ? "border-accent/40 bg-accent-tint/50" : "hairline bg-surface"}`}>
          <span className="font-semibold text-ink">{i.payer}:</span> <span className="text-ink">{i.text}</span>
        </li>
      ))}
    </ul>
  );
}

function PayerRules({ p }: { p: SocPayerView }) {
  const { rule } = p;
  return (
    <section id={`rules-${p.key}`} aria-labelledby={`rules-${p.key}-title`} className="mb-8 scroll-mt-24 rounded-xl border hairline bg-surface p-5">
      <h3 id={`rules-${p.key}-title`} className="text-lg font-semibold text-ink">
        {rule.name}
      </h3>
      <p className="mt-1 text-sm text-ink-muted">
        {p.policy ? `${p.policy.title}${p.policy.policyNumber ? ` (${p.policy.policyNumber})` : ""}, effective ${fmt(p.policy.effectiveDate)}. ` : "Not loaded yet. "}
        {rule.writtenFrom.reviewedBy ? `Rule reviewed by ${rule.writtenFrom.reviewedBy}.` : `Rule transcribed from the payer's text on ${fmt(rule.writtenFrom.transcribedOn)}; not yet reviewed by a pharmacist.`}
      </p>
      {p.changedSinceReview ? (
        <div className="mt-3">
          <Callout tone="warning" title="Changed since this rule was written">
            The payer&apos;s current criteria wording (below) differs from the wording the window and quotes here were written from ({fmt(rule.writtenFrom.effectiveDate)} version).
          </Callout>
        </div>
      ) : null}
      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="font-semibold text-ink">Plans it covers</dt>
          <dd className="text-ink-muted">{rule.scope}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Initial hospital period</dt>
          <dd className="text-ink-muted">
            {rule.window.kind === "days"
              ? `${rule.window.approximate ? `About ${rule.window.days} days, given by the payer as an example; the hospital still needs its approval.` : `${rule.window.days} days.`} Day 1 is ${rule.window.startsFrom}. Applies to: ${rule.window.qualifies ?? "new courses"} `
              : `${rule.window.note ?? ""} `}
            The policy: “{rule.window.quote}”
          </dd>
        </div>
        {rule.oncologyDoses ? (
          <div>
            <dt className="font-semibold text-ink">Oncology drugs (★ on the list)</dt>
            <dd className="text-ink-muted">“{rule.oncologyDoses.quote}”</dd>
          </div>
        ) : null}
        {rule.exceptionLimit ? (
          <div>
            <dt className="font-semibold text-ink">After an exception</dt>
            <dd className="text-ink-muted">“{rule.exceptionLimit.quote}”</dd>
          </div>
        ) : null}
        {rule.firstDose ? (
          <div>
            <dt className="font-semibold text-ink">First dose</dt>
            <dd className="text-ink-muted">{rule.firstDose}</dd>
          </div>
        ) : null}
        <div>
          <dt className="font-semibold text-ink">Drug list</dt>
          <dd className="text-ink-muted">
            {rule.listNote} {p.list ? `${p.list.entries.length} entries${p.list.date ? `, dated ${fmt(p.list.date)}` : ""}.` : ""}
          </dd>
        </div>
      </dl>
      {p.policy?.criteriaText ? (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-semibold text-brand">Exception criteria, in the payer&apos;s current words</summary>
          <pre className="mt-2 max-h-[32rem] overflow-auto rounded-lg bg-paper-sunken p-3 font-sans text-xs whitespace-pre-wrap text-ink">{p.policy.criteriaText}</pre>
          <p className="mt-1 text-xs text-ink-muted">
            From{" "}
            <a href={p.policy.url} className="font-semibold text-brand underline" rel="noopener noreferrer">
              the payer&apos;s policy
            </a>
            , as fetched by the monthly refresh, with page headers and footers removed. The text is the payer&apos;s own, shown for internal reference; the copy on the payer&apos;s site governs.
          </p>
        </details>
      ) : null}
      <ProvenanceFooter sources={p.provenance} />
    </section>
  );
}

export default async function SocCheckPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const header = (
    <PageHeader
      eyebrow={<Breadcrumbs items={[{ href: "/tools", label: "Tools" }, { label: "Site-of-care denial check" }]} />}
      title="Site-of-care denial check"
      subtitle="Which payers require infusions outside the hospital, how long hospital infusion is allowed for a new start, and when to move a patient to home infusion or request an exception, from each payer's current policy."
    />
  );
  if (!(await benchmarkUnlocked())) {
    return (
      <>
        {header}
        <BenchmarkUnlockForm
          next={PATH}
          denied={sp.access === "denied"}
          label="Unlock the site-of-care denial check"
          title="The site-of-care denial check is password protected"
          description="Enter the CodeRx password (the same one as the MultiCare price benchmark)."
        />
      </>
    );
  }
  const today = todayPacific();
  const cachedView = await cachedSoc();
  const { loaded } = cachedView;
  const payers = cachedView.payers.map(withRule);
  return (
    <>
      {header}
      <div className="mb-6 flex justify-end">
        <BenchmarkLockButton next={PATH} />
      </div>
      {!loaded ? (
        <div className="mb-6">
          <Callout tone="warning" title="Payer policies are not loaded yet">
            Run the monthly refresh (npm run refresh:soc-policies) to load them.
          </Callout>
        </div>
      ) : null}
      <Section id="check" number="01" title="Check a patient" description="The hospital window and what to do before it ends. Nothing entered here is saved or sent.">
        <SocCalculator payers={payers.map((p) => ({ key: p.key, rule: p.rule, entries: p.list?.entries ?? null, listDate: p.list?.date ?? null, listUrl: readableList(p), changedSinceReview: p.changedSinceReview }))} today={today} />
      </Section>
      <Section id="changes" number="02" title="What changed" description="Updated by the monthly refresh: new and removed drugs, versions posted ahead of their effective date, and criteria wording that changed since review.">
        <Changes payers={payers} today={today} />
      </Section>
      <Section id="rules" number="03" title="Payer rules" description="Each payer's scope, hospital window, and exception criteria, quoted from its own policy.">
        {payers.map((p) => (
          <PayerRules key={p.key} p={p} />
        ))}
      </Section>
      <div className="mt-10 space-y-3">
        <p className="text-sm font-semibold text-ink">A planning aid from the payers&apos; published policies, not a coverage determination. Confirm with the payer for the member&apos;s plan.</p>
        <Disclaimer />
      </div>
    </>
  );
}
