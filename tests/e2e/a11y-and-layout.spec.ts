import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = ["/", "/search?q=rituximab", "/hcpcs/J9312", "/hcpcs/S0189", "/drugs/rituxan-rituximab", "/ndc/00006-3026-02", "/manufacturers/genentech-inc", "/calculator?code=J9312", "/codes/j", "/sources", "/methodology", "/tools", "/tools/audit", "/tools/margin", "/tools/biosimilars", "/tools/changes", "/tools/scan", "/tools/site-of-care?code=J9312&units=50", "/tools/intake?code=J9312", "/tools/price-benchmark?code=J9312"];

test.describe("accessibility (axe-core, WCAG 2.x A/AA)", () => {
  for (const path of PAGES) {
    for (const scheme of ["light", "dark"] as const) {
      test(`${path} has no serious or critical violations (${scheme})`, async ({ page }) => {
        // Reduced motion renders entrance animations in their final state, so contrast is measured as users read it.
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.goto(path);
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
        const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(serious.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
      });
    }
  }

  test("pages have one h1 and a logical heading order", async ({ page }) => {
    for (const path of ["/", "/hcpcs/J9312", "/drugs/rituxan-rituximab", "/calculator?code=J9312", "/tools", "/tools/biosimilars", "/tools/changes"]) {
      await page.goto(path);
      await expect(page.locator("h1")).toHaveCount(1);
      const levels = await page.locator("main h1, main h2, main h3").evaluateAll((els) => els.map((e) => Number(e.tagName[1])));
      for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("15. responsive layout", () => {
  const sizes = [
    { name: "mobile", width: 375, height: 812 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1440, height: 900 },
  ];
  for (const size of sizes) {
    test(`no horizontal page overflow on ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      for (const path of PAGES) {
        await page.goto(path);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
      }
    });
  }

  test("wide tables scroll inside a labeled, focusable region on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/hcpcs/J9312");
    const region = page.getByRole("region", { name: /Medicare Part B payment limits/ });
    await expect(region).toBeVisible();
    await expect(region).toHaveAttribute("tabindex", "0");
    const scrollable = await region.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(scrollable).toBe(true);
  });

  test("touch targets in the header are at least 40px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    for (const name of ["Switch to dark theme", "Switch to light theme", "Toggle color theme"]) {
      const btn = page.getByRole("button", { name });
      if (await btn.count()) {
        const box = await btn.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(40);
        expect(box!.width).toBeGreaterThanOrEqual(40);
      }
    }
  });
});

test.describe("security headers", () => {
  test("pages send a nonce-based CSP and hardening headers", async ({ request }) => {
    const res = await request.get("/");
    const h = res.headers();
    expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["x-powered-by"]).toBeUndefined();
  });

  test("API responses carry rate-limit headers and a JSON envelope", async ({ request }) => {
    const res = await request.get("/api/search?q=J9271");
    expect(res.status()).toBe(200);
    expect(res.headers()["ratelimit-limit"]).toBeTruthy();
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["data", "error", "meta"]);
  });

  test("the admin import endpoint is not exposed without a configured token", async ({ request }) => {
    const res = await request.post("/api/admin/import", { data: {} });
    expect([401, 404]).toContain(res.status());
  });
});
