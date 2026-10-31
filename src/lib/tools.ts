import { Calculator, ChartColumn, ClipboardCheck, ClipboardList, GitCompareArrows, History, Hospital, Scale, ScanLine } from "lucide-react";

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
    href: "/tools/scan",
    icon: ScanLine,
    title: "Vial barcode scanner",
    who: "Pharmacists and technicians",
    body: "Scan the 2D barcode on a vial or carton with your phone camera, a photo, or a USB scanner: NDC, HCPCS code, billable units, container type, Medicaid unit type, lot, and expiry — straight into the calculator.",
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
    href: "/tools/site-of-care",
    icon: Hospital,
    title: "Site of care: HOPD vs home",
    who: "Infusion and pharmacy directors",
    body: "Monthly revenue for one therapy in your hospital outpatient department versus your home infusion pharmacy (no Medicare HIT certification), for Medicare, Washington Apple Health, and your commercial contracts — from CMS OPPS rates, the HCA schedule, and terms you enter.",
  },
  {
    href: "/tools/price-benchmark",
    icon: ChartColumn,
    title: "MultiCare price benchmark",
    who: "Contracting and finance",
    body: "What MultiCare's Washington hospitals have negotiated for a drug, per CMS billing unit and as a percent of the Medicare payment limit, by plan type — from their federally required price transparency files. No payer names.",
  },
  {
    href: "/tools/biosimilars",
    icon: GitCompareArrows,
    title: "Biosimilar comparator",
    who: "Formulary and P&T committees",
    body: "Reference biologics side by side with their FDA-licensed biosimilars, plus a switch simulator: annual Medicare payment, patient coinsurance, and margin when part of the volume moves to a biosimilar.",
  },
  {
    href: "/tools/changes",
    icon: History,
    title: "What changed this quarter",
    who: "Everyone who maintains a chargemaster",
    body: "Payment-limit movers, new and terminated drug codes, codes added to or dropped from the payment file, and NDCs added to or removed from the CMS crosswalk — with a personal watchlist and an RSS feed.",
  },
  {
    href: "/tools/intake",
    icon: ClipboardList,
    title: "Referral intake card",
    who: "Intake and prior-authorization staff",
    body: "One printable page per drug code: billing unit, MUEs, NDCs with claim unit qualifiers, the Medicare hospital and home payment path, Washington Apple Health prior authorization, and related biologics. No patient fields.",
  },
] as const;
