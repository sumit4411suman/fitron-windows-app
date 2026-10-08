import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { writeBranch } from "@/lib/auth/current";
import type { Prisma } from "@/generated/prisma/client";
import type { ExpenseInput } from "@/lib/validation/expense";
import { audit } from "./audit";
import { UserError } from "./errors";
import { assertMonthOpen } from "./locks";
import { nextNumber } from "./sequence";
import { fromIso, toIso } from "./time";

export const listCategories = () => db.expenseCategory.findMany({ orderBy: [{ group: "asc" }, { name: "asc" }] });

const scope = (u: CurrentUser): Prisma.ExpenseWhereInput => ({ orgId: u.orgId, branchId: { in: u.branchIds } });

export async function listExpenses(u: CurrentUser, f: { from?: string; to?: string; categoryId?: string; method?: string; q?: string; includeVoid?: boolean }) {
  const q = f.q?.trim();
  return db.expense.findMany({
    where: {
      ...scope(u),
      ...(f.includeVoid ? {} : { status: "ACTIVE" }),
      ...(f.categoryId ? { categoryId: f.categoryId } : {}),
      ...(f.method ? { method: f.method } : {}),
      ...(f.from || f.to ? { date: { ...(f.from ? { gte: fromIso(f.from) } : {}), ...(f.to ? { lte: fromIso(f.to) } : {}) } } : {}),
      ...(q ? { OR: [{ description: { contains: q, mode: "insensitive" } }, { vendor: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, { billNo: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: { category: true, branch: { select: { name: true } } },
  });
}

export async function createExpense(u: CurrentUser, input: ExpenseInput) {
  const branchId = writeBranch(u);
  if (!branchId) throw new UserError("Pick a branch first.");
  const cat = await db.expenseCategory.findUnique({ where: { id: input.categoryId } });
  if (!cat) throw new UserError("Pick a category.", "categoryId");
  return db.$transaction(async (tx) => {
    await assertMonthOpen(tx, u, branchId, input.date);
    const n = await nextNumber(tx, u.orgId, "expense", 1);
    const e = await tx.expense.create({
      data: {
        code: `EXP-${n}`,
        orgId: u.orgId,
        branchId,
        date: fromIso(input.date),
        categoryId: input.categoryId,
        description: input.description,
        vendor: input.vendor ?? null,
        amount: input.amount,
        method: input.method,
        billNo: input.billNo ?? null,
        notes: input.notes ?? null,
        createdById: u.id,
      },
    });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "expense.create", entity: "Expense", entityId: e.id, after: e });
    return e;
  });
}

/** Rule 2: expenses are voided with a reason, never deleted. */
export async function voidExpense(u: CurrentUser, id: string, reason: string) {
  const before = await db.expense.findFirst({ where: { ...scope(u), id } });
  if (!before) throw new UserError("Expense not found.");
  if (before.status === "VOID") throw new UserError("Already voided.");
  if (before.purchaseId) throw new UserError("This expense is part of a purchase bill. Cancel the bill instead.");
  if (before.assetId) throw new UserError("This is an asset's purchase. Remove the asset instead.");
  if (await db.salaryPayment.findFirst({ where: { expenseId: id }, select: { id: true } })) throw new UserError("This expense is a salary payment. Salary records can't be voided from here.");
  await db.$transaction(async (tx) => {
    await assertMonthOpen(tx, u, before.branchId, toIso(before.date));
    const after = await tx.expense.update({ where: { id }, data: { status: "VOID", voidReason: reason } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "expense.void", entity: "Expense", entityId: id, before, after });
  });
}

/** Active expenses per month for the "Monthly expense trend" chart, optionally for one category. */
export async function expenseTrend(u: CurrentUser, months: string[], categoryId?: string) {
  const rows = await db.expense.findMany({
    where: { ...scope(u), status: "ACTIVE", ...(categoryId ? { categoryId } : {}), date: { gte: fromIso(`${months[0]}-01`) } },
    select: { date: true, amount: true },
  });
  const by = new Map(months.map((m) => [m, 0]));
  for (const r of rows) {
    const k = toIso(r.date).slice(0, 7);
    if (by.has(k)) by.set(k, by.get(k)! + r.amount);
  }
  return months.map((m) => ({ month: m, amount: by.get(m)! }));
}
