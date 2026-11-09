/**
 * Recognizing a database that is down or refusing work (Neon over its plan quota, a dropped or timed-out
 * connection), and a short process-wide pause on new database calls after one, so cache fallbacks answer at
 * once instead of each waiting on the same failure.
 */

/** Thrown by getDb() while the pause is on. */
export class DatabaseUnavailableError extends Error {
  constructor() {
    super("Database unavailable (recent connection failure).");
    this.name = "DatabaseUnavailableError";
  }
}

// SQLSTATE class 53 (insufficient resources: Neon's "exceeded the quota" is 53000), 57P01–57P03 (shutdown,
// cannot connect now), class 08 (connection exceptions), and Node socket errors.
const CODES = new Set(["53000", "53100", "53200", "53300", "57P01", "57P02", "57P03", "08000", "08001", "08003", "08004", "08006", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"]);
const MESSAGES = /exceeded the [a-z ]*quota|connection terminated|connection timeout|timeout exceeded when trying to connect|too many connections|DATABASE_URL is not configured/i;

/** True when the error (or any error in its `cause` chain) means the database could not serve the query. */
export function isDatabaseUnavailable(error: unknown): boolean {
  let e: unknown = error;
  for (let depth = 0; e && depth < 6; depth++) {
    if (e instanceof DatabaseUnavailableError) return true;
    const { code, message, cause } = e as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof code === "string" && CODES.has(code)) return true;
    // Drizzle's "Failed query: …" message carries the SQL text, so only the driver's own message is matched.
    if (typeof message === "string" && !message.startsWith("Failed query:") && MESSAGES.test(message)) return true;
    e = cause;
  }
  return false;
}

let pausedUntil = 0;

/** Stop starting new database calls in this process for `ms` milliseconds. */
export function pauseDatabase(ms = 15_000, now = Date.now()) {
  pausedUntil = Math.max(pausedUntil, now + ms);
}

export function databasePaused(now = Date.now()): boolean {
  return now < pausedUntil;
}

/** Tests only. */
export function resetDatabasePause() {
  pausedUntil = 0;
}
