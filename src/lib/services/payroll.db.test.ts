import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { createMember } from "./members";
import { createInvoice } from "./billing";
import { listAudit, ledger, monthPeriod, profitAndLoss } from "./accounting";
import { voidExpense } from "./expenses";
import { payrollOverview, paySalary, recordAdvance, setSalary } from "./payroll";
import { todayIso } from "./time";
import { monthLabel } from "@/lib/domain/periods";

describe.skipIf(!hasDb)("payroll (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<typeof gym.user>>;
  let trainer: { id: string; name: string };
  let recep: { id: string; name: string };
  const month = todayIso().slice(0, 7);
  const pay = (over = {}) => ({ month, base: 1800000, commission: 0, bonus: 0, deductions: 0, advance: 0, days: 26, method: "Bank Transfer" as const, ...over });

  const mk = async (roleName: string, name: string) => {
    const role = await db.role.findFirstOrThrow({ where: { name: roleName } });
    return db.user.create({ data: { orgId: admin.orgId, name, email: `${name}-${Math.random()}@t.local`, phone: "9000000000", passwordHash: "x", roleId: role.id, branches: { create: [{ branchId: gym.a.id }] } } });
  };

  beforeAll(async () => {
    gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    trainer = await mk("Trainer", "Tara Trainer");
    recep = await mk("Receptionist", "Rita Recep");
  });

  it("setSalary stores details and audits; other gyms are refused", async () => {
    await setSalary(admin, trainer.id, { salary: 1800000, ptRate: 40, joinedOn: "2024-04-01", payAccount: "tara@okaxis" });
    await setSalary(admin, recep.id, { salary: 1500000, ptRate: 0 });
    const t = await db.user.findUniqueOrThrow({ where: { id: trainer.id } });
    expect([t.salary, t.ptRate, t.payAccount]).toEqual([1800000, 40, "tara@okaxis"]);
    expect((await listAudit(admin, {})).rows.some((r) => r.action === "staff.salary" && r.entity === "User")).toBe(true);
    const og = await makeGym();
    const other = pick(await og.user("Super Admin"), og.a.id);
    await expect(setSalary(other, trainer.id, { salary: 1, ptRate: 0 })).rejects.toThrow("Staff member not found.");
  });

  it("advance rules and booking", async () => {
    const nosal = await mk("Receptionist", "No Salary");
    await expect(recordAdvance(admin, nosal.id, { amount: 100, method: "Cash" })).rejects.toThrow("Set the monthly salary first.");
    await expect(recordAdvance(admin, recep.id, { amount: 1600000, method: "Cash" })).rejects.toThrow(/more than one month’s salary/);
    const a = await recordAdvance(admin, recep.id, { amount: 200000, method: "Cash", note: "Diwali" });
    const b = await recordAdvance(admin, trainer.id, { amount: 300000, method: "Cash" });
    expect(a.kind).toBe("ADVANCE");
    expect(a.code).toMatch(/^PR-\d+$/);
    expect(a.recovered).toBe(0);
    const ea = await db.expense.findUniqueOrThrow({ where: { id: a.expenseId! } });
    const eb = await db.expense.findUniqueOrThrow({ where: { id: b.expenseId! } });
    expect([ea.categoryId, ea.vendor, ea.description, ea.amount, ea.status, ea.branchId]).toEqual(["staff-salary", "Rita Recep", "Salary advance · Rita Recep", 200000, "ACTIVE", gym.a.id]);
    expect(ea.code).toMatch(/^EXP-\d+$/);
    expect(eb.categoryId).toBe("trainer-salary");
    const actions = new Set((await listAudit(admin, {})).rows.map((r) => r.action));
    expect(actions.has("payroll.advance") && actions.has("expense.create")).toBe(true);
  });

  it("overview, commission prefill and paying", async () => {
    const m = await createMember(admin, { name: "PT Member", gender: "Male", phone: "9822200077", source: "Walk-in", tags: [] });
    const inv = await createInvoice(admin, { memberId: m.id, date: todayIso(), dueDate: todayIso(), lines: [{ description: "PT", category: "Personal Training", qty: 1, rate: 1000000, discount: 0, taxable: true }], payAmount: 0 });
    await db.invoiceItem.updateMany({ where: { invoiceId: inv.id }, data: { trainerId: trainer.id } });
    let o = await payrollOverview(admin, month);
    expect(o.rows.some((r) => r.name === "Super Admin user")).toBe(false);
    const tr = o.rows.find((r) => r.id === trainer.id)!;
    expect(tr.commission).toBe(400000);
    expect(o.rows.find((r) => r.id === recep.id)!.commission).toBe(0);
    expect(tr.advanceOutstanding).toBe(300000);
    expect(o.stats.advances).toBe(500000);
    expect(o.stats.payroll).toBe(3300000);
    expect(o.stats.due).toBe(o.rows.length);

    await expect(paySalary(admin, trainer.id, pay({ deductions: 99999900 }))).rejects.toThrow("Deductions are more than the salary.");
    await expect(paySalary(admin, trainer.id, pay({ advance: 400000 }))).rejects.toThrow(/Only ₹3,000 of advances is outstanding/);
    // partial recovery
    const r = await paySalary(admin, recep.id, pay({ base: 1500000, advance: 50000 }));
    expect(r.row.net).toBe(1450000);
    o = await payrollOverview(admin, month);
    expect(o.rows.find((x) => x.id === recep.id)!.advanceOutstanding).toBe(150000);
    // full recovery with commission + bonus
    const t = await paySalary(admin, trainer.id, pay({ commission: 400000, bonus: 50000, deductions: 30000, advance: 300000, reference: "UTR1" }));
    expect(t.row.net).toBe(1800000 + 400000 + 50000 - 30000 - 300000);
    const e = await db.expense.findUniqueOrThrow({ where: { id: t.row.expenseId! } });
    expect([e.amount, e.description, e.notes, e.categoryId]).toEqual([t.row.net, `Salary ${monthLabel(month)} · Tara Trainer`, "UTR1", "trainer-salary"]);
    const adv = await db.salaryPayment.findFirstOrThrow({ where: { userId: trainer.id, kind: "ADVANCE" } });
    expect([adv.recovered, adv.settledMonth]).toEqual([300000, month]);
    await expect(paySalary(admin, trainer.id, pay())).rejects.toThrow(/already paid for/);
    o = await payrollOverview(admin, month);
    expect(o.stats.advances).toBe(150000);
    expect(o.stats.due).toBe(o.rows.length - 2);
    expect(o.stats.paid).toBe(r.row.net + t.row.net);
    const actions = new Set((await listAudit(admin, {})).rows.map((x) => x.action));
    expect(actions.has("payroll.pay") && actions.has("payroll.advance.settle")).toBe(true);

    const pl = await profitAndLoss(admin, monthPeriod(month));
    expect(pl.expenseGroups.find((g) => g.key === "Salaries")?.amount).toBe(200000 + 300000 + r.row.net + t.row.net);
    const led = await ledger(admin, "Bank Transfer", monthPeriod(month));
    expect(JSON.stringify(led)).toContain("Salary");
    await expect(voidExpense(admin, t.row.expenseId!, "oops")).rejects.toThrow(/salary payment/);
  });

  it("a net of 0 books no expense", async () => {
    const z = await mk("Receptionist", "Zed Zero");
    await setSalary(admin, z.id, { salary: 100000, ptRate: 0 });
    const r = await paySalary(admin, z.id, pay({ base: 100000, deductions: 100000 }));
    expect([r.row.net, r.row.expenseId]).toEqual([0, null]);
  });

  it("month lock blocks an Accountant, not a Super Admin; branch is the picked one", async () => {
    const w = await mk("Receptionist", "Lock Case");
    await setSalary(admin, w.id, { salary: 100000, ptRate: 0 });
    await db.monthLock.create({ data: { branchId: gym.b.id, month, lockedById: admin.id, lockedAt: new Date() } });
    const acc = pick(await gym.user("Accountant"), gym.b.id);
    await expect(recordAdvance(acc, w.id, { amount: 1000, method: "Cash" })).rejects.toThrow(/locked/);
    await expect(paySalary(acc, w.id, pay({ base: 100000 }))).rejects.toThrow(/locked/);
    const adminB = pick(await gym.user("Super Admin"), gym.b.id);
    const r = await recordAdvance(adminB, w.id, { amount: 1000, method: "Cash" });
    expect(r.branchId).toBe(gym.b.id);
  });
});
