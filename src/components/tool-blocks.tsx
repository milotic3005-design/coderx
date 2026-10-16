import { ExternalLink, FileSearch, Landmark, ListX, Scale, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { MAI_TEXT, MUE_INFO_URL, MUE_SERVICE_LABELS, type MueEntry } from "@/lib/mue";
import { DataStatusBadge } from "./badges";
import { NoData, TableScroll, td, th } from "./layout-bits";

/** Published CMS MUE values for one code, by service setting. Server component. */
export function MueTable({ code, entries, caption }: { code: string; entries: MueEntry[]; caption: string }) {
  if (!entries.length) {
    return (
      <NoData>
        No published MUE for {code}. CMS keeps some MUE values confidential, so this does not mean there is no daily unit limit.
      </NoData>
    );
  }
  return (
    <>
      <TableScroll label={caption}>
        <table className="w-full min-w-[40rem] border-collapse">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className={th}>
                Setting
              </th>
              <th scope="col" className={th}>
                Max units / day
              </th>
              <th scope="col" className={th}>
                Adjudication (MAI)
              </th>
              <th scope="col" className={th}>
                CMS rationale
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((m) => (
              <tr key={m.serviceType}>
                <th scope="row" className={`${td} text-left font-semibold text-ink`}>
                  {MUE_SERVICE_LABELS[m.serviceType].long}
                </th>
                <td className={td}>
                  <span className="code-chip text-lg font-semibold text-ink">{m.value}</span>
                  {m.value === 0 ? <span className="block text-xs text-ink-muted">Not reportable in this setting</span> : null}
                </td>
                <td className={td}>
                  <span className="text-ink">{m.adjudicationText ?? "—"}</span>
                  {m.adjudicationIndicator && m.adjudicationIndicator in MAI_TEXT ? (
                    <span className="mt-0.5 block text-xs text-ink-muted">{MAI_TEXT[m.adjudicationIndicator as 1 | 2 | 3]}</span>
                  ) : null}
                </td>
                <td className={`${td} text-ink-muted`}>{m.rationale ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <p className="mt-2 text-xs text-ink-muted">
        An MUE is the most units CMS expects for this code for one patient on one date of service by the same provider in most correctly reported claims.{" "}
        <a href={MUE_INFO_URL} rel="noopener noreferrer" className="font-semibold text-brand hover:underline">
          CMS MUE program
        </a>
      </p>
    </>
  );
}

const MCD_SEARCH = "https://www.cms.gov/medicare-coverage-database/search-results.aspx";

export function coverageSearchUrl(keyword: string): string {
  const qs = new URLSearchParams({ keyword, keywordType: "starts", areaId: "all", docType: "NCA,CAL,NCD,MEDCAC,TA,MCD,6,3,5,1,F,P", contractOption: "all" });
  return `${MCD_SEARCH}?${qs.toString()}`;
}

function LinkCard({ href, icon, title, children }: { href: string; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li>
      <a href={href} rel="noopener noreferrer" className="group flex h-full gap-3 rounded-lg border hairline bg-surface p-4 hover:border-brand">
        <span className="mt-0.5 text-brand">{icon}</span>
        <span className="min-w-0">
          <span className="flex items-center gap-1 font-semibold text-brand group-hover:underline">
            {title} <ExternalLink aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          </span>
          <span className="mt-0.5 block text-sm text-ink-muted">{children}</span>
        </span>
      </a>
    </li>
  );
}

/**
 * Links to the official coverage sources for a code or drug. CodeRx does not copy
 * coverage content: CMS distributes LCD/article code lists under AMA, ADA, and AHA
 * license terms that limit reuse to personal, non-commercial use.
 */
export function CoverageLinks({ keywords }: { keywords: { label: string; value: string }[] }) {
  const searches = keywords.filter((k) => k.value.trim());
  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2">
        {searches.map((k) => (
          <LinkCard key={k.value} href={coverageSearchUrl(k.value)} icon={<FileSearch aria-hidden="true" className="h-5 w-5" />} title={`Coverage documents for ${k.label}`}>
            NCDs, LCDs, and Billing &amp; Coding articles in the CMS Medicare Coverage Database that mention “{k.value}”. Covered diagnosis codes are listed in the articles.
          </LinkCard>
        ))}
        <LinkCard
          href="https://www.cms.gov/medicare-coverage-database/reports/local-coverage-sad-exclusion-list-report.aspx?contractorName=all&dateOption=current"
          icon={<ListX aria-hidden="true" className="h-5 w-5" />}
          title="Self-administered drug (SAD) exclusion lists"
        >
          Drugs each MAC excludes from “incident to” Part B coverage because they are usually self-administered.
        </LinkCard>
        <LinkCard href="https://www.cms.gov/medicare/coding-billing/medicare-administrative-contractors-macs/who-are-macs" icon={<Landmark aria-hidden="true" className="h-5 w-5" />} title="Find your Medicare contractor (MAC)">
          A/B and DME MAC jurisdictions by state — local coverage and prior-authorization rules come from your MAC.
        </LinkCard>
        <LinkCard href="https://www.cms.gov/medicare/payment/part-b-drugs/discarded-drugs" icon={<Trash2 aria-hidden="true" className="h-5 w-5" />} title="CMS discarded drug (JW/JZ) guidance">
          When the JW and JZ modifiers are required for drugs from single-dose containers.
        </LinkCard>
        <LinkCard href={MUE_INFO_URL} icon={<Scale aria-hidden="true" className="h-5 w-5" />} title="NCCI Medically Unlikely Edits">
          CMS MUE tables and quarterly changes for practitioner, outpatient hospital, and DME claims.
        </LinkCard>
      </ul>
      <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <DataStatusBadge status="verification-needed" />
        CodeRx links to coverage documents instead of copying them: CMS distributes their code lists under AMA, ADA, and AHA license terms that limit reuse. Medicare Advantage, Medicaid, and commercial plans set their own coverage and prior-authorization rules.
      </p>
    </>
  );
}
