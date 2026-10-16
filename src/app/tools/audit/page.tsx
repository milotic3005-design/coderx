import type { Metadata } from "next";
import { Breadcrumbs, Disclaimer, PageHeader } from "@/components/layout-bits";
import { AuditTool } from "@/components/tools/audit-tool";

export const metadata: Metadata = {
  title: "Chargemaster & formulary audit",
  description: "Check a list of HCPCS codes and NDCs against current CMS and FDA data: terminated codes, crosswalk mismatches, FDA listing status, payment limits, and MUEs.",
  alternates: { canonical: "/tools/audit" },
};

export default function AuditPage() {
  return (
    <>
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ href: "/tools", label: "Tools" }, { label: "Chargemaster audit" }]} />}
        title="Chargemaster & formulary audit"
        subtitle="Check every code and NDC on your list — and every code–NDC pair — against the current CMS HCPCS file, payment limit file, NDC–HCPCS crosswalk, MUE tables, and the FDA NDC Directory."
      />
      <AuditTool />
      <div className="mt-10">
        <Disclaimer />
      </div>
    </>
  );
}
