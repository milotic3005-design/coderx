/**
 * Runs before every page and API request:
 *  - API routes: per-IP fixed-window rate limiting (best effort per instance).
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
