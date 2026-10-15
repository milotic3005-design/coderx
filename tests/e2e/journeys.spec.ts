import { expect, test } from "@playwright/test";

const search = (q: string) => `/search?q=${encodeURIComponent(q)}`;

test.describe("required user journeys", () => {
  test("1. search by exact HCPCS code", async ({ page }) => {
    await page.goto(search("J9271"));
    await expect(page.getByRole("heading", { level: 1 })).toContainText("“J9271”");
    const first = page.locator("article").first();
    await expect(first).toContainText("J9271");
    await expect(first).toContainText("Exact HCPCS code match");
  });

  test("2. search by lowercase HCPCS code", async ({ page }) => {
    await page.goto(search("j9271"));
    await expect(page.getByText("Interpreted as:")).toContainText("HCPCS code");
    await expect(page.locator("article").first()).toContainText("J9271");
  });

  test("3. search by brand name", async ({ page }) => {
    await page.goto(search("Keytruda"));
    const first = page.locator("article").first();
    await expect(first).toContainText("Keytruda");
    await expect(first).toContainText("Exact brand name match");
  });

  test("4. search by generic name", async ({ page }) => {
    await page.goto(search("pembrolizumab"));
    await expect(page.locator("article").first()).toContainText("Keytruda");
  });

  test("5. search by formatted 10-digit NDC", async ({ page }) => {
    await page.goto(search("0006-3026-02"));
    await expect(page.locator("article").first()).toContainText("00006-3026-02");
    await expect(page.locator("article").first()).toContainText("Exact NDC match");
  });

  test("6. search by normalized 11-digit NDC", async ({ page }) => {
    await page.goto(search("00006302602"));
    await expect(page.locator("article").first()).toContainText("00006-3026-02");
  });

  test("7. search with a minor misspelling", async ({ page }) => {
    await page.goto(search("Keytrda"));
    await expect(page.locator("article").first()).toContainText("Keytruda");
    await expect(page.locator("article").first()).toContainText("Similar spelling");
  });

  test("8. view an active record with provenance", async ({ page }) => {
    await page.goto("/hcpcs/J9312");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("J9312");
    await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
    await expect(page.locator("#reimbursement")).toContainText("$72.094");
    await expect(page.locator("#reimbursement")).toContainText("Medicare Part B Drug Payment Limit File");
    await expect(page.locator("#ndc-packages")).toContainText("50242-0051-21");
    await expect(page.getByLabel("Data provenance").first()).toContainText("Official CMS");
  });

  test("9. view an inactive historical record", async ({ page }) => {
    await page.goto("/hcpcs/S0189");
    await expect(page.getByRole("alert").filter({ hasText: "terminated" })).toContainText("Dec 31, 2025");
    await expect(page.locator("#history")).toContainText("Termination date set");
    await expect(page.locator("#overview")).toContainText("Not payable by Medicare");
  });

  test("10. use the billing-unit calculator", async ({ page }) => {
    await page.goto("/calculator?code=J9312&ndc=50242-0051-21");
    await expect(page.getByText("“10 MG” from the CMS payment limit file")).toBeVisible();
    await page.getByLabel("Dose", { exact: true }).fill("375");
    await page.getByRole("radio", { name: "Single-dose" }).check();
    const result = page.locator("section[aria-live]");
    await expect(result).toContainText("Administered HCPCS units");
    await expect(result).toContainText("38");
    await expect(result).toContainText("ceil(37.5)");
    await expect(result).toContainText("Units attributable to the discarded amount");
    await expect(result).toContainText("rounded up to 38");
    await expect(page.getByText("Payer rules and claim requirements must be verified")).toBeVisible();
  });

  test("11. handle an ambiguous drug name", async ({ page }) => {
    await page.goto(search("dexamethasone"));
    await expect(page.getByRole("alert").filter({ hasText: "different drugs" })).toBeVisible();
  });

  test("12. handle a no-result query", async ({ page }) => {
    await page.goto(search("zzqxjv"));
    await expect(page.getByRole("heading", { name: "No matching records" })).toBeVisible();
    await expect(page.getByText("Check the spelling")).toBeVisible();
  });

  test("13. display missing source data safely", async ({ page }) => {
    await page.goto("/hcpcs/J3490");
    await expect(page.getByText("No authoritative public data was located for this field.").first()).toBeVisible();
    await expect(page.locator("#overview")).toContainText("On the CMS NOC code list");
  });

  test("ambiguous unhyphenated NDC offers each interpretation", async ({ page }) => {
    await page.goto("/ndc/0006302602");
    await expect(page.getByRole("heading", { name: "Which NDC did you mean?" })).toBeVisible();
    await expect(page.getByRole("link", { name: /00006-3026-02/ })).toBeVisible();
  });

  test("non-canonical URLs redirect permanently", async ({ request }) => {
    const r1 = await request.get("/hcpcs/j9271", { maxRedirects: 0 });
    expect(r1.status()).toBe(308);
    expect(r1.headers()["location"]).toContain("/hcpcs/J9271");
    const r2 = await request.get("/ndc/0006-3026-02", { maxRedirects: 0 });
    expect(r2.status()).toBe(308);
    expect(r2.headers()["location"]).toContain("/ndc/00006-3026-02");
  });
});

test.describe("14. keyboard-only workflow", () => {
  test("search, choose a suggestion, and navigate the page without a mouse", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.keyboard.press("Tab"); // skip link
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    await page.keyboard.press("/");
    const box = page.getByRole("combobox");
    await expect(box).toBeFocused();
    await page.keyboard.type("rituxi");
    await expect(page.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(box).toHaveAttribute("aria-activedescendant", /opt-0-0/);
    await expect(page.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/drugs\/rituxan-rituximab$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Rituxan");
    // Section navigation is reachable and works from the keyboard.
    const nav = page.getByRole("navigation", { name: "On this page" });
    await nav.getByRole("link", { name: /Reimbursement/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#reimbursement$/);
  });

  test("Escape closes suggestions and focus stays visible", async ({ page }) => {
    await page.goto("/");
    const box = page.getByRole("combobox");
    await box.focus();
    await page.keyboard.type("keyt");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toBeHidden();
    const outline = await box.evaluate((el) => getComputedStyle(el.closest("div")!).boxShadow);
    expect(outline).not.toBe("none");
  });
});
