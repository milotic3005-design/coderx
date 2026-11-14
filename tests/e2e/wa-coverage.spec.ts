import { expect, test } from "@playwright/test";

/** Washington coverage: needs the uploaded Washington files and NLM's RxNav, so it runs against deployments only. */
test.describe("Washington drug coverage", () => {
  test.skip(({ baseURL }) => !baseURL || /localhost|127\.0\.0\.1/.test(baseURL), "Needs the uploaded Washington data and RxNav; runs with npm run test:e2e:prod.");

  test("answers each plan for Enbrel from the uploaded files, with UMP as a link", async ({ page }) => {
    await page.goto("/tools/wa-coverage?q=Enbrel", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "What was matched" })).toBeVisible();
    const apple = page.getByRole("table", { name: "Washington Apple Health (Medicaid): coverage by plan" });
    await expect(apple.getByRole("row", { name: /Apple Health \(Medicaid, all plans\)/ })).toContainText("Yes");
    await expect(page.getByText(/^Listed on \d+ of \d+ plans\. Among those: PA on \d+/).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "UMP preferred drug list (PDF, HCA)" })).toHaveAttribute("href", /ump-preferred-drug-list\.pdf$/);
    await expect(page.getByRole("heading", { name: "Reference price (NADAC)" })).toBeVisible();
  });

  test("offers RxNorm's closest names instead of guessing", async ({ page }) => {
    await page.goto("/tools/wa-coverage?q=ozempick", { waitUntil: "networkidle" });
    await expect(page.getByText("No exact match in RxNorm")).toBeVisible();
    await page.getByRole("list", { name: "RxNorm's closest names" }).getByRole("link", { name: "Ozempic", exact: true }).click();
    await expect(page).toHaveURL(/q=Ozempic$/);
    await expect(page.getByRole("heading", { name: "Coverage by plan" })).toBeVisible();
  });
});
