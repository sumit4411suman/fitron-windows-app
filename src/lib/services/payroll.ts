import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { writeBranch } from "@/lib/auth/current";
import type { Prisma } from "@/generated/prisma/client";
import { commissionFor, netPay, outstanding, payrollMonths, recoverAdvances, salaryCategory } from "@/lib/domain/payroll";
import { monthEnd, monthLabel } from "@/lib/domain/periods";
import { formatRupees } from "@/lib/format";
import type { AdvanceInput, SalaryInput, SalaryPayInput } from "@/lib/validation/payroll";
import { audit } from "./audit";
import { isUniqueViolation, UserError } from "./errors";
import { assertMonthOpen } from "./locks";
import { nextNumber } from "./sequence";
import { fromIso, todayIso } from "./time";

type Tx = Prisma.TransactionClient;
const OWNER = "Super Admin";

const safe = <T extends { passwordHash?: string }>(u: T) => {
  const { passwordHash: _, ...rest } = u;
  void _;
  return rest;
};

/** The staff member must be an active, non-owner person of this gym. */
async function staffOf(u: CurrentUser, id: string, db_: Tx | typeof db = db) {
  const s = await db_.user.findFirst({ where: { id, orgId: u.orgId, deletedAt: null, active: true, role: { name: { not: OWNER } } }, include: { role: { select: { name: true } } } });
  if (!s) throw new UserError("Staff member not found.");
  return s;
}

const outstandingOf = async (tx: Tx | typeof db, userId: string) =>
  tx.salaryPayment.findMany({ where: { userId, kind: "ADVANCE" }, orderBy: [{ date: "asc" }, { createdAt: "asc" }], select: { id: true, net: true, recovered: true } });

export async function payrollTotal(u: CurrentUser) {
  const r = await db.user.aggregate({ _sum: { salary: true }, where: { orgId: u.orgId, deletedAt: null, active: true, role: { name: { not: OWNER } } } });
  return r._sum.salary ?? 0;
}

/** Personal Training revenue × rate for the month, using the same invoice lines as the PT report. */
async function commissionOf(u: CurrentUser, staffId: string, ptRate: number, month: string) {
  if (ptRate <= 0) return 0;
  const r = await db.invoiceItem.aggregate({
    _sum: { amount: true },
    where: { category: "Personal Training", trainerId: staffId, invoice: { orgId: u.orgId, status: "ISSUED", date: { gte: fromIso(`${month}-01`), lte: fromIso(monthEnd(month)) } } },
  });
  return commissionFor(r._sum.amount ?? 0, ptRate);
}

export async function payrollOverview(u: CurrentUser, month: string) {
  const months = payrollMonths(todayIso());
  const staff = await db.user.findMany({
    where: { orgId: u.orgId, deletedAt: null, active: true, role: { name: { not: OWNER } } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, salary: true, ptRate: true, joinedOn: true, payAccount: true, role: { select: { name: true } } },
  });
  const ids = staff.map((s) => s.id);
  const [paidRows, advances, history] = await Promise.all([
    db.salaryPayment.findMany({ where: { orgId: u.orgId, kind: "SALARY", month, userId: { in: ids } } }),
    db.salaryPayment.findMany({ where: { orgId: u.orgId, kind: "ADVANCE", userId: { in: ids } }, select: { id: true, userId: true, net: true, recovered: true } }),
    db.salaryPayment.findMany({ where: { orgId: u.orgId, kind: "SALARY" }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 8, include: { user: { select: { name: true } } } }),
  ]);
  const rows = await Promise.all(
    staff.map(async (s) => ({
      ...s,
      paid: paidRows.find((p) => p.userId === s.id) ?? null,
      advanceOutstanding: outstanding(advances.filter((a) => a.userId === s.id).map((a) => ({ id: a.id, amount: a.net, recovered: a.recovered }))),
      commission: s.role.name === "Trainer" ? await commissionOf(u, s.id, s.ptRate, month) : 0,
    })),
  );
  const stats = {
    payroll: rows.reduce((t, r) => t + r.salary, 0),
    paid: paidRows.reduce((t, p) => t + p.net, 0),
    due: rows.filter((r) => !r.paid).length,
    advances: rows.reduce((t, r) => t + r.advanceOutstanding, 0),
  };
  return { rows, stats, history, months };
}

export async function setSalary(u: CurrentUser, id: string, input: SalaryInput) {
  const before = await staffOf(u, id);
  await db.$transaction(async (tx) => {
    const after = await tx.user.update({ where: { id }, data: { salary: input.salary, ptRate: Math.round(input.ptRate), joinedOn: input.joinedOn ? fromIso(input.joinedOn) : null, payAccount: input.payAccount ?? null } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "staff.salary", entity: "User", entityId: id, before: safe(before), after: safe(after) });
  });
}

async function salaryExpense(tx: Tx, u: CurrentUser, branchId: string, today: string, s: { name: string; role: { name: string } }, amount: number, method: string, description: string, notes: string | null) {
  const n = await nextNumber(tx, u.orgId, "expense", 1);
  const e = await tx.expense.create({
    data: { code: `EXP-${n}`, orgId: u.orgId, branchId, date: fromIso(today), categoryId: salaryCategory(s.role.name), description, vendor: s.name, amount, method, notes, createdById: u.id },
  });
  await audit(tx, { orgId: u.orgId, userId: u.id, action: "expense.create", entity: "Expense", entityId: e.id, after: e });
  return e;
}

export async function recordAdvance(u: CurrentUser, id: string, input: AdvanceInput) {
  const s = await staffOf(u, id);
  if (s.salary <= 0) throw new UserError("Set the monthly salary first.", "amount");
  if (input.amount > s.salary) throw new UserError("Advance can’t be more than one month’s salary.", "amount");
  const branchId = writeBranch(u);
  if (!branchId) throw new UserError("Pick a branch first.");
  const today = todayIso();
  return db.$transaction(async (tx) => {
    await assertMonthOpen(tx, u, branchId, today);
    const e = await salaryExpense(tx, u, branchId, today, s, input.amount, input.method, `Salary advance · ${s.name}`, input.note ?? null);
    const n = await nextNumber(tx, u.orgId, "payroll", 1);
    const row = await tx.salaryPayment.create({
      data: { kind: "ADVANCE", code: `PR-${n}`, orgId: u.orgId, userId: id, branchId, date: fromIso(today), net: input.amount, method: input.method, note: input.note ?? null, expenseId: e.id, recovered: 0, paidById: u.id },
    });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "payroll.advance", entity: "SalaryPayment", entityId: row.id, after: row });
    return row;
  });
}

export async function paySalary(u: CurrentUser, id: string, input: SalaryPayInput) {
  if (!payrollMonths(todayIso()).includes(input.month)) throw new UserError("Pick a month.", "month");
  const s = await staffOf(u, id);
  const net = netPay(input);
  if (net < 0) throw new UserError("Deductions are more than the salary.", "deductions");
  const open = outstanding((await outstandingOf(db, id)).map((a) => ({ id: a.id, amount: a.net, recovered: a.recovered })));
  if (input.advance > open) throw new UserError(`Only ${formatRupees(open)} of advances is outstanding.`, "advance");
  const branchId = writeBranch(u);
  if (!branchId) throw new UserError("Pick a branch first.");
  const today = todayIso();
  const already = `${s.name} is already paid for ${monthLabel(input.month)}.`;
  try {
    return await db.$transaction(async (tx) => {
      await assertMonthOpen(tx, u, branchId, today);
      if (await tx.salaryPayment.findFirst({ where: { userId: id, kind: "SALARY", month: input.month }, select: { id: true } })) throw new UserError(already);
      const e = net > 0 ? await salaryExpense(tx, u, branchId, today, s, net, input.method, `Salary ${monthLabel(input.month)} · ${s.name}`, input.reference ?? null) : null;
      if (input.advance > 0) {
        const advs = await tx.salaryPayment.findMany({ where: { userId: id, kind: "ADVANCE" }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] });
        for (const r of recoverAdvances(advs.map((a) => ({ id: a.id, amount: a.net, recovered: a.recovered })), input.advance)) {
          const before = advs.find((a) => a.id === r.id)!;
          const after = await tx.salaryPayment.update({ where: { id: r.id }, data: { recovered: { increment: r.recover }, settledMonth: r.settled ? input.month : null } });
          await audit(tx, { orgId: u.orgId, userId: u.id, action: "payroll.advance.settle", entity: "SalaryPayment", entityId: r.id, before, after });
        }
      }
      const n = await nextNumber(tx, u.orgId, "payroll", 1);
      const row = await tx.salaryPayment.create({
        data: { kind: "SALARY", code: `PR-${n}`, orgId: u.orgId, userId: id, branchId, month: input.month, date: fromIso(today), base: input.base, days: input.days, commission: input.commission, bonus: input.bonus, deductions: input.deductions, advance: input.advance, net, method: input.method, reference: input.reference ?? null, expenseId: e?.id ?? null, paidById: u.id },
      });
      await audit(tx, { orgId: u.orgId, userId: u.id, action: "payroll.pay", entity: "SalaryPayment", entityId: row.id, after: row });
      return { row, name: s.name };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserError(already);
    throw e;
  }
}
