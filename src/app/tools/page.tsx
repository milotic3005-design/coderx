import type { Metadata } from "next";
import { Disclaimer, PageHeader } from "@/components/layout-bits";
import { ToolsBento } from "@/components/tools-bento";

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
      <ToolsBento />
      <div className="mt-10">
        <Disclaimer />
      </div>
    </>
  );
}
