"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { BenefitData } from "@/lib/data/benefit";
import { formatMoney, formatPeriod } from "@/lib/format";
import { compareDollars, convertUnitCost, type PathwayKey } from "@/lib/part-b-d-dollars";
import { decideBenefit, homeSummary, questionsFor, RULE_SOURCES, type QuestionKey, type RouteChoice, type Setting, type SettingResult, type Verdict } from "@/lib/part-b-d";
import { Section, TableScroll, td, th } from "../layout-bits";

const KEY = "coderx:part-b-d";

const SETTING_LABEL: Record<Setting, string> = {
  inpatient: "Inpatient Part A stay",
  snf: "SNF Part A stay",
  hospice: "Hospice",
  hopd: "HOPD",
  home_pump: "Home, DME pump",
  home_no_pump: "Home, no pump",
  ltc: "Long-term care, not a Part A stay",
};

const VERDICT_LABEL: Record<Verdict, string> = {
  part_a: "Part A bundle",
  hospice: "Hospice benefit",
  part_b: "Part B",
  part_b_packaged: "Part B, packaged",
  part_b_dme: "Part B, DME contractor",
  part_d: "Part D",
  not_part_b: "Not Part B",
  check: "Needs a check",
  not_applicable: "Does not apply",
};

const VERDICT_STYLE: Record<Verdict, string> = {
  part_a: "border-rule-strong text-ink",
  hospice: "border-rule-strong text-ink",
  part_b: "border-brand text-brand",
  part_b_packaged: "border-brand text-brand",
  part_b_dme: "border-brand text-brand",
  part_d: "border-accent text-ink",
  not_part_b: "border-danger text-danger",
  check: "border-dashed border-rule-strong text-ink",
  not_applicable: "border-rule text-ink-muted",
};

const QUESTION: Record<QuestionKey, string> = {
  transplant: "Medicare-covered organ transplant?",
  cancer: "Used for cancer, with the same active ingredient and indication as IV chemotherapy?",
  antiemetic48h: "Within 48 hours of chemotherapy, as a full replacement for an IV antiemetic?",
  pid: "Home IVIG for primary immune deficiency?",
  nebulizer: "Given by nebulizer?",
  clottingFactor: "Hemophilia clotting factor the patient self-administers?",
  dialysisEsa: "ESA or ESRD drug for a dialysis patient?",
  permanentGi: "Parenteral nutrition for permanent GI dysfunction?",
};

const ROUTE_LABEL: Record<Exclude<RouteChoice, null>, string> = { iv: "Intravenous", subcutaneous: "Subcutaneous", im: "Intramuscular", oral: "Oral", other: "Other" };
const FDA_ROUTE: Record<string, Exclude<RouteChoice, null>> = { INTRAVENOUS: "iv", SUBCUTANEOUS: "subcutaneous", INTRAMUSCULAR: "im", ORAL: "oral" };

const PATHWAY_LABEL: Record<PathwayKey, string> = { hopd_b: "HOPD, Part B", home_b_dme: "Home, Part B", home_d: "Home, Part D" };
const NO_DATA = "No authoritative public data was located for this field.";

/** The DMEPOS answer lasts across visits on this browser; if storage is blocked it lasts until the tab closes. */
const listeners = new Set<() => void>();
let memory: boolean | null = null;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
function readEnrolled(): boolean {
  if (memory != null) return memory;
  try {
    return window.localStorage.getItem(KEY) === "enrolled";
  } catch {
    return false;
  }
}
function writeEnrolled(enrolled: boolean) {
  memory = enrolled;
  try {
    window.localStorage.setItem(KEY, enrolled ? "enrolled" : "not-enrolled");
  } catch {
    // Blocked storage: the in-memory value still applies.
  }
  listeners.forEach((l) => l());
}

/** Blank is null; anything else stays a number, NaN included, so the dollars code can reject it. */
const parse = (text: string) => (text.trim() === "" ? null : Number(text));

const money = (v: number | null) => (v == null ? "—" : formatMoney(v, 2));

function routeOptions(data: BenefitData): Exclude<RouteChoice, null>[] {
  const status = data.facts.sad?.status;
  if (status === "route_specific") return ["iv", "subcutaneous"];
  if (status === "double_route") return ["im", "subcutaneous"];
  const routes = [...new Set(data.facts.routes.flatMap((r) => (FDA_ROUTE[r] ? [FDA_ROUTE[r]] : [])))];
  return routes.length > 1 ? routes : [];
}

function Question({ id, value, onChange }: { id: QuestionKey; value: boolean | undefined; onChange: (v: boolean | undefined) => void }) {
  return (
    <label className="block text-sm font-semibold text-ink">
      {QUESTION[id]}
      <select value={value === undefined ? "" : value ? "yes" : "no"} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "yes")} className="mt-1 block min-h-11 w-44 rounded-lg border border-rule-strong bg-surface-raised px-3 text-base font-normal text-ink">
        <option value="">Not answered</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
}

function VerdictChip({ verdict }: { verdict: Verdict }) {
  return <span className={`inline-block rounded-md border px-2 py-0.5 text-sm font-semibold whitespace-nowrap ${VERDICT_STYLE[verdict]}`}>{VERDICT_LABEL[verdict]}</span>;
}

function ResultRow({ r, dates }: { r: SettingResult; dates: BenefitData["sourceDates"] }) {
  return (
    <tr>
      <th scope="row" className={`${td} text-left font-semibold text-ink`}>
        {SETTING_LABEL[r.setting]}
      </th>
      <td className={td}>
        <VerdictChip verdict={r.verdict} />
        {r.modifier ? <span className="mt-1 block text-sm font-semibold text-ink">Modifier {r.modifier}</span> : null}
      </td>
      <td className={`${td} min-w-[18rem]`}>
        <p className="text-ink">{r.reason}</p>
        {r.notes.map((n) => (
          <p key={n} className="mt-1 text-ink-muted">
            {n}
          </p>
        ))}
      </td>
      <td className={`${td} min-w-[11rem] text-xs`}>
        <ul className="space-y-1">
          {r.sources.map((s) => (
            <li key={s}>
              <a href={RULE_SOURCES[s].url} rel="noopener noreferrer" className="text-brand hover:underline">
                {RULE_SOURCES[s].title}, {RULE_SOURCES[s].section}
              </a>
              {dates[s] ? <span className="block text-ink-faint">Data: {formatPeriod(dates[s])}</span> : null}
            </li>
          ))}
        </ul>
      </td>
    </tr>
  );
}

export function PartBDTool({ data, initialUnits }: { data: BenefitData; initialUnits: string }) {
  const { facts, partD } = data;
  const [route, setRoute] = useState<RouteChoice>(null);
  const [answers, setAnswers] = useState<Partial<Record<QuestionKey, boolean>>>({});
  const [units, setUnits] = useState(initialUnits);
  const [doses, setDoses] = useState("1");
  const [contractRate, setContractRate] = useState("");
  const enrolled = useSyncExternalStore(subscribe, readEnrolled, () => false);

  const options = routeOptions(data);
  const questions = useMemo(() => questionsFor(facts), [facts]);
  const results = decideBenefit(facts, { route, answers, dmeposEnrolled: enrolled });
  const row = (setting: Setting) => results.find((r) => r.setting === setting)!;
  const home = homeSummary(results);

  const converted = convertUnitCost(partD?.costs ?? [], data.asp?.limit ?? null);
  const dollars = compareDollars({
    results,
    units: parse(units),
    dosesPerMonth: parse(doses),
    opps: data.opps,
    paymentLimit: data.asp?.limit ?? null,
    partBCoinsurancePct: data.asp?.coinsurancePct,
    inpatientDeductible: data.inpatientDeductible,
    partDPerHcpcsUnit: converted.perHcpcsUnit,
    rawPartD: converted.raw,
    contractRate: parse(contractRate),
  });
  const partDPath = dollars.pathways.find((p) => p.key === "home_d")!;
  const set = (id: QuestionKey) => (value: boolean | undefined) => setAnswers((a) => ({ ...a, [id]: value }));
  const listed = partD ? partD.plansListing.pdp + partD.plansListing.mapd : 0;
  const total = partD ? partD.plansTotal.pdp + partD.plansTotal.mapd : 0;
  const hasPartBPath = results.some((r) => r.verdict === "part_b" || r.verdict === "part_b_packaged" || r.verdict === "part_b_dme");

  return (
    <>
      <Section id="case" number="02" title="This case" description="Questions appear only when they change the answer.">
        <div className="flex flex-wrap items-end gap-4">
          {options.length ? (
            <label className="text-sm font-semibold text-ink">
              Route
              <select value={route ?? ""} onChange={(e) => setRoute((e.target.value || null) as RouteChoice)} className="mt-1 block min-h-11 w-44 rounded-lg border border-rule-strong bg-surface-raised px-3 text-base font-normal text-ink">
                <option value="">Choose a route</option>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {ROUTE_LABEL[o]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {questions.primary.map((q) => (
            <Question key={q} id={q} value={answers[q]} onChange={set(q)} />
          ))}
        </div>
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold text-brand">Other situations</summary>
          <div className="mt-3 flex flex-wrap items-end gap-4">
            {questions.other.map((q) => (
              <Question key={q} id={q} value={answers[q]} onChange={set(q)} />
            ))}
          </div>
        </details>
        <label className="mt-4 flex min-h-11 items-center gap-2 text-sm font-semibold text-ink">
          <input type="checkbox" checked={enrolled} onChange={(e) => writeEnrolled(e.target.checked)} className="h-5 w-5" />
          My pharmacy is enrolled with Medicare as a DMEPOS supplier
        </label>
      </Section>

      <Section id="answer" number="03" title="Who pays, by setting" description="Your two sites first, then every setting.">
        <dl className="mb-4 grid gap-3 sm:grid-cols-2">
          {[
            { label: "Your HOPD", r: row("hopd") },
            { label: "Your home infusion pharmacy", r: home },
          ].map(({ label, r }) => (
            <div key={label} className="rounded-xl border hairline bg-surface p-4">
              <dt className="text-xs font-semibold tracking-wide text-ink-faint uppercase">{label}</dt>
              <dd className="mt-1">
                <VerdictChip verdict={r.verdict} />
              </dd>
            </div>
          ))}
        </dl>
        <TableScroll label="Who pays in each setting">
          <table className="w-full min-w-[46rem] border-collapse">
            <caption className="sr-only">Which Medicare benefit pays for this drug in each setting, with the reason and source</caption>
            <thead>
              <tr>
                {["Setting", "Who pays", "Why", "Source"].map((h) => (
                  <th key={h} scope="col" className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <ResultRow key={r.setting} r={r} dates={data.sourceDates} />
              ))}
            </tbody>
          </table>
        </TableScroll>
        {data.policyLinks.length ? <p className="mt-3 text-sm text-ink-muted">CMS DME policies listing this code: {data.policyLinks.map((p) => `${p.title} (${p.displayId})`).join("; ")}.</p> : null}
      </Section>

      <Section id="dollars" number="04" title="Dollars for the lawful pathways" description="Part B applies 2% sequestration to Medicare's share. The Part D benchmark is a retail average, not a home infusion contract rate.">
        <div className="mb-4 flex flex-wrap items-end gap-4">
          <label className="text-sm font-semibold text-ink">
            Units per dose
            <input value={units} onChange={(e) => setUnits(e.target.value)} inputMode="decimal" className="mt-1 block min-h-11 w-36 rounded-lg border border-rule-strong bg-surface-raised px-3 text-base font-normal text-ink" />
          </label>
          <label className="text-sm font-semibold text-ink">
            Doses per month
            <input value={doses} onChange={(e) => setDoses(e.target.value)} inputMode="decimal" className="mt-1 block min-h-11 w-36 rounded-lg border border-rule-strong bg-surface-raised px-3 text-base font-normal text-ink" />
          </label>
          <label className="text-sm font-semibold text-ink">
            Your Part D contract rate per HCPCS unit (optional)
            <input value={contractRate} onChange={(e) => setContractRate(e.target.value)} inputMode="decimal" className="mt-1 block min-h-11 w-48 rounded-lg border border-rule-strong bg-surface-raised px-3 text-base font-normal text-ink" />
          </label>
        </div>
        <TableScroll label="Dollars by pathway">
          <table className="w-full min-w-[36rem] border-collapse">
            <caption className="sr-only">Expected payment for each lawful pathway</caption>
            <thead>
              <tr>
                {["Pathway", "Per HCPCS unit", "Per dose", "Per month", "Source"].map((h) => (
                  <th key={h} scope="col" className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dollars.pathways.map((p) => (
                <tr key={p.key}>
                  <th scope="row" className={`${td} text-left font-semibold text-ink`}>
                    {PATHWAY_LABEL[p.key]}
                    {dollars.higher === p.key ? <span className="mt-1 block text-xs font-semibold text-brand">Higher for this case</span> : null}
                  </th>
                  <td className={`${td} code-chip`}>{p.allowedPerUnit == null ? "—" : formatMoney(p.allowedPerUnit)}</td>
                  <td className={`${td} code-chip`}>{money(p.expectedPerDose)}</td>
                  <td className={`${td} code-chip`}>{money(p.expectedPerMonth)}</td>
                  <td className={td}>{p.source === "you" ? "You entered" : p.source === "cms" ? "CMS" : p.lawful ? NO_DATA : "Does not apply to this case"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        <div className="mt-3 space-y-1 text-sm text-ink-muted">
          {dollars.contractRateRejected ? <p>Enter your contract rate as a number above 0. It is not being used.</p> : null}
          {dollars.higher ? <p>Site of care is a clinical decision, not a billing choice.</p> : null}
          {dollars.onlyOneLawful ? <p>Only one pathway is lawful for this case, so there is nothing to rank.</p> : null}
          {partDPath.source == null && dollars.rawPartD != null && row("home_no_pump").verdict === "part_d" ? <p>CMS&apos;s median plan cost is {formatMoney(dollars.rawPartD)} per NDC unit. These units don&apos;t convert cleanly, so no dollar comparison is shown.</p> : null}
          <p>
            Part D pays no supplies or nursing. For administration and nursing, use{" "}
            <Link href={`/tools/site-of-care${data.code ? `?code=${data.code}` : ""}`} className="font-semibold text-brand hover:underline">
              Site of care
            </Link>
            .
          </p>
        </div>
      </Section>

      <Section id="plans" number="05" title="Washington Part D plans" description="From CMS's quarterly formulary file. A plan's own rules decide; check its formulary before billing.">
        <div className="rounded-xl border hairline bg-surface p-5 text-sm">
          {!partD ? (
            <p className="text-ink-muted">{NO_DATA}</p>
          ) : listed ? (
            <>
              <p className="font-semibold text-ink">
                {listed} of {total} Washington plans list this drug: {partD.plansListing.pdp} of {partD.plansTotal.pdp} PDPs and {partD.plansListing.mapd} of {partD.plansTotal.mapd} MA-PDs.
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-muted">
                {partD.tierMin != null ? <li>Tier {partD.tierMin === partD.tierMax ? partD.tierMin : `${partD.tierMin} to ${partD.tierMax}`}</li> : null}
                <li>Prior authorization on {partD.priorAuth} plans</li>
                <li>Step therapy on {partD.stepTherapy} plans</li>
                <li>Quantity limit on {partD.quantityLimit} plans</li>
                {partD.selectedDrug ? <li>A Medicare negotiated (selected) drug</li> : null}
              </ul>
            </>
          ) : (
            <>
              <p className="font-semibold text-ink">CMS&apos;s formulary file does not list this drug for Washington plans.</p>
              {hasPartBPath ? <p className="mt-1 text-ink-muted">This drug also has a Part B pathway above. The file does not say why it is unlisted.</p> : null}
            </>
          )}
          {partD?.linkedBy.length ? <p className="mt-3 text-xs text-ink-faint">Matched by {partD.linkedBy.join(", ")}.</p> : null}
        </div>
      </Section>
    </>
  );
}
