/** Data-status labels shared by server and client components (no database imports). */
export type DataStatus = "official-cms" | "official-fda" | "official-state" | "derived" | "manual" | "historical" | "verification-needed";

export const STATUS_LABELS: Record<DataStatus, string> = {
  "official-cms": "Official CMS",
  "official-fda": "Official FDA",
  "official-state": "Official state Medicaid",
  derived: "Derived calculation",
  manual: "Manually reviewed",
  historical: "Historical",
  "verification-needed": "Verification needed",
};
