import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";
import { handle } from "@/lib/api/envelope";
import { FALLBACK_DAYS, previousDays, readThrough } from "@/lib/data/cached";
import { DatabaseUnavailableError, databasePaused, isDatabaseUnavailable, pauseDatabase, resetDatabasePause } from "@/lib/db/availability";

/** The error Drizzle threw in production once Neon's free compute quota ran out (2026-11-08). */
function quotaError() {
  const cause = Object.assign(new Error("Your account or project has exceeded the quota. Upgrade your plan to increase limits."), { code: "53000", severity: "ERROR" });
  return Object.assign(new Error('Failed query: select "id" from "source_releases" where "source_releases"."status" in ($1, $2)\nparams: succeeded,superseded'), { cause });
}

afterEach(() => {
  resetDatabasePause();
  vi.restoreAllMocks();
});

describe("isDatabaseUnavailable", () => {
  it("recognizes Neon's quota error, dropped connections, and socket errors through the cause chain", () => {
    expect(isDatabaseUnavailable(quotaError())).toBe(true);
    expect(isDatabaseUnavailable(new Error("Connection terminated unexpectedly"))).toBe(true);
    expect(isDatabaseUnavailable(Object.assign(new Error("Failed query: select 1"), { cause: new Error("Connection terminated due to connection timeout") }))).toBe(true);
    expect(isDatabaseUnavailable(Object.assign(new Error("connect"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isDatabaseUnavailable(new DatabaseUnavailableError())).toBe(true);
  });

  it("does not treat code bugs or SQL errors as an outage, even when the SQL text mentions a timeout", () => {
    expect(isDatabaseUnavailable(new TypeError("Cannot read properties of undefined (reading 'articles')"))).toBe(false);
    const syntax = Object.assign(new Error("Failed query: select statement_timeout from connection_timeout_settings"), { cause: Object.assign(new Error("syntax error"), { code: "42601" }) });
    expect(isDatabaseUnavailable(syntax)).toBe(false);
    expect(isDatabaseUnavailable(null)).toBe(false);
  });

  it("pauses new database calls for a short window", () => {
    expect(databasePaused(1_000)).toBe(false);
    pauseDatabase(15_000, 1_000);
    expect(databasePaused(10_000)).toBe(true);
    expect(databasePaused(16_001)).toBe(false);
  });
});

describe("readThrough (cache fallback during an outage)", () => {
  /** A stand-in for unstable_cache: saved copies by day; a missing day runs the loader, which fails. */
  function store(saved: Record<string, string>, failure: () => Error) {
    return vi.fn(async (day: string, code: string) => {
      if (day in saved) return `${saved[day]}:${code}`;
      throw failure();
    });
  }

  it("lists the previous days, newest first, across month boundaries", () => {
    expect(previousDays("2026-11-02", 3)).toEqual(["2026-11-01", "2026-10-31", "2026-10-30"]);
    expect(FALLBACK_DAYS).toBeGreaterThanOrEqual(28);
  });

  it("returns today's copy without touching older days", async () => {
    const s = store({ "2026-11-09": "today" }, quotaError);
    await expect(readThrough(s, ["J9312"], "hcpcs", "2026-11-09")).resolves.toBe("today:J9312");
    expect(s).toHaveBeenCalledTimes(1);
  });

  it("serves the newest earlier copy when the database is over quota, and pauses further database calls", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = store({ "2026-11-07": "nov7", "2026-11-01": "nov1" }, quotaError);
    await expect(readThrough(s, ["J9312"], "hcpcs", "2026-11-09")).resolves.toBe("nov7:J9312");
    expect(s.mock.calls.map((c) => c[0])).toEqual(["2026-11-09", "2026-11-08", "2026-11-07"]);
    expect(databasePaused()).toBe(true);
  });

  it("rethrows the original error when no copy is saved", async () => {
    const s = store({}, quotaError);
    await expect(readThrough(s, ["J9312"], "hcpcs", "2026-11-09")).rejects.toThrow(/^Failed query/);
    expect(s).toHaveBeenCalledTimes(1 + FALLBACK_DAYS);
  });

  it("does not hide code bugs behind old copies", async () => {
    const s = store({ "2026-11-08": "nov8" }, () => new TypeError("boom"));
    await expect(readThrough(s, ["J9312"], "hcpcs", "2026-11-09")).rejects.toThrow("boom");
    expect(s).toHaveBeenCalledTimes(1);
    expect(databasePaused()).toBe(false);
  });
});

describe("outage handling elsewhere", () => {
  it("API routes answer 503 (not 500) when the database is over quota", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handle(new Request("https://example.test/api/search?q=x"), "test", async () => {
      throw quotaError();
    });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("robots.txt keeps crawlers off the query-string tool URLs and the API", () => {
    const rule = [robots().rules].flat()[0];
    const disallow = [rule.disallow].flat();
    for (const path of ["/api/", "/search", "/calculator?", "/tools/site-of-care?", "/tools/part-b-vs-d?", "/*?"]) expect(disallow).toContain(path);
    expect(disallow).not.toContain("/tools/");
  });
});
