import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { EDITION } from "../env";
import { expect, test } from "../support";
import { firstRun, startLocalServer, type LocalServer, type Owner } from "./server";

// FITRON for Windows' own timer (src/lib/runtime/local-scheduler.ts), in the real built server: a couple of minutes
// after FITRON opens it takes the automatic backup, then runs the day's jobs for the gym, with no scheduler outside.
// Slow by design (the first run waits two minutes so opening FITRON is never slowed down). Local Edition only.
test.skip(EDITION !== "local", "Local Edition only (npm run e2e:local)");

const PORT = 3304;
const owner: Owner = { gym: "Timer Gym", name: "Meera Rao", email: "owner@timer.in", password: "a-long-password-1" };
let dataDir: string;
let server: LocalServer;
let ctx: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), "fitron-timer-"));
  server = await startLocalServer(dataDir, PORT);
  ctx = await browser.newContext({ baseURL: server.url, locale: "en-IN", timezoneId: "Asia/Kolkata" });
  await ctx.addInitScript((k) => localStorage.setItem(k, "1"), `fitron-tour-done-${owner.email}`);
  page = await ctx.newPage();
});
test.afterAll(async () => {
  await server?.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

test("a couple of minutes after FITRON opens, it backs up and runs the day's jobs on its own", async () => {
  test.setTimeout(300_000);
  await firstRun(page, owner);
  await expect
    .poll(
      async () => {
        await page.goto("/settings/jobs");
        return page.getByText("Churn risk for every member").count();
      },
      { timeout: 240_000, intervals: [15_000] },
    )
    .toBeGreaterThan(0);
  for (const job of ["Churn risk for every member", "Check out visits left open on earlier days", "Lead follow-ups due"]) await expect(page.getByText(job).first(), job).toBeVisible();
  // The demo autopay debits never run on their own on a computer, and nothing failed.
  await expect(page.getByText("UPI Autopay demo debits")).toHaveCount(0);
  await expect(page.getByText(/^Failed:/)).toHaveCount(0);
  await page.goto("/settings/backup");
  await expect(page.getByText(/FITRON-Backup-\d{4}-\d{2}-\d{2}\.fitronbackup/).first()).toBeVisible();
});
