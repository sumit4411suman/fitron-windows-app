import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { Browser, BrowserContext } from "@playwright/test";
import { EDITION } from "../env";
import { addMember, createPlan, expect, sell, test } from "../support";
import { addExpense } from "./helpers";
import { firstRun, localSignIn, startLocalServer, type LocalServer, type Owner } from "./server";

// Phase 22 / 21 (laptop replacement): a gym's whole books move to a new computer through a password-protected backup.
// The old computer backs up; the new one is installed fresh (first-run setup, any name), restores the file, and holds
// exactly the same records: members, the sale, its payments to the paisa, the expense, the document, the owner's login.
test.describe.configure({ mode: "serial" });
test.skip(EDITION !== "local", "Local Edition only (npm run e2e:local)");
test.setTimeout(180_000);

const owner: Owner = { gym: "Moving Gym", name: "Farah Ali", email: "owner@moving.in", password: "a-long-password-1" };
const root = mkdtempSync(path.join(os.tmpdir(), "fitron-restore-e2e-"));
let oldPc: LocalServer;
let newPc: LocalServer;
let backupFile = "";
let invoiceId = "";

const books = (dir: string) => {
  const db = new Database(path.join(dir, "data", "fitron.db"), { readonly: true });
  try {
    return db
      .prepare(`SELECT (SELECT GROUP_CONCAT(name, ',') FROM (SELECT name FROM "Member" ORDER BY name)) members, (SELECT COUNT(*) FROM "Invoice") invoices, (SELECT SUM(amount) FROM "Payment" WHERE status = 'SUCCESS') paid, (SELECT SUM(amount) FROM "Expense") spent, (SELECT COUNT(*) FROM "MemberDocument") documents`)
      .get();
  } finally {
    db.close();
  }
};

const browserFor = async (browser: Browser, url: string): Promise<BrowserContext> => {
  const ctx = await browser.newContext({ baseURL: url, locale: "en-IN", timezoneId: "Asia/Kolkata", acceptDownloads: true });
  await ctx.addInitScript((k) => localStorage.setItem(k, "1"), `fitron-tour-done-${owner.email}`);
  return ctx;
};

test.afterAll(async () => {
  await oldPc?.stop();
  await newPc?.stop();
  rmSync(root, { recursive: true, force: true });
});

test("the old computer's books and a password-protected backup of them", async ({ browser }) => {
  oldPc = await startLocalServer(path.join(root, "old"), 3307, { FITRON_LOCAL_SCHEDULER: "off" });
  const page = await (await browserFor(browser, oldPc.url)).newPage();
  await firstRun(page, owner);
  await createPlan(page, { name: "Quarterly", months: 3, price: 3999.5 });
  const memberId = await addMember(page, "Meera Nair");
  await addMember(page, "Arjun Rao");
  invoiceId = await sell(page, memberId, { payNow: 1000.25 });
  await page.goto(`/invoices/${invoiceId}`);
  await page.getByLabel("Amount (₹)").fill("500.75");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect.poll(() => (books(path.join(root, "old")) as { paid: number }).paid).toBe(150100);
  await addExpense(page, { description: "Treadmill belt", amount: 2350.4 });
  await page.goto(`/members/${memberId}?tab=documents`);
  const form = page.locator("#upload");
  await form.getByLabel("Title").fill("Aadhaar card");
  await form.getByLabel("File", { exact: true }).setInputFiles({ name: "aadhaar.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n% Meera's Aadhaar\n") });
  await form.getByRole("button", { name: "Upload document" }).click();
  await expect(page.getByText("Aadhaar card").first()).toBeVisible();

  await page.goto("/settings/backup");
  await page.getByLabel("Backup password (optional)").fill("moving-pass-1");
  await page.getByLabel("Password again").fill("moving-pass-1");
  await page.getByRole("button", { name: "Back up now" }).click();
  await expect(page.getByText(/Backup saved as FITRON-Backup-/)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("region", { name: "Backup history" }).locator("tbody tr").first().getByRole("link", { name: "Download" }).click();
  backupFile = path.join(root, "pen-drive.fitronbackup");
  await (await download).saveAs(backupFile);
});

test("a new computer: installed fresh, restored from the file, and holding exactly the same books", async ({ browser }) => {
  newPc = await startLocalServer(path.join(root, "new"), 3308, { FITRON_LOCAL_SCHEDULER: "off" });
  const page = await (await browserFor(browser, newPc.url)).newPage();
  await firstRun(page, { gym: "Temporary Name", name: "Setup", email: "setup@new-pc.in", password: "a-long-password-2" });
  await page.goto("/settings/backup?restore=file");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Backup file").setInputFiles(backupFile);
  await dialog.getByLabel("Backup password (if it has one)").fill("moving-pass-1");
  await dialog.getByLabel("Type RESTORE to confirm").fill("RESTORE");
  await dialog.getByRole("button", { name: "Restore" }).click();
  await page.waitForURL(/\/login\?restored=/);

  expect(books(path.join(root, "new"))).toEqual(books(path.join(root, "old")));
  expect(books(path.join(root, "new"))).toMatchObject({ members: "Arjun Rao,Meera Nair", invoices: 1, paid: 150100, spent: 235040, documents: 1 });
  // The old owner signs in on the new computer with their own password; the temporary login is gone.
  await localSignIn(page, owner);
  await page.goto(`/invoices/${invoiceId}`);
  await expect(page.getByText("Amount paid", { exact: true }).locator("xpath=following-sibling::*[1]")).toHaveText("₹1,501");
  // The document's file came across too, and opens.
  await page.goto("/members");
  const memberPage = await page.getByRole("link", { name: "Meera Nair" }).first().getAttribute("href");
  await page.goto(`${memberPage}?tab=documents`);
  const href = await page.locator('a[href^="/documents/"]').first().getAttribute("href");
  const body = await page.evaluate(async (u) => new TextDecoder().decode(await (await fetch(u)).arrayBuffer()), href!);
  expect(body).toBe("%PDF-1.7\n% Meera's Aadhaar\n");
});
