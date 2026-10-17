import type { Metadata } from "next";
import { Breadcrumbs, Disclaimer, PageHeader } from "@/components/layout-bits";
import { VialScanner } from "@/components/tools/vial-scanner";

export const metadata: Metadata = {
  title: "Vial barcode scanner",
  description: "Scan the 2D barcode on a drug vial or carton to get its NDC, HCPCS code, billable units, container type, Medicaid unit type, lot, and expiry.",
  alternates: { canonical: "/tools/scan" },
};

export default function ScanPage() {
  return (
    <>
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ href: "/tools", label: "Tools" }, { label: "Vial barcode scanner" }]} />}
        title="Vial barcode scanner"
        subtitle="Scan the 2D DataMatrix on a vial or carton (or its linear barcode) to see the NDC, the HCPCS code CMS crosswalks it to, billable units, container type, Medicaid unit type, and the lot and expiry printed in the barcode."
      />
      <VialScanner />
      <div className="mt-10">
        <Disclaimer />
      </div>
    </>
  );
}
