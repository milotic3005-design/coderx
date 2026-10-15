import { timingSafeEqual, createHash } from "node:crypto";

/** Constant-time comparison of a presented bearer token with a configured secret. */
export function bearerMatches(request: Request, secret: string | undefined, minLength = 32): boolean {
  if (!secret || secret.length < minLength) return false;
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  // Hash both sides so lengths match and timing does not leak the secret length.
  const a = createHash("sha256").update(match[1].trim()).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}
