import type { Metadata } from "next";
import Link from "next/link";
import { DataStatusBadge } from "@/components/badges";
import { Disclaimer, PageHeader, Section, SectionNav } from "@/components/layout-bits";
import { SCOPE_STATEMENT } from "@/ingest/scope";
import { ABBREVIATIONS } from "@/lib/search/synonyms";

export const metadata: Metadata = {
  title: "Methodology",
  description: "How CodeRx sources, normalizes, relates, and ranks drug coding and reimbursement data — and what it does not do.",
  alternates: { canonical: "/methodology" },
};

const nav = [
  { id: "principles", label: "Principles" },
  { id: "sources", label: "Sources & refresh" },
  { id: "normalization", label: "Normalization" },
  { id: "relationships", label: "Relationships" },
  { id: "reimbursement", label: "Reimbursement" },
  { id: "units", label: "Billing units" },
  { id: "search", label: "Search ranking" },
  { id: "badges", label: "Status badges" },
  { id: "limitations", label: "Limitations" },
  { id: "assumptions", label: "Assumptions" },
];

export default function MethodologyPage() {
  return (
    <>
      <PageHeader title="Methodology" subtitle="How every number in CodeRx is sourced, transformed, and labeled." />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[13rem_1fr]">
        <div>
          <SectionNav items={nav} />
        </div>
        <div className="max-w-3xl min-w-0 text-ink-muted [&_li]:mt-1.5 [&_strong]:text-ink [&_ul]:list-disc [&_ul]:pl-5">
          <Section id="principles" number="01" title="Principles">
            <ul>
              <li><strong>Government sources only.</strong> CMS and FDA files are downloaded directly from the publisher; nothing is copied from commercial or third-party sites.</li>
              <li><strong>No inferred codes.</strong> A NDC is linked to a HCPCS code only when a CMS NDC–HCPCS crosswalk row says so. Similar names, ingredients, or NDCs never create a link, and no language model is used to map codes.</li>
              <li><strong>Provenance everywhere.</strong> Each data section names its source file, publication and effective dates, import time, and a direct link.</li>
              <li><strong>Gaps are shown, not filled.</strong> Missing values read “No authoritative public data was located for this field.”</li>
              <li><strong>Conflicts are shown.</strong> Duplicate FDA records and CMS revisions of a posted quarter are displayed rather than silently resolved.</li>
            </ul>
          </Section>

          <Section id="sources" number="02" title="Sources and refresh schedule">
            <ul>
              <li>CMS HCPCS Level II quarterly files — every quarter CMS still posts (Q1 2023 onward); checked daily, imported when CMS posts a new quarter or re-posts one.</li>
              <li>CMS Medicare Part B drug payment limit files and NDC–HCPCS crosswalks (ASP, OPPS, AWP, PrEP; NOC in 2025) — every quarter from Q1 2021 onward, including CMS revisions of earlier quarters.</li>
              <li>FDA NDC Directory and its excluded-listings file — published daily; imported weekly by default, and whenever a new CMS crosswalk arrives.</li>
              <li>FDA Purple Book monthly data — imported when a new month is posted.</li>
              <li>CMS “Drug Products in the Medicaid Drug Rebate Program” (data.medicaid.gov) — the newest quarter, for the NDCs CodeRx indexes: unit type, units per package, COD status, and termination dates.</li>
              <li>CMS NCCI Medically Unlikely Edit tables (practitioner, outpatient hospital, DME supplier) — the current quarter, imported when CMS posts a new one. Only HCPCS Level II rows are kept; CPT rows are dropped.</li>
            </ul>
            <p className="mt-3">
              Every file is checked for HTTP success, ZIP structure and per-entry CRC-32, expected contents, and plausible record counts, then loaded inside a single database transaction. A failure rolls back completely and is recorded. Re-running an import of an unchanged file is a no-op (matched by SHA-256). See the full log on{" "}
              <Link href="/sources" className="font-semibold text-brand hover:underline">Data sources</Link>.
            </p>
            <p className="mt-3">{SCOPE_STATEMENT}</p>
          </Section>

          <Section id="normalization" number="03" title="Normalization">
            <ul>
              <li><strong>NDCs.</strong> FDA 10-digit NDCs (4-4-2, 5-3-2, 5-4-1) are converted to the 11-digit 5-4-2 form by padding the short segment with a leading zero. An unhyphenated 10-digit input is ambiguous, so search tries all three possible 11-digit forms and says so.</li>
              <li><strong>HCPCS codes.</strong> Case-insensitive; validated as one letter plus four digits. CPT (AMA) and CDT (ADA) content is excluded from storage and display.</li>
              <li><strong>Text.</strong> Lowercased, accents and trademark symbols removed, punctuation collapsed. Words after “excludes”/“not” in descriptors are not indexed, so “biosimilar” does not match codes that exclude biosimilars.</li>
              <li><strong>Manufacturers.</strong> Labeler names are merged only when they differ by punctuation, case, or a trailing legal suffix (Inc, LLC, Corp …).</li>
              <li><strong>Drugs.</strong> FDA products are grouped by proprietary name (with suffix) plus nonproprietary name; a generic marketed by many labelers is one drug with many packages.</li>
            </ul>
          </Section>

          <Section id="relationships" number="04" title="Relationships">
            <ul>
              <li><DataStatusBadge status="official-cms" /> <strong>NDC → HCPCS:</strong> CMS crosswalk rows, aggregated across quarters with first and last quarter seen.</li>
              <li><DataStatusBadge status="derived" /> <strong>Drug → HCPCS:</strong> derived from those NDC-level rows; each link states how many of the drug’s packages CMS crosswalks to the code.</li>
              <li><DataStatusBadge status="official-fda" /> <strong>Biosimilar → reference:</strong> FDA Purple Book license type and reference product, matched to NDC products by BLA number.</li>
              <li><DataStatusBadge status="official-cms" /> <strong>HCPCS cross-references:</strong> the CMS cross-reference field, shown verbatim; not presented as a guaranteed replacement.</li>
              <li><DataStatusBadge status="manual" /> <strong>Manual reviews:</strong> supported through a reviewed file that requires evidence, reviewer, and date. None are published yet.</li>
              <li><strong>NOC drugs:</strong> the CMS NOC code list flags NOC/NOS codes; the 2025 CMS NOC crosswalk identifies NDCs billed under a NOC code without naming which one. CodeRx never assigns a specific NOC code.</li>
            </ul>
          </Section>

          <Section id="reimbursement" number="05" title="Reimbursement">
            <p>
              Medicare Part B payment limits are shown per HCPCS billing unit exactly as published (three decimals), with the effective quarter, the ASP data quarter CMS cites, co-insurance percentage, and CMS notes. The “methodology” label is read only from the file’s own columns and notes (for example, vaccine AWP percentage or a CMS note about the biosimilar add-on). When CMS re-posts a quarter with different values, the earlier value is shown as a revision.
            </p>
            <p className="mt-3">Not included: hospital outpatient (OPPS) rates from Addendum B (distributed under the AMA CPT license), commercial payer rates, AWP, WAC, and 340B pricing.</p>
          </Section>

          <Section id="units" number="06" title="Billing units and the calculator">
            <p>
              The billing unit comes from the CMS “HCPCS Code Dosage” column when available (official); otherwise it is read from the HCPCS long descriptor (derived). Billable units per package come from the CMS crosswalk. The calculator reports units as dose ÷ unit rounded up to a whole unit; for single-dose containers, units attributable to the discarded amount are ceil(amount opened ÷ unit) − administered units. Dollar figures are labeled derived arithmetic. Modifiers are discussed only as education.
            </p>
            <p className="mt-3">
              Container facts (single- or multi-dose, milliliters per vial, powder) are read from the words of the FDA package description; when the text does not say, the field stays unknown. Vial amounts are the CMS billable units per item × the billing unit. The vial optimizer searches whole-vial combinations for the least unused drug; dose-rounding options are whole-vial doses within the threshold you set and are decision support only. The claim-line view places the NDC as <span className="code-chip">N4</span> + 11 digits + unit qualifier + quantity; milliliter quantities are split in proportion to drug administered and discarded, and other payer conventions must be entered by hand.
            </p>
            <p className="mt-3">
              The vial scanner reads the GS1 barcode (GTIN, expiry, lot, serial); a US drug GTIN embeds the 10-digit NDC, whose segment layout is resolved by looking up all three 11-digit forms. The claim-line NDC qualifier is taken from the Medicaid unit type when the NDC is in the rebate file (ML→ML, GM→GR, AHF→F2, EA/TAB/CAP/SUP/TDP→UN), otherwise suggested from the FDA package text.
            </p>
            <p className="mt-3">
              The MUE check compares units with the published CMS MUE value for each setting and shows the adjudication indicator; it is not a payment determination, and other payers set their own limits. The margin analyzer multiplies the payment limit by the billable units, applies the coinsurance percentage in the CMS file to the patient share, and reduces Medicare’s share by the sequestration percentage you enter; the costs you enter stay in your browser.
            </p>
          </Section>

          <Section id="search" number="07" title="Search ranking">
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>Exact HCPCS code or NDC (any format)</li>
              <li>Exact brand or generic name</li>
              <li>Exact alias — CMS crosswalk drug names, Purple Book proper names, or a clinical abbreviation expansion</li>
              <li>Prefix match</li>
              <li>Active-ingredient or descriptor-word match</li>
              <li>Manufacturer match</li>
              <li>All words matched across fields</li>
              <li>Typo-tolerant trigram match (used only when nothing matches more directly)</li>
            </ol>
            <p className="mt-3">Inactive and historical records sort after active ones at the same relevance, except exact code matches. When two or more drugs tie at the top, the results page flags the query as ambiguous.</p>
            <p className="mt-3">
              Abbreviations expanded at query time: {Object.entries(ABBREVIATIONS).map(([k, v]) => `${k.toUpperCase()} → ${v}`).join("; ")}.
            </p>
          </Section>

          <Section id="badges" number="08" title="Status badges">
            <ul className="space-y-2 [&]:list-none [&]:pl-0">
              <li><DataStatusBadge status="official-cms" /> Value published by CMS, shown as published.</li>
              <li><DataStatusBadge status="official-fda" /> Value published by FDA, shown as published.</li>
              <li><DataStatusBadge status="derived" /> Calculated by CodeRx from official values; the formula is shown.</li>
              <li><DataStatusBadge status="manual" /> Relationship approved by a named reviewer with cited evidence.</li>
              <li><DataStatusBadge status="historical" /> No longer in the most recent source file.</li>
              <li><DataStatusBadge status="verification-needed" /> Incomplete or conflicting; confirm with the publisher.</li>
            </ul>
          </Section>

          <Section id="limitations" number="09" title="Limitations">
            <ul>
              <li>Coverage is not implied by the presence of a code, crosswalk row, or payment limit.</li>
              <li>CMS crosswalks are not comprehensive; a missing NDC does not mean it cannot be billed.</li>
              <li>FDA directory content is labeler-submitted and not verified by FDA.</li>
              <li>History begins with the earliest quarter imported (Q1 2025).</li>
              <li>Payer-specific rules, MAC local coverage determinations, MUEs, and OPPS packaging are out of scope.</li>
            </ul>
          </Section>

          <Section id="assumptions" number="10" title="Assumptions">
            <ul>
              <li>A HCPCS code is “active” when it has no termination date or the termination date is today or later.</li>
              <li>An NDC package is “active” when it is in the active FDA directory and its marketing end date has not passed.</li>
              <li>Quarterly CMS files apply to the quarter named in the file (and stated in its header when present).</li>
              <li>“Brand” means the product has a proprietary name different from its nonproprietary name; product class comes from FDA marketing category and Purple Book license type.</li>
            </ul>
            <div className="mt-6">
              <Disclaimer />
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
