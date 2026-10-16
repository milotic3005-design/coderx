import { expect, test } from "@playwright/test";

test.describe("record pages: at-a-glance strip and sticky bar", () => {
  test("HCPCS page leads with the key numbers and keeps them in a bar while scrolling", async ({ page }) => {
    await page.goto("/hcpcs/J9312", { waitUntil: "networkidle" });
    const glance = page.getByRole("region", { name: "At a glance" });
    await expect(glance).toContainText("10 MG");
    await expect(glance).toContainText("$72.094");
    await expect(glance).toContainText("150 / 150");
    await expect(glance.getByRole("link", { name: "Calculate units" })).toHaveAttribute("href", "/calculator?code=J9312");

    const bar = page.locator("[data-sticky-record-bar]");
    await expect(bar).toHaveAttribute("aria-hidden", "true");
    await page.locator("#history").scrollIntoViewIfNeeded();
    await expect(bar).toHaveAttribute("aria-hidden", "false");
    await expect(bar).toContainText("$72.094");
  });

  test("NDC page shows billable units and the derived payment per package", async ({ page }) => {
    await page.goto("/ndc/50242-0051-21");
    const glance = page.getByRole("region", { name: "At a glance" });
    await expect(glance).toContainText("J9312");
    await expect(glance).toContainText("$720.94");
  });
});

test.describe("command palette", () => {
  test("opens with Ctrl+K and jumps to a code", async ({ page }) => {
    await page.goto("/tools", { waitUntil: "networkidle" });
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await expect(dialog).toBeVisible();
    await page.keyboard.type("j9312");
    await expect(dialog.getByRole("option", { name: /Open J9312/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/hcpcs\/J9312$/);
  });

  test("ranks a matching tool first and closes with Escape", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await page.keyboard.type("margin");
    await expect(dialog.getByRole("option").first()).toContainText("Margin analyzer");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});

test.describe("tools bento and calculator summary", () => {
  test("home page shows the five tools", async ({ page }) => {
    await page.goto("/");
    const section = page.getByRole("region", { name: "Tools for the infusion workflow" });
    for (const name of ["Billing-unit calculator", "Chargemaster & formulary audit", "Margin analyzer", "Biosimilar comparator", "What changed this quarter"]) {
      await expect(section.getByRole("heading", { name })).toBeVisible();
    }
  });

  test("calculator summary stays in view while the form scrolls (desktop)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/calculator?code=J9312&ndc=50242-0051-21", { waitUntil: "networkidle" });
    await page.getByLabel("Dose", { exact: true }).fill("375");
    await page.getByRole("button", { name: "Reset" }).scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 600);
    const summary = page.locator("section[aria-live] dl").first();
    await expect(summary).toContainText("Administered HCPCS units");
    const box = await summary.boundingBox();
    expect(box && box.y >= 0 && box.y < 220).toBe(true);
  });
});
