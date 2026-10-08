import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, PORT, SERVER_ENV } from "./e2e/env";

// End-to-end tests: a real browser against a production build. `npm run build` first, then `npm run e2e`
// (CI does both; see .github/workflows/ci.yml and the README). The suite starts the server itself, and uses a
// server that is already running on the port when not in CI.
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    // The suite signs people in and out all the time; none of it needs the browser's own notion of a language.
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: SERVER_ENV,
    stdout: "pipe",
    stderr: "pipe",
  },
});
