import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { Browser, Page } from "@playwright/test";
import { EDITION } from "../env";
import { addMember, createPlan, expect, sell, test } from "../support";
import { firstRun, localSignIn, startLocalServer, type LocalServer, type Owner } from "./server";

// Phase 22: an update on FITRON for Windows, on the production server. The installed version is this build with its
// migrations; the "next version" is the same build with one more migration (FITRON_MIGRATIONS_DIR, as the desktop
// program sets it). Updating keeps every record and makes a safety backup first; an update whose migration fails puts
// the database back as it was and says so; the gym carries on with the version that works.
test.describe.configure({ mode: "serial" });
test.skip(EDITION !== "local", "Local Edition only (npm run e2e:local)");
test.setTimeout(180_000);

const PORT = 3306;
const owner: Owner = { gym: "Upgrade Gym", name: "Sunita Jain", email: "owner@upgrade.in", password: "a-long-password-1" };
let root: string;
let dataDir: string;
let current: string;
let next: string;
let broken: string;
let server: LocalServer;
let page: Page;
let invoiceId = "";

const start = (migrations: string) => startLocalServer(dataDir, PORT, { FITRON_LOCAL_SCHEDULER: "off", FITRON_MIGRATIONS_DIR: migrations });
const health = async () => (await fetch(`${server.url}/api/health`)).json();
function read<T>(sql: string): T[] {
  const db = new Database(path.join(dataDir, "data", "fitron.db"), { readonly: true });
  try {
    return db.prepare(sql).all() as T[];
  } finally {
    db.close();
  }
}
const counts = () => read<{ m: number; i: number; p: number; paid: number }>(`SELECT (SELECT COUNT(*) FROM "Member") m, (SELECT COUNT(*) FROM "Invoice") i, (SELECT COUNT(*) FROM "Payment") p, (SELECT COALESCE(SUM(amount), 0) FROM "Payment") paid`)[0]!;
const safetyBackups = () => (existsSync(path.join(dataDir, "backups", "safety")) ? readdirSync(path.join(dataDir, "backups", "safety")) : []);

/** The migrations of this build, plus one more. */
function withExtra(name: string, sql: string) {
  const dir = path.join(root, name);
  cpSync(current, dir, { recursive: true });
  mkdirSync(path.join(dir, name));
  writeFileSync(path.join(dir, name, "migration.sql"), sql);
  return dir;
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  root = mkdtempSync(path.join(os.tmpdir(), "fitron-update-e2e-"));
  dataDir = path.join(root, "data-folder");
  current = path.join(root, "current");
  cpSync(path.join(process.cwd(), "prisma", "local-migrations"), current, { recursive: true });
  next = withExtra("9990_next_version", `CREATE TABLE "_e2e_next_version" ("id" INTEGER PRIMARY KEY, "note" TEXT NOT NULL DEFAULT 'added by the update');\nINSERT INTO "_e2e_next_version" ("id") VALUES (1);\n`);
  // Valid at first, then fails half-way: the first statement must not survive.
  broken = withExtra("9991_broken_version", `CREATE TABLE "_e2e_half_done" ("id" INTEGER);\nINSERT INTO "no_such_table" VALUES (1);\n`);
  server = await start(current);
  const ctx = await browser.newContext({ baseURL: server.url, locale: "en-IN", timezoneId: "Asia/Kolkata" });
  await ctx.addInitScript((k) => localStorage.setItem(k, "1"), `fitron-tour-done-${owner.email}`);
  page = await ctx.newPage();
  await firstRun(page, owner);
  await createPlan(page, { name: "Monthly", months: 1, price: 1200 });
  invoiceId = await sell(page, await addMember(page, "Before The Update"), { payNow: 700 });
});
test.afterAll(async () => {
  await server?.stop();
  rmSync(root, { recursive: true, force: true });
});

test("an update applies its migration after a safety backup and keeps every record", async () => {
  const before = counts();
  expect(safetyBackups()).toEqual([]);
  await server.stop();
  server = await start(next);
  expect(await health()).toMatchObject({ ok: true });
  expect(read<{ note: string }>(`SELECT note FROM "_e2e_next_version"`)).toEqual([{ note: "added by the update" }]);
  expect(read<{ name: string }>(`SELECT name FROM "_fitron_migrations" WHERE name = '9990_next_version'`)).toHaveLength(1);
  expect(counts()).toEqual(before);
  expect(safetyBackups()).toHaveLength(1);
  // The gym carries on: signed in again, the sale is there, and a payment saves.
  await localSignIn(page, owner);
  await page.goto(`/invoices/${invoiceId}`);
  await page.getByLabel("Amount (₹)").fill("500");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect.poll(() => counts().p).toBe(before.p + 1);
});

test("an update whose migration fails puts the database back as it was, says why, and the working version opens it", async () => {
  const before = counts();
  await server.stop();
  // The failed start stays up to report why; the desktop program shows its words.
  server = await startLocalServer(dataDir, PORT, { FITRON_LOCAL_SCHEDULER: "off", FITRON_MIGRATIONS_DIR: broken }, { acceptFailure: true });
  const h = await health();
  expect(h).toMatchObject({ ok: false, error: "Database migration failed" });
  expect(h.detail).toMatch(/put back as it was before, from the safety backup/);
  await server.stop();
  expect(read(`SELECT name FROM sqlite_master WHERE name = '_e2e_half_done'`)).toEqual([]);
  expect(read(`SELECT name FROM "_fitron_migrations" WHERE name = '9991_broken_version'`)).toEqual([]);
  expect(counts()).toEqual(before);
  server = await start(next);
  expect(await health()).toMatchObject({ ok: true });
  expect(counts()).toEqual(before);
});
