import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { EDITION } from "../env";
import { addMember, chargeGst, createPlan, expect, sell, test } from "../support";
import { addExpense, noErrorScreen } from "./helpers";
import { firstRun, localSignIn, startLocalServer, type LocalServer, type Owner } from "./server";

// Phase 24: the final offline acceptance test, the 25 steps of the brief in order, on a production server of its own.
// Steps 1–19 with the computer as it is; then FITRON is closed, the internet goes (the server cannot look up or reach
// anything but this computer, the browser cannot load anything from outside), FITRON starts again, and the gym carries
// on, restores its backup and finds every record. Installing on a clean Windows is `npm run desktop:installer-test` on
// the Windows runner (docs/local-windows/RELEASE.md); here the same server the installer ships is started directly.
test.describe.configure({ mode: "serial" });
test.skip(EDITION !== "local", "Local Edition only (npm run e2e:local)");
test.setTimeout(300_000);

const PORT = 3311;
const owner: Owner = { gym: "Acceptance Fitness", name: "Neha Kulkarni", email: "owner@acceptance.in", password: "a-long-password-1" };
const dataDir = mkdtempSync(path.join(os.tmpdir(), "fitron-acceptance-"));
const networkLog = path.join(dataDir, "network-attempts.jsonl");
let server: LocalServer;
let ctx: BrowserContext;
let page: Page;
const browserTried: string[] = [];

type Books = { members: string; invoices: number; paid: number; spent: number; audit: number };
function books(): Books {
  const db = new Database(path.join(dataDir, "data", "fitron.db"), { readonly: true });
  try {
    return db
      .prepare(
        `SELECT (SELECT GROUP_CONCAT(name, ',') FROM (SELECT name FROM "Member" WHERE "deletedAt" IS NULL ORDER BY name)) members, (SELECT COUNT(*) FROM "Invoice") invoices, (SELECT COALESCE(SUM(amount), 0) FROM "Payment" WHERE status = 'SUCCESS') paid, (SELECT COALESCE(SUM(amount), 0) FROM "Expense" WHERE status = 'ACTIVE') spent, (SELECT COUNT(*) FROM "AuditLog") audit`,
      )
      .get() as Books;
  } finally {
    db.close();
  }
}

/** A file from FITRON, fetched by the signed-in browser itself. */
const fetched = (url: string) =>
  page.evaluate(async (u) => {
    const r = await fetch(u);
    return { status: r.status, type: r.headers.get("content-type") ?? "", head: new TextDecoder().decode((await r.arrayBuffer()).slice(0, 5)) };
  }, url);

let invoiceId = "";
let saved: Books;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  // 1. Install FITRON: the server and data folder the installer sets up, started as the desktop program starts it.
  server = await startLocalServer(dataDir, PORT, { FITRON_LOCAL_SCHEDULER: "off" });
  ctx = await browser.newContext({ baseURL: server.url, locale: "en-IN", timezoneId: "Asia/Kolkata" });
  await ctx.addInitScript((k) => localStorage.setItem(k, "1"), `fitron-tour-done-${owner.email}`);
  page = await ctx.newPage();
});
test.afterAll(async () => {
  await server?.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

test("steps 1–19: a gym's first day, then FITRON is closed", async () => {
  // 2–4. Create the gym and its owner, signed in.
  await firstRun(page, owner);
  await expect(page).toHaveURL(/\/dashboard/);
  // The gym charges GST (18%, CGST and SGST).
  await chargeGst(page);
  // 5–6. A member and a membership plan.
  const memberId = await addMember(page, "Pooja Sharma");
  await createPlan(page, { name: "Half-yearly", months: 6, price: 7500 });
  // 7. Sell the membership (nothing paid yet).
  invoiceId = await sell(page, memberId, { payNow: 0 });
  // 8–9. A payment, then a part payment that leaves a balance.
  for (const amount of ["3000", "1500.50"]) {
    await page.goto(`/invoices/${invoiceId}`);
    await page.getByLabel("Amount (₹)").fill(amount);
    await page.getByRole("button", { name: "Record payment" }).click();
    await page.waitForURL(/receipt=/);
  }
  expect(books().paid).toBe(450050);
  await expect(page.getByText("PART PAID", { exact: true }).first()).toBeVisible();
  // 10–11. The invoice, and printing it.
  await expect(page.getByRole("heading", { name: /^INV-\d+$/ })).toBeVisible();
  const print = await page.getByRole("link", { name: "Print invoice" }).getAttribute("href");
  expect(await fetched(print!)).toMatchObject({ status: 200, type: "application/pdf", head: "%PDF-" });
  // 12. An expense.
  await addExpense(page, { description: "Electricity bill", amount: 3200.75 });
  // 13–15. The ledgers, the profit and loss, GST.
  await page.goto("/accounting?tab=ledger");
  await noErrorScreen(page);
  await expect(page.getByRole("heading", { name: "Accounting" })).toBeVisible();
  await page.goto("/accounting");
  await expect(page.locator("main").getByText("₹7,500").first()).toBeVisible();
  await page.goto("/reports/gst-invoices");
  await expect(page.locator("main").getByText("Pooja Sharma").first()).toBeVisible();
  await expect(page.locator("main").getByText("₹8,850").first()).toBeVisible();
  // 16. Attendance.
  await page.goto("/attendance");
  await noErrorScreen(page);
  await expect(page.getByRole("heading", { name: "Attendance", level: 1 })).toBeVisible();
  // 17. Reports.
  for (const key of ["collections", "dues", "expenses", "members"]) {
    await page.goto(`/reports/${key}`);
    await noErrorScreen(page);
    await expect(page.locator("table").first(), key).toBeVisible();
  }
  // 18. A backup.
  await page.goto("/settings/backup");
  await page.getByRole("button", { name: "Back up now" }).click();
  await expect(page.getByText(/Backup saved as FITRON-Backup-/)).toBeVisible();
  saved = books();
  // 19. Close FITRON.
  await server.stop();
});

test("steps 20–25: no internet, FITRON starts again, the gym carries on, restores its backup and finds every record", async () => {
  // 20–21. The internet goes; FITRON starts again.
  server = await startLocalServer(dataDir, PORT, {
    FITRON_LOCAL_SCHEDULER: "off",
    NODE_OPTIONS: `--require ${path.join(process.cwd(), "e2e", "local", "offline-preload.cjs")}`,
    FITRON_OFFLINE_LOG: networkLog,
  });
  await ctx.route(
    (url) => !["127.0.0.1", "localhost"].includes(url.hostname),
    (route) => {
      browserTried.push(route.request().url());
      return route.abort("internetdisconnected");
    },
  );
  // 22. Sign in.
  await localSignIn(page, owner);
  await page.goto("/dashboard");
  await noErrorScreen(page);
  // 23. Carry on working: a new member with a paid sale, and an expense.
  const offlineMember = await addMember(page, "Offline Walk-in");
  await sell(page, offlineMember, { payNow: 7500 });
  await addExpense(page, { description: "Cleaning supplies", amount: 450 });
  const later = books();
  expect(later.members).toContain("Offline Walk-in");
  expect(later.paid).toBe(saved.paid + 750000);
  // 24. Restore the backup from step 18.
  await page.goto("/settings/backup");
  await page.getByRole("region", { name: "Backup history" }).locator("tbody tr").filter({ hasText: "Acceptance Fitness" }).first().getByRole("link", { name: "Restore" }).click();
  await page.getByLabel("Type RESTORE to confirm").fill("RESTORE");
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page.waitForURL(/\/login\?restored=/);
  // 25. Every record of the backup, to the paisa; the work after it undone, as a restore does.
  await localSignIn(page, owner);
  const now = books();
  expect({ ...now, audit: undefined }).toEqual({ ...saved, audit: undefined });
  expect(now.audit).toBeGreaterThanOrEqual(saved.audit);
  await page.goto(`/invoices/${invoiceId}`);
  await expect(page.getByText("PART PAID", { exact: true }).first()).toBeVisible();
  await page.goto("/members");
  await expect(page.getByText("Pooja Sharma").first()).toBeVisible();
  await expect(page.getByText("Offline Walk-in")).toHaveCount(0);

  // All of it without the internet: nothing on the server or in the browser tried to go online.
  const serverTried = existsSync(networkLog) ? readFileSync(networkLog, "utf8").split("\n").filter(Boolean) : [];
  expect(serverTried, "the server's attempts to go online").toEqual([]);
  expect(browserTried, "the browser's attempts to go online").toEqual([]);
});
