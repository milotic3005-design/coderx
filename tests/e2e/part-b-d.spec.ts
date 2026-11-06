import { expect, test, type Page } from "@playwright/test";

/** A row of the settings table; the dollars table has rows with similar names. */
const setting = (page: Page, name: RegExp) => page.getByRole("table", { name: /Which Medicare benefit pays/ }).getByRole("row", { name });

test.describe("Part B vs Part D tool", () => {
  test("a route-specific drug changes verdict and modifier", async ({ page }) => {
    await page.goto("/tools/part-b-vs-d?code=J0490", { waitUntil: "networkidle" });
    await expect(setting(page, /HOPD/)).toContainText("Needs a check");
    await page.getByLabel("Route").selectOption("iv");
    await expect(setting(page, /HOPD/)).toContainText("JA");
    await page.getByLabel("Route").selectOption("subcutaneous");
    await expect(setting(page, /HOPD/)).toContainText("JB");
    await expect(setting(page, /HOPD/)).toContainText("Not Part B");
  });
  test("the DMEPOS switch changes the pump row", async ({ page }) => {
    await page.goto("/tools/part-b-vs-d?code=J3285", { waitUntil: "networkidle" });
    await expect(setting(page, /DME pump/)).toContainText("needs an enrolled DMEPOS supplier");
    await page.getByLabel(/DMEPOS/).check();
    await expect(setting(page, /DME pump/)).toContainText("can bill");
  });
  test("the DMEPOS switch is remembered on this browser", async ({ page }) => {
    await page.goto("/tools/part-b-vs-d?code=J3285", { waitUntil: "networkidle" });
    await page.getByLabel(/DMEPOS/).check();
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByLabel(/DMEPOS/)).toBeChecked();
  });
  test("a statutory question appears only when it applies and changes the answer", async ({ page }) => {
    await page.goto("/tools/part-b-vs-d?code=J3285", { waitUntil: "networkidle" });
    await expect(page.getByLabel(/Medicare-covered organ transplant/)).toHaveCount(0);
    await expect(page.getByText("Other situations")).toBeVisible();
    await page.getByText("Other situations").click();
    await page.getByLabel(/clotting factor/).selectOption("yes");
    await expect(setting(page, /Home, no pump/)).toContainText("Part B");
  });
  test("the contract rate never leaves the browser", async ({ page }) => {
    const seen: string[] = [];
    page.on("request", (r) => seen.push(r.url() + (r.postData() ?? "")));
    await page.goto("/tools/part-b-vs-d?code=J3285", { waitUntil: "networkidle" });
    await page.getByLabel(/contract rate/i).fill("123.45");
    await page.getByLabel("Units per dose").fill("10");
    await page.waitForTimeout(300);
    await expect(page.getByRole("row", { name: /Home, Part D/ })).toContainText("You entered");
    expect(seen.join()).not.toContain("123.45");
  });
  test("a drug with two codes offers each code", async ({ page }) => {
    await page.goto("/tools/part-b-vs-d?q=aranesp", { waitUntil: "networkidle" });
    const choices = page.getByRole("list", { name: "HCPCS codes for this drug" });
    await expect(choices.getByRole("link")).toHaveCount(2);
    await expect(setting(page, /HOPD/)).toHaveCount(0);
    await choices.getByRole("link", { name: /J0881/ }).click();
    await expect(setting(page, /HOPD/)).toBeVisible();
  });
  test("unknown input gives the not-in-CodeRx message", async ({ page }) => {
    await page.goto("/tools/part-b-vs-d?q=zzzzqq", { waitUntil: "networkidle" });
    await expect(page.getByText("This drug is not in CodeRx")).toBeVisible();
    await expect(setting(page, /HOPD/)).toHaveCount(0);
  });
  test("bad numbers hide dollars without NaN", async ({ page }) => {
    await page.goto("/tools/part-b-vs-d?code=J3285", { waitUntil: "networkidle" });
    for (const value of ["abc", "-1", "0", "1e9", ""]) {
      await page.getByLabel("Units per dose").fill(value);
      await expect(page.locator("main")).not.toContainText("NaN");
      await expect(page.locator("main")).not.toContainText("Infinity");
    }
  });
  test("shows Washington plan coverage for a listed drug", async ({ page }) => {
    await page.goto("/tools/part-b-vs-d?code=J0897&drug=prolia-denosumab", { waitUntil: "networkidle" });
    const panel = page.getByRole("region", { name: "Washington Part D plans" });
    await expect(panel).toContainText(/Tier/);
    await expect(panel).toContainText(/\d+ of \d+ Washington plans/);
  });
  test("says a drug is not listed without calling it denied", async ({ page }) => {
    await page.goto("/tools/part-b-vs-d?code=J9312", { waitUntil: "networkidle" });
    const panel = page.getByRole("region", { name: "Washington Part D plans" });
    await expect(panel).toContainText("CMS's formulary file does not list this drug for Washington plans.");
    await expect(panel).not.toContainText(/denied|not covered/i);
  });
  test("the drug page links to the tool", async ({ page }) => {
    await page.goto("/drugs/rituxan-rituximab", { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "Which Medicare benefit pays for this drug?" }).click();
    await expect(page).toHaveURL(/\/tools\/part-b-vs-d\?drug=rituxan-rituximab/);
    await expect(setting(page, /HOPD/)).toContainText("Part B");
  });
  test("the tool is on the tools page", async ({ page }) => {
    await page.goto("/tools");
    await expect(page.getByRole("link", { name: /Part B vs Part D/ }).first()).toBeVisible();
  });
});
