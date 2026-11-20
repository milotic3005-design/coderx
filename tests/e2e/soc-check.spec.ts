import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** The site-of-care denial check shares the MultiCare benchmark's password. */
const PASSWORD = process.env.CODERX_BENCHMARK_PASSWORD ?? "local-e2e-benchmark";

async function unlock(page: Page) {
  await page.goto("/tools/soc-check", { waitUntil: "networkidle" });
  const form = page.getByRole("form", { name: "Unlock the site-of-care denial check" });
  await form.getByLabel("Password").fill(PASSWORD);
  await form.getByRole("button", { name: "Unlock" }).click();
  await page.waitForLoadState("networkidle");
}

test.describe("Site-of-care denial check", () => {
  test("is locked without the password and shows no payer rules", async ({ page }) => {
    await page.goto("/tools/soc-check", { waitUntil: "networkidle" });
    await expect(page.getByRole("form", { name: "Unlock the site-of-care denial check" })).toBeVisible();
    await expect(page.getByText("Grace period")).toHaveCount(0);
  });

  test("gives a payer with no initial period the act-now answer, and quotes each payer's rule", async ({ page }) => {
    await unlock(page);
    const form = page.getByRole("form", { name: "Patient site-of-care check" });
    await form.getByLabel("Payer").selectOption({ label: "Cigna" });
    await expect(page.getByRole("region", { name: "Result" })).toContainText("states no initial period in the hospital");
    await expect(page.locator("#rules-regence")).toContainText("Grace period");
    await expect(page.locator("#rules-uhc")).toContainText("e.g., 4 weeks");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  });

  test("counts Regence's first 30 days for a drug on its list", async ({ page, baseURL }) => {
    test.skip(!baseURL || /localhost|127\.0\.0\.1/.test(baseURL), "Needs the uploaded payer policies; runs with npm run test:e2e:prod.");
    await unlock(page);
    const form = page.getByRole("form", { name: "Patient site-of-care check" });
    await form.getByLabel("Payer").selectOption({ label: "Regence BlueShield (incl. UMP/PEBB/SEBB)" });
    await form.getByLabel(/Find the drug/).fill("J3262");
    await form.getByLabel(/^Drug \(/).selectOption({ index: 0 });
    await form.getByLabel(/qualifies for/).check();
    await form.getByLabel(/^First (hospital )?dose/).fill("2026-11-10");
    const result = page.getByRole("region", { name: "Result" });
    await expect(result).toContainText("Last day of the period");
    await expect(result).toContainText("Dec 9, 2026");
    await expect(result).toContainText("Home infusion eligible");
  });
});
