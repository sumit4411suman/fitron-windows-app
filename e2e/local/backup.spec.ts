import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Browser, Page } from "@playwright/test";
import { EDITION } from "../env";
import { addMember, expect, test } from "../support";
import { firstRun, localSignIn, startLocalServer, type LocalServer, type Owner } from "./server";

// Phase 10 / Phase 22 (backup, restore): Settings › Backup on FITRON for Windows, on a server of its own (a restore
// replaces everything on the computer). Back up with and without a password, download, keep working, restore from
// the list and from a file, and check that what came back is exactly what was saved.
test.describe.configure({ mode: "serial" });
test.skip(EDITION !== "local", "Local Edition only (npm run e2e:local)");

const PORT = 3302;
const owner: Owner = { gym: "Iron Temple Gym", name: "Meena Rao", email: "owner@irontemple.in", password: "a-long-password-1" };
let dataDir: string;
let server: LocalServer;
let page: Page;
let encryptedFile = "";

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), "fitron-backup-e2e-"));
  server = await startLocalServer(dataDir, PORT, { FITRON_LOCAL_SCHEDULER: "off" });
  const ctx = await browser.newContext({ baseURL: server.url, locale: "en-IN", timezoneId: "Asia/Kolkata", acceptDownloads: true });
  await ctx.addInitScript((k) => localStorage.setItem(k, "1"), `fitron-tour-done-${owner.email}`);
  page = await ctx.newPage();
  await firstRun(page, owner);
});
test.afterAll(async () => {
  await server?.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

const memberNames = async () => {
  await page.goto("/members");
  return page.locator("main").innerText();
};

test("backs up with a password and without, lists both, and downloads the file", async () => {
  await addMember(page, "Asha Verma");
  await page.goto("/settings/backup");
  await expect(page.getByText("No backups yet.")).toBeVisible();

  await page.getByLabel("Backup password (optional)").fill("backup-pass-1");
  await page.getByLabel("Password again").fill("backup-pass-1");
  await page.getByRole("button", { name: "Back up now" }).click();
  await expect(page.getByText(/Backup saved as FITRON-Backup-\d{4}-\d{2}-\d{2}\.fitronbackup/)).toBeVisible();
  await page.getByRole("button", { name: "Back up now" }).click();
  await expect(page.getByText(/Backup saved as FITRON-Backup-\d{4}-\d{2}-\d{2}-2\.fitronbackup/)).toBeVisible();

  const rows = page.getByRole("region", { name: "Backup history" }).locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "Password" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "Iron Temple Gym · 1 members" })).toHaveCount(1);
  expect(existsSync(path.join(dataDir, "backups", "manual"))).toBe(true);

  const download = page.waitForEvent("download");
  await rows.filter({ hasText: "Password" }).getByRole("link", { name: "Download" }).click();
  const d = await download;
  encryptedFile = path.join(dataDir, "..", `${path.basename(dataDir)}-${d.suggestedFilename()}`);
  await d.saveAs(encryptedFile);
  expect(readFileSync(encryptedFile).subarray(0, 11).toString()).toBe("FITRONENC1\n");
});

test("restores a backup from the list: later work is undone, a safety backup is kept, everyone signs in again", async () => {
  await addMember(page, "Ravi Kumar");
  expect(await memberNames()).toContain("Ravi Kumar");

  await page.goto("/settings/backup");
  const plain = page.getByRole("region", { name: "Backup history" }).locator("tbody tr").filter({ hasText: "1 members" });
  await plain.getByRole("link", { name: "Restore" }).click();
  await page.getByLabel("Type RESTORE to confirm").fill("restore");
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByText("Type RESTORE to confirm. Everything on this computer will be replaced by the backup.")).toBeVisible();
  await page.getByLabel("Type RESTORE to confirm").fill("RESTORE");
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page.waitForURL(/\/login\?restored=/);
  await expect(page.getByText("Backup restored. Everyone was signed out; sign in again to continue.")).toBeVisible();

  await localSignIn(page, owner);
  const names = await memberNames();
  expect(names).toContain("Asha Verma");
  expect(names).not.toContain("Ravi Kumar");
  await page.goto("/settings/backup");
  await expect(page.getByRole("region", { name: "Backup history" }).locator("tbody tr").filter({ hasText: "Before restore" })).toHaveCount(1);
  await page.goto("/audit");
  await expect(page.locator("main")).toContainText(/backup\.local\.restore|restore/i);
});

test("restores a downloaded file with its password, refuses a wrong password and a file that is not a backup", async () => {
  await addMember(page, "Kiran Shah");
  await page.goto("/settings/backup?restore=file");
  const dialog = page.getByRole("dialog");
  const junk = path.join(dataDir, "..", `${path.basename(dataDir)}-notes.fitronbackup`);
  writeFileSync(junk, "just some notes");
  await dialog.getByLabel("Backup file").setInputFiles(junk);
  await dialog.getByLabel("Type RESTORE to confirm").fill("RESTORE");
  await dialog.getByRole("button", { name: "Restore" }).click();
  await expect(dialog.getByText("This is not a FITRON backup file.")).toBeVisible();

  await dialog.getByLabel("Backup file").setInputFiles(encryptedFile);
  await dialog.getByLabel("Backup password (if it has one)").fill("not-the-password");
  await dialog.getByRole("button", { name: "Restore" }).click();
  await expect(dialog.getByText("The password is wrong, or the backup file is damaged.")).toBeVisible();
  expect(await memberNames(), "nothing changed").toContain("Kiran Shah");

  await page.goto("/settings/backup?restore=file");
  await dialog.getByLabel("Backup file").setInputFiles(encryptedFile);
  await dialog.getByLabel("Backup password (if it has one)").fill("backup-pass-1");
  await dialog.getByLabel("Type RESTORE to confirm").fill("RESTORE");
  await dialog.getByRole("button", { name: "Restore" }).click();
  await page.waitForURL(/\/login\?restored=/);
  await localSignIn(page, owner);
  const names = await memberNames();
  expect(names).toContain("Asha Verma");
  expect(names).not.toContain("Kiran Shah");
  rmSync(junk, { force: true });
  rmSync(encryptedFile, { force: true });
});

test("after a restart FITRON opens on the restored data", async () => {
  await server.stop();
  server = await startLocalServer(dataDir, PORT, { FITRON_LOCAL_SCHEDULER: "off" });
  await localSignIn(page, owner);
  expect(await memberNames()).toContain("Asha Verma");
});
