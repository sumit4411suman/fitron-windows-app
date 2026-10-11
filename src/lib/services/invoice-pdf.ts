import "server-only";
import type { CurrentUser } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { getInvoice } from "./billing";
import { getGymProfile } from "./settings";
import { getTax } from "./tax";
import { readGymLogo } from "./gym-logo";
import { renderInvoicePdf } from "@/lib/pdf/invoice";
import { renderReceiptPdf } from "@/lib/pdf/receipt";
import type { GymHeader } from "@/lib/pdf/parts";
import type { Paper } from "@/lib/pdf/paper";
import { fmtDate } from "@/lib/format";
import { INVOICE_STATUS_LABEL } from "@/components/invoice-status";

type Invoice = NonNullable<Awaited<ReturnType<typeof getInvoice>>>;

/** Who a document is from: the gym's profile, with a branch's own address, phone and GSTIN where it has them. */
async function gymHeader(u: CurrentUser, inv: Invoice): Promise<GymHeader> {
  const [gym, tax, logo] = await Promise.all([getGymProfile(u.orgId), getTax(u.orgId), readGymLogo(u.orgId).catch(() => null)]);
  return {
    name: gym.name || inv.org.name,
    tagline: gym.tagline || undefined,
    address: gym.address || inv.branch.address,
    phone: gym.phone || inv.branch.phone,
    email: gym.email || undefined,
    // A branch's own registration wins; else the gym-level one from Billing & GST.
    gstin: inv.branch.gstin || tax.gstin || null,
    sac: tax.sac,
    instagram: gym.instagram || undefined,
    logo: logo && (logo.mime === "image/png" || logo.mime === "image/jpeg") ? { bytes: logo.body, mime: logo.mime } : null,
  };
}

const membershipOf = (inv: Invoice) => (inv.membership ? { plan: inv.membership.plan.name, start: fmtDate(inv.membership.startDate), end: fmtDate(inv.membership.endDate) } : null);

/** The GST invoice as PDF bytes on the paper asked for (A4 unless said), or null if the user can't see it. */
export async function invoicePdf(u: CurrentUser, id: string, paper: Paper = "a4") {
  const inv = await getInvoice(u, id);
  if (!inv) return null;
  const m = inv.member;
  const r = await renderInvoicePdf(
    {
      gym: await gymHeader(u, inv),
      number: inv.number,
      date: fmtDate(inv.date),
      dueDate: fmtDate(inv.dueDate),
      status: INVOICE_STATUS_LABEL[inv.status],
      member: { name: m.name, code: m.code, phone: m.phone, address: [m.house, m.area, m.city, m.state, m.pin].filter(Boolean).join(", ") },
      items: inv.items.map((i) => ({ ...i, taxRate: Number(i.taxRate) })),
      subtotal: inv.subtotal,
      discount: inv.discount,
      tax: inv.tax,
      total: inv.total,
      paid: inv.paid,
      balance: inv.balance,
      gstType: inv.gstType,
      gstRate: inv.gstRate ? Number(inv.gstRate) : null,
      payments: inv.payments.map((p) => ({ code: p.code, date: fmtDate(p.date), method: p.method, amount: p.amount, reversed: p.status === "REVERSED" })),
      membership: membershipOf(inv),
    },
    paper,
  );
  return { bytes: r.bytes, lines: r.lines, filename: `${inv.number}${paper === "a4" ? "" : `-${paper}`}.pdf`, invoice: inv };
}

/**
 * The receipt for one payment (80 mm unless said), or null if the user can't see it. "Paid to date" counts the
 * invoice's payments in the order they were entered, up to and including this one, so a receipt says what was due
 * after it was given, whatever was paid later. A reversed payment prints as cancelled and counts for nothing.
 */
export async function receiptPdf(u: CurrentUser, paymentId: string, paper: Paper = "80mm") {
  const ref = await db.payment.findFirst({ where: { id: paymentId, orgId: u.orgId }, select: { invoiceId: true } });
  if (!ref) return null;
  // Through the invoice, so the branch a user may see is checked the same way.
  const inv = await getInvoice(u, ref.invoiceId);
  const at = inv?.payments.findIndex((p) => p.id === paymentId) ?? -1;
  if (!inv || at < 0) return null;
  const p = inv.payments[at]!;
  const paidToDate = inv.payments.slice(0, at + 1).reduce((sum, q) => sum + (q.status === "SUCCESS" ? q.amount : 0), 0);
  const r = await renderReceiptPdf(
    {
      gym: await gymHeader(u, inv),
      number: p.code,
      date: fmtDate(p.date),
      member: { name: inv.member.name, code: inv.member.code, phone: inv.member.phone },
      amount: p.amount,
      method: p.method,
      txnRef: p.txnRef,
      notes: p.notes,
      invoice: { number: inv.number, date: fmtDate(inv.date), total: inv.total, paidToDate, balance: Math.max(0, inv.total - paidToDate) },
      membership: membershipOf(inv),
      items: inv.items.map((i) => ({ description: i.description, qty: i.qty, amount: i.amount })),
      receivedBy: inv.staffName(p.receivedById),
      reversed: p.status === "REVERSED" ? { date: p.reversedAt ? fmtDate(p.reversedAt) : fmtDate(p.date), reason: p.reverseReason ?? "" } : null,
    },
    paper,
  );
  return { bytes: r.bytes, lines: r.lines, filename: `${p.code}${paper === "80mm" ? "" : `-${paper}`}.pdf`, payment: p, invoice: inv };
}
