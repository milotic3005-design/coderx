import { expect, test } from "@playwright/test";
import { toBuffer } from "bwip-js/node";

// Rituxan 100 mg/10 mL: FDA NDC 50242-051-21 (5-3-2), 11-digit 50242-0051-21. GTIN-14 = 0 + 03 + NDC10 + check digit.
const GTIN = "00350242051217";
const GS1 = `01${GTIN}17271231` + "10LOTA1";

test.describe("vial barcode scanner", () => {
  test("resolves a GS1 string from a USB scanner to the product, code, units, and Medicaid unit", async ({ page }) => {
    const res = await page.goto("/tools/scan", { waitUntil: "networkidle" });
    expect(res?.headers()["permissions-policy"]).toContain("camera=(self)");
    await page.getByLabel("USB scanner or typed NDC").fill(GS1);
    await page.getByLabel("USB scanner or typed NDC").press("Enter");
    const card = page.locator("li").filter({ hasText: "NDC 50242-0051-21" });
    await expect(card).toContainText("Rituxan");
    await expect(card).toContainText("J9312");
    await expect(card).toContainText("ML → ML");
    await expect(card).toContainText("Expires 2027-12-31");
    await expect(card).toContainText("Lot LOTA1");
    await expect(card.getByRole("link", { name: "Calculate" })).toHaveAttribute("href", "/calculator?code=J9312&ndc=50242-0051-21");
  });

  test("decodes a GS1 DataMatrix photo", async ({ page }) => {
    const png = await toBuffer({ bcid: "gs1datamatrix", text: `(01)${GTIN}(17)271231(10)LOTA1`, scale: 6, paddingwidth: 10, paddingheight: 10, backgroundcolor: "FFFFFF" });
    await page.goto("/tools/scan", { waitUntil: "networkidle" });
    await page.locator('input[type="file"]').setInputFiles({ name: "vial.png", mimeType: "image/png", buffer: png });
    await expect(page.locator("li").filter({ hasText: "NDC 50242-0051-21" })).toContainText("J9312", { timeout: 15_000 });
  });
});

test.describe("Medicaid rebate data", () => {
  test("NDC page shows the Medicaid unit type and COD status", async ({ page }) => {
    await page.goto("/ndc/50242-0051-21");
    await expect(page.getByRole("region", { name: "At a glance" })).toContainText("Medicaid unit type");
    await expect(page.getByText("02 — BLA")).toBeVisible();
    await expect(page.getByText("ML — Milliliter")).toBeVisible();
  });

  test("claim lines take the NDC qualifier from the Medicaid unit type", async ({ page }) => {
    await page.goto("/calculator?code=J9312&ndc=50242-0051-21", { waitUntil: "networkidle" });
    await page.getByLabel("Dose", { exact: true }).fill("375");
    await expect(page.getByText(/Medicaid Drug Rebate Program lists this NDC's unit type as ML/)).toBeVisible();
  });
});

test.describe("biosimilar switch simulator and RSS", () => {
  test("simulator compares all-reference with a 50% switch", async ({ page }) => {
    await page.goto("/tools/biosimilars?ref=rituxan-rituximab", { waitUntil: "networkidle" });
    const table = page.getByRole("table", { name: "Annual totals before and after the switch" });
    await expect(table).toContainText("$605,590");
    await expect(table).toContainText("$327,121");
  });


  test("RSS feed lists watchlist changes", async ({ request }) => {
    const res = await request.get("/feeds/changes?codes=J9312");
    expect(res.headers()["content-type"]).toContain("application/rss+xml");
    const xml = await res.text();
    expect(xml).toContain('<guid isPermaLink="false">coderx-limit-2026-Q4-J9312</guid>');
    expect(xml).toContain("J9312 payment limit $73.278 → $72.094");
  });
});

test.describe("site of care: HOPD vs home infusion", () => {
  test("prices Medicare HOPD from the OPPS addenda and compares commercial terms", async ({ page }) => {
    await page.goto("/tools/site-of-care?code=J9312&units=50", { waitUntil: "networkidle" });
    await expect(page.getByText("Paid separately (non-pass-through drug or biological)")).toBeVisible();
    const table = page.getByRole("table", { name: "Expected revenue per month at each site, by payer" });
    const medicare = table.getByRole("row", { name: /Medicare fee-for-service/ });
    // 50 × $72.094 + (Level 4 $337.46 + Level 2 $73.56) × 0.9951, Medicare share less 2%.
    await expect(medicare).toContainText("$3,949.49");
    await expect(medicare).toContainText("Add the missing inputs");

    await page.getByRole("checkbox", { name: /Part B covers this drug at home/ }).check();
    await expect(medicare).toContainText("$3,547.02");
    await expect(medicare).toContainText("HOPD by $402.47/mo");

    await page.getByLabel("HOPD drug amount").fill("150");
    await page.getByLabel("HOPD administration amount").fill("200");
    await page.getByLabel("Home drug amount").fill("120");
    const commercial = table.getByRole("row", { name: /Commercial/ });
    await expect(commercial).toContainText("$6,225.06");
    await expect(commercial).toContainText("$4,325.64");
  });

  test("adds an Apple Health supply from the HCA schedule", async ({ page }) => {
    await page.goto("/tools/site-of-care?code=J9312&units=50", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "A4222" }).click();
    await page.getByLabel(/HOPD: EAPG payment/).fill("1800");
    await page.getByLabel(/Home: drug payment/).fill("68");
    const row = page.getByRole("table", { name: "Expected revenue per month at each site, by payer" }).getByRole("row", { name: /Washington Apple Health/ });
    await expect(row).toContainText("$3,447.35"); // 50 × $68 + A4222 at the HCA maximum of $47.35
    await expect(row).toContainText("Home infusion by $1,647.35/mo");
  });
});

test("the retired capacity planner URL redirects to the tools page", async ({ page }) => {
  const res = await page.goto("/tools/capacity");
  expect(page.url()).toMatch(/\/tools$/);
  expect(res?.status()).toBe(200);
});

test.describe("referral intake card", () => {
  test("summarizes billing, payer requirements, and NDC qualifiers for a code", async ({ page }) => {
    await page.goto("/tools/intake?code=J9312", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Intake card: J9312");
    const ndcs = page.getByRole("table", { name: /NDCs mapped to J9312/ });
    await expect(ndcs.getByRole("row", { name: /50242-0051-21/ })).toContainText("single-dose");
    await expect(ndcs.getByRole("row", { name: /50242-0051-21/ })).toContainText("ML");
    await expect(page.getByText("Paid separately (non-pass-through drug or biological)")).toBeVisible();
    await expect(page.getByText("$72.09 maximum allowable")).toBeVisible();
    await expect(page.getByText(/Apple Health \(professional claims\): PA required/)).toBeVisible();
    await expect(page.getByText(/JW for discarded drug, JZ when none/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Print card" })).toBeVisible();
  });
});

// Local runs use the test server's password; production runs read the real one from the environment.
const BENCHMARK_PASSWORD = process.env.CODERX_BENCHMARK_PASSWORD ?? "local-e2e-benchmark";

async function unlockBenchmark(page: import("@playwright/test").Page, path = "/tools/price-benchmark?code=J9312") {
  await page.goto(path, { waitUntil: "networkidle" });
  const form = page.getByRole("form", { name: "Unlock the MultiCare price benchmark" });
  await form.getByLabel("Password").fill(BENCHMARK_PASSWORD);
  await form.getByRole("button", { name: "Unlock" }).click();
  await page.waitForLoadState("networkidle");
}

test.describe("MultiCare price benchmark", () => {
  test("is locked without the password, and a wrong password is refused", async ({ page, request }) => {
    await page.goto("/tools/price-benchmark?code=J9312", { waitUntil: "networkidle" });
    await expect(page.getByRole("form", { name: "Unlock the MultiCare price benchmark" })).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    const form = page.getByRole("form", { name: "Unlock the MultiCare price benchmark" });
    await form.getByLabel("Password").fill("not-the-password");
    await form.getByRole("button", { name: "Unlock" }).click();
    await expect(page.getByRole("form", { name: "Unlock the MultiCare price benchmark" }).getByRole("alert")).toHaveText("That password is not correct.");
    expect(new URL(page.url()).searchParams.get("access")).toBe("denied");
    await expect(page.getByRole("table")).toHaveCount(0);
    // Locked pages and the public API carry none of the benchmark data.
    await page.goto("/hcpcs/J9312", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "MultiCare negotiated rates (hospital price transparency files)" })).toHaveCount(0);
    await page.goto("/tools/site-of-care?code=J9312&units=50", { waitUntil: "networkidle" });
    await expect(page.getByText(/MultiCare.s published commercial outpatient rates/)).toHaveCount(0);
    const api = await (await request.get("/api/hcpcs/J9312")).json();
    expect(api.data.hospitalRates).toBeUndefined();
    expect(JSON.stringify(api)).not.toContain("yakima-memorial");
  });

  test("shows anonymized negotiated rates per billing unit by plan type once unlocked", async ({ page }) => {
    await unlockBenchmark(page);
    const pooled = page.getByRole("table", { name: /MultiCare outpatient negotiated rates for J9312 per 10 MG, all hospitals, by plan type/ });
    await expect(pooled.getByRole("row", { name: /Commercial/ })).toBeVisible();
    await expect(pooled.getByRole("row", { name: /Medicare Advantage/ })).toBeVisible();
    await expect(page.getByRole("table", { name: /by MultiCare hospital and plan type/ })).toContainText("MultiCare Yakima Memorial Hospital");
    await expect(page.locator("main")).not.toContainText("Regence");
    // The cookie unlocks the code page section and the site-of-care hint too.
    await page.goto("/hcpcs/J9312", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "MultiCare negotiated rates (hospital price transparency files)" })).toBeVisible();
    await page.goto("/tools/site-of-care?code=J9312&units=50", { waitUntil: "networkidle" });
    await expect(page.getByText(/MultiCare.s published commercial outpatient rates for J9312: median \d+% of the CMS payment limit/)).toBeVisible();
    // Lock again.
    await page.goto("/tools/price-benchmark?code=J9312", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Lock" }).click();
    await expect(page.getByRole("form", { name: "Unlock the MultiCare price benchmark" })).toBeVisible();
  });

  test("the unlocked benchmark has no serious accessibility violations", async ({ page }) => {
    const AxeBuilder = (await import("@axe-core/playwright")).default;
    await unlockBenchmark(page);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  });
});
