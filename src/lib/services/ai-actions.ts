import "server-only";
import { db } from "@/lib/db";
import { writeBranch, type CurrentUser } from "@/lib/auth/current";
import type { Permission } from "@/lib/auth/permissions";
import { canUsePermission } from "@/lib/domain/features";
import { invoiceTotals } from "@/lib/domain/billing";
import { membershipEndDate } from "@/lib/domain/dates";
import { offerDiscount } from "@/lib/domain/offers";
import {
  cancelPreview,
  expensePreview,
  invoicePreview,
  paymentPreview,
  problemText,
  reversePreview,
  rupeeText,
  salePreview,
  type DraftKind,
} from "@/lib/domain/ai-drafts";
import { expenseInput, type ExpenseInput } from "@/lib/validation/expense";
import { invoiceInput, paymentInput, reasonInput, sellInput, LINE_CATEGORIES, type InvoiceInput, type PaymentInput, type SellInput } from "@/lib/validation/billing";
import { cancelInvoice, collectPayment, createInvoice, getInvoice, reversePayment, sellMembership, suggestedStart } from "./billing";
import { createExpense } from "./expenses";
import { UserError } from "./errors";
import { memberScope } from "./members";
import { usableOffer } from "./offers";
import { getTax } from "./tax";
import { todayIso } from "./time";
import { audit } from "./audit";
import { log } from "@/lib/log";
import { sendLater } from "./whatsapp";
import { rupeesText } from "@/lib/domain/whatsapp";

// Drafts for the accounting actions. A draft is validated and priced here, stored as an AiProposal with the exact
// payload to run, and shown to the user with a Confirm button. Confirming runs the app's normal service function
// as that user, so roles, plan limits, month locks and the audit log apply exactly as they do on the pages.

type Input = Record<string, unknown>;
type Draft = { proposal_id: string; preview: string; note: string };

export const DRAFT_PERMISSIONS: Record<DraftKind, Permission[]> = {
  INVOICE: ["invoices.create"],
  MEMBERSHIP_SALE: ["memberships.renew"],
  PAYMENT: ["payments.collect"],
  EXPENSE: ["expenses.manage"],
  CANCEL_INVOICE: ["invoices.cancel"],
  REVERSE_PAYMENT: ["payments.reverse"],
};

const NOTE = "Shown to the user with Confirm and Discard buttons. Nothing is saved until they press Confirm. Give a one or two line summary and ask them to check it.";
const DENIED = (what: string) => ({ error: `This staff member's role can't ${what}.` });
const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

/** Fails with the same message the pages give if the month is locked for this branch. */
async function monthOpen(u: CurrentUser, branchId: string, date: string) {
  if (u.can("months.unlock")) return;
  const lock = await db.monthLock.findUnique({ where: { branchId_month: { branchId, month: date.slice(0, 7) } } });
  if (lock) throw new UserError(`${date.slice(0, 7)} is locked for this branch. Ask a Super Admin to unlock it.`);
}

/** A member the user may see, from an id, member code, phone number or name. Several name matches are listed, never guessed. */
export async function resolveMember(u: CurrentUser, ref: string) {
  const q = ref.trim();
  if (!q) throw new UserError("Say which member (name, code or phone).");
  const where = { ...memberScope(u), walkIn: false } as const;
  const exact = await db.member.findMany({ where: { ...where, OR: [{ id: q }, { code: { equals: q, mode: "insensitive" } }, { phone: q.replace(/[\s-]/g, "").replace(/^(\+91|91|0)(?=\d{10}$)/, "") }] }, select: { id: true, name: true, code: true, branchId: true }, take: 2 });
  if (exact.length === 1) return exact[0]!;
  const byName = exact.length ? exact : await db.member.findMany({ where: { ...where, name: { contains: q, mode: "insensitive" } }, select: { id: true, name: true, code: true, phone: true, branchId: true }, take: 6 });
  if (byName.length === 1) return byName[0]!;
  if (!byName.length) throw new UserError(`No member matches "${q}".`);
  throw new UserError(`Several members match "${q}": ${byName.map((m) => `${m.name} (${m.code})`).join(", ")}. Ask which one.`);
}

export async function resolveInvoice(u: CurrentUser, ref: string) {
  const q = ref.trim();
  if (!q) throw new UserError("Say which invoice (its number).");
  const inv = await db.invoice.findFirst({ where: { orgId: u.orgId, branchId: { in: u.branchIds }, OR: [{ id: q }, { number: { equals: q, mode: "insensitive" } }] }, select: { id: true } });
  if (!inv) throw new UserError(`No invoice ${q} that you can see.`);
  const full = await getInvoice(u, inv.id);
  if (!full) throw new UserError(`No invoice ${q} that you can see.`);
  return full;
}

async function save(u: CurrentUser, kind: DraftKind, memberIds: string[], summary: string, preview: string, payload: object): Promise<Draft> {
  const p = await db.aiProposal.create({ data: { orgId: u.orgId, userId: u.id, kind, memberIds, body: preview, summary: summary.slice(0, 200), payload } });
  return { proposal_id: p.id, preview, note: NOTE };
}

const gstLabel = (t: { enabled: boolean; rate: number; type: string }) => (t.enabled ? `${t.rate}% ${t.type}` : "GST off");

async function draftInvoice(u: CurrentUser, i: Input) {
  if (!canUsePermission(u, "invoices.create")) return DENIED("create invoices");
  const member = await resolveMember(u, str(i.member));
  const today = todayIso();
  const date = str(i.date) || today;
  const lines = Array.isArray(i.lines) ? i.lines : [];
  const pay = i.pay_amount == null || i.pay_amount === "" ? 0 : Number(i.pay_amount);
  const parsed = invoiceInput.safeParse({
    memberId: member.id,
    date,
    dueDate: str(i.due_date) || date,
    lines: lines.map((l: Input) => ({
      description: str(l.description),
      category: str(l.category) || "Other",
      qty: l.qty ?? 1,
      rate: rupeeText(l.rate) ?? "x",
      discount: l.discount == null ? "0" : (rupeeText(l.discount) ?? "x"),
      taxable: l.taxable !== false,
    })),
    payAmount: pay > 0 ? (rupeeText(pay) ?? "x") : "0",
    payMethod: str(i.pay_method) || undefined,
    payRef: str(i.pay_ref) || undefined,
  });
  if (!parsed.success) return { error: `${problemText(parsed.error.issues)}. Line categories: ${LINE_CATEGORIES.join(", ")}.` };
  const input = parsed.data;
  if (input.payAmount > 0 && !input.payMethod) return { error: "Say how it was paid (UPI, Cash, Card, Bank Transfer or Other)." };
  if (input.dueDate < input.date) return { error: "The due date is before the invoice date." };
  const tax = await getTax(u.orgId);
  const priced = input.lines.map((l) => ({ description: l.description, qty: l.qty, rate: l.rate, discount: l.discount, taxRate: tax.enabled && l.taxable ? tax.rate : 0 }));
  for (const l of priced) if (l.discount > l.qty * l.rate) return { error: `The discount on "${l.description}" is more than its amount.` };
  const total = invoiceTotals(priced).total;
  if (input.payAmount > total) return { error: "The payment is more than the invoice total." };
  await monthOpen(u, member.branchId, input.date);
  const preview = invoicePreview({ member: `${member.name} (${member.code})`, date: input.date, dueDate: input.dueDate, lines: priced, gstLabel: gstLabel(tax), payAmount: input.payAmount, payMethod: input.payMethod });
  return save(u, "INVOICE", [member.id], `Create invoice of ${(total / 100).toLocaleString("en-IN", { style: "currency", currency: "INR" })} for ${member.name}`, preview, { input });
}

async function draftSale(u: CurrentUser, i: Input) {
  if (!canUsePermission(u, "memberships.renew")) return DENIED("sell or renew memberships");
  const member = await resolveMember(u, str(i.member));
  const planRef = str(i.plan);
  const plan = await db.membershipPlan.findFirst({ where: { orgId: u.orgId, status: "ACTIVE", OR: [{ id: planRef }, { name: { equals: planRef, mode: "insensitive" } }] }, include: { prices: true } });
  if (!plan) return { error: `No active plan "${planRef}". Use the catalog tool to see the plans.` };
  const pay = i.pay_amount == null || i.pay_amount === "" ? 0 : Number(i.pay_amount);
  const suggested = await suggestedStart(member.id);
  const parsed = sellInput.safeParse({
    planId: plan.id,
    startDate: str(i.start_date) || suggested.start,
    discount: i.discount == null ? "0" : (rupeeText(i.discount) ?? "x"),
    includeRegFee: i.include_reg_fee === true,
    offerCode: str(i.offer_code) || undefined,
    pricingCategory: str(i.pricing_category) || undefined,
    payAmount: pay > 0 ? (rupeeText(pay) ?? "x") : "0",
    payMethod: str(i.pay_method) || undefined,
    payRef: str(i.pay_ref) || undefined,
  });
  if (!parsed.success) return { error: problemText(parsed.error.issues) };
  const input = parsed.data;
  // Price it the way sellMembership will, so the preview's total is the invoice's total.
  const category = input.pricingCategory && input.pricingCategory !== "Standard" ? plan.prices.find((x) => x.category === input.pricingCategory) : undefined;
  if (input.pricingCategory && input.pricingCategory !== "Standard" && !category) return { error: `${plan.name} has no ${input.pricingCategory} price.` };
  const price = category?.price ?? plan.price;
  if (input.discount > price) return { error: "The discount is more than the plan price." };
  const offer = input.offerCode ? await usableOffer(u.orgId, input.offerCode) : null;
  const discount = Math.min(price, input.discount + (offer ? offerDiscount(offer, price) : 0));
  const tax = await getTax(u.orgId);
  const taxRate = tax.enabled && plan.gstApplicable ? tax.rate : 0;
  const regFee = input.includeRegFee && plan.regFee > 0 ? plan.regFee : 0;
  const total = invoiceTotals([{ qty: 1, rate: price, discount, taxRate }, ...(regFee ? [{ qty: 1, rate: regFee, discount: 0, taxRate }] : [])]).total;
  if (input.payAmount > total) return { error: "The payment is more than the invoice total." };
  if (input.payAmount > 0 && !input.payMethod) return { error: "Say how it was paid (UPI, Cash, Card, Bank Transfer or Other)." };
  await monthOpen(u, member.branchId, todayIso());
  const preview = salePreview({
    member: `${member.name} (${member.code})`,
    plan: plan.name,
    months: plan.months,
    start: input.startDate,
    end: membershipEndDate(input.startDate, plan.months),
    price,
    discount,
    regFee,
    taxRate,
    gstLabel: gstLabel(tax),
    renewal: !suggested.isNew,
    payAmount: input.payAmount,
    payMethod: input.payMethod,
    offer: offer?.code,
    category: category?.category,
  });
  return save(u, "MEMBERSHIP_SALE", [member.id], `${suggested.isNew ? "Sell" : "Renew"} ${plan.name} for ${member.name}`, preview, { memberId: member.id, input });
}

async function draftPayment(u: CurrentUser, i: Input) {
  if (!canUsePermission(u, "payments.collect")) return DENIED("collect payments");
  const inv = await resolveInvoice(u, str(i.invoice));
  if (inv.status === "CANCELLED") return { error: `Invoice ${inv.number} is cancelled.` };
  const date = str(i.date) || todayIso();
  const parsed = paymentInput.safeParse({ amount: rupeeText(i.amount) ?? "x", method: str(i.method), date, txnRef: str(i.txn_ref) || undefined, notes: str(i.notes) || undefined });
  if (!parsed.success) return { error: problemText(parsed.error.issues) };
  const input = parsed.data;
  if (input.amount > inv.balance) return { error: `Invoice ${inv.number} has only ${(inv.balance / 100).toLocaleString("en-IN", { style: "currency", currency: "INR" })} left to pay.` };
  await monthOpen(u, inv.branchId, input.date);
  const preview = paymentPreview({ invoice: inv.number, member: inv.member.name, amount: input.amount, method: input.method, date: input.date, balance: inv.balance, ref: input.txnRef });
  return save(u, "PAYMENT", [inv.memberId], `Record ${(input.amount / 100).toLocaleString("en-IN", { style: "currency", currency: "INR" })} on ${inv.number}`, preview, { invoiceId: inv.id, input });
}

async function draftExpense(u: CurrentUser, i: Input) {
  if (!canUsePermission(u, "expenses.manage")) return DENIED("record expenses");
  const branchId = writeBranch(u);
  if (!branchId) return { error: "Pick one branch in the branch switcher first; expenses are recorded against a single branch." };
  const ref = str(i.category);
  const cats = await db.expenseCategory.findMany({ orderBy: [{ group: "asc" }, { name: "asc" }] });
  const cat = cats.find((c) => c.id === ref) ?? cats.find((c) => c.name.toLowerCase() === ref.toLowerCase()) ?? (ref ? cats.find((c) => c.name.toLowerCase().includes(ref.toLowerCase())) : undefined);
  if (!cat) return { error: `No expense category "${ref}". Categories: ${cats.map((c) => c.name).join(", ")}.` };
  const parsed = expenseInput.safeParse({ date: str(i.date) || todayIso(), categoryId: cat.id, description: str(i.description), vendor: str(i.vendor) || undefined, amount: rupeeText(i.amount) ?? "x", method: str(i.method), billNo: str(i.bill_no) || undefined, notes: str(i.notes) || undefined });
  if (!parsed.success) return { error: problemText(parsed.error.issues) };
  const input = parsed.data;
  await monthOpen(u, branchId, input.date);
  const branch = u.branches.find((b) => b.id === branchId)?.name ?? "this branch";
  const preview = expensePreview({ date: input.date, category: cat.name, group: cat.group, description: input.description, amount: input.amount, method: input.method, vendor: input.vendor, billNo: input.billNo, branch });
  return save(u, "EXPENSE", [], `Record expense: ${input.description}`, preview, { input });
}

async function draftCancel(u: CurrentUser, i: Input) {
  if (!canUsePermission(u, "invoices.cancel")) return DENIED("cancel invoices");
  const inv = await resolveInvoice(u, str(i.invoice));
  if (inv.status === "CANCELLED") return { error: `Invoice ${inv.number} is already cancelled.` };
  const reason = reasonInput.safeParse({ reason: str(i.reason) });
  if (!reason.success) return { error: "I need a real reason from the user to cancel an invoice (at least 3 characters). Ask them." };
  await monthOpen(u, inv.branchId, inv.date.toISOString().slice(0, 10));
  const preview = cancelPreview({ invoice: inv.number, member: inv.member.name, total: inv.total, paid: inv.paid, reason: reason.data.reason, hasMembership: !!inv.membership });
  return save(u, "CANCEL_INVOICE", [inv.memberId], `Cancel invoice ${inv.number}`, preview, { invoiceId: inv.id, reason: reason.data.reason });
}

async function draftReverse(u: CurrentUser, i: Input) {
  if (!canUsePermission(u, "payments.reverse")) return DENIED("reverse payments");
  const ref = str(i.payment);
  const pay = await db.payment.findFirst({ where: { orgId: u.orgId, branchId: { in: u.branchIds }, OR: [{ id: ref }, { code: { equals: ref, mode: "insensitive" } }] }, include: { member: { select: { name: true } }, invoice: { select: { number: true } } } });
  if (!pay) return { error: `No payment ${ref} that you can see.` };
  if (pay.status === "REVERSED") return { error: `Payment ${pay.code} is already reversed.` };
  const reason = reasonInput.safeParse({ reason: str(i.reason) });
  if (!reason.success) return { error: "I need a real reason from the user to reverse a payment (at least 3 characters). Ask them." };
  await monthOpen(u, pay.branchId, pay.date.toISOString().slice(0, 10));
  const preview = reversePreview({ code: pay.code, invoice: pay.invoice.number, member: pay.member.name, amount: pay.amount, method: pay.method, reason: reason.data.reason });
  return save(u, "REVERSE_PAYMENT", [pay.memberId], `Reverse payment ${pay.code}`, preview, { paymentId: pay.id, reason: reason.data.reason });
}

const DRAFTERS: Record<string, (u: CurrentUser, i: Input) => Promise<unknown>> = {
  draft_invoice: draftInvoice,
  draft_membership_sale: draftSale,
  draft_payment: draftPayment,
  draft_expense: draftExpense,
  draft_cancel_invoice: draftCancel,
  draft_reverse_payment: draftReverse,
};
export const isDraftTool = (name: string) => name in DRAFTERS;

/** Runs a drafting tool. Problems the user can fix come back as { error } for the model to explain. */
export async function runDraftTool(u: CurrentUser, name: string, input: Input): Promise<unknown> {
  try {
    return await DRAFTERS[name]!(u, input);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

/** Notifications after the books are written are best effort: if one fails the booking still stands, so it must not read as a failed confirm (a retry would book twice). */
async function afterBooking(what: string, fn: () => unknown) {
  try {
    await fn();
  } catch (e) {
    log.error(`ai_action.${what}_follow_up_failed`, e);
  }
}

export type Executed = { message: string; href?: string; pdf?: string };

type Payload = { input?: unknown; memberId?: string; invoiceId?: string; paymentId?: string; reason?: string };

/** Runs a confirmed draft as the user, through the same service functions the pages use. */
export async function executeDraft(u: CurrentUser, kind: DraftKind, payload: Payload): Promise<Executed> {
  const inr = (p: number) => (p / 100).toLocaleString("en-IN", { style: "currency", currency: "INR" });
  switch (kind) {
    case "INVOICE": {
      const input = payload.input as InvoiceInput;
      const inv = await createInvoice(u, input);
      // The same automatic WhatsApp the New invoice page sends (it only goes out if that template is on).
      await afterBooking("invoice", () => sendLater({ orgId: u.orgId, memberId: inv.memberId, key: "invoice", userId: u.id, vars: { invoice_number: inv.number, amount: rupeesText(inv.total) }, invoiceId: inv.id }));
      return { message: `Invoice ${inv.number} created, total ${inr(inv.total)}.`, href: `/invoices/${inv.id}`, pdf: `/invoices/${inv.id}/pdf` };
    }
    case "MEMBERSHIP_SALE": {
      const r = await sellMembership(u, payload.memberId!, payload.input as SellInput);
      const vars = { invoice_number: r.invoice.number, amount: rupeesText(r.invoice.total) };
      await afterBooking("sale", () => (r.membership.type === "NEW" ? sendLater({ orgId: u.orgId, memberId: payload.memberId!, key: "welcome", userId: u.id, vars }) : sendLater({ orgId: u.orgId, memberId: payload.memberId!, key: "renewal", userId: u.id, vars, invoiceId: r.invoice.id })));
      return { message: `${r.membership.type === "RENEWAL" ? "Renewed" : "Sold"}: invoice ${r.invoice.number}, total ${inr(r.invoice.total)}.`, href: `/invoices/${r.invoice.id}`, pdf: `/invoices/${r.invoice.id}/pdf` };
    }
    case "PAYMENT": {
      const input = payload.input as PaymentInput;
      const p = await collectPayment(u, payload.invoiceId!, input);
      await afterBooking("payment", async () => {
        const inv = await getInvoice(u, payload.invoiceId!);
        sendLater({ orgId: u.orgId, memberId: p.memberId, key: "payment", userId: u.id, vars: { amount: rupeesText(p.amount), invoice_number: inv?.number ?? "", pending_amount: rupeesText(inv?.balance ?? 0) } });
      });
      return { message: `Payment ${p.code} of ${inr(p.amount)} recorded.`, href: `/invoices/${payload.invoiceId}` };
    }
    case "EXPENSE": {
      const e = await createExpense(u, payload.input as ExpenseInput);
      return { message: `Expense ${e.code} of ${inr(e.amount)} recorded.`, href: "/expenses" };
    }
    case "CANCEL_INVOICE": {
      await cancelInvoice(u, payload.invoiceId!, payload.reason!);
      return { message: "Invoice cancelled; its payments were reversed.", href: `/invoices/${payload.invoiceId}` };
    }
    case "REVERSE_PAYMENT": {
      await reversePayment(u, payload.paymentId!, payload.reason!);
      return { message: "Payment reversed.", href: "/payments" };
    }
  }
}

export const auditConfirm = (u: CurrentUser, p: { id: string; kind: string; summary: string }, result: string) =>
  db.$transaction((tx) => audit(tx, { orgId: u.orgId, userId: u.id, action: "ai.proposal.confirm", entity: "AiProposal", entityId: p.id, after: { kind: p.kind, summary: p.summary, result } }));
