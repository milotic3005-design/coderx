import { describe, expect, it } from "vitest";
import { bearerMatches } from "@/lib/api/auth";
import { FixedWindowLimiter, limiterFor } from "@/lib/api/rate-limit";
import { hcpcsCodeSchema, importBodySchema, ndcSchema, searchParamsSchema, slugSchema, toSearchOptions } from "@/lib/api/validation";
import { buildCsp } from "@/proxy";

describe("API parameter validation", () => {
  it("accepts and normalizes valid search parameters", () => {
    const p = searchParamsSchema.parse({ q: " keytruda ", page: "2", kind: "drug,hcpcs", family: "j,q", status: "active", payment: "yes" });
    expect(p).toMatchObject({ q: "keytruda", page: 2, pageSize: 20, kind: ["drug", "hcpcs"], family: ["J", "Q"], status: "active" });
    expect(toSearchOptions(p).filters).toMatchObject({ kinds: ["drug", "hcpcs"], families: ["J", "Q"], payment: "yes" });
  });
  it.each([
    [{ q: "" }],
    [{ q: "x".repeat(101) }],
    [{ q: "ok", page: "0" }],
    [{ q: "ok", pageSize: "1000" }],
    [{ q: "ok", kind: "drug,patient" }],
    [{ q: "ok", family: "Z" }],
    [{ q: "ok", effectiveOn: "10/01/2026" }],
    [{ q: "ok", manufacturer: "Robert'); DROP TABLE drugs;--" }],
  ])("rejects %j", (input) => {
    expect(searchParamsSchema.safeParse(input).success).toBe(false);
  });
  it("validates codes, NDCs, and slugs", () => {
    expect(hcpcsCodeSchema.parse("j9271")).toBe("J9271");
    expect(hcpcsCodeSchema.safeParse("96413").success).toBe(false);
    expect(ndcSchema.parse("0006-3026-02")).toBe("00006302602");
    expect(ndcSchema.safeParse("0006302602").success).toBe(false); // ambiguous
    expect(slugSchema.safeParse("../etc/passwd").success).toBe(false);
    expect(importBodySchema.parse({})).toEqual({ source: "all", force: false, latestOnly: true });
    expect(importBodySchema.safeParse({ source: "everything" }).success).toBe(false);
  });
});

describe("rate limiting", () => {
  it("allows up to the limit per window, then blocks with a reset time", () => {
    const limiter = new FixedWindowLimiter(3, 60_000);
    const t = 1_000_000;
    expect([1, 2, 3].map(() => limiter.check("ip", t).allowed)).toEqual([true, true, true]);
    const blocked = limiter.check("ip", t + 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.resetSeconds).toBeGreaterThan(0);
    expect(limiter.check("other-ip", t).allowed).toBe(true);
    expect(limiter.check("ip", t + 60_001).allowed).toBe(true);
  });
  it("classifies routes", () => {
    expect(limiterFor("/api/suggest")).toBe("suggest");
    expect(limiterFor("/api/admin/import")).toBe("admin");
    expect(limiterFor("/api/hcpcs/J9271")).toBe("read");
    expect(limiterFor("/hcpcs/J9271")).toBeNull();
  });
});

describe("security", () => {
  it("compares bearer tokens and refuses weak or missing secrets", () => {
    const secret = "s".repeat(40);
    const req = (h?: string) => new Request("https://x/api/admin/import", { headers: h ? { authorization: h } : {} });
    expect(bearerMatches(req(`Bearer ${secret}`), secret)).toBe(true);
    expect(bearerMatches(req(`Bearer ${secret}x`), secret)).toBe(false);
    expect(bearerMatches(req(), secret)).toBe(false);
    expect(bearerMatches(req("Bearer short"), "short")).toBe(false);
    expect(bearerMatches(req(`Bearer ${secret}`), undefined)).toBe(false);
  });
  it("builds a strict nonce-based CSP", () => {
    const csp = buildCsp("abc123", false);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-eval");
  });
});
