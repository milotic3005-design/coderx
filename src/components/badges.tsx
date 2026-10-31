import { BadgeCheck, Calculator, CircleAlert, FileClock, Hospital, Landmark, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { STATUS_LABELS, type DataStatus } from "@/lib/data/status";
import { PRODUCT_CLASS_LABELS } from "@/lib/format";
import { CODE_FAMILIES } from "@/lib/hcpcs";

const FAMILY_VARS: Record<string, [string, string]> = {
  J: ["var(--fam-j)", "var(--fam-j-bg)"],
  Q: ["var(--fam-q)", "var(--fam-q-bg)"],
  C: ["var(--fam-c)", "var(--fam-c-bg)"],
  S: ["var(--fam-s)", "var(--fam-s-bg)"],
  A: ["var(--fam-a)", "var(--fam-a-bg)"],
  P: ["var(--fam-p)", "var(--fam-p-bg)"],
};

function Pill({ children, className = "", style, title }: { children: ReactNode; className?: string; style?: React.CSSProperties; title?: string }) {
  return (
    <span
      title={title}
      style={style}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.72rem] leading-5 font-semibold tracking-wide whitespace-nowrap ${className}`}
    >
      {children}
    </span>
  );
}

/** "J-code" style family badge with the family name available to screen readers. */
export function FamilyBadge({ code, size = "sm" }: { code: string; size?: "sm" | "md" }) {
  const letter = code.charAt(0).toUpperCase();
  const [fg, bg] = FAMILY_VARS[letter] ?? ["var(--fam-x)", "var(--fam-x-bg)"];
  const family = CODE_FAMILIES[letter];
  return (
    <Pill style={{ color: fg, backgroundColor: bg }} className={size === "md" ? "px-2.5 py-1 text-xs" : ""} title={family?.name}>
      <span aria-hidden="true" className="code-chip">
        {letter}
      </span>
      <span>{letter}-code</span>
      {family ? <span className="sr-only">: {family.name}</span> : null}
    </Pill>
  );
}

export function ActiveBadge({ active, endDate, inactiveLabel = "Inactive" }: { active: boolean; endDate?: string | null; inactiveLabel?: string }) {
  return active ? (
    <Pill className="bg-ok-tint text-ok">
      <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
      Active
    </Pill>
  ) : (
    <Pill className="bg-paper-sunken text-ink-muted ring-1 ring-rule-strong ring-inset" title={endDate ? `Ended ${endDate}` : undefined}>
      <FileClock aria-hidden="true" className="h-3 w-3" />
      {inactiveLabel}
    </Pill>
  );
}

const STATUS_STYLE: Record<DataStatus, { className: string; icon: ReactNode }> = {
  "official-cms": { className: "bg-brand-tint text-brand", icon: <Landmark aria-hidden="true" className="h-3 w-3" /> },
  "official-fda": { className: "bg-[var(--fam-c-bg)] text-[var(--fam-c)]", icon: <ShieldCheck aria-hidden="true" className="h-3 w-3" /> },
  "official-state": { className: "bg-[var(--fam-p-bg)] text-[var(--fam-p)]", icon: <Landmark aria-hidden="true" className="h-3 w-3" /> },
  "hospital-published": { className: "bg-[var(--fam-c-bg)] text-[var(--fam-c)]", icon: <Hospital aria-hidden="true" className="h-3 w-3" /> },
  derived: { className: "bg-surface text-ink-muted ring-1 ring-dashed ring-rule-strong ring-inset border border-dashed border-rule-strong", icon: <Calculator aria-hidden="true" className="h-3 w-3" /> },
  manual: { className: "bg-ok-tint text-ok", icon: <BadgeCheck aria-hidden="true" className="h-3 w-3" /> },
  historical: { className: "bg-paper-sunken text-ink-muted", icon: <FileClock aria-hidden="true" className="h-3 w-3" /> },
  "verification-needed": { className: "bg-accent-tint text-accent", icon: <CircleAlert aria-hidden="true" className="h-3 w-3" /> },
};

export function DataStatusBadge({ status }: { status: DataStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <Pill className={s.className}>
      {s.icon}
      {STATUS_LABELS[status]}
    </Pill>
  );
}

export function ClassBadge({ productClass }: { productClass: string | null | undefined }) {
  if (!productClass) return null;
  const isBio = productClass.includes("biosimilar");
  return (
    <Pill className={isBio ? "bg-[var(--fam-q-bg)] text-[var(--fam-q)]" : "bg-paper-sunken text-ink-muted ring-1 ring-rule ring-inset"}>
      {PRODUCT_CLASS_LABELS[productClass] ?? productClass}
    </Pill>
  );
}

export function NocBadge() {
  return (
    <Pill className="border border-dashed border-[var(--fam-s)] text-[var(--fam-s)]" title="On the CMS not-otherwise-classified code list">
      NOC / NOS
    </Pill>
  );
}

export function NonMedicareBadge() {
  return (
    <Pill className="bg-[var(--fam-s-bg)] text-[var(--fam-s)]" title="Not payable by Medicare; payer recognition varies">
      <CircleAlert aria-hidden="true" className="h-3 w-3" />
      Non-Medicare
    </Pill>
  );
}

export function KindBadge({ kind }: { kind: "drug" | "hcpcs" | "ndc" | "manufacturer" }) {
  const label = { drug: "Drug", hcpcs: "HCPCS", ndc: "NDC package", manufacturer: "Manufacturer" }[kind];
  return <Pill className="bg-surface text-ink-muted ring-1 ring-rule ring-inset">{label}</Pill>;
}
