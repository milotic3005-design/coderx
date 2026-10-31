import { afterEach, describe, expect, it } from "vitest";
import { benchmarkCookieValid, benchmarkPasswordMatches, benchmarkToken, safeNext } from "@/lib/benchmark-access";

describe("benchmark password gate", () => {
  const original = process.env.CODERX_BENCHMARK_PASSWORD;
  afterEach(() => {
    if (original === undefined) delete process.env.CODERX_BENCHMARK_PASSWORD;
    else process.env.CODERX_BENCHMARK_PASSWORD = original;
  });

  it("accepts only the configured password and the cookie derived from it", () => {
    process.env.CODERX_BENCHMARK_PASSWORD = "unit-test-password";
    expect(benchmarkPasswordMatches("unit-test-password")).toBe(true);
    expect(benchmarkPasswordMatches("unit-test-passwor")).toBe(false);
    expect(benchmarkPasswordMatches("")).toBe(false);
    expect(benchmarkCookieValid(benchmarkToken("unit-test-password"))).toBe(true);
    expect(benchmarkCookieValid(benchmarkToken("another"))).toBe(false);
    expect(benchmarkCookieValid(undefined)).toBe(false);
    // The cookie is not the password itself.
    expect(benchmarkToken("unit-test-password")).not.toContain("unit-test-password");
  });

  it("stays locked when no password is configured", () => {
    delete process.env.CODERX_BENCHMARK_PASSWORD;
    expect(benchmarkPasswordMatches("")).toBe(false);
    expect(benchmarkCookieValid(benchmarkToken(""))).toBe(false);
  });

  it("only returns to same-site paths", () => {
    expect(safeNext("/tools/price-benchmark?code=J9312")).toBe("/tools/price-benchmark?code=J9312");
    expect(safeNext("/hcpcs/J9312#reimbursement")).toBe("/hcpcs/J9312#reimbursement");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", ""]) expect(safeNext(bad)).toBe("/tools/price-benchmark");
  });
});
