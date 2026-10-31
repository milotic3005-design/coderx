import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3301);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 45_000,
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Production build + server against a PGlite database seeded from real CMS/FDA excerpts.
    command: `npm run e2e:db && npm run build && npx next start --port ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    // A test-only benchmark password (the production one lives in Vercel and .env.production.local).
    env: { CODERX_PGLITE_DIR: ".data/e2e-pglite", DATABASE_URL: "", CODERX_DISABLE_DATA_CACHE: "1", NEXT_TELEMETRY_DISABLED: "1", CODERX_BENCHMARK_PASSWORD: "local-e2e-benchmark" },
  },
});
