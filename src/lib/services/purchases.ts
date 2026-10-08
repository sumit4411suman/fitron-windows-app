import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { writeBranch } from "@/lib/auth/current";
import type { Prisma } from "@/generated/prisma/client";
import { depDefault } from "@/lib/domain/assets";
import { lineAmount, NEW_PRODUCT, type PurchaseInput, type VendorPayInput } from "@/lib/validation/assets";
import { writeAsset } from "./assets";
import { audit } from "./audit";
import { UserError } from "./errors";
import { assertMonthOpen } from "./locks";
import { nextNumber } from "./sequence";
import { fromIso, toIso, todayIso } from "./time";

type Tx = Prisma.TransactionClient;

export const CREDIT = "Credit";
const INVENTORY_CATEGORY = "inventory";

const scope = (u: CurrentUser): Prisma.PurchaseWhereInput => ({ orgId: u.orgId, branchId: { in: u.branchIds } });

const paidOf = (p: { payments: { amount: number }[] }) => p.payments.reduce((s, x) => s + x.amount, 0);

export async function listPurchases(u: CurrentUser, f: { q?: string; show?: "payable" | "cancelled" | "" }) {
  const q = f.q?.trim();
  const rows = await db.purchase.findMany({
    where: {
      ...scope(u),
      status: f.show === "cancelled" ? "CANCELLED" : "ACTIVE",
      ...(q ? { OR: [{ vendor: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, { billNo: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: { payments: { select: { amount: true } }, lines: { select: { type: true, description: true, qty: true, rate: true, gstPct: true, amount: true } }, branch: { select: { name: true } } },
  });
  const out = rows.map((p) => ({ ...p, paid: paidOf(p), balance: p.total - paidOf(p) }));
  return f.show === "payable" ? out.filter((p) => p.balance > 0) : out;
}

/** What the gym owes suppliers, oldest bill first. */
export async function payables(u: CurrentUser) {
  const rows = (await listPurchases(u, { show: "payable" })).sort((a, b) => a.date.getTime() - b.date.getTime());
  const today = todayIso();
  return rows.map((p) => ({ ...p, ageDays: Math.round((fromIso(today).getTime() - p.date.getTime()) / 86_400_000) }));
}

export async function getPurchase(u: CurrentUser, id: string) {
  const p = await db.purchase.findFirst({
    where: { ...scope(u), id },
    include: { lines: true, payments: { orderBy: { date: "asc" } }, expenses: { select: { id: true, code: true, method: true, amount: true, status: true, capital: true } }, branch: { select: { name: true } } },
  });
  if (!p) return null;
  const productIds = p.lines.map((l) => l.productId).filter((x): x is string => !!x);
  const assetIds = p.lines.map((l) => l.assetId).filter((x): x is string => !!x);
  const catIds = [...new Set(p.lines.filter((l) => l.type === "EXPENSE" && l.category).map((l) => l.category as string))];
  const [products, assets, categories] = await Promise.all([
    db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, sku: true } }),
    db.asset.findMany({ where: { id: { in: assetIds } }, select: { id: true, code: true, name: true } }),
    db.expenseCategory.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true } }),
  ]);
  return { ...p, paid: paidOf(p), balance: p.total - paidOf(p), products, assets, categories };
}

/** Stock the branch can receive against a bill. */
export const stockProducts = (u: CurrentUser, branchId: string) =>
  db.product.findMany({ where: { orgId: u.orgId, branchId, active: true, stock: { not: null } }, orderBy: { name: "asc" }, select: { id: true, name: true, sku: true, cost: true } });

async function writeExpense(tx: Tx, u: CurrentUser, d: { branchId: string; date: Date; categoryId: string; description: string; vendor: string; amount: number; method: string; billNo: string | null; notes: string; purchaseId: string; capital?: boolean }) {
  const n = await nextNumber(tx, u.orgId, "expense", 1);
  const e = await tx.expense.create({ data: { code: `EXP-${n}`, orgId: u.orgId, createdById: u.id, ...d } });
  await audit(tx, { orgId: u.orgId, userId: u.id, action: "expense.create", entity: "Expense", entityId: e.id, after: e });
  return e;
}

/**
 * Rule 13. One bill, three kinds of line: STOCK goes into product stock (weighted-average cost),
 * ASSET goes to the register with a capital expense, EXPENSE is an ordinary expense.
 * The GST-inclusive amount is the cost booked. Expenses on a bill with a balance take method Credit
 * until it is settled; the cash book follows the supplier payments.
 */
export async function createPurchase(u: CurrentUser, input: PurchaseInput) {
  const branchId = writeBranch(u);
  if (!branchId) throw new UserError("Pick a branch first.");
  if (input.date > todayIso()) throw new UserError("The bill date can't be in the future.", "date");
  const lines = input.lines.map((l) => ({ ...l, amount: lineAmount(l) }));
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const paid = input.paid === "full" ? total : input.paid === "none" ? 0 : input.paidAmount!;
  if (paid > total) throw new UserError("Paid is more than the bill total.", "paidAmount");
  const expenseMethod = paid >= total ? input.method : CREDIT;

  const categoryIds = [...new Set(lines.filter((l) => l.type === "EXPENSE").map((l) => l.ref))];
  if (categoryIds.length && (await db.expenseCategory.count({ where: { id: { in: categoryIds } } })) !== categoryIds.length) throw new UserError("Pick an expense category for each expense line.");
  const productIds = [...new Set(lines.filter((l) => l.type === "STOCK" && l.ref !== NEW_PRODUCT).map((l) => l.ref))];
  const products = await db.product.findMany({ where: { orgId: u.orgId, branchId, id: { in: productIds }, stock: { not: null } } });
  if (products.length !== productIds.length) throw new UserError("Some products aren't stocked at this branch. Refresh and try again.");
  const newSkus = lines.filter((l) => l.type === "STOCK" && l.ref === NEW_PRODUCT).map((l) => l.newSku!.toUpperCase());
  if (new Set(newSkus).size !== newSkus.length) throw new UserError("Two new products have the same SKU.");
  if (newSkus.length && (await db.product.count({ where: { branchId, sku: { in: newSkus } } }))) throw new UserError("A product with that SKU already exists. Pick it from the list instead.");

  return db.$transaction(async (tx) => {
    await assertMonthOpen(tx, u, branchId, input.date);
    const n = await nextNumber(tx, u.orgId, "purchase", 1001);
    const date = fromIso(input.date);
    const purchase = await tx.purchase.create({
      data: { orgId: u.orgId, branchId, code: `PUR-${n}`, date, vendor: input.vendor, billNo: input.billNo ?? null, notes: input.notes ?? null, total, createdById: u.id },
    });
    const base = { branchId, date, vendor: input.vendor, method: expenseMethod, billNo: input.billNo ?? null, purchaseId: purchase.id };

    for (const l of lines) {
      let productId: string | null = null;
      let assetId: string | null = null;
      let expenseId: string | null = null;
      if (l.type === "STOCK") {
        const unitCost = Math.round(l.amount / l.qty);
        let prod = l.ref === NEW_PRODUCT ? null : await tx.product.findUniqueOrThrow({ where: { id: l.ref } });
        if (!prod) {
          prod = await tx.product.create({ data: { orgId: u.orgId, branchId, sku: l.newSku!.toUpperCase(), name: l.description, category: "Other", price: l.newPrice!, cost: unitCost, stock: 0 } });
          await audit(tx, { orgId: u.orgId, userId: u.id, action: "product.create", entity: "Product", entityId: prod.id, after: prod });
        }
        const stockBefore = Math.max(prod.stock ?? 0, 0);
        const stock = (prod.stock ?? 0) + l.qty;
        const cost = Math.round((stockBefore * prod.cost + l.qty * unitCost) / (stockBefore + l.qty));
        const after = await tx.product.update({ where: { id: prod.id }, data: { stock, cost } });
        const e = await writeExpense(tx, u, { ...base, categoryId: INVENTORY_CATEGORY, description: `Purchase · ${l.description} × ${l.qty}`, amount: l.amount, notes: purchase.code });
        await tx.stockMovement.create({ data: { productId: prod.id, qty: l.qty, reason: "RESTOCK", unitCost, note: `${purchase.code} · ${input.vendor}`, expenseId: e.id, createdById: u.id } });
        await audit(tx, { orgId: u.orgId, userId: u.id, action: "product.stock", entity: "Product", entityId: prod.id, before: prod, after });
        productId = prod.id;
        expenseId = e.id;
      } else if (l.type === "ASSET") {
        const [rate, life] = depDefault(l.ref);
        const a = await writeAsset(
          tx,
          u,
          branchId,
          { name: l.description, category: l.ref, qty: l.qty, vendor: input.vendor, purchaseDate: date, cost: l.amount, salvage: 0, method: "WDV", rate, life, serial: null, billNo: input.billNo ?? null, notes: `From purchase ${purchase.code}`, purchaseId: purchase.id },
          { method: expenseMethod, purchaseId: purchase.id },
        );
        assetId = a.id;
        expenseId = a.expenseId;
      } else {
        const e = await writeExpense(tx, u, { ...base, categoryId: l.ref, description: l.description + (l.qty > 1 ? ` × ${l.qty}` : ""), amount: l.amount, notes: purchase.code });
        expenseId = e.id;
      }
      await tx.purchaseLine.create({
        data: { purchaseId: purchase.id, type: l.type, description: l.description, category: l.type === "STOCK" ? null : l.ref, productId, assetId, expenseId, qty: l.qty, rate: l.rate, gstPct: l.gstPct, amount: l.amount },
      });
    }
    if (paid > 0) await writeVendorPayment(tx, u, purchase.id, { date: input.date, amount: paid, method: input.method });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "purchase.create", entity: "Purchase", entityId: purchase.id, after: { ...purchase, lines, paid } });
    return purchase;
  });
}

async function writeVendorPayment(tx: Tx, u: CurrentUser, purchaseId: string, p: { date: string; amount: number; method: string; reference?: string }) {
  const n = await nextNumber(tx, u.orgId, "vendorPayment", 1001);
  const vp = await tx.vendorPayment.create({ data: { purchaseId, code: `VP-${n}`, date: fromIso(p.date), amount: p.amount, method: p.method, reference: p.reference ?? null, createdById: u.id } });
  await audit(tx, { orgId: u.orgId, userId: u.id, action: "purchase.pay", entity: "Purchase", entityId: purchaseId, after: vp });
  return vp;
}

/** Pay a supplier against a bill. When the bill is settled, its Credit expenses move to the settling method. */
export async function payVendor(u: CurrentUser, id: string, input: VendorPayInput) {
  const p = await db.purchase.findFirst({ where: { ...scope(u), id }, include: { payments: true } });
  if (!p) throw new UserError("Purchase not found.");
  if (p.status !== "ACTIVE") throw new UserError("This bill was cancelled.");
  if (input.date < toIso(p.date)) throw new UserError("That's before the bill date.", "date");
  if (input.date > todayIso()) throw new UserError("The date can't be in the future.", "date");
  return db.$transaction(async (tx) => {
    // Lock the bill so two payments can't both clear the same balance.
    await tx.$queryRaw`SELECT id FROM "Purchase" WHERE id = ${id} FOR UPDATE`;
    const paid = (await tx.vendorPayment.aggregate({ where: { purchaseId: id }, _sum: { amount: true } }))._sum.amount ?? 0;
    const balance = p.total - paid;
    if (input.amount > balance) throw new UserError(`That's more than the balance of ₹${(balance / 100).toLocaleString("en-IN")}.`, "amount");
    await assertMonthOpen(tx, u, p.branchId, input.date);
    const vp = await writeVendorPayment(tx, u, id, input);
    if (input.amount === balance) {
      const credit = await tx.expense.findMany({ where: { purchaseId: id, method: CREDIT } });
      for (const e of credit) {
        const after = await tx.expense.update({ where: { id: e.id }, data: { method: input.method } });
        await audit(tx, { orgId: u.orgId, userId: u.id, action: "expense.update", entity: "Expense", entityId: e.id, before: e, after });
      }
      await tx.asset.updateMany({ where: { purchaseId: id, payMethod: CREDIT }, data: { payMethod: input.method } });
    }
    return vp;
  });
}

/**
 * Cancel a bill entered by mistake or returned: expenses are voided, stock taken back out,
 * assets removed. Money already paid is treated as refunded.
 */
export async function cancelPurchase(u: CurrentUser, id: string, reason: string) {
  const p = await db.purchase.findFirst({ where: { ...scope(u), id }, include: { lines: true } });
  if (!p) throw new UserError("Purchase not found.");
  if (p.status !== "ACTIVE") throw new UserError("Already cancelled.");
  await db.$transaction(async (tx) => {
    await assertMonthOpen(tx, u, p.branchId, toIso(p.date));
    for (const l of p.lines) {
      if (l.type === "STOCK" && l.productId) {
        const prod = await tx.product.findUniqueOrThrow({ where: { id: l.productId } });
        if ((prod.stock ?? 0) < l.qty) throw new UserError(`Only ${prod.stock} of ${prod.name} left, so this bill's ${l.qty} can't be taken back out. Adjust the stock first.`);
        const after = await tx.product.update({ where: { id: prod.id }, data: { stock: (prod.stock ?? 0) - l.qty } });
        await tx.stockMovement.create({ data: { productId: prod.id, qty: -l.qty, reason: "ADJUST", note: `${p.code} cancelled`, createdById: u.id } });
        await audit(tx, { orgId: u.orgId, userId: u.id, action: "product.stock", entity: "Product", entityId: prod.id, before: prod, after });
      }
      if (l.type === "ASSET" && l.assetId) {
        const a = await tx.asset.findUniqueOrThrow({ where: { id: l.assetId } });
        if (a.status !== "IN_USE") throw new UserError(`${a.code} has been sold or scrapped. Undo that first.`);
        const after = await tx.asset.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
        await audit(tx, { orgId: u.orgId, userId: u.id, action: "asset.remove", entity: "Asset", entityId: a.id, before: a, after });
      }
    }
    const expenses = await tx.expense.findMany({ where: { purchaseId: id, status: "ACTIVE" } });
    for (const e of expenses) {
      const after = await tx.expense.update({ where: { id: e.id }, data: { status: "VOID", voidReason: `${p.code} cancelled: ${reason}` } });
      await audit(tx, { orgId: u.orgId, userId: u.id, action: "expense.void", entity: "Expense", entityId: e.id, before: e, after });
    }
    const after = await tx.purchase.update({ where: { id }, data: { status: "CANCELLED", cancelReason: reason } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "purchase.cancel", entity: "Purchase", entityId: id, before: p, after });
  });
}

/** Supplier names already used, for the vendor box. */
export async function vendorNames(u: CurrentUser) {
  const rows = await db.purchase.findMany({ where: scope(u), distinct: ["vendor"], select: { vendor: true }, orderBy: { vendor: "asc" }, take: 200 });
  return rows.map((r) => r.vendor);
}
