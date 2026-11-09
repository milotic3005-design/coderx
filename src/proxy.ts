/**
 * Runs before every page and API request:
 *  - API routes: per-IP fixed-window rate limiting (best effort per instance).
 *  - Calculator and tool lookups (?code=…): refused for scripts, which have no use for the HTML pages (see below).
 *  - Pages: a fresh nonce and a strict Content-Security-Policy.
 */
import { NextResponse, type NextRequest } from "next/server";
import { LIMITERS, limiterFor } from "@/lib/api/rate-limit";
import { formatNdc11, parseNdc } from "@/lib/ndc";

/** Canonical URLs: uppercase HCPCS codes and 5-4-2 NDCs (permanent redirects). */
function canonicalRedirect(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl;
  const code = pathname.match(/^\/hcpcs\/([A-Za-z]\d{4})$/);
  if (code && code[1] !== code[1].toUpperCase()) {
    const url = request.nextUrl.clone();
    url.pathname = `/hcpcs/${code[1].toUpperCase()}`;
    return NextResponse.redirect(url, 308);
  }
  const ndc = pathname.match(/^\/ndc\/([^/]+)$/);
  if (ndc) {
    const raw = decodeURIComponent(ndc[1]);
    const parsed = parseNdc(raw);
    if (parsed.kind === "package" && formatNdc11(parsed.ndc11) !== raw) {
      const url = request.nextUrl.clone();
      url.pathname = `/ndc/${formatNdc11(parsed.ndc11)}`;
      return NextResponse.redirect(url, 308);
    }
  }
  return null;
}

function clientKey(request: NextRequest): string {
  return request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anonymous";
}

/** Pages that take a code in the URL and read the database on a cache miss. */
const LOOKUP_PAGE = /^\/(calculator|tools\/[a-z-]+)\/?$/;

/**
 * Browsers always send Fetch Metadata (Sec-Fetch-Site); the few that predate it still ask for HTML in a language.
 * A script that walks lookup URLs one code at a time sends neither. Such a script requested /calculator and
 * /tools/site-of-care every few seconds around the clock, kept the database awake, and used up Neon's free monthly
 * compute (2026-11-08). The same data is available from /api/hcpcs/{code}, which is rate limited.
 */
export function isScriptedLookup(pathname: string, searchParams: URLSearchParams, headers: Headers): boolean {
  if (!LOOKUP_PAGE.test(pathname) || !searchParams.has("code")) return false;
  if (headers.has("sec-fetch-site")) return false;
  return !((headers.get("accept") ?? "").includes("text/html") && headers.has("accept-language"));
}

let lastScriptLog = 0;

/** One line a minute per instance (path and user agent only, no address or query) so the sender can be identified. */
function logScript(pathname: string, userAgent: string | null, now = Date.now()) {
  if (now - lastScriptLog < 60_000) return;
  lastScriptLog = now;
  console.warn(JSON.stringify({ level: "warn", scope: "proxy.script-lookup", path: pathname, userAgent: (userAgent ?? "").slice(0, 120), at: new Date(now).toISOString() }));
}

export function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const limiterName = limiterFor(pathname);

  if (limiterName) {
    if (request.method === "OPTIONS") return NextResponse.next();
    const result = LIMITERS[limiterName].check(`${limiterName}:${clientKey(request)}`);
    const rateHeaders = {
      "RateLimit-Limit": String(result.limit),
      "RateLimit-Remaining": String(result.remaining),
      "RateLimit-Reset": String(result.resetSeconds),
    };
    if (!result.allowed) {
      return NextResponse.json(
        {
          data: null,
          meta: { requestId: crypto.randomUUID(), generatedAt: new Date().toISOString() },
          error: { code: "RATE_LIMITED", message: "Too many requests. Please wait and try again." },
        },
        { status: 429, headers: { ...rateHeaders, "Retry-After": String(result.resetSeconds), "Cache-Control": "no-store" } },
      );
    }
    const response = NextResponse.next();
    for (const [k, v] of Object.entries(rateHeaders)) response.headers.set(k, v);
    return response;
  }

  if (isScriptedLookup(pathname, request.nextUrl.searchParams, request.headers)) {
    logScript(pathname, request.headers.get("user-agent"));
    return new NextResponse("Automated requests to this page are not allowed. Use the API instead: /api/hcpcs/{code} (see /methodology).\n", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const redirect = canonicalRedirect(request);
  if (redirect) return redirect;

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|robots.txt|sitemap.xml|manifest.webmanifest).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
