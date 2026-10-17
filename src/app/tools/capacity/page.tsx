import type { Metadata } from "next";
import { Breadcrumbs, PageHeader } from "@/components/layout-bits";
import { CapacityPlanner } from "@/components/tools/capacity-planner";

export const metadata: Metadata = {
  title: "Chair capacity planner",
  description: "Infusion chair utilization, chairs needed at a target, and room for more visits — from your chairs, hours, and visit mix. Nothing leaves your browser.",
  alternates: { canonical: "/tools/capacity" },
};

export default function CapacityPage() {
  return (
    <>
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ href: "/tools", label: "Tools" }, { label: "Chair capacity planner" }]} />}
        title="Chair capacity planner"
        subtitle="How full your infusion chairs are, how many you need at a target utilization, and whether the day packs — from your own chairs, hours, and visit mix. Nothing you enter leaves this browser."
      />
      <CapacityPlanner />
    </>
  );
}
