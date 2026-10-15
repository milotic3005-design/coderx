/** Value parsing helpers shared by every source parser. */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function iso(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "20260101" → "2026-01-01"; blanks and invalid values → null. */
export function parseYmd(value: string | null | undefined): string | null {
  const s = (value ?? "").trim();
  if (!/^\d{8}$/.test(s)) return null;
  return iso(Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8)));
}

/** "October 1, 2026" → "2026-10-01". */
export function parseLongDate(value: string | null | undefined): string | null {
  const m = (value ?? "").trim().match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS.findIndex((name) => name.startsWith(m[1].toLowerCase().slice(0, 3)));
  if (month < 0) return null;
  return iso(Number(m[3]), month + 1, Number(m[2]));
}

/** "09/17/2026" or "06/30/25" → ISO date. */
export function parseUsDate(value: string | null | undefined): string | null {
  const m = (value ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return iso(year, Number(m[1]), Number(m[2]));
}

/** HTTP date ("Wed, 14 Oct 2026 08:15:27 GMT") → ISO date. */
export function parseHttpDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

/** Numbers as published: strips "$" and thousands separators; blank → null; garbage → NaN. */
export function parseNumber(value: string | null | undefined): number | null {
  const s = (value ?? "").trim().replace(/^\$/, "").replace(/,/g, "");
  if (s === "") return null;
  if (!/^-?\d*\.?\d+(e-?\d+)?$/i.test(s)) return Number.NaN;
  return Number(s);
}

/** Keep the published text of a numeric field for `numeric` columns (null when blank). */
export function numericText(value: string | null | undefined): string | null {
  const n = parseNumber(value);
  if (n === null || Number.isNaN(n)) return null;
  return (value ?? "").trim().replace(/^\$/, "").replace(/,/g, "");
}

export type Period = `${number}-Q${1 | 2 | 3 | 4}`;

export function quarterOf(year: number, monthIndex1: number): Period {
  return `${year}-Q${Math.floor((monthIndex1 - 1) / 3) + 1}` as Period;
}

/** "October 2026" → "2026-Q4". */
export function periodFromMonthYear(text: string): Period | null {
  const m = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b[^0-9]{0,3}(\d{4})/i);
  if (!m) return null;
  const month = MONTHS.findIndex((name) => name.startsWith(m[1].toLowerCase().slice(0, 3))) + 1;
  return quarterOf(Number(m[2]), month);
}

export function quarterBounds(period: string): { start: string; end: string } {
  const m = period.match(/^(\d{4})-Q([1-4])$/);
  if (!m) throw new Error(`Invalid period ${period}`);
  const year = Number(m[1]);
  const q = Number(m[2]);
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const endDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  return { start: iso(year, startMonth, 1)!, end: iso(year, endMonth, endDay)! };
}

/** "2026-Q4" → "Q4 2026"; other labels unchanged. */
export function formatPeriod(period: string | null | undefined): string {
  if (!period) return "";
  const m = period.match(/^(\d{4})-Q([1-4])$/);
  return m ? `Q${m[2]} ${m[1]}` : period;
}

export function comparePeriods(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Parse "Effective October 1, 2026 through December 31, 2026" anywhere in a text block. */
export function parseEffectiveRange(text: string): { start: string; end: string } | null {
  const m = text.match(/effective\s+([A-Za-z]+\.?\s+\d{1,2},?\s+\d{4})\s+(?:through|to|-)\s+([A-Za-z]+\.?\s+\d{1,2},?\s+\d{4})/i);
  if (!m) return null;
  const start = parseLongDate(m[1]);
  const end = parseLongDate(m[2]);
  return start && end ? { start, end } : null;
}
