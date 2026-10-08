import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { addDays, addMonths } from "@/lib/domain/dates";
import { audit } from "./audit";
import { UserError } from "./errors";
import { getSetting } from "./settings";
import { fromIso, istInstant, todayIso } from "./time";
import type { Prisma } from "@/generated/prisma/client";
import { HIGH_WORDS, MEDIUM_WORDS, deviceLabel, describeAudit, moduleOf, moduleWhere, severityOf, type Severity } from "@/lib/domain/audit";
import { depreciationIn, disposalsIn } from "@/lib/domain/assets";
import { assetsFor, toLike } from "./assets";

export type Period = { from: string; to: string };

export const monthPeriod = (ym: string): Period => ({ from: `${ym}-01`, to: addDays(addMonths(`${ym}-01`, 1), -1) });

/**
 * Rule 11: P&L comes from invoice items and expenses, never stored totals.
 * Revenue is the net of each line (after discount, before GST) on non-cancelled invoices dated in the period.
 * Rule 12: capital spend stays out; depreciation and disposal gains or losses come from the asset register.
 */
export async function profitAndLoss(u: CurrentUser, p: Period) {
  const [items, expenses, payments, assets] = await Promise.all([
    db.invoiceItem.findMany({
      where: { invoice: { orgId: u.orgId, branchId: { in: u.branchIds }, status: "ISSUED", date: { gte: fromIso(p.from), lte: fromIso(p.to) } } },
      select: { category: true, amount: true, taxAmount: true },
    }),
    db.expense.findMany({
      where: { orgId: u.orgId, branchId: { in: u.branchIds }, status: "ACTIVE", capital: false, date: { gte: fromIso(p.from), lte: fromIso(p.to) } },
      select: { amount: true, category: { select: { name: true, group: true } } },
    }),
    db.payment.findMany({
      where: { orgId: u.orgId, branchId: { in: u.branchIds }, status: "SUCCESS", date: { gte: fromIso(p.from), lte: fromIso(p.to) } },
      select: { amount: true, method: true },
    }),
    assetsFor(u.orgId, u.branchIds),
  ]);
  const sumBy = <T>(xs: T[], key: (x: T) => string, val: (x: T) => number) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + val(x));
    return [...m.entries()].map(([k, v]) => ({ key: k, amount: v })).sort((a, b) => b.amount - a.amount);
  };
  const revenue = sumBy(items, (i) => i.category, (i) => i.amount);
  const expenseGroups = sumBy(expenses, (e) => e.category.group, (e) => e.amount);
  const expenseCats = sumBy(expenses, (e) => e.category.name, (e) => e.amount);
  const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0);
  const totalExpenses = expenseGroups.reduce((s, r) => s + r.amount, 0);
  const gstCollected = items.reduce((s, i) => s + i.taxAmount, 0);
  const collected = payments.reduce((s, x) => s + x.amount, 0);
  const like = assets.map(toLike);
  const depreciation = depreciationIn(like, p.from.slice(0, 7), p.to.slice(0, 7));
  const disposals = disposalsIn(like, p.from, p.to);
  return {
    revenue,
    expenseGroups,
    expenseCats,
    totalRevenue,
    totalExpenses,
    depreciation,
    disposalGain: disposals.gain,
    disposalLoss: disposals.loss,
    net: totalRevenue + disposals.gain - totalExpenses - depreciation - disposals.loss,
    gstCollected,
    collected,
    collectedByMethod: sumBy(payments, (x) => x.method, (x) => x.amount),
  };
}

/**
 * Money in and out per payment method, the cash book view. In: member payments and asset sale proceeds.
 * Out: expenses (capital ones included), except those on supplier bills, where the supplier payments are the cash that moved.
 */
export async function ledger(u: CurrentUser, method: string, p: Period) {
  const rows = await movements(u, method, p);
  // The cash and bank books start from the balances entered when the gym switched to Fitron.
  const opening = method === "Cash" || method === "Bank Transfer" ? await getSetting<{ cash?: number; bank?: number; asOf?: string }>(u.orgId, "opening") : null;
  let bal = 0;
  let broughtForward: number | null = null;
  if (opening?.asOf && opening.asOf <= p.to) {
    const amount = (method === "Cash" ? opening.cash : opening.bank) ?? 0;
    if (opening.asOf < p.from) {
      const before = await movements(u, method, { from: opening.asOf, to: addDays(p.from, -1) });
      broughtForward = amount + before.reduce((s, r) => s + r.in - r.out, 0);
      bal = broughtForward;
    } else {
      rows.push({ date: fromIso(opening.asOf), ref: "OPENING", text: "Opening balance", link: null, in: Math.max(amount, 0), out: Math.max(-amount, 0) });
      rows.sort((a, b) => a.date.getTime() - b.date.getTime() || (a.ref === "OPENING" ? -1 : b.ref === "OPENING" ? 1 : a.ref.localeCompare(b.ref)));
    }
  }
  const withBal = rows.map((r) => ((bal += r.in - r.out), { ...r, balance: bal }));
  const moves = rows.filter((r) => r.ref !== "OPENING");
  return { rows: withBal, broughtForward, closing: bal, totalIn: moves.reduce((s, r) => s + r.in, 0), totalOut: moves.reduce((s, r) => s + r.out, 0) };
}

async function movements(u: CurrentUser, method: string, p: Period) {
  const range = { gte: fromIso(p.from), lte: fromIso(p.to) };
  const [payments, expenses, vendorPays, sales] = await Promise.all([
    db.payment.findMany({
      where: { orgId: u.orgId, branchId: { in: u.branchIds }, status: "SUCCESS", method, date: { gte: fromIso(p.from), lte: fromIso(p.to) } },
      include: { member: { select: { name: true } }, invoice: { select: { number: true, id: true } } },
    }),
    db.expense.findMany({
      where: { orgId: u.orgId, branchId: { in: u.branchIds }, status: "ACTIVE", purchaseId: null, method, date: range },
      include: { category: { select: { name: true } } },
    }),
    db.vendorPayment.findMany({
      where: { method, date: range, purchase: { orgId: u.orgId, branchId: { in: u.branchIds }, status: "ACTIVE" } },
      include: { purchase: { select: { id: true, code: true, vendor: true } } },
    }),
    db.asset.findMany({
      where: { orgId: u.orgId, branchId: { in: u.branchIds }, deletedAt: null, status: "SOLD", disposeMethod: method, disposedOn: range, disposedFor: { gt: 0 } },
    }),
  ]);
  return [
    ...payments.map((x) => ({ date: x.date, ref: x.code, text: `${x.member.name} · ${x.invoice.number}`, link: `/invoices/${x.invoice.id}`, in: x.amount, out: 0 })),
    ...expenses.map((x) => ({ date: x.date, ref: x.code, text: `${x.category.name} · ${x.description}`, link: (x.assetId ? `/assets/${x.assetId}` : null) as string | null, in: 0, out: x.amount })),
    ...vendorPays.map((x) => ({ date: x.date, ref: x.code, text: `${x.purchase.vendor} · ${x.purchase.code}`, link: `/purchases/${x.purchase.id}` as string | null, in: 0, out: x.amount })),
    ...sales.map((x) => ({ date: x.disposedOn!, ref: x.code, text: `Sale of ${x.name}`, link: `/assets/${x.id}` as string | null, in: x.disposedFor!, out: 0 })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.ref.localeCompare(b.ref));
}

/** Last 12 months with P&L headline and lock state for the picked branch(es). */
export async function monthOverview(u: CurrentUser, months = 12) {
  const now = todayIso().slice(0, 7);
  const list: string[] = [];
  for (let i = 0; i < months; i++) list.push(addMonths(`${now}-01`, -i).slice(0, 7));
  const locks = await db.monthLock.findMany({ where: { branchId: { in: u.branchIds }, month: { in: list } } });
  const out = [];
  for (const ym of list) {
    const pl = await profitAndLoss(u, monthPeriod(ym));
    const locked = u.branchIds.filter((b) => locks.some((l) => l.branchId === b && l.month === ym));
    out.push({ month: ym, revenue: pl.totalRevenue, expenses: pl.totalExpenses + pl.depreciation + pl.disposalLoss, net: pl.net, collected: pl.collected, lockedBranches: locked.length, branches: u.branchIds.length });
  }
  return out;
}

export async function lockMonth(u: CurrentUser, month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new UserError("Bad month.");
  if (month >= todayIso().slice(0, 7)) throw new UserError("You can only lock a month that has ended.");
  await db.$transaction(async (tx) => {
    for (const branchId of u.branchIds) {
      const exists = await tx.monthLock.findUnique({ where: { branchId_month: { branchId, month } } });
      if (exists) continue;
      const lock = await tx.monthLock.create({ data: { branchId, month, lockedById: u.id, lockedAt: new Date() } });
      await audit(tx, { orgId: u.orgId, userId: u.id, action: "month.lock", entity: "MonthLock", entityId: `${branchId}:${month}`, after: lock });
    }
  });
}

export async function unlockMonth(u: CurrentUser, month: string) {
  await db.$transaction(async (tx) => {
    for (const branchId of u.branchIds) {
      const before = await tx.monthLock.findUnique({ where: { branchId_month: { branchId, month } } });
      if (!before) continue;
      await tx.monthLock.delete({ where: { branchId_month: { branchId, month } } });
      await audit(tx, { orgId: u.orgId, userId: u.id, action: "month.unlock", entity: "MonthLock", entityId: `${branchId}:${month}`, before });
    }
  });
}

export async function listAudit(u: CurrentUser, f: { q?: string; userId?: string; module?: string; severity?: Severity; from?: string; to?: string; page?: number; pageSize?: number }) {
  const pageSize = f.pageSize ?? 50;
  const page = Math.max(1, f.page ?? 1);
  const has = (words: string[]) => words.map((w) => ({ action: { contains: w, mode: "insensitive" as const } }));
  const q = f.q?.trim();
  let qUsers: string[] = [];
  if (q) qUsers = (await db.user.findMany({ where: { orgId: u.orgId, name: { contains: q, mode: "insensitive" } }, select: { id: true } })).map((x) => x.id);
  const jsonHit = (col: "after" | "before") => {
    const up = q?.toUpperCase() ?? "";
    return [
      ...["code", "number", "sku"].map((k) => ({ [col]: { path: [k], string_contains: up } })),
      ...["name", "invoiceNumber"].map((k) => ({ [col]: { path: [k], string_contains: q! } })),
      { [col]: { path: ["invoice", "number"], string_contains: up } },
      { [col]: { path: ["membership", "code"], string_contains: up } },
    ];
  };
  const where: Prisma.AuditLogWhereInput = {
    orgId: u.orgId,
    ...(f.userId === "system" ? { userId: null } : f.userId ? { userId: f.userId } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: istInstant(f.from, "00:00") } : {}), ...(f.to ? { lt: istInstant(addDays(f.to, 1), "00:00") } : {}) } } : {}),
    AND: [
      ...(u.branch !== "ALL" ? [{ OR: [{ branchId: null }, { branchId: { in: u.branchIds } }] }] : []),
      ...(f.module ? [moduleWhere(f.module)] : []),
      ...(q
        ? [
            {
              OR: [
                { action: { contains: q, mode: "insensitive" as const } },
                { entity: { contains: q, mode: "insensitive" as const } },
                { entityId: { contains: q, mode: "insensitive" as const } },
                ...(qUsers.length ? [{ userId: { in: qUsers } }] : []),
                ...jsonHit("after"),
                ...jsonHit("before"),
              ] as Prisma.AuditLogWhereInput[],
            },
          ]
        : []),
      ...(f.severity === "High" ? [{ OR: has(HIGH_WORDS) }] : []),
      ...(f.severity === "Medium" ? [{ NOT: { OR: has(HIGH_WORDS) } }, { OR: has(MEDIUM_WORDS) }] : []),
      ...(f.severity === "Low" ? [{ NOT: { OR: [...has(HIGH_WORDS), ...has(MEDIUM_WORDS)] } }] : []),
    ],
  };
  const [rows, total, users, branches, anySystem] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { id: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    db.auditLog.count({ where }),
    db.user.findMany({ where: { orgId: u.orgId }, select: { id: true, name: true, role: { select: { name: true } } } }),
    db.branch.findMany({ where: { orgId: u.orgId }, select: { id: true, name: true } }),
    db.auditLog.findFirst({ where: { orgId: u.orgId, userId: null }, select: { id: true } }),
  ]);
  const names = new Map(users.map((x) => [x.id, x]));
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  return {
    rows: rows.map((r) => {
      const userName = r.userId ? (names.get(r.userId)?.name ?? "Unknown") : "System";
      const bn = r.branchId ? branchName.get(r.branchId) : undefined;
      const targetBranch = str(obj(r.after).branchId) ? branchName.get(str(obj(r.after).branchId)) : undefined;
      return {
        ...r,
        id: String(r.id),
        userName,
        roleName: r.userId ? (names.get(r.userId)?.role.name ?? "") : "Automatic",
        branchName: r.branchId ? (bn ?? "Deleted branch") : "All branches",
        module: moduleOf(r.entity, r.action),
        severity: severityOf(r.action, r.entity),
        sentence: describeAudit({ action: r.action, entity: r.entity, entityId: r.entityId, before: r.before, after: r.after, extra: { branchName: targetBranch ?? bn, userName } }),
        device: deviceLabel(r.userAgent, r.ip, r.actorType),
      };
    }),
    total,
    page,
    pageSize,
    users,
    hasSystem: !!anySystem,
  };
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");

const METHOD_LIST = ["UPI", "Cash", "Card", "Bank Transfer", "Other"];

/** What is still owed on non-cancelled invoices matching `where`, counting payments up to `upTo` (inclusive). */
async function owed(u: CurrentUser, invoiceDate: { gte?: Date; lte?: Date }, upTo?: string) {
  const invs = await db.invoice.findMany({
    where: { orgId: u.orgId, branchId: { in: u.branchIds }, status: "ISSUED", date: invoiceDate },
    select: { total: true, payments: { where: { status: "SUCCESS", ...(upTo ? { date: { lte: fromIso(upTo) } } : {}) }, select: { amount: true } } },
  });
  return invs.reduce((s, i) => s + Math.max(0, i.total - i.payments.reduce((a, p) => a + p.amount, 0)), 0);
}

/** Money on hand across every method at the end of `upTo`: the cash and bank books' closing balances added up. */
export async function moneyOnHand(u: CurrentUser, upTo: string, method?: string) {
  const opening = await getSetting<{ asOf?: string }>(u.orgId, "opening");
  const from = opening?.asOf && opening.asOf <= upTo ? opening.asOf : "2000-01-01";
  let total = 0;
  for (const m of method ? [method] : METHOD_LIST) total += (await ledger(u, m, { from, to: upTo })).closing;
  return total;
}

/** The P&L's "Reconciliation" column (prototype): what was invoiced, collected and is still owed in the period. */
export async function reconciliation(u: CurrentUser, p: Period) {
  const range = { gte: fromIso(p.from), lte: fromIso(p.to) };
  const [pl, onThese, allOwed, cash, capex] = await Promise.all([
    profitAndLoss(u, p),
    owed(u, range),
    owed(u, {}),
    moneyOnHand(u, p.to, "Cash"),
    db.expense.aggregate({ where: { orgId: u.orgId, branchId: { in: u.branchIds }, status: "ACTIVE", capital: true, date: range }, _sum: { amount: true } }),
  ]);
  const cashIn = pl.collectedByMethod.find((x) => x.key === "Cash")?.amount ?? 0;
  return {
    pl,
    rows: [
      ["Revenue invoiced", pl.totalRevenue],
      ["Tax collected", pl.gstCollected],
      ["Collected in period", pl.collected],
      ["Cash collections", cashIn],
      ["Bank / UPI / card collections", pl.collected - cashIn],
      ["Outstanding on these invoices", onThese],
      ["Total outstanding receivables", allOwed],
      ["Cash in hand (est.)", cash],
      ["Asset purchases (capitalised, not in P&L)", capex._sum.amount ?? 0],
      ["Depreciation charged (non-cash)", pl.depreciation],
    ] as [string, number][],
  };
}

/** The "Month-end closing" summary for one month (prototype), with the lock state across the picked branches. */
export async function monthClose(u: CurrentUser, ym: string) {
  const p = monthPeriod(ym);
  const dayBefore = addDays(p.from, -1);
  const range = { gte: fromIso(p.from), lte: fromIso(p.to) };
  const [pl, opening, closing, receivable, capex, locks] = await Promise.all([
    profitAndLoss(u, p),
    moneyOnHand(u, dayBefore),
    moneyOnHand(u, p.to),
    owed(u, { lte: fromIso(p.to) }, p.to),
    db.expense.aggregate({ where: { orgId: u.orgId, branchId: { in: u.branchIds }, status: "ACTIVE", capital: true, date: range }, _sum: { amount: true } }),
    db.monthLock.count({ where: { branchId: { in: u.branchIds }, month: ym } }),
  ]);
  const by = (m: string) => pl.collectedByMethod.find((x) => x.key === m)?.amount ?? 0;
  return {
    locked: locks === u.branchIds.length,
    partly: locks > 0 && locks < u.branchIds.length,
    rows: [
      ["Opening balance", opening, true],
      ["Total revenue (invoiced)", pl.totalRevenue],
      ["Total collections", pl.collected],
      ["Cash collection", by("Cash")],
      ["UPI collection", by("UPI")],
      ["Bank transfer collection", by("Bank Transfer")],
      ["Card collection", by("Card")],
      ["Other collection", by("Other")],
      ["Outstanding receivables at month end", receivable],
      ["Operating expenses", pl.totalExpenses],
      ["Asset purchases (capitalised)", capex._sum.amount ?? 0],
      ["Depreciation (non-cash)", pl.depreciation],
      ["Net profit", pl.net, true],
      ["Closing balance", closing, true],
    ] as [string, number, boolean?][],
  };
}

export const LEDGERS = ["income", "expense", "payment", "receivable"] as const;
export type LedgerKind = (typeof LEDGERS)[number];

/** The prototype's four ledgers as plain tables. Money columns are paise; reversed payments are flagged. */
export async function ledgerTable(u: CurrentUser, kind: LedgerKind) {
  const scope = { orgId: u.orgId, branchId: { in: u.branchIds } };
  if (kind === "income") {
    const invs = await db.invoice.findMany({ where: { ...scope, status: "ISSUED" }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 120, include: { member: { select: { name: true } }, items: { select: { category: true, amount: true } } } });
    return {
      cols: ["Date", "Invoice", "Member", "Category", "Amount"],
      money: [4],
      rows: invs.flatMap((i) => i.items.map((l) => [i.date, i.number, i.member.name, l.category, l.amount] as (string | number | Date)[])),
      note: "Latest 120 invoices, one row per line item (net of discount, before GST)",
    };
  }
  if (kind === "expense") {
    const ex = await db.expense.findMany({ where: { ...scope, status: "ACTIVE" }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 150, include: { category: { select: { name: true } } } });
    return { cols: ["Date", "Expense", "Category", "Vendor", "Method", "Amount"], money: [5], rows: ex.map((e) => [e.date, e.code, e.category.name, e.vendor ?? "", e.method, e.amount] as (string | number | Date)[]), note: `${ex.length} rows` };
  }
  if (kind === "payment") {
    const ps = await db.payment.findMany({ where: scope, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 150, include: { member: { select: { name: true } }, invoice: { select: { number: true } } } });
    return {
      cols: ["Date", "Payment", "Invoice", "Member", "Method", "Status", "Amount"],
      money: [6],
      rows: ps.map((p) => [p.date, p.code, p.invoice.number, p.member.name, p.method, p.status === "SUCCESS" ? "Success" : "Reversed", p.status === "SUCCESS" ? p.amount : -p.amount] as (string | number | Date)[]),
      note: "Reversed payments stay in the ledger in brackets",
    };
  }
  const invs = await db.invoice.findMany({ where: { ...scope, status: "ISSUED" }, orderBy: { dueDate: "asc" }, include: { member: { select: { name: true } }, payments: { where: { status: "SUCCESS" }, select: { amount: true } } } });
  const rows = invs
    .map((i) => ({ i, paid: i.payments.reduce((a, p) => a + p.amount, 0) }))
    .filter((x) => x.paid < x.i.total)
    .map(({ i, paid }) => [i.number, i.member.name, i.date, i.dueDate, i.total, paid, i.total - paid] as (string | number | Date)[]);
  return { cols: ["Invoice", "Member", "Invoice date", "Due", "Total", "Paid", "Balance"], money: [4, 5, 6], rows, note: `${rows.length} invoices with a balance` };
}
