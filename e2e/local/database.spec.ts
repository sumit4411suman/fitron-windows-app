import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { Browser, Page } from "@playwright/test";
import { EDITION } from "../env";
import { addMember, createPlan, expect, sell, test } from "../support";
import { firstRun, startLocalServer, type LocalServer, type Owner } from "./server";

// Phase 22: the database FITRON for Windows makes on a new computer. Created in the data folder (never beside the
// program), in WAL mode, with every migration of this version recorded, whole by SQLite's own check; money records and
// the audit log refused to anyone who tries to delete or rewrite them behind FITRON's back; and still there after a restart.
test.describe.configure({ mode: "serial" });
test.skip(EDITION !== "local", "Local Edition only (npm run e2e:local)");

const PORT = 3309;
const owner: Owner = { gym: "Database Gym", name: "Kavya Menon", email: "owner@database.in", password: "a-long-password-1" };
let dataDir: string;
let server: LocalServer;
let page: Page;

const file = () => path.join(dataDir, "data", "fitron.db");
const open = (readonly = true) => new Database(file(), { readonly });

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), "fitron-database-e2e-"));
  server = await startLocalServer(dataDir, PORT, { FITRON_LOCAL_SCHEDULER: "off" });
  const ctx = await browser.newContext({ baseURL: server.url, locale: "en-IN", timezoneId: "Asia/Kolkata" });
  await ctx.addInitScript((k) => localStorage.setItem(k, "1"), `fitron-tour-done-${owner.email}`);
  page = await ctx.newPage();
});
test.afterAll(async () => {
  await server?.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

test("a new computer's database: in the data folder, WAL, every migration recorded, whole", async () => {
  expect(existsSync(file())).toBe(true);
  // Nothing database-like beside the program.
  expect(readdirSync(process.cwd()).filter((n) => /\.(db|sqlite)(-wal|-shm)?$/.test(n))).toEqual([]);
  const db = open();
  try {
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    const recorded = (db.prepare(`SELECT name FROM "_fitron_migrations" ORDER BY name`).all() as { name: string }[]).map((r) => r.name);
    const shipped = readdirSync(path.join(process.cwd(), "prisma", "local-migrations")).filter((n) => existsSync(path.join(process.cwd(), "prisma", "local-migrations", n, "migration.sql"))).sort();
    expect(recorded).toEqual(shipped);
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(db.pragma("foreign_key_check")).toEqual([]);
  } finally {
    db.close();
  }
});

test("money records and the audit log cannot be deleted or rewritten from outside FITRON", async () => {
  await firstRun(page, owner);
  await createPlan(page, { name: "Monthly", months: 1, price: 1000 });
  const invoiceId = await sell(page, await addMember(page, "Guarded Member"), { payNow: 400 });
  const db = open(false);
  try {
    const pay = db.prepare(`SELECT id FROM "Payment" WHERE "invoiceId" = ?`).get(invoiceId) as { id: string };
    for (const [what, sql, args] of [
      ["a payment", `DELETE FROM "Payment" WHERE id = ?`, [pay.id]],
      ["an invoice", `DELETE FROM "Invoice" WHERE id = ?`, [invoiceId]],
      ["the audit log", `DELETE FROM "AuditLog"`, []],
      ["an audit entry", `UPDATE "AuditLog" SET action = 'nothing.happened'`, []],
    ] as const)
      expect(() => db.prepare(sql).run(...args), what).toThrow(/not allowed|append-only|cannot/i);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM "Payment" WHERE id = ?`).get(pay.id)).toEqual({ n: 1 });
  } finally {
    db.close();
  }
});

const counts = () => {
  const db = open();
  try {
    return db.prepare(`SELECT (SELECT COUNT(*) FROM "Member") m, (SELECT COUNT(*) FROM "Payment") p, (SELECT COUNT(*) FROM "AuditLog") a`).get();
  } finally {
    db.close();
  }
};

test("after a restart the database opens as it was, and passes its check", async () => {
  const before = counts();
  await server.stop();
  server = await startLocalServer(dataDir, PORT, { FITRON_LOCAL_SCHEDULER: "off" });
  expect(await (await fetch(`${server.url}/api/health`)).json()).toMatchObject({ ok: true });
  expect(counts()).toEqual(before);
  expect(existsSync(path.join(dataDir, "data", "DAMAGED.json"))).toBe(false);
});
