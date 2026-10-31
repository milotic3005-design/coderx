/** CMS OPPS status indicators (Addendum D1), for the codes a drug commonly carries. */
export const SI_MEANING: Record<string, string> = {
  K: "Paid separately (non-pass-through drug or biological)",
  G: "Paid separately (pass-through drug or biological)",
  N: "Packaged: no separate payment",
  A: "Paid under a fee schedule other than the OPPS",
  B: "Not recognized by the OPPS on an outpatient hospital bill",
  E1: "Not covered by Medicare",
  E2: "Not paid: no pricing information or claims data",
  M: "Not billable to the MAC by hospitals",
};

const PAID = new Set(["K", "G"]);

/** Plain-language effect on hospital outpatient payment of a status indicator change. */
export function statusChangeEffect(before: string | null, after: string | null): string {
  if (before === "G" && after === "K") return "Pass-through ended; still paid separately";
  if (before === "G" && after === "N") return "Pass-through ended; now packaged (no separate payment)";
  if (before && PAID.has(before) && after === "N") return "Now packaged (no separate payment)";
  if (before === "N" && after && PAID.has(after)) return "Now paid separately";
  if (after && PAID.has(after)) return "Now paid separately";
  if (before && PAID.has(before)) return "No longer paid separately";
  return "Status changed";
}
