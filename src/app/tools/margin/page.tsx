import type { Metadata } from "next";
import { Breadcrumbs, Disclaimer, PageHeader } from "@/components/layout-bits";
import { MarginTool } from "@/components/tools/margin-tool";

export const metadata: Metadata = {
  title: "Margin analyzer",
  description: "Compare your acquisition cost with the Medicare Part B payment limit per billing unit and per NDC package, net of sequestration. Costs stay in your browser.",
  alternates: { canonical: "/tools/margin" },
};

export default function MarginPage() {
  return (
    <>
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ href: "/tools", label: "Tools" }, { label: "Margin analyzer" }]} />}
        title="Margin analyzer"
        subtitle="Expected Medicare Part B revenue for each drug, from the CMS payment limit and the billable units CMS assigns to each NDC package, compared with what you pay."
      />
      <MarginTool />
      <div className="mt-10">
        <Disclaimer />
      </div>
    </>
  );
}
