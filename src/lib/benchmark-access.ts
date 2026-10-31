/**
 * Password gate for the MultiCare price benchmark. The password lives in the
 * CODERX_BENCHMARK_PASSWORD environment variable; a correct entry sets an httpOnly cookie
 * holding an HMAC derived from it, so changing the password signs everyone out. Pages render
 * benchmark data only when the cookie is valid; with no password configured the benchmark
 * stays locked.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const BENCHMARK_COOKIE = "coderx_benchmark";
export const BENCHMARK_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

const configured = () => process.env.CODERX_BENCHMARK_PASSWORD || null;
const digest = (s: string) => createHash("sha256").update(s).digest();

export function benchmarkToken(password: string): string {
  return createHmac("sha256", password).update("coderx-benchmark-access-v1").digest("base64url");
}

export function benchmarkPasswordMatches(input: string): boolean {
  const password = configured();
  return !!password && timingSafeEqual(digest(input), digest(password));
}

export function benchmarkCookieValid(value: string | undefined): boolean {
  const password = configured();
  return !!password && !!value && timingSafeEqual(digest(value), digest(benchmarkToken(password)));
}

/** True when this request carries a valid benchmark cookie. */
export async function benchmarkUnlocked(): Promise<boolean> {
  return benchmarkCookieValid((await cookies()).get(BENCHMARK_COOKIE)?.value);
}

/** A same-site path to return to after unlocking ("/tools/price-benchmark?code=J9312"); anything else falls back. */
export function safeNext(next: string | null | undefined, fallback = "/tools/price-benchmark"): string {
  return next && /^\/(?!\/)[^\s\\]*$/.test(next) ? next : fallback;
}
