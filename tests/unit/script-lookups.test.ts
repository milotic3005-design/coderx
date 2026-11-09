import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { isScriptedLookup, proxy } from "@/proxy";

const BROWSER = { "sec-fetch-site": "same-origin", accept: "text/html,application/xhtml+xml", "accept-language": "en-US,en;q=0.9", "user-agent": "Mozilla/5.0 Chrome/140" };
const OLD_BROWSER = { accept: "text/html,application/xhtml+xml,*/*;q=0.8", "accept-language": "en-US", "user-agent": "Mozilla/5.0 Safari/605" };
const SCRIPTS: Record<string, string>[] = [{}, { accept: "*/*", "user-agent": "python-requests/2.32" }, { accept: "text/html", "user-agent": "curl/8.7" }, { "accept-language": "en-US", accept: "*/*" }];

const get = (path: string, headers: Record<string, string> = {}) => new NextRequest(`https://coderxnsl.vercel.app${path}`, { headers });

describe("scripted lookups of calculator and tool pages", () => {
  it.each(["/calculator?code=J9312", "/tools/site-of-care?code=J9312&units=50", "/tools/part-b-vs-d?code=J0129", "/tools/intake?code=J9312", "/calculator/?code=J9312"])("refuses a script on %s", (path) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const headers of SCRIPTS) {
      const res = proxy(get(path, headers));
      expect(res.status).toBe(403);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-middleware-next")).toBeNull();
    }
    vi.restoreAllMocks();
  });

  it.each(["/calculator?code=J9312", "/tools/site-of-care?code=J9312", "/tools/part-b-vs-d?code=J0129"])("lets browsers through on %s, including ones without Fetch Metadata", (path) => {
    for (const headers of [BROWSER, OLD_BROWSER, { "sec-fetch-site": "none" }]) {
      const res = proxy(get(path, headers));
      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("only guards lookups: pages without a code, record pages, tool landing pages, and the API are untouched", () => {
    for (const path of ["/calculator", "/tools", "/tools/site-of-care", "/hcpcs/J9312", "/drugs/rituxan-rituximab", "/ndc/00006-3026-02", "/search?q=x", "/tools/biosimilars?ref=rituxan-rituximab", "/api/hcpcs/J9312?code=J9312"]) {
      expect(isScriptedLookup(new URL(`https://x.test${path}`).pathname, new URL(`https://x.test${path}`).searchParams, new Headers())).toBe(false);
    }
    expect(proxy(get("/hcpcs/J9312")).status).toBe(200);
  });

  it("logs the sender's user agent at most once a minute, without the query", () => {
    vi.resetModules();
    return import("@/proxy").then(({ proxy: fresh }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      for (let i = 0; i < 5; i++) fresh(get(`/calculator?code=J${9000 + i}`, { "user-agent": "ScannerBot/1.0 (+https://example.test)" }));
      expect(warn).toHaveBeenCalledTimes(1);
      const line = JSON.parse(String(warn.mock.calls[0][0]));
      expect(line).toMatchObject({ scope: "proxy.script-lookup", path: "/calculator", userAgent: "ScannerBot/1.0 (+https://example.test)" });
      expect(JSON.stringify(line)).not.toMatch(/J9000|code=/);
      warn.mockRestore();
    });
  });
});
