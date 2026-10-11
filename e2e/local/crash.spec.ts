import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { EDITION } from "../env";
import { addMember, createPlan, expect, sell, test } from "../support";
import { firstRun, startLocalServer, type LocalServer, type Owner } from "./server";

// Phase 21: FITRON loses power in the middle of taking payments and making invoices. The server is killed (SIGKILL,
// nothing written on the way out) while several desks are saving at once. After the restart the database is whole,
// and every record is all there or not there at all: each payment and invoice with its audit entry, each invoice with
// its items and membership, numbers without gaps or repeats, and no invoice paid past its total.
test.describe.configure({ mode: "serial" });
test.skip(EDITION !== "local", "Local Edition only (npm run e2e:local)");
test.setTimeout(240_000);

const PORT = 3305;
const owner: Owner = { gym: "Volt Gym", name: "Anil Das", email: "owner@volt.in", password: "a-long-password-1" };
let dataDir: string;
let server: LocalServer;
let ctx: BrowserContext;
let page: Page;

const dbFile = () => path.join(dataDir, "data", "fitron.db");
/** Reads the database as it is on disk after the crash: its own connection, as FITRON's next start would. */
function read<T>(sql: string, ...args: unknown[]): T[] {
  const db = new Database(dbFile(), { readonly: true });
  try {
    return db.prepare(sql).all(...args) as T[];
  } finally {
    db.close();
  }
}
const num = (code: string) => Number(code.replace(/\D/g, ""));
const consecutive = (ns: number[]) => ns.sort((a, b) => a - b).every((n, i) => i === 0 || n === ns[i - 1]! + 1);

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), "fitron-crash-e2e-"));
  server = await startLocalServer(dataDir, PORT, { FITRON_LOCAL_SCHEDULER: "off" });
  ctx = await browser.newContext({ baseURL: server.url, locale: "en-IN", timezoneId: "Asia/Kolkata" });
  await ctx.addInitScript((k) => localStorage.setItem(k, "1"), `fitron-tour-done-${owner.email}`);
  page = await ctx.newPage();
  await firstRun(page, owner);
  await createPlan(page, { name: "Monthly", months: 1, price: 1500 });
});
test.afterAll(async () => {
  await server?.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

let killed = false;

/** Desks saving over and over until the server dies under them. A desk's own hiccup (a page still loading) is retried. */
async function desks(n: number, work: (p: Page, desk: number) => Promise<void>) {
  killed = false;
  const pages = await Promise.all(Array.from({ length: n }, () => ctx.newPage()));
  const loops = pages.map(async (p, desk) => {
    for (let k = 0; k < 500 && !killed; k++) {
      try {
        await work(p, desk);
      } catch {
        if (killed) return;
      }
    }
  });
  return { pages, done: Promise.all(loops) };
}

async function powerCut() {
  killed = true;
  await server.kill();
}

async function restart() {
  server = await startLocalServer(dataDir, PORT, { FITRON_LOCAL_SCHEDULER: "off" });
  expect(await (await fetch(`${server.url}/api/health`)).json()).toMatchObject({ ok: true });
  expect((await fetch(`${server.url}/api/health`).then((r) => r.json())).recovery).toBeUndefined();
}

test("power lost while four desks take payments: every payment is whole or absent, none twice, none past the total", async () => {
  const memberId = await addMember(page, "Pays In Parts");
  const invoiceId = await sell(page, memberId, { payNow: 0 });
  const [{ total }] = read<{ total: number }>(`SELECT total FROM "Invoice" WHERE id = ?`, invoiceId);
  const { pages, done } = await desks(4, async (p) => {
    await p.goto(`/invoices/${invoiceId}`, { timeout: 15_000 });
    await p.getByLabel("Amount (₹)").fill("1", { timeout: 15_000 });
    await p.getByRole("button", { name: "Record payment" }).click({ timeout: 15_000 });
    await p.waitForURL(/receipt=/, { timeout: 15_000 });
  });
  await expect.poll(() => read(`SELECT 1 FROM "Payment" WHERE "invoiceId" = ?`, invoiceId).length, { timeout: 90_000 }).toBeGreaterThanOrEqual(6);
  await powerCut();
  await done;
  for (const p of pages) await p.close();

  expect(read<{ integrity_check: string }>("PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
  const pays = read<{ id: string; code: string; amount: number }>(`SELECT id, code, amount FROM "Payment" WHERE "invoiceId" = ?`, invoiceId);
  const audited = new Set(read<{ entityId: string }>(`SELECT "entityId" FROM "AuditLog" WHERE action = 'payment.create'`).map((a) => a.entityId));
  expect(pays.every((p) => audited.has(p.id)), "each payment has its audit entry").toBe(true);
  expect(new Set(pays.map((p) => p.code)).size).toBe(pays.length);
  expect(consecutive(read<{ code: string }>(`SELECT code FROM "Payment"`).map((p) => num(p.code))), "payment numbers without gaps").toBe(true);
  expect(pays.reduce((s, p) => s + p.amount, 0)).toBeLessThanOrEqual(total);

  // FITRON starts as usual, and shows exactly what is in the database.
  await restart();
  await page.goto(`/invoices/${invoiceId}`);
  if (page.url().includes("/login")) {
    await page.getByLabel("Email").fill(owner.email);
    await page.getByLabel("Password").fill(owner.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/dashboard|\/invoices/);
    await page.goto(`/invoices/${invoiceId}`);
  }
  const paid = page.getByText("Amount paid", { exact: true }).locator("xpath=following-sibling::*[1]");
  await expect(paid).toHaveText(`₹${pays.reduce((s, p) => s + p.amount, 0) / 100}`);
});

test("power lost while four desks make sales: every invoice is whole, with its items, membership and audit entry", async () => {
  const members: string[] = [];
  for (let i = 0; i < 4; i++) members.push(await addMember(page, `Buyer ${i}`));
  const before = read(`SELECT 1 FROM "Invoice"`).length;
  const { pages, done } = await desks(4, async (p, desk) => {
    await p.goto(`/members/${members[desk]}/sell`, { timeout: 15_000 });
    await p.getByLabel("Amount received now (₹)").fill("500", { timeout: 15_000 });
    await p.getByRole("button", { name: /^(Create membership|Renew and generate invoice)$/ }).click({ timeout: 15_000 });
    await p.waitForURL(/\/invoices\//, { timeout: 15_000 });
  });
  await expect.poll(() => read(`SELECT 1 FROM "Invoice"`).length - before, { timeout: 90_000 }).toBeGreaterThanOrEqual(6);
  await powerCut();
  await done;
  for (const p of pages) await p.close();

  expect(read<{ integrity_check: string }>("PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
  const invoices = read<{ id: string; number: string }>(`SELECT id, number FROM "Invoice"`);
  // A sale's audit entry is the membership's ("membership.create" or ".renew"), holding its invoice and payment.
  const auditedIn = (id: string) => read(`SELECT 1 FROM "AuditLog" WHERE "entityId" = ? OR "after" LIKE ?`, id, `%${id}%`).length > 0;
  for (const inv of invoices) {
    expect(auditedIn(inv.id), `${inv.number} is in the audit log`).toBe(true);
    expect(read(`SELECT 1 FROM "InvoiceItem" WHERE "invoiceId" = ?`, inv.id).length, `${inv.number} has its items`).toBeGreaterThan(0);
    const ships = read<{ id: string }>(`SELECT id FROM "Membership" WHERE "invoiceId" = ?`, inv.id);
    expect(ships, `${inv.number} has its membership`).toHaveLength(1);
    expect(read(`SELECT 1 FROM "AuditLog" WHERE "entityId" = ? AND action IN ('membership.create', 'membership.renew')`, ships[0]!.id), `${inv.number}'s sale is audited`).toHaveLength(1);
  }
  expect(consecutive(invoices.map((i) => num(i.number))), "invoice numbers without gaps").toBe(true);
  expect(read<{ id: string }>(`SELECT id FROM "Payment"`).every((p) => auditedIn(p.id)), "each payment is in the audit log").toBe(true);
  // The counter carries on after the last invoice that was saved.
  const [{ next }] = read<{ next: number }>(`SELECT next FROM "Sequence" WHERE name = 'invoice'`);
  expect(next).toBe(Math.max(...invoices.map((i) => num(i.number))) + 1);
  await restart();
});
