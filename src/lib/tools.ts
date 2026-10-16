import { Calculator, ClipboardCheck, GitCompareArrows, History, Scale } from "lucide-react";

/** The Tools section, in the order shown on /tools and in the footer. */
export const TOOLS = [
  {
    href: "/calculator",
    icon: Calculator,
    title: "Billing-unit calculator",
    who: "Pharmacists and billers",
    body: "Dose to HCPCS units with the formula shown, plus the CMS MUE check, JW/JZ claim lines with the NDC segment, a vial optimizer with dose-rounding options, and a printable worksheet.",
  },
  {
    href: "/tools/audit",
    icon: ClipboardCheck,
    title: "Chargemaster & formulary audit",
    who: "Revenue integrity and pharmacy directors",
    body: "Paste or upload HCPCS codes and NDCs (or code–NDC pairs) and see terminated codes, NDCs missing from the CMS crosswalk, mismatched pairs, FDA listing problems, payment limits, and MUEs. Export to CSV.",
  },
  {
    href: "/tools/margin",
    icon: Scale,
    title: "Margin analyzer",
    who: "Directors and finance",
    body: "Compare your own acquisition cost with the Medicare Part B payment (ASP-based limit, net of sequestration) per billing unit and per package, and find drugs that are underwater. Your costs never leave your browser.",
  },
  {
    href: "/tools/biosimilars",
    icon: GitCompareArrows,
    title: "Biosimilar comparator",
    who: "Formulary and P&T committees",
    body: "Reference biologics side by side with their FDA-licensed biosimilars: Part B payment limit per billing unit, payment and patient coinsurance for a dose you enter.",
  },
  {
    href: "/tools/changes",
    icon: History,
    title: "What changed this quarter",
    who: "Everyone who maintains a chargemaster",
    body: "Payment-limit movers, new and terminated drug codes, codes added to or dropped from the payment file, and NDCs added to or removed from the CMS crosswalk — with a personal watchlist.",
  },
] as const;
