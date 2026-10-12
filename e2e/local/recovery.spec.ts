import { closeSync, mkdtempSync, openSync, readdirSync, rmSync, statSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Browser, Page } from "@playwright/test";
import { EDITION } from "../env";
import { addMember, expect, test } from "../support";
import { firstRun, startLocalServer, type LocalServer, type Owner } from "./server";

// Phase 21: the database is damaged while FITRON is closed (a failing disk, a power cut the disk did not survive). The
// next start finds it, opens the window on Recovery instead of the books, and a Super Admin restores the latest
// backup; the damaged files are kept, and FITRON carries on with the backup's records.
test.describe.configure({ mode: "serial" });
test.skip(EDITION !== "local", "Local Edition only (npm run e2e:local)");

const PORT = 3304;
const owner: Owner = { gym: "Phoenix Fitness", name: "Ravi Iyer", email: "owner@phoenix.in", password: "a-long-password-1" };
let dataDir: string;
let server: LocalServer;
let page: Page;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), "fitron-recovery-e2e-"));
  server = await startLocalServer(dataDir, PORT, { FITRON_LOCAL_SCHEDULER: "off" });
  const ctx = await browser.newContext({ baseURL: server.url, locale: "en-IN", timezoneId: "Asia/Kolkata" });
  await ctx.addInitScript((k) => localStorage.setItem(k, "1"), `fitron-tour-done-${owner.email}`);
  page = await ctx.newPage();
  await firstRun(page, owner);
});
test.afterAll(async () => {
  await server?.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

test("a damaged database opens on Recovery, and a backup brings the books back", async () => {
  await addMember(page, "Kept Member");
  await page.goto("/settings/backup");
  await page.getByRole("button", { name: "Back up now" }).click();
  await expect(page.getByText(/Backup saved as FITRON-Backup-/)).toBeVisible();
  // Entered after the backup: the backup does not have it.
  await addMember(page, "After Backup Member");

  // FITRON closes; a run of sectors in the middle of the database goes bad.
  await server.stop();
  const db = path.join(dataDir, "data", "fitron.db");
  const page4k = 4096;
  const pages = Math.floor(statSync(db).size / page4k);
  const fd = openSync(db, "r+");
  for (let p = Math.floor(pages / 2); p < Math.floor(pages / 2) + 4; p++) writeSync(fd, Buffer.alloc(page4k, 0), 0, page4k, p * page4k);
  closeSync(fd);

  // The next start: the health check lets the window open, and every page is Recovery.
  server = await startLocalServer(dataDir, PORT, { FITRON_LOCAL_SCHEDULER: "off" });
  expect(await (await fetch(`${server.url}/api/health`)).json()).toMatchObject({ ok: true, recovery: true });
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/recovery$/);
  await expect(page.getByRole("heading", { name: "FITRON's database is damaged" })).toBeVisible();
  expect((await fetch(`${server.url}/api/local/sync/status`)).status).toBe(503);

  // Only a Super Admin of the backup can restore it.
  await page.getByLabel("Email of a Super Admin in that backup").fill(owner.email);
  await page.getByLabel("Their password (as it was in the backup)").fill("not-the-password-1");
  await page.getByRole("button", { name: "Restore this backup" }).click();
  await expect(page.getByText(/Only a Super Admin of the gym in this backup/)).toBeVisible();
  await page.getByLabel("Their password (as it was in the backup)").fill(owner.password);
  await page.getByRole("button", { name: "Restore this backup" }).click();
  await expect(page.getByTestId("recovered")).toContainText("Anything entered after that is not in it");

  // FITRON carries on with the backup's records, without a restart; the damaged files are kept beside the database.
  expect(await (await fetch(`${server.url}/api/health`)).json()).toMatchObject({ ok: true });
  await page.getByRole("link", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
  await page.goto("/members");
  await expect(page.getByText("Kept Member").first()).toBeVisible();
  await expect(page.getByText("After Backup Member")).toHaveCount(0);
  expect(readdirSync(path.join(dataDir, "data")).filter((n) => n.startsWith("damaged-"))).toHaveLength(1);
  // And a new member saves as usual.
  await addMember(page, "New After Recovery");
  await page.goto("/members");
  await expect(page.getByText("New After Recovery").first()).toBeVisible();
});
