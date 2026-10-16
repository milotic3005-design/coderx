export const SITE = {
  name: "CodeRx",
  tagline: "Drug coding and reimbursement intelligence, simplified.",
  description:
    "Search drugs, HCPCS codes, and NDCs to see billing units, CMS NDC–HCPCS crosswalks, and Medicare Part B payment limits — every value traced to its CMS or FDA source.",
  url: (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")
  ).replace(/\/$/, ""),
  repo: "https://github.com/milotic3005-design/coderx",
  disclaimer:
    "This application provides informational coding and reimbursement reference data. It does not constitute legal, clinical, coding, or billing advice. Codes, payment amounts, payer rules, and coverage policies can change. Verify all information with current CMS publications, the applicable payer, and your organization’s compliance policies before submitting a claim.",
  noData: "No authoritative public data was located for this field.",
} as const;

export const NAV = [
  { href: "/search", label: "Search" },
  { href: "/codes", label: "Code families" },
  { href: "/tools", label: "Tools" },
  { href: "/sources", label: "Data sources" },
  { href: "/methodology", label: "Methodology" },
] as const;
