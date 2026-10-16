import type { Metadata } from "next";
import Link from "next/link";
import { Disclaimer, PageHeader } from "@/components/layout-bits";
import { TOOLS } from "@/lib/tools";

export const metadata: Metadata = {
  title: "Tools for infusion pharmacy and revenue integrity",
  description: "Billing-unit calculator, chargemaster and formulary audit, margin analyzer, biosimilar comparator, and the quarterly change report — all on public CMS and FDA data.",
  alternates: { canonical: "/tools" },
};

export default function ToolsPage() {
  return (
    <>
      <PageHeader
        title="Tools"
        subtitle="Workflow tools for infusion pharmacists, billers, and directors. Every number comes from a public CMS or FDA file shown on the page; nothing you enter is stored."
      />
      <ul className="grid gap-4 md:grid-cols-2">
        {TOOLS.map((tool) => (
          <li key={tool.href}>
            <Link href={tool.href} className="flex h-full flex-col rounded-xl border hairline bg-surface p-5 transition-colors hover:border-brand">
              <span className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-tint text-brand">
                  <tool.icon aria-hidden="true" className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-lg font-semibold text-ink">{tool.title}</span>
                  <span className="block text-xs font-semibold tracking-wide text-ink-faint uppercase">{tool.who}</span>
                </span>
              </span>
              <span className="mt-3 block flex-1 text-sm text-ink-muted">{tool.body}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-10">
        <Disclaimer />
      </div>
    </>
  );
}
