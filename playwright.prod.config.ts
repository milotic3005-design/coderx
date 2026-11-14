import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig, devices } from "@playwright/test";
// Smoke-test a deployed environment: BASE_URL=https://... npx playwright test -c playwright.prod.config.ts

// The benchmark tests unlock with the real password, kept in the git-ignored .env.production.local.
// Only that one variable is read; a value already set in the shell wins.
const ENV_FILE = ".env.production.local";
if (!process.env.CODERX_BENCHMARK_PASSWORD && existsSync(ENV_FILE)) {
  const password = parseEnv(readFileSync(ENV_FILE, "utf8")).CODERX_BENCHMARK_PASSWORD;
  if (password) process.env.CODERX_BENCHMARK_PASSWORD = password;
}

export default defineConfig({
  testDir: "tests/e2e",
  workers: 2,
  timeout: 60_000,
  reporter: [["list"]],
  use: { baseURL: process.env.BASE_URL ?? "https://coderxnsl.vercel.app" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
