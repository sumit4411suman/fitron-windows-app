import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import type { Prisma } from "@/generated/prisma/client";
import { invoiceState, invoiceTotals, lineTaxes, type InvoiceLine } from "@/lib/domain/billing";
import { addDays, membershipEndDate } from "@/lib/domain/dates";
import type { InvoiceInput, PaymentInput, SellInput } from "@/lib/validation/billing";
import { audit } from "./audit";
import { takeOfferUse, usableOffer } from "./offers";
import { offerDiscount } from "@/lib/domain/offers";
import { UserError } from "./errors";
import { assertMonthOpen } from "./locks";
import { memberScope } from "./members";
import { nextNumber } from "./sequence";
import { getSetting } from "./settings";
import { getTax, type TaxSetting } from "./tax";
import { fromIso, toIso, todayIso } from "./time";
import { assertBranchWritable } from "./saas";

type Tx = Prisma.TransactionClient;

export type Line = InvoiceLine & { description: string; category: string; planId?: string | null; productId?: string | null };

export async function prefixes(orgId: string) {
  const n = (await getSetting<{ invoicePrefix?: string; paymentPrefix?: string }>(orgId, "numbering")) ?? {};
  return { invoice: n.invoicePrefix ?? "INV-", payment: n.paymentPrefix ?? "PAY-" };
}

/** The number the next invoice will get, without taking it (nextNumber burns one). */
export async function nextInvoiceNumber(orgId: string) {
  return (await db.sequence.findUnique({ where: { orgId_name: { orgId, name: "invoice" } } }))?.next ?? 1001;
}

async function findMember(u: CurrentUser, memberId: string) {
  const m = await db.member.findFirst({ where: { ...memberScope(u), id: memberId } });
  if (!m) throw new UserError("Member not found.");
  return m;
}

/** Writes an invoice with its lines. Totals are computed here and stored once (rule 3). */
export async function writeInvoice(
  tx: Tx,
  u: CurrentUser,
  a: { branchId: string; memberId: string; date: string; dueDate: string; lines: Line[]; prefix: string; tax: TaxSetting },
) {
  await assertBranchWritable(tx, u.orgId, a.branchId);
  const tax = a.tax;
  const t = invoiceTotals(a.lines);
  // The lines carry the invoice's own tax, split so they add back up to it (rule 3).
  const itemTax = lineTaxes(a.lines, t.tax);
  const n = await nextNumber(tx, u.orgId, "invoice");
  const br = await tx.branch.findFirst({ where: { orgId: u.orgId, id: a.branchId }, select: { invoicePrefix: true } });
  const prefix = br?.invoicePrefix || a.prefix;
  return tx.invoice.create({
    data: {
      orgId: u.orgId,
      branchId: a.branchId,
      memberId: a.memberId,
      number: `${prefix}${n}`,
      date: fromIso(a.date),
      dueDate: fromIso(a.dueDate),
      ...t,
      gstType: t.tax > 0 ? tax.type : null,
      gstRate: t.tax > 0 ? tax.rate : null,
      status: "ISSUED",
      createdById: u.id,
      items: {
        create: a.lines.map((l, i) => {
          const net = l.qty * l.rate - l.discount;
          return {
            description: l.description,
            qty: l.qty,
            rate: l.rate,
            discount: l.discount,
            taxRate: l.taxRate,
            taxAmount: itemTax[i]!,
            amount: net,
            category: l.category,
            planId: l.planId ?? null,
            productId: l.productId ?? null,
          };
        }),
      },
    },
    include: { items: true },
  });
}

export async function writePayment(
  tx: Tx,
  u: CurrentUser,
  a: { branchId: string; memberId: string; invoiceId: string; date: string; amount: number; method: string; txnRef?: string; notes?: string; prefix: string },
) {
  const n = await nextNumber(tx, u.orgId, "payment", 5001);
  return tx.payment.create({
    data: {
      orgId: u.orgId,
      branchId: a.branchId,
      memberId: a.memberId,
      invoiceId: a.invoiceId,
      code: `${a.prefix}${n}`,
      date: fromIso(a.date),
      amount: a.amount,
      method: a.method,
      txnRef: a.txnRef ?? null,
      notes: a.notes ?? null,
      receivedById: u.id,
    },
  });
}

/** Default start for a sale: the day after the current membership ends, or today if it already ended. */
export async function suggestedStart(memberId: string, today = todayIso()) {
  const last = await db.membership.findFirst({ where: { memberId, status: "VALID" }, orderBy: { endDate: "desc" } });
  if (!last) return { start: today, isNew: true };
  const end = toIso(last.endDate);
  return { start: end >= today ? addDays(end, 1) : today, isNew: false };
}

/**
 * Rule 1: a sale or renewal always creates a new Membership + Invoice (+ Payment if collected now),
 * in one transaction. Nothing is overwritten.
 */
export async function sellMembership(u: CurrentUser, memberId: string, input: SellInput, opts: { type?: "AUTOPAY" } = {}) {
  const member = await findMember(u, memberId);
  const plan = await db.membershipPlan.findFirst({ where: { orgId: u.orgId, id: input.planId, status: "ACTIVE" }, include: { prices: true } });
  if (!plan) throw new UserError("Pick an active plan.", "planId");
  // Category prices (Female, Student…) replace the standard price when the plan has one.
  const category = input.pricingCategory && input.pricingCategory !== "Standard" ? plan.prices.find((x) => x.category === input.pricingCategory) : undefined;
  if (input.pricingCategory && input.pricingCategory !== "Standard" && !category) throw new UserError(`${plan.name} has no ${input.pricingCategory} price.`, "pricingCategory");
  const price = category?.price ?? plan.price;
  const tax = await getTax(u.orgId);
  const taxRate = tax.enabled && plan.gstApplicable ? tax.rate : 0;
  const { isNew } = await suggestedStart(memberId);
  if (input.discount > price) throw new UserError("The discount is more than the plan price.", "discount");
  // An offer code adds its discount on the plan price (Plans & offers); the total never goes below zero.
  const offer = input.offerCode ? await usableOffer(u.orgId, input.offerCode) : null;
  const discount = Math.min(price, input.discount + (offer ? offerDiscount(offer, price) : 0));

  const lines: Line[] = [
    { description: `${plan.name} membership (${plan.months} ${plan.months === 1 ? "month" : "months"})`, category: isNew ? "New Membership" : "Renewal", qty: 1, rate: price, discount, taxRate, planId: plan.id },
  ];
  if (input.includeRegFee && plan.regFee > 0) lines.push({ description: "Registration fee", category: "Registration", qty: 1, rate: plan.regFee, discount: 0, taxRate });
  const total = invoiceTotals(lines).total;
  if (input.payAmount > total) throw new UserError("The payment is more than the invoice total.", "payAmount");

  const endDate = membershipEndDate(input.startDate, plan.months);
  const today = todayIso();
  const p = await prefixes(u.orgId);

  return db.$transaction(async (tx) => {
    await assertMonthOpen(tx, u, member.branchId, today);
    const invoice = await writeInvoice(tx, u, { branchId: member.branchId, memberId, date: today, dueDate: today, lines, prefix: p.invoice, tax });
    const msNo = await nextNumber(tx, u.orgId, "membership", 1);
    const membership = await tx.membership.create({
      data: {
        code: `MS-${msNo}`,
        memberId,
        planId: plan.id,
        branchId: member.branchId,
        type: opts.type ?? (isNew ? "NEW" : "RENEWAL"),
        startDate: fromIso(input.startDate),
        endDate: fromIso(endDate),
        price,
        discount,
        pricingCategory: category?.category ?? "Standard",
        offerCode: offer?.code ?? null,
        invoiceId: invoice.id,
      },
    });
    if (offer) await takeOfferUse(tx, offer.id);
    let payment = null;
    if (input.payAmount > 0) {
      payment = await writePayment(tx, u, {
        branchId: member.branchId,
        memberId,
        invoiceId: invoice.id,
        date: today,
        amount: input.payAmount,
        method: input.payMethod!,
        txnRef: input.payRef,
        prefix: p.payment,
      });
    }
    await audit(tx, { orgId: u.orgId, userId: u.id, action: isNew ? "membership.create" : "membership.renew", entity: "Membership", entityId: membership.id, after: { membership, invoice, payment } });
    return { membership, invoice, payment };
  });
}

/** A standalone invoice for PT, products or other charges. */
export async function createInvoice(u: CurrentUser, input: InvoiceInput) {
  const member = await findMember(u, input.memberId);
  const tax = await getTax(u.orgId);
  const lines: Line[] = input.lines.map((l) => ({ ...l, taxRate: tax.enabled && l.taxable ? tax.rate : 0 }));
  for (const l of lines) if (l.discount > l.qty * l.rate) throw new UserError(`The discount on "${l.description}" is more than its amount.`);
  const total = invoiceTotals(lines).total;
  if (input.payAmount > total) throw new UserError("The payment is more than the invoice total.", "payAmount");
  if (input.dueDate < input.date) throw new UserError("The due date is before the invoice date.", "dueDate");
  const p = await prefixes(u.orgId);

  return db.$transaction(async (tx) => {
    await assertMonthOpen(tx, u, member.branchId, input.date);
    const invoice = await writeInvoice(tx, u, { branchId: member.branchId, memberId: member.id, date: input.date, dueDate: input.dueDate, lines, prefix: p.invoice, tax });
    let payment = null;
    if (input.payAmount > 0) {
      payment = await writePayment(tx, u, { branchId: member.branchId, memberId: member.id, invoiceId: invoice.id, date: input.date, amount: input.payAmount, method: input.payMethod!, txnRef: input.payRef, prefix: p.payment });
    }
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "invoice.create", entity: "Invoice", entityId: invoice.id, after: { invoice, payment } });
    return invoice;
  });
}

const invoiceScope = (u: CurrentUser): Prisma.InvoiceWhereInput => ({ orgId: u.orgId, branchId: { in: u.branchIds } });

export async function getInvoice(u: CurrentUser, id: string) {
  const inv = await db.invoice.findFirst({
    where: { ...invoiceScope(u), id },
    include: {
      items: true,
      payments: { orderBy: { createdAt: "asc" } },
      member: true,
      branch: true,
      membership: { include: { plan: { select: { name: true } } } },
      org: true,
    },
  });
  if (!inv) return null;
  const state = invoiceState(
    { total: inv.total, cancelled: inv.status === "CANCELLED", dueDate: toIso(inv.dueDate) },
    inv.payments as { amount: number; status: "SUCCESS" | "REVERSED" }[],
    todayIso(),
  );
  const staffIds = [...new Set([inv.createdById, ...inv.payments.map((p) => p.receivedById)])];
  const staff = new Map((await db.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
  return { ...inv, ...state, staffName: (id: string) => staff.get(id) ?? "—" };
}

/** Rule 3: every payment belongs to an invoice and can't exceed its balance. */
export async function collectPayment(u: CurrentUser, invoiceId: string, input: PaymentInput) {
  const inv = await getInvoice(u, invoiceId);
  if (!inv) throw new UserError("Invoice not found.");
  if (inv.status === "CANCELLED") throw new UserError("This invoice is cancelled.");
  if (input.amount > inv.balance) throw new UserError(`The balance is only ₹${(inv.balance / 100).toLocaleString("en-IN")}.`, "amount");
  const p = await prefixes(u.orgId);
  return db.$transaction(async (tx) => {
    await assertMonthOpen(tx, u, inv.branchId, input.date);
    // Re-check the balance inside the transaction so two quick collections can't overpay.
    const paid = await tx.payment.aggregate({ where: { invoiceId, status: "SUCCESS" }, _sum: { amount: true } });
    if (input.amount > inv.total - (paid._sum.amount ?? 0)) throw new UserError("Someone just collected part of this. Refresh and try again.");
    const payment = await writePayment(tx, u, { branchId: inv.branchId, memberId: inv.memberId, invoiceId, date: input.date, amount: input.amount, method: input.method, txnRef: input.txnRef, notes: input.notes, prefix: p.payment });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "payment.create", entity: "Payment", entityId: payment.id, after: { ...payment, invoiceNumber: inv.number } });
    return payment;
  });
}

/** Rule 2: payments are reversed with a reason, never deleted. */
export async function reversePayment(u: CurrentUser, paymentId: string, reason: string) {
  const before = await db.payment.findFirst({ where: { orgId: u.orgId, branchId: { in: u.branchIds }, id: paymentId } });
  if (!before) throw new UserError("Payment not found.");
  if (before.status === "REVERSED") throw new UserError("This payment is already reversed.");
  const inv = await db.invoice.findUnique({ where: { id: before.invoiceId }, select: { number: true } });
  await db.$transaction(async (tx) => {
    await assertMonthOpen(tx, u, before.branchId, toIso(before.date));
    const after = await tx.payment.update({ where: { id: paymentId }, data: { status: "REVERSED", reversedById: u.id, reversedAt: new Date(), reverseReason: reason } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "payment.reverse", entity: "Payment", entityId: paymentId, before: { ...before, invoiceNumber: inv?.number }, after: { ...after, invoiceNumber: inv?.number } });
  });
}

/** Rule 2: invoices are cancelled with a reason. Their payments are reversed and the membership cancelled. */
export async function cancelInvoice(u: CurrentUser, invoiceId: string, reason: string) {
  const before = await db.invoice.findFirst({ where: { ...invoiceScope(u), id: invoiceId }, include: { payments: true, membership: true } });
  if (!before) throw new UserError("Invoice not found.");
  if (before.status === "CANCELLED") throw new UserError("This invoice is already cancelled.");
  await db.$transaction(async (tx) => {
    await assertMonthOpen(tx, u, before.branchId, toIso(before.date));
    const now = new Date();
    await tx.payment.updateMany({
      where: { invoiceId, status: "SUCCESS" },
      data: { status: "REVERSED", reversedById: u.id, reversedAt: now, reverseReason: `Invoice cancelled: ${reason}` },
    });
    if (before.membership) await tx.membership.update({ where: { id: before.membership.id }, data: { status: "CANCELLED" } });
    // Counter-sale items go back on the shelf.
    const sold = await tx.stockMovement.findMany({ where: { reason: "SALE", invoiceItemId: { in: (await tx.invoiceItem.findMany({ where: { invoiceId }, select: { id: true } })).map((i) => i.id) } } });
    for (const m of sold) {
      await tx.product.updateMany({ where: { id: m.productId, stock: { not: null } }, data: { stock: { increment: -m.qty } } });
      await tx.stockMovement.create({ data: { productId: m.productId, qty: -m.qty, reason: "RETURN", invoiceItemId: m.invoiceItemId, note: `Invoice cancelled: ${reason}`, createdById: u.id } });
    }
    const after = await tx.invoice.update({ where: { id: invoiceId }, data: { status: "CANCELLED", cancelReason: reason, cancelledById: u.id, cancelledAt: now } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "invoice.cancel", entity: "Invoice", entityId: invoiceId, before, after });
  });
}

export type InvoiceRow = Awaited<ReturnType<typeof listInvoices>>["rows"][number];

export async function listInvoices(u: CurrentUser, f: { q?: string; status?: string; memberId?: string; from?: string; to?: string; openOnly?: boolean }) {
  const q = f.q?.trim();
  const invoices = await db.invoice.findMany({
    where: {
      ...invoiceScope(u),
      ...(f.memberId ? { memberId: f.memberId } : {}),
      ...(f.openOnly ? { status: "ISSUED" } : {}),
      ...(f.from || f.to ? { date: { ...(f.from ? { gte: fromIso(f.from) } : {}), ...(f.to ? { lte: fromIso(f.to) } : {}) } } : {}),
      ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { member: { name: { contains: q, mode: "insensitive" } } }, { member: { phone: { contains: q } } }] } : {}),
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: f.openOnly || f.memberId ? undefined : 500,
    include: {
      member: { select: { id: true, name: true, code: true, phone: true } },
      payments: { select: { amount: true, status: true } },
      items: { select: { description: true, productId: true } },
    },
  });
  const today = todayIso();
  let rows = invoices.map((i) => ({
    ...i,
    ...invoiceState({ total: i.total, cancelled: i.status === "CANCELLED", dueDate: toIso(i.dueDate) }, i.payments as { amount: number; status: "SUCCESS" | "REVERSED" }[], today),
  }));
  if (f.status === "OVERDUE") rows = rows.filter((r) => r.overdueDays > 0);
  else if (f.status) rows = rows.filter((r) => r.status === f.status);
  return { rows };
}

export async function listPayments(u: CurrentUser, f: { q?: string; method?: string; from?: string; to?: string; memberId?: string }) {
  const q = f.q?.trim();
  return db.payment.findMany({
    where: {
      orgId: u.orgId,
      branchId: { in: u.branchIds },
      ...(f.memberId ? { memberId: f.memberId } : {}),
      ...(f.method ? { method: f.method } : {}),
      ...(f.from || f.to ? { date: { ...(f.from ? { gte: fromIso(f.from) } : {}), ...(f.to ? { lte: fromIso(f.to) } : {}) } } : {}),
      ...(q
        ? {
            OR: [
              { code: { contains: q, mode: "insensitive" } },
              { txnRef: { contains: q, mode: "insensitive" } },
              { invoice: { number: { contains: q, mode: "insensitive" } } },
              { member: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 500,
    include: { member: { select: { id: true, name: true } }, invoice: { select: { id: true, number: true } } },
  });
}

/** Unpaid and part-paid invoices, for the receivables screen. */
export async function listReceivables(u: CurrentUser, filter?: string) {
  const { rows } = await listInvoices(u, { openOnly: true });
  const today = todayIso();
  const open = rows.filter((r) => r.balance > 0);
  const buckets = {
    due_today: open.filter((r) => toIso(r.dueDate) === today),
    overdue: open.filter((r) => r.overdueDays > 0),
    partial: open.filter((r) => r.status === "PARTIALLY_PAID"),
    unpaid: open.filter((r) => r.status === "UNPAID"),
  };
  const list = filter && filter in buckets ? buckets[filter as keyof typeof buckets] : open;
  return { list, counts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, { n: v.length, amount: v.reduce((s, r) => s + r.balance, 0) }])), total: open.reduce((s, r) => s + r.balance, 0) };
}

export async function memberHistory(u: CurrentUser, memberId: string) {
  await findMember(u, memberId);
  const [memberships, invoices, payments] = await Promise.all([
    db.membership.findMany({ where: { memberId, branchId: { in: u.branchIds } }, orderBy: { startDate: "desc" }, include: { plan: { select: { name: true } }, invoice: { select: { id: true, number: true } } } }),
    listInvoices(u, { memberId }),
    listPayments(u, { memberId }),
  ]);
  return { memberships, invoices: invoices.rows, payments };
}
