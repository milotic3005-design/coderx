/**
 * Fixed-window, per-key rate limiter held in process memory.
 *
 * On serverless platforms each instance keeps its own counters, so this is a
 * best-effort first line of defense; production deployments should also add a
 * platform rate-limit rule (see docs/05-operations.md).
 */
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

interface Bucket {
  count: number;
  windowStart: number;
}

export class FixedWindowLimiter {
  private buckets = new Map<string, Bucket>();
  private lastSweep = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 50_000,
  ) {}

  check(key: string, now = Date.now()): RateLimitResult {
    this.sweep(now);
    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      bucket = { count: 0, windowStart: now };
      this.buckets.set(key, bucket);
    }
    bucket.count++;
    const resetSeconds = Math.max(1, Math.ceil((bucket.windowStart + this.windowMs - now) / 1000));
    return { allowed: bucket.count <= this.limit, limit: this.limit, remaining: Math.max(0, this.limit - bucket.count), resetSeconds };
  }

  private sweep(now: number) {
    if (now - this.lastSweep < this.windowMs && this.buckets.size < this.maxKeys) return;
    this.lastSweep = now;
    for (const [k, b] of this.buckets) if (now - b.windowStart >= this.windowMs) this.buckets.delete(k);
    if (this.buckets.size >= this.maxKeys) this.buckets.clear();
  }
}

/** Route class → limiter. Admin and cron endpoints are deliberately strict. */
export const LIMITERS = {
  suggest: new FixedWindowLimiter(240, 60_000),
  search: new FixedWindowLimiter(120, 60_000),
  read: new FixedWindowLimiter(180, 60_000),
  admin: new FixedWindowLimiter(10, 60_000),
};

export function limiterFor(pathname: string): keyof typeof LIMITERS | null {
  if (!pathname.startsWith("/api/")) return null;
  if (pathname.startsWith("/api/suggest")) return "suggest";
  if (pathname.startsWith("/api/search")) return "search";
  if (pathname.startsWith("/api/admin") || pathname.startsWith("/api/cron")) return "admin";
  return "read";
}
