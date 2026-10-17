/**
 * "Today" for active/terminated checks. CMS termination and FDA marketing end dates are
 * calendar dates, so the comparison uses one U.S. calendar day (Eastern time) instead of
 * UTC, which would roll over at 7–8 PM Eastern.
 */
const EASTERN = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/** YYYY-MM-DD in U.S. Eastern time. */
export function todayUs(now: Date = new Date()): string {
  return EASTERN.format(now);
}
