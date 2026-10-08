import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { writeBranch } from "@/lib/auth/current";
import type { Prisma } from "@/generated/prisma/client";
import type { PosSaleInput, ProductInput } from "@/lib/validation/frontdesk";
import { audit } from "./audit";
import { prefixes, writeInvoice, writePayment, type Line } from "./billing";
import { isUniqueViolation, UserError } from "./errors";
import { assertMonthOpen } from "./locks";
import { memberScope } from "./members";
import { notify } from "./notifications";
import { getTax } from "./tax";
import { nextNumber } from "./sequence";
import { fromIso, todayIso } from "./time";

type Tx = Prisma.TransactionClient;

export const PRODUCT_CATEGORIES = ["Supplements", "Drinks", "Apparel", "Accessories", "Services", "Other"];

const scope = (u: CurrentUser): Prisma.ProductWhereInput => ({ orgId: u.orgId, branchId: { in: u.branchIds } });

export const isLow = (p: { stock: number | null; reorderLevel: number | null }) => p.stock != null && p.reorderLevel != null && p.stock <= p.reorderLevel;

export async function listProducts(u: CurrentUser, f: { q?: string; activeOnly?: boolean } = {}) {
  const q = f.q?.trim();
  return db.product.findMany({
    where: { ...scope(u), ...(f.activeOnly ? { active: true } : {}), ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] } : {}) },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    include: { branch: { select: { name: true } } },
  });
}

export const getProduct = (u: CurrentUser, id: string) => db.product.findFirst({ where: { ...scope(u), id }, include: { movements: { orderBy: { createdAt: "desc" }, take: 30 } } });

export async function saveProduct(u: CurrentUser, id: string | null, input: ProductInput) {
  const branchId = writeBranch(u);
  if (!branchId) throw new UserError("Pick a branch first.");
  const before = id ? await db.product.findFirst({ where: { ...scope(u), id } }) : null;
  if (id && !before) throw new UserError("Product not found.");
  const data = {
    sku: input.sku,
    name: input.name,
    category: input.category,
    price: input.price,
    cost: input.cost,
    gstApplicable: input.gstApplicable,
    reorderLevel: input.trackStock ? (input.reorderLevel ?? null) : null,
  };
  try {
    return await db.$transaction(async (tx) => {
      const after = before
        ? // Turning stock tracking on starts at 0; turning it off forgets the count.
          await tx.product.update({ where: { id: before.id }, data: { ...data, stock: input.trackStock ? (before.stock ?? 0) : null } })
        : await tx.product.create({ data: { ...data, orgId: u.orgId, branchId, stock: input.trackStock ? 0 : null } });
      await audit(tx, { orgId: u.orgId, userId: u.id, action: before ? "product.update" : "product.create", entity: "Product", entityId: after.id, before, after });
      return after;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserError("Another product in this branch has that SKU.", "sku");
    throw e;
  }
}

export async function setProductActive(u: CurrentUser, id: string, active: boolean) {
  const before = await db.product.findFirst({ where: { ...scope(u), id } });
  if (!before) throw new UserError("Product not found.");
  await db.$transaction(async (tx) => {
    const after = await tx.product.update({ where: { id }, data: { active } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: active ? "product.activate" : "product.deactivate", entity: "Product", entityId: id, before, after });
  });
}

/**
 * Stock received (+) or written off (−). Received stock at a new unit cost moves the
 * product's cost to the weighted average.
 */
export async function adjustStock(u: CurrentUser, id: string, a: { qty: number; unitCost?: number; note?: string; vendor?: string; asExpense?: boolean }) {
  const p = await db.product.findFirst({ where: { ...scope(u), id } });
  if (!p) throw new UserError("Product not found.");
  if (p.stock == null) throw new UserError("This product doesn't track stock.");
  if (p.stock + a.qty < 0) throw new UserError(`Only ${p.stock} in stock.`, "qty");
  const asExpense = a.asExpense && a.qty > 0;
  if (asExpense && !a.unitCost) throw new UserError("Enter the cost per unit to record the expense.", "unitCost");
  const category = asExpense ? await db.expenseCategory.findFirst({ where: { name: "Inventory" } }) : null;
  await db.$transaction(async (tx) => {
    const fresh = await tx.product.findUniqueOrThrow({ where: { id } });
    const stock = fresh.stock! + a.qty;
    if (stock < 0) throw new UserError(`Only ${fresh.stock} in stock.`, "qty");
    const cost = a.qty > 0 && a.unitCost != null && stock > 0 ? Math.round((Math.max(fresh.stock!, 0) * fresh.cost + a.qty * a.unitCost) / (Math.max(fresh.stock!, 0) + a.qty)) : fresh.cost;
    const after = await tx.product.update({ where: { id }, data: { stock, cost } });
    let expenseId: string | null = null;
    if (asExpense && category) {
      const today = todayIso();
      await assertMonthOpen(tx, u, p.branchId, today);
      const n = await nextNumber(tx, u.orgId, "expense", 1);
      const e = await tx.expense.create({
        data: { code: `EXP-${n}`, orgId: u.orgId, branchId: p.branchId, date: fromIso(today), categoryId: category.id, description: `Restock ${p.name} × ${a.qty}`, vendor: a.vendor ?? null, amount: a.qty * a.unitCost!, method: "Bank Transfer", createdById: u.id },
      });
      await audit(tx, { orgId: u.orgId, userId: u.id, action: "expense.create", entity: "Expense", entityId: e.id, after: e });
      expenseId = e.id;
    }
    await tx.stockMovement.create({ data: { productId: id, qty: a.qty, reason: a.qty > 0 ? "RESTOCK" : "ADJUST", unitCost: a.unitCost ?? null, note: a.note ?? a.vendor ?? null, expenseId, createdById: u.id } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "product.stock", entity: "Product", entityId: id, before: fresh, after });
  });
}

/** The branch's "Walk-in customer", created the first time it's needed. */
async function walkInMember(tx: Tx, u: CurrentUser, branchId: string) {
  const found = await tx.member.findFirst({ where: { orgId: u.orgId, branchId, walkIn: true, deletedAt: null } });
  if (found) return found;
  return tx.member.create({
    data: { orgId: u.orgId, branchId, walkIn: true, code: `WALKIN-${branchId.slice(-6).toUpperCase()}`, name: "Walk-in customer", gender: "Other", phone: "", source: "Walk-in", tags: [], createdById: u.id },
  });
}

/**
 * A counter sale: one GST invoice, paid in full, with stock taken off each tracked product,
 * all in one transaction. Stock can't go below zero.
 */
export async function posSale(u: CurrentUser, input: PosSaleInput) {
  const member = input.memberId ? await db.member.findFirst({ where: { ...memberScope(u), id: input.memberId, walkIn: false } }) : null;
  if (input.memberId && !member) throw new UserError("Member not found.", "memberId");
  const branchId = member?.branchId ?? writeBranch(u);
  if (!branchId) throw new UserError("Pick a branch first.");
  const qty = new Map<string, number>();
  for (const i of input.items) qty.set(i.productId, (qty.get(i.productId) ?? 0) + i.qty);
  const products = await db.product.findMany({ where: { ...scope(u), branchId, active: true, id: { in: [...qty.keys()] } } });
  if (products.length !== qty.size) throw new UserError("Some items aren't sold at this branch. Refresh and try again.");
  const tax = await getTax(u.orgId);
  const lines: Line[] = products.map((p) => ({ description: p.name, category: p.category === "Services" ? "Other" : "Product", qty: qty.get(p.id)!, rate: p.price, discount: 0, taxRate: tax.enabled && p.gstApplicable ? tax.rate : 0, productId: p.id }));
  const pre = await prefixes(u.orgId);
  const today = todayIso();

  return db.$transaction(async (tx) => {
    await assertMonthOpen(tx, u, branchId, today);
    for (const p of products) {
      if (p.stock == null) continue;
      const n = qty.get(p.id)!;
      const r = await tx.product.updateMany({ where: { id: p.id, stock: { gte: n } }, data: { stock: { decrement: n } } });
      if (r.count === 0) {
        const left = (await tx.product.findUnique({ where: { id: p.id }, select: { stock: true } }))?.stock ?? 0;
        throw new UserError(`Only ${left} ${p.name} left in stock.`);
      }
    }
    const buyer = member ?? (await walkInMember(tx, u, branchId));
    const invoice = await writeInvoice(tx, u, { branchId, memberId: buyer.id, date: today, dueDate: today, lines, prefix: pre.invoice, tax });
    const payment = await writePayment(tx, u, { branchId, memberId: buyer.id, invoiceId: invoice.id, date: today, amount: invoice.total, method: input.method, txnRef: input.txnRef, notes: "Counter sale", prefix: pre.payment });
    for (const p of products) {
      if (p.stock == null) continue;
      const item = invoice.items.find((i) => i.productId === p.id)!;
      const n = qty.get(p.id)!;
      await tx.stockMovement.create({ data: { productId: p.id, qty: -n, reason: "SALE", invoiceItemId: item.id, unitCost: p.cost, createdById: u.id } });
      if (p.reorderLevel != null && p.stock - n <= p.reorderLevel && p.stock > p.reorderLevel) {
        await notify(tx, { orgId: u.orgId, branchId, type: "LOW_STOCK", text: `${p.name} is down to ${p.stock - n}.`, link: `/products/${p.id}` });
      }
    }
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "pos.sale", entity: "Invoice", entityId: invoice.id, after: { invoice, payment } });
    return invoice;
  });
}

/** Units of each product sold since a date (the Inventory table's "Sold (30 d)"); cancelled invoices don't count. */
export async function soldSince(productIds: string[], from: string) {
  const rows = await db.invoiceItem.groupBy({ by: ["productId"], where: { productId: { in: productIds }, invoice: { status: "ISSUED", date: { gte: fromIso(from) } } }, _sum: { qty: true } });
  return new Map(rows.map((r) => [r.productId!, r._sum.qty ?? 0]));
}
