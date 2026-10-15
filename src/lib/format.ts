import { formatPeriod } from "@/ingest/values";

export { formatPeriod };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-01" → "Oct 1, 2026" (no timezone shifts: parsed as a calendar date). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${formatDate(d.toISOString().slice(0, 10))} ${d.toISOString().slice(11, 16)} UTC`;
}

/** Payment limits keep the three decimals CMS publishes. */
export function formatMoney(value: string | number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function formatNumber(value: string | number | null | undefined, maxDigits = 4): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("en-US", { maximumFractionDigits: maxDigits });
}

export function formatBytes(n: number | null | undefined): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s,/(-])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

export const PRODUCT_CLASS_LABELS: Record<string, string> = {
  brand: "Brand",
  generic: "Generic (ANDA)",
  authorized_generic: "Authorized generic",
  unbranded_nda: "NDA (unbranded name)",
  biologic: "Biologic (BLA)",
  biosimilar: "Biosimilar",
  interchangeable_biosimilar: "Interchangeable biosimilar",
  unapproved: "Unapproved drug (per FDA listing)",
  eua: "Emergency use authorization",
  other: "Other",
};

export const EXCLUDE_FLAG_LABELS: Record<string, string> = {
  E: "Removed for failure to respond to FDA requests for corrections (E)",
  U: "Listing certification expired (U)",
  I: "Inactivated by FDA (I)",
  D: "Discontinued by the firm (D)",
};
