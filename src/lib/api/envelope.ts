/**
 * Consistent JSON envelope for every API response:
 *   { data, meta: { requestId, generatedAt, pagination?, match?, provenance? }, error }
 */
import type { Provenance } from "@/lib/data/provenance";

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Meta {
  requestId: string;
  generatedAt: string;
  pagination?: Pagination;
  match?: Record<string, unknown>;
  provenance?: Provenance[];
  [key: string]: unknown;
}

export type ErrorCode = "INVALID_PARAMETER" | "NOT_FOUND" | "UNAUTHORIZED" | "RATE_LIMITED" | "SERVICE_UNAVAILABLE" | "INTERNAL_ERROR" | "METHOD_NOT_ALLOWED";

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

function requestIdFrom(request?: Request): string {
  return request?.headers.get("x-vercel-id") ?? request?.headers.get("x-request-id") ?? crypto.randomUUID();
}

const READ_CACHE = "public, max-age=0, s-maxage=300, stale-while-revalidate=3600";

export function ok<T>(data: T, extra: Omit<Partial<Meta>, "requestId" | "generatedAt"> = {}, init: { request?: Request; cache?: boolean } = {}): Response {
  const body = { data, meta: { requestId: requestIdFrom(init.request), generatedAt: new Date().toISOString(), ...extra }, error: null };
  return Response.json(body, {
    status: 200,
    headers: { "Cache-Control": init.cache === false ? "no-store" : READ_CACHE },
  });
}

const STATUS: Record<ErrorCode, number> = {
  INVALID_PARAMETER: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

export function fail(code: ErrorCode, message: string, init: { request?: Request; details?: unknown; headers?: Record<string, string> } = {}): Response {
  const body = {
    data: null,
    meta: { requestId: requestIdFrom(init.request), generatedAt: new Date().toISOString() },
    error: { code, message, ...(init.details !== undefined ? { details: init.details } : {}) },
  };
  return Response.json(body, { status: STATUS[code], headers: { "Cache-Control": "no-store", ...init.headers } });
}

/** Log server-side without echoing request contents (no query text, no IPs). */
export function logError(scope: string, error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(JSON.stringify({ level: "error", scope, message, at: new Date().toISOString() }));
}

/** Wrap a handler so unexpected errors become a generic 500/503 envelope. */
export async function handle(request: Request, scope: string, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    logError(scope, error);
    const message = error instanceof Error ? error.message : "";
    if (/DATABASE_URL|ECONNREFUSED|connect|timeout/i.test(message)) {
      return fail("SERVICE_UNAVAILABLE", "The data service is temporarily unavailable. Please try again shortly.", { request });
    }
    return fail("INTERNAL_ERROR", "An unexpected error occurred.", { request });
  }
}
