import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { sellMembership } from "./billing";
import { allowDelete } from "./db-guard";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { todayIso } from "./time";

// The database refuses to delete a financial record (prisma/migrations/20261005031500_financial_row_guard). Go-live's "Clear demo
// data" and the backup restore, the two operations that must, are tested with their own services in go-live.db.test.ts and
// backup.db.test.ts, which pass with the guard in place; this file is about what the guard refuses.

const root = path.join(__dirname, "../../..");
const migration = readFileSync(path.join(root, "prisma/migrations/20261005031500_financial_row_guard/migration.sql"), "utf8");
const tablesOf = (trigger: string) => [...migration.matchAll(new RegExp(`CREATE TRIGGER ${trigger} BEFORE (?:DELETE|TRUNCATE|UPDATE OR DELETE) ON "(\\w+)"`, "g"))].map((m) => m[1]!).sort();

const GUARDED = ["Asset", "Expense", "Invoice", "InvoiceItem", "Membership", "Payment", "Purchase", "PurchaseLine", "Sequence", "VendorPayment"];
const NEVER = ["BranchSubscription", "SalaryPayment", "TrainerPayment"];

type Gym = Awaited<ReturnType<typeof makeGym>>;

/** One row of every protected table in a gym. */
async function fill(gym: Gym) {
  const admin = pick(await gym.user("Super Admin"), gym.a.id);
  const orgId = gym.org.id;
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const plan = await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: true, features: [] });
  const member = await createMember(admin, { name: "Guard Member", gender: "Male", phone: `98${Math.floor(10_000_000 + Math.random() * 89_999_999)}`, source: "Walk-in", tags: [] });
  const sale = await sellMembership(admin, member.id, { planId: plan.id, startDate: todayIso(), discount: 0, includeRegFee: false, payAmount: 150000, payMethod: "UPI" });
  const cat = await db.expenseCategory.findFirstOrThrow();
  const expense = await db.expense.create({ data: { orgId, branchId: gym.a.id, code: `EXP-${stamp}`, date: new Date(), categoryId: cat.id, description: "Rent", amount: 100000, method: "Cash", createdById: admin.id } });
  const asset = await db.asset.create({ data: { orgId, branchId: gym.a.id, code: `AST-${stamp}`, name: "Treadmill", category: "Cardio", purchaseDate: new Date(), cost: 10000000, method: "Bank", createdById: admin.id } });
  const purchase = await db.purchase.create({ data: { orgId, branchId: gym.a.id, code: `PUR-${stamp}`, date: new Date(), vendor: "Vendor", total: 100000, createdById: admin.id } });
  const line = await db.purchaseLine.create({ data: { purchaseId: purchase.id, type: "Stock", description: "Whey", qty: 1, rate: 100000, gstPct: 18, amount: 100000 } });
  const vendorPayment = await db.vendorPayment.create({ data: { purchaseId: purchase.id, code: `VP-${stamp}`, date: new Date(), amount: 100000, method: "Cash", createdById: admin.id } });
  await db.sequence.upsert({ where: { orgId_name: { orgId, name: "guard-test" } }, create: { orgId, name: "guard-test", next: 5 }, update: { next: 5 } });
  const salary = await db.salaryPayment.create({ data: { code: `SAL-${stamp}`, orgId, branchId: gym.a.id, userId: admin.id, kind: "SALARY", date: new Date(), net: 2000000, method: "Cash", paidById: admin.id } });
  const subscription = await db.branchSubscription.create({ data: { orgId, cycle: "MONTHLY", base: 399900, gst: 71982, total: 471882, mode: "demo", createdById: admin.id } });
  const trainerMember = await db.trainerMember.create({ data: { email: `guard-${stamp}@test.local`, name: "Trainer Member" } });
  const trainerPayment = await db.trainerPayment.create({ data: { memberId: trainerMember.id, plan: "ai-pro", cycle: "MONTHLY", kind: "NEW", base: 29900, gst: 5382, total: 35282, mode: "demo" } });
  const payment = await db.payment.findFirstOrThrow({ where: { orgId } });
  const invoice = sale.invoice;
  const item = await db.invoiceItem.findFirstOrThrow({ where: { invoiceId: invoice.id } });
  const membership = await db.membership.findFirstOrThrow({ where: { memberId: member.id } });
  const audit = await db.auditLog.findFirstOrThrow({ where: { orgId } });
  return { orgId, admin, member, ids: { expense: expense.id, asset: asset.id, purchase: purchase.id, line: line.id, vendorPayment: vendorPayment.id, salary: salary.id, subscription: subscription.id, trainerPayment: trainerPayment.id, payment: payment.id, invoice: invoice.id, item: item.id, membership: membership.id, audit: audit.id } };
}
type Filled = Awaited<ReturnType<typeof fill>>;

/** Deleting each kind of row, the way the app's own queries would. */
const deletions = (f: Filled): Record<string, () => Promise<unknown>> => ({
  Asset: () => db.asset.deleteMany({ where: { id: f.ids.asset } }),
  Expense: () => db.expense.deleteMany({ where: { id: f.ids.expense } }),
  Invoice: () => db.invoice.deleteMany({ where: { id: f.ids.invoice } }),
  InvoiceItem: () => db.invoiceItem.deleteMany({ where: { id: f.ids.item } }),
  Membership: () => db.membership.deleteMany({ where: { id: f.ids.membership } }),
  Payment: () => db.payment.deleteMany({ where: { id: f.ids.payment } }),
  Purchase: () => db.purchase.deleteMany({ where: { id: f.ids.purchase } }),
  PurchaseLine: () => db.purchaseLine.deleteMany({ where: { id: f.ids.line } }),
  Sequence: () => db.sequence.deleteMany({ where: { orgId: f.orgId, name: "guard-test" } }),
  VendorPayment: () => db.vendorPayment.deleteMany({ where: { id: f.ids.vendorPayment } }),
  BranchSubscription: () => db.branchSubscription.deleteMany({ where: { id: f.ids.subscription } }),
  SalaryPayment: () => db.salaryPayment.deleteMany({ where: { id: f.ids.salary } }),
  TrainerPayment: () => db.trainerPayment.deleteMany({ where: { id: f.ids.trainerPayment } }),
});
const present = async (f: Filled) => ({
  payment: await db.payment.count({ where: { id: f.ids.payment } }),
  invoice: await db.invoice.count({ where: { id: f.ids.invoice } }),
  item: await db.invoiceItem.count({ where: { id: f.ids.item } }),
  membership: await db.membership.count({ where: { id: f.ids.membership } }),
  expense: await db.expense.count({ where: { id: f.ids.expense } }),
  purchase: await db.purchase.count({ where: { id: f.ids.purchase } }),
  line: await db.purchaseLine.count({ where: { id: f.ids.line } }),
  vendorPayment: await db.vendorPayment.count({ where: { id: f.ids.vendorPayment } }),
  asset: await db.asset.count({ where: { id: f.ids.asset } }),
  sequence: await db.sequence.count({ where: { orgId: f.orgId, name: "guard-test" } }),
});
const ALL_PRESENT = { payment: 1, invoice: 1, item: 1, membership: 1, expense: 1, purchase: 1, line: 1, vendorPayment: 1, asset: 1, sequence: 1 };
const blocked = (p: Promise<unknown>) => expect(p).rejects.toThrow(/not allowed|append-only/);

describe("what the migration guards", () => {
  it("lists the same tables as this test, so a table added to one is added to the other", () => {
    expect(tablesOf("fitron_guard_delete")).toEqual(GUARDED);
    expect(tablesOf("fitron_never_delete")).toEqual(NEVER);
    expect(tablesOf("fitron_audit_append_only")).toEqual(["AuditLog"]);
    expect(tablesOf("fitron_no_truncate")).toEqual([...GUARDED, ...NEVER, "AuditLog"].sort());
  });

  it("is the only thing that decides: the app deletes these tables in two places, go-live and restore", () => {
    const models = "asset|expense|invoice|invoiceItem|membership|payment|purchase|purchaseLine|sequence|vendorPayment|branchSubscription|salaryPayment|trainerPayment|auditLog";
    const re = new RegExp(`\\b(?:db|tx)\\.(?:${models})\\.(?:delete|deleteMany)\\(`);
    const files = (function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((n) => {
        const p = path.join(dir, n);
        if (n === "generated" || n === "node_modules") return [];
        return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
      });
    })(path.join(root, "src"));
    const found = files.filter((f) => re.test(readFileSync(f, "utf8"))).map((f) => path.relative(root, f).replaceAll("\\", "/"));
    expect(found).toEqual(["src/lib/services/go-live.ts"]);
    expect(readFileSync(path.join(root, "src/lib/services/backup.ts"), "utf8")).toContain('allowDelete(tx, "restore")');
    expect(readFileSync(path.join(root, "src/lib/services/go-live.ts"), "utf8")).toContain('allowDelete(tx, "demo-clear")');
  });
});

describe.skipIf(!hasDb)("financial records are kept (database)", () => {
  let gym: Gym;
  let f: Filled;

  beforeAll(async () => {
    gym = await makeGym();
    f = await fill(gym);
  });

  it.each([...GUARDED, ...NEVER])("refuses to delete a %s, by the app's own query", async (table) => {
    await blocked(deletions(f)[table]!());
    expect(await present(f)).toEqual(ALL_PRESENT);
  });

  it("refuses a DELETE typed into a SQL prompt, whatever it matches", async () => {
    await expect(db.$executeRaw`DELETE FROM "Payment" WHERE id = ${f.ids.payment}`).rejects.toThrow(/Deleting a Payment record is not allowed/);
    await expect(db.$executeRaw`DELETE FROM "Invoice" WHERE "orgId" = ${f.orgId}`).rejects.toThrow(/Deleting a Invoice record is not allowed/);
    expect(await present(f)).toEqual(ALL_PRESENT);
  });

  it("keeps the audit log: no row can be changed or removed, by the app's query or a typed one, but rows can still be added", async () => {
    await expect(db.auditLog.updateMany({ where: { id: f.ids.audit }, data: { action: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(db.auditLog.deleteMany({ where: { id: f.ids.audit } })).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`UPDATE "AuditLog" SET "entityId" = 'x' WHERE id = ${f.ids.audit}`).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`DELETE FROM "AuditLog" WHERE "orgId" = ${f.orgId}`).rejects.toThrow(/append-only/);
    expect((await db.auditLog.findUniqueOrThrow({ where: { id: f.ids.audit } })).action).not.toBe("tampered");
    const before = await db.auditLog.count({ where: { orgId: f.orgId } });
    await db.$transaction((tx) => tx.auditLog.create({ data: { orgId: f.orgId, userId: f.admin.id, actorType: "USER", action: "guard.test", entity: "Test", entityId: "x" } }));
    expect(await db.auditLog.count({ where: { orgId: f.orgId } })).toBe(before + 1);
  });

  it("does not let the audit log be cleared even by the two operations that may delete money", async () => {
    for (const why of ["restore", "demo-clear"] as const) {
      await blocked(db.$transaction(async (tx) => { await allowDelete(tx, why); await tx.auditLog.deleteMany({ where: { id: f.ids.audit } }); }));
    }
    expect(await db.auditLog.count({ where: { id: f.ids.audit } })).toBe(1);
  });

  it("does not let staff pay, FITRON subscriptions or AI Trainer payments be deleted by anything, 'restore' and 'demo-clear' included", async () => {
    for (const why of ["restore", "demo-clear"] as const) {
      for (const table of NEVER) await blocked(db.$transaction(async (tx) => { await allowDelete(tx, why); await deletions(f)[table]!(); }));
    }
    expect(await db.salaryPayment.count({ where: { id: f.ids.salary } })).toBe(1);
    expect(await db.branchSubscription.count({ where: { id: f.ids.subscription } })).toBe(1);
    expect(await db.trainerPayment.count({ where: { id: f.ids.trainerPayment } })).toBe(1);
  });

  describe("'demo-clear'", () => {
    it("does not work for a gym that is not flagged demo: the database checks, not just the app", async () => {
      for (const table of GUARDED) {
        await blocked(db.$transaction(async (tx) => { await allowDelete(tx, "demo-clear"); await deletions(f)[table]!(); }));
      }
      expect(await present(f)).toEqual(ALL_PRESENT);
    });

    it("removes a demo gym's rows, resolving the owner through the parent for items, memberships, purchase lines and vendor payments", async () => {
      const demo = await makeGym();
      await db.organization.update({ where: { id: demo.org.id }, data: { demo: true } });
      const d = await fill(demo);
      await db.$transaction(async (tx) => {
        await allowDelete(tx, "demo-clear");
        await tx.payment.deleteMany({ where: { id: d.ids.payment } });
        await tx.invoiceItem.deleteMany({ where: { id: d.ids.item } });
        await tx.membership.deleteMany({ where: { id: d.ids.membership } });
        await tx.invoice.deleteMany({ where: { id: d.ids.invoice } });
        await tx.expense.deleteMany({ where: { id: d.ids.expense } });
        await tx.vendorPayment.deleteMany({ where: { id: d.ids.vendorPayment } });
        await tx.purchaseLine.deleteMany({ where: { id: d.ids.line } });
        await tx.purchase.deleteMany({ where: { id: d.ids.purchase } });
        await tx.asset.deleteMany({ where: { id: d.ids.asset } });
        await tx.sequence.deleteMany({ where: { orgId: d.orgId, name: "guard-test" } });
      });
      expect(await present(d)).toEqual({ payment: 0, invoice: 0, item: 0, membership: 0, expense: 0, purchase: 0, line: 0, vendorPayment: 0, asset: 0, sequence: 0 });
      expect(await present(f)).toEqual(ALL_PRESENT);
    });

    it("cannot reach another gym's records even in the same transaction as a demo gym's: all of it is undone", async () => {
      const demo = await makeGym();
      await db.organization.update({ where: { id: demo.org.id }, data: { demo: true } });
      const d = await fill(demo);
      await blocked(
        db.$transaction(async (tx) => {
          await allowDelete(tx, "demo-clear");
          await tx.payment.deleteMany({ where: { id: d.ids.payment } });
          await tx.payment.deleteMany({ where: { id: f.ids.payment } });
        }),
      );
      expect((await present(d)).payment).toBe(1);
      expect((await present(f)).payment).toBe(1);
    });
  });

  describe("'restore'", () => {
    it("lets a transaction delete a gym's money records, which the backup restore does before it loads the file's", async () => {
      const g = await makeGym();
      const r = await fill(g);
      let inside: Record<string, number> | undefined;
      await expect(
        db.$transaction(async (tx) => {
          await allowDelete(tx, "restore");
          await tx.payment.deleteMany({ where: { orgId: r.orgId } });
          await tx.invoiceItem.deleteMany({ where: { invoice: { orgId: r.orgId } } });
          await tx.membership.deleteMany({ where: { member: { orgId: r.orgId } } });
          await tx.invoice.deleteMany({ where: { orgId: r.orgId } });
          inside = { payments: await tx.payment.count({ where: { orgId: r.orgId } }), invoices: await tx.invoice.count({ where: { orgId: r.orgId } }) };
          throw new Error("roll back");
        }),
      ).rejects.toThrow("roll back");
      expect(inside).toEqual({ payments: 0, invoices: 0 });
      expect(await present(r)).toEqual(ALL_PRESENT);
    });
  });

  describe("the permission", () => {
    it("ends with the transaction it was given in: the next statement on the same connection is refused again", async () => {
      const demo = await makeGym();
      await db.organization.update({ where: { id: demo.org.id }, data: { demo: true } });
      const d = await fill(demo);
      await db.$transaction(async (tx) => {
        await allowDelete(tx, "demo-clear");
        await tx.payment.deleteMany({ where: { id: d.ids.payment } });
      });
      for (let i = 0; i < 5; i++) await expect(db.$executeRaw`DELETE FROM "Invoice" WHERE id = ${d.ids.invoice}`).rejects.toThrow(/not allowed/);
      expect((await present(d)).invoice).toBe(1);
    });

    it("is only a known reason: any other value opens nothing", async () => {
      for (const why of ["yes", "true", "demo", "RESTORE", ""]) {
        await blocked(db.$transaction(async (tx) => { await tx.$executeRaw`SELECT set_config('fitron.allow_delete', ${why}, true)`; await deletions(f).Payment!(); }));
      }
      expect((await present(f)).payment).toBe(1);
    });
  });

  describe("TRUNCATE, which skips row triggers", () => {
    it("is refused by the trigger function on every guarded table (proved on a scratch table, so a failure here cannot empty real data)", async () => {
      await expect(
        db.$transaction(async (tx) => {
          await tx.$executeRawUnsafe("CREATE TEMP TABLE guard_scratch (id int)");
          await tx.$executeRawUnsafe("CREATE TRIGGER fitron_no_truncate BEFORE TRUNCATE ON guard_scratch FOR EACH STATEMENT EXECUTE FUNCTION fitron_no_truncate()");
          await tx.$executeRawUnsafe("TRUNCATE guard_scratch");
        }),
      ).rejects.toThrow(/Emptying the guard_scratch table is not allowed/);
    });

    it("has that trigger on each of them, switched on", async () => {
      const rows = await db.$queryRaw<{ t: string; enabled: string }[]>`
        SELECT c.relname::text AS t, g.tgenabled::text AS enabled FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
        WHERE g.tgname = 'fitron_no_truncate' AND NOT g.tgisinternal`;
      expect(rows.map((r) => r.t).sort()).toEqual([...GUARDED, ...NEVER, "AuditLog"].sort());
      expect(rows.every((r) => r.enabled === "O")).toBe(true);
    });
  });
});
