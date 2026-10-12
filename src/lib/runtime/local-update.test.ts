import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { makeGym, pick } from "@/test/db";
import { collectPayment, sellMembership } from "@/lib/services/billing";
import { createExpense } from "@/lib/services/expenses";
import { createMember } from "@/lib/services/members";
import { createPlan } from "@/lib/services/plans";
import { todayIso } from "@/lib/services/time";
import { listLocalBackups } from "./fitron-backup";
import { listMigrations } from "./local-migrate";
import { startLocalEdition } from "./local-start";
import { dataDirs } from "./paths";

// Phase 15: an update replaces the program, never the gym's data. The first start of the new version backs the
// database up before it changes it, and changes nothing if that backup cannot be made.

let root: string;
let migrations: string;
/** The migrations every FITRON ships with today; the tests add their own after them. */
const BASE = listMigrations(path.join(process.cwd(), "prisma", "local-migrations")).map((m) => m.name);
const dirs = () => dataDirs(root);
const applied = () => {
  const db = new Database(dirs().database, { readonly: true });
  try {
    return (db.prepare(`SELECT "name" FROM "_fitron_migrations" ORDER BY "name"`).all() as { name: string }[]).map((r) => r.name);
  } finally {
    db.close();
  }
};
const safety = async () => (await listLocalBackups(dirs())).filter((b) => b.kind === "safety");

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "fitron-update-"));
  migrations = path.join(root, "..", `${path.basename(root)}-migrations`);
  cpSync(path.join(process.cwd(), "prisma", "local-migrations"), migrations, { recursive: true });
  vi.stubEnv("FITRON_DATA_DIR", root);
  vi.stubEnv("FITRON_MIGRATIONS_DIR", migrations);
  vi.stubEnv("FITRON_LOCAL_SCHEDULER", "off");
  vi.stubEnv("FITRON_SHELL", "");
  vi.stubEnv("DATABASE_URL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
  rmSync(migrations, { recursive: true, force: true });
});

/** A new version of FITRON with one more migration. */
function nextVersion(name = "9999_update_test") {
  mkdirSync(path.join(migrations, name));
  writeFileSync(path.join(migrations, name, "migration.sql"), `CREATE TABLE "_update_test" ("id" INTEGER PRIMARY KEY);\n`);
  return name;
}

describe("starting FITRON after an update", () => {
  it("makes no safety backup on a first start, or a start with nothing to update", async () => {
    const first = await startLocalEdition();
    expect(first).toMatchObject({ ready: true, applied: BASE });
    expect(first.safetyBackup).toBeUndefined();
    const again = await startLocalEdition();
    expect(again).toMatchObject({ ready: true, applied: [] });
    expect(await safety()).toHaveLength(0);
  });

  it("backs the database up before an update changes it", async () => {
    await startLocalEdition();
    const name = nextVersion();
    const s = await startLocalEdition();
    expect(s.ready).toBe(true);
    expect(s.applied).toEqual([name]);
    const [b] = await safety();
    expect(b.name).toBe(s.safetyBackup);
    // The backup holds the database as it was before the update.
    expect(b.manifest?.migrations).toEqual(BASE);
    expect(b.manifest?.note).toContain(name);
    expect(applied()).toEqual([...BASE, name]);
  });

  it("changes nothing when the safety backup cannot be made", async () => {
    await startLocalEdition();
    nextVersion();
    // Something in the way of the safety backups' folder.
    writeFileSync(path.join(dirs().backups, "safety"), "not a folder");
    const s = await startLocalEdition();
    expect(s.ready).toBe(false);
    expect(s.error).toBeTruthy();
    expect(applied()).toEqual(BASE);
    expect(readdirSync(dirs().backups)).toEqual(["safety"]);
  });
});

// Phase 18: the same, on a database full of a gym's work, through two updates, the second of which fails.
// Runs on the Local Edition's SQLite file (npm run test:local), where the gym's books can be copied into a data folder.
const TEST_DB = (process.env.DATABASE_URL ?? "").replace(/^file:/, "");
const local = process.env.FITRON_EDITION === "local" && !!TEST_DB;

describe.skipIf(!local)("updating FITRON with a gym's data in it", () => {
  const counts = () => {
    const c = new Database(dirs().database, { readonly: true });
    try {
      const n = (t: string) => (c.prepare(`SELECT count(*) AS n FROM "${t}"`).get() as { n: number }).n;
      const sum = (c.prepare(`SELECT coalesce(sum(amount), 0) AS s FROM "Payment" WHERE status = 'SUCCESS'`).get() as { s: number }).s;
      const integrity = (c.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
      const tables = (c.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '\\_v%' ESCAPE '\\'`).all() as { name: string }[]).map((t) => t.name);
      return { members: n("Member"), memberships: n("Membership"), invoices: n("Invoice"), payments: n("Payment"), expenses: n("Expense"), collected: sum, integrity, tables };
    } finally {
      c.close();
    }
  };

  it("keeps every record through an update, and puts them back when an update fails", async () => {
    // 1.0.0, in use: a gym with members, sales, payments and expenses, made through FITRON's own services (on the test
    // database the services are bound to; the stubs above only move where FITRON starts).
    const gym = await makeGym();
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const today = todayIso();
    const planId = (await createPlan(admin, { name: "Quarterly", kind: "Membership", months: 3, price: 450000, regFee: 50000, discount: 0, gstApplicable: true, features: [] })).id;
    for (let i = 0; i < 12; i++) {
      const m = await createMember(admin, { name: `Member ${i}`, gender: i % 2 ? "Female" : "Male", phone: `98117${String(10000 + i).slice(-5)}`, source: "Walk-in", tags: [] });
      const { invoice } = await sellMembership(admin, m.id, { planId, startDate: today, discount: 0, includeRegFee: true, payAmount: 200000, payMethod: "UPI" });
      if (i % 3 === 0) await collectPayment(admin, invoice.id, { amount: 100000, method: "Cash", date: today });
    }
    const category = await db.expenseCategory.findFirst();
    for (let i = 0; i < 5; i++) await createExpense(admin, { date: today, categoryId: category!.id, description: `Expense ${i}`, amount: 1250.5 + i, method: "Cash" });
    // Their database becomes this computer's FITRON data.
    const src = new Database(TEST_DB);
    src.pragma("wal_checkpoint(TRUNCATE)");
    src.close();
    mkdirSync(dirs().data, { recursive: true });
    cpSync(TEST_DB, dirs().database);
    const first = await startLocalEdition();
    expect(first).toMatchObject({ ready: true, applied: [] });
    const before = counts();
    expect(before.members).toBeGreaterThanOrEqual(12);
    expect(before.payments).toBeGreaterThanOrEqual(16);
    expect(before.expenses).toBeGreaterThanOrEqual(5);
    expect(before.integrity).toBe("ok");

    // 1.1.0: a new column and a new table. A safety backup first, then every record as it was.
    mkdirSync(path.join(migrations, "9001_v1_1_0"));
    writeFileSync(path.join(migrations, "9001_v1_1_0", "migration.sql"), `ALTER TABLE "Member" ADD COLUMN "nickname" TEXT;\nCREATE TABLE "_v1_1_0" ("id" INTEGER PRIMARY KEY);\n`);
    const second = await startLocalEdition();
    expect(second).toMatchObject({ ready: true, applied: ["9001_v1_1_0"] });
    expect(second.safetyBackup).toBeTruthy();
    const after110 = counts();
    expect(after110).toEqual({ ...before, tables: ["_v1_1_0"] });
    expect(applied()).toEqual([...BASE, "9001_v1_1_0"]);
    const [backup110] = await safety();
    expect(backup110.manifest?.migrations).toEqual(BASE);

    // 1.2.0: a migration that fails half-way. Nothing of it stays, the database is put back from the safety backup,
    // and FITRON does not serve until the previous version is installed again.
    mkdirSync(path.join(migrations, "9002_v1_2_0"));
    writeFileSync(path.join(migrations, "9002_v1_2_0", "migration.sql"), `CREATE TABLE "_v1_2_0" ("id" INTEGER PRIMARY KEY);\nINSERT INTO "_no_such_table" ("id") VALUES (1);\n`);
    const third = await startLocalEdition();
    expect(third.ready).toBe(false);
    expect(third.rolledBack).toBe(true);
    expect(third.error).toMatch(/could not update its database/);
    expect(third.error).toMatch(/put back as it was before/);
    expect(third.error).toContain(third.safetyBackup);
    expect(counts()).toEqual(after110);
    expect(applied()).toEqual([...BASE, "9001_v1_1_0"]);
    expect((await safety()).map((b) => b.manifest?.migrations)).toEqual([BASE, [...BASE, "9001_v1_1_0"]].reverse());

    // 1.2.1 fixes the migration: it applies, on the data put back.
    writeFileSync(path.join(migrations, "9002_v1_2_0", "migration.sql"), `CREATE TABLE "_v1_2_0" ("id" INTEGER PRIMARY KEY);\n`);
    const fourth = await startLocalEdition();
    expect(fourth).toMatchObject({ ready: true, applied: ["9002_v1_2_0"] });
    expect(counts()).toEqual({ ...after110, tables: ["_v1_1_0", "_v1_2_0"] });
  }, 120_000);
});
