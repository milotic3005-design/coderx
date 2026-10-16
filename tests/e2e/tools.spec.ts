import { expect, test } from "@playwright/test";

test.describe("calculator tools (MUE, claim lines, vial optimizer, worksheet)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/calculator?code=J9312&ndc=50242-0051-21", { waitUntil: "networkidle" });
    await page.getByLabel("Dose", { exact: true }).fill("375");
  });

  test("checks units against the CMS MUE and builds JW claim lines with the NDC segment", async ({ page }) => {
    const result = page.locator("section[aria-live]");
    await expect(result).toContainText("Max units per day · CMS MUE");
    await expect(result).toContainText("Within (38 of 150)");
    const lines = page.getByRole("table", { name: "Claim lines for J9312" });
    await expect(lines).toContainText("J9312-JW");
    await expect(lines).toContainText("N450242005121ML37.5");
    await expect(lines).toContainText("N450242005121ML2.5");
    // The container type comes from the FDA package text for this NDC.
    await expect(page.getByRole("radio", { name: "Single-dose" })).toBeChecked();
  });

  test("vial optimizer applies a whole-vial dose, which removes the discarded line", async ({ page }) => {
    const optimizer = page.getByRole("region", { name: "Vial optimizer" });
    await expect(optimizer).toContainText("Least unused drug for 375 mg");
    await optimizer.getByRole("button", { name: "Use 400 mg" }).click();
    await expect(page.getByLabel("Dose", { exact: true })).toHaveValue("400");
    await expect(page.getByRole("table", { name: "Claim lines for J9312" })).toContainText("J9312-JZ");
  });

  test("prints a one-page worksheet without the form", async ({ page }) => {
    await page.emulateMedia({ media: "print" });
    await expect(page.getByText("CodeRx billing worksheet")).toBeVisible();
    await expect(page.getByRole("form", { name: "Billing unit calculator inputs" })).toBeHidden();
    await expect(page.getByText("No patient information is entered into or stored by CodeRx.")).toBeVisible();
  });
});

test.describe("director tools", () => {
  test("chargemaster audit flags a mismatched code–NDC pair and a terminated code", async ({ page }) => {
    await page.goto("/tools/audit", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load an example" }).click();
    await page.getByRole("button", { name: /Run audit/ }).click();
    const table = page.getByRole("table", { name: "Audit results" });
    await expect(table).toContainText("CMS crosswalks 50242-0051-21 to J9312, not J9311");
    await expect(table).toContainText("S0189 was terminated 2025-12-31.");
    await expect(table).toContainText("10 billable unit(s) per package");
  });

  test("margin analyzer compares cost with expected Medicare revenue without sending costs", async ({ page }) => {
    await page.goto("/tools/margin", { waitUntil: "networkidle" });
    const sent: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/audit")) sent.push(r.postData() ?? "");
    });
    await page.getByRole("button", { name: "Load an example" }).click();
    await page.getByRole("button", { name: /Compare/ }).click();
    const table = page.getByRole("table", { name: "Expected Medicare revenue compared with your cost" });
    await expect(table).toContainText("$709.40");
    await expect(table).toContainText("−$103.10");
    expect(sent.join("")).not.toContain("812.5");
  });

  test("biosimilar comparator computes payment for a dose", async ({ page }) => {
    await page.goto("/tools/biosimilars#ref-rituxan-rituximab", { waitUntil: "networkidle" });
    const section = page.locator("#ref-rituxan-rituximab");
    await expect(section).toContainText("Truxima");
    await section.getByLabel("Dose (mg, optional)").fill("700");
    await expect(section.getByRole("row", { name: /Rituxan/ })).toContainText("70");
    await expect(section.getByRole("row", { name: /Rituxan/ })).toContainText("$5,046.58");
  });

  test("quarterly change report shows watchlist changes", async ({ page }) => {
    await page.goto("/tools/changes", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("What changed in Q4 2026");
    await page.getByLabel("Add codes").fill("J9312");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Payment limit $73.278 → $72.094")).toBeVisible();
  });
});

test.describe("code page additions", () => {
  test("HCPCS page shows MUE values and official coverage links", async ({ page }) => {
    await page.goto("/hcpcs/J9312");
    const mue = page.getByRole("table", { name: "CMS MUE values for J9312 by service setting" });
    await expect(mue).toContainText("Practitioner services");
    await expect(mue).toContainText("150");
    const link = page.getByRole("link", { name: /Coverage documents for J9312/ });
    await expect(link).toHaveAttribute("href", /medicare-coverage-database\/search-results\.aspx\?keyword=J9312/);
  });
});
