import { defineConfig, devices } from "@playwright/test";
// Smoke-test a deployed environment: BASE_URL=https://... npx playwright test -c playwright.prod.config.ts
export default defineConfig({
  testDir: "tests/e2e",
  workers: 2,
  timeout: 60_000,
  reporter: [["list"]],
  use: { baseURL: process.env.BASE_URL ?? "https://coderxnsl.vercel.app" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
