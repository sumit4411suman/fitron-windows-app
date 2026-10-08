import { beforeAll, describe, expect, it } from "vitest";
import { hasDb, makeGym, pick } from "@/test/db";
import { addMonths } from "@/lib/domain/dates";
import { createMember } from "./members";
import { createInvoice } from "./billing";
import { createExpense, expenseTrend, listExpenses, voidExpense } from "./expenses";
import { listAudit, lockMonth, monthPeriod, profitAndLoss, unlockMonth } from "./accounting";
import { REPORTS } from "./reports";
import { todayIso } from "./time";
import { db } from "@/lib/db";
import { audit } from "./audit";

describe.skipIf(!hasDb)("expenses and accounting (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  const lastMonth = addMonths(`${todayIso().slice(0, 7)}-01`, -1).slice(0, 7);
  const day = `${lastMonth}-10`;
  const expense = (over = {}) => ({ date: day, categoryId: "rent", description: "Shop rent", amount: 3000000, method: "Bank Transfer" as const, ...over });

  beforeAll(async () => {
    gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
  });

  it("P&L is invoice lines minus expenses, and voided expenses drop out", async () => {
    const m = await createMember(admin, { name: "PnL Member", gender: "Female", phone: "9822200001", source: "Walk-in", tags: [] });
    await createInvoice(admin, {
      memberId: m.id,
      date: day,
      dueDate: day,
      lines: [{ description: "PT sessions", category: "Personal Training", qty: 2, rate: 100000, discount: 0, taxable: true }],
      payAmount: 0,
    });
    const rent = await createExpense(admin, expense());
    const power = await createExpense(admin, expense({ categoryId: "electricity", description: "Power bill", amount: 450000, method: "UPI" }));
    expect(rent.code).toMatch(/^EXP-\d+$/);

    let pl = await profitAndLoss(admin, monthPeriod(lastMonth));
    expect(pl.totalRevenue).toBe(200000);
    expect(pl.gstCollected).toBe(36000);
    expect(pl.totalExpenses).toBe(3450000);
    expect(pl.net).toBe(200000 - 3450000);
    expect(pl.expenseGroups.find((g) => g.key === "Utilities")?.amount).toBe(450000);

    await voidExpense(admin, power.id, "Duplicate entry");
    pl = await profitAndLoss(admin, monthPeriod(lastMonth));
    expect(pl.totalExpenses).toBe(3000000);
    await expect(voidExpense(admin, power.id, "Again")).rejects.toThrow(/Already voided/);
    expect((await listExpenses(admin, { includeVoid: true })).find((e) => e.id === power.id)?.voidReason).toBe("Duplicate entry");

    // The monthly trend counts active expenses only, per category when one is picked.
    const months = [lastMonth, todayIso().slice(0, 7)];
    expect(await expenseTrend(admin, months)).toEqual([{ month: lastMonth, amount: 3000000 }, { month: months[1], amount: 0 }]);
    expect((await expenseTrend(admin, months, "electricity"))[0]!.amount).toBe(0);
  });

  it("a locked month blocks an Accountant, not a Super Admin, and unlocks again", async () => {
    await lockMonth(admin, lastMonth);
    const accountant = pick(await gym.user("Accountant"), gym.a.id);
    await expect(createExpense(accountant, expense())).rejects.toThrow(/locked/);
    await createExpense(admin, expense({ description: "Late bill" }));
    await unlockMonth(admin, lastMonth);
    await createExpense(accountant, expense({ description: "After unlock" }));
  });

  it("only ended months can be locked", async () => {
    await expect(lockMonth(admin, todayIso().slice(0, 7))).rejects.toThrow(/ended/);
  });

  it("scopes expenses to the user's branches", async () => {
    const onlyB = pick(await gym.user("Accountant", [gym.b.id]), gym.b.id);
    const list = await listExpenses(onlyB, {});
    expect(list).toHaveLength(0);
  });

  it("writes an audit row for every expense and lock change", async () => {
    const { rows } = await listAudit(admin, {});
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ["expense.create", "expense.void", "month.lock", "month.unlock"]) expect(actions.has(a)).toBe(true);
  });

  it("the expenses report matches the P&L", async () => {
    const pl = await profitAndLoss(admin, monthPeriod(lastMonth));
    const r = await REPORTS.expenses!.run(admin, monthPeriod(lastMonth));
    expect(r.totals?.amount).toBe(pl.totalExpenses);
  });

  it("filters by module, system user, search and branch, with readable rows", async () => {
    const g = await makeGym();
    const boss = await g.user("Super Admin");
    const w = (a: { action: string; entity: string; entityId: string; userId?: string | null; after?: unknown }) => db.$transaction((tx) => audit(tx, { orgId: g.org.id, userId: boss.id, ...a }));
    await w({ action: "auth.login", entity: "Session", entityId: boss.id, after: { via: "password" } });
    await w({ action: "staff.role", entity: "User", entityId: "u1", after: { name: "Ravi" } });
    await w({ action: "payment.create", entity: "Payment", entityId: "p1", after: { code: "PAY-9001", amount: 50000, method: "UPI", invoiceNumber: "INV-9", branchId: g.a.id } });
    await w({ action: "autopay.charged", entity: "AutopayMandate", entityId: "m1", userId: null, after: { code: "MND-1", amount: 100, branchId: g.b.id } });
    await w({ action: "ai.proposal.send", entity: "AiProposal", entityId: "x" });
    const access = await listAudit(boss, { module: "Access", pageSize: 100 });
    expect(access.rows.map((r) => r.action).sort()).toEqual(["auth.login", "staff.role"]);
    const other = await listAudit(boss, { module: "Other", pageSize: 100 });
    expect(other.rows.map((r) => r.action)).toEqual(["ai.proposal.send"]);
    expect(other.total).toBe(1);
    const sys = await listAudit(boss, { userId: "system", pageSize: 100 });
    expect(sys.rows.map((r) => r.action)).toEqual(["autopay.charged"]);
    expect(sys.hasSystem).toBe(true);
    const pay = await listAudit(boss, { q: "PAY-", pageSize: 100 });
    expect(pay.rows.map((r) => r.action)).toEqual(["payment.create"]);
    expect(pay.rows[0]).toMatchObject({ sentence: "Recorded payment PAY-9001 of ₹500 (UPI) against INV-9", branchName: "A", module: "Payments" });
    expect(pay.rows[0]!.hash).toBeTruthy();
    expect((await listAudit(boss, { q: boss.name, pageSize: 100 })).total).toBeGreaterThanOrEqual(4);
    const onlyA = await listAudit(pick(boss, g.a.id), { pageSize: 100 });
    expect(onlyA.rows.map((r) => r.action)).not.toContain("autopay.charged");
    expect(onlyA.rows.map((r) => r.action)).toContain("payment.create");
    expect(onlyA.rows.map((r) => r.action)).toContain("auth.login");
  });
});
