import { daysBetween, type IsoDate } from "./dates";

// Invoice maths. All amounts are integer paise.

export type InvoiceLine = {
  qty: number;
  rate: number;
  discount: number;
  /** GST percent, e.g. 18 */
  taxRate: number;
};

export type InvoiceTotals = { subtotal: number; discount: number; tax: number; total: number };

/** Tax is charged on (qty × rate − discount) per line and rounded once on the invoice. */
export function invoiceTotals(lines: InvoiceLine[]): InvoiceTotals {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  for (const l of lines) {
    const gross = l.qty * l.rate;
    subtotal += gross;
    discount += l.discount;
    tax += ((gross - l.discount) * l.taxRate) / 100;
  }
  tax = Math.round(tax);
  return { subtotal, discount, tax, total: subtotal - discount + tax };
}

/** The taxable value of a line: what is left after its own discount. */
export const lineNet = (l: InvoiceLine): number => l.qty * l.rate - l.discount;

/**
 * Splits the invoice's tax across its lines so the parts add up to it exactly.
 *
 * The invoice rounds its tax once (above), so rounding each line on its own would not come back to
 * the same number: three lines of 4.5 paise are 13.5 → 14 on the invoice but 5 + 5 + 5 = 15 by line.
 * A P&L adding up line tax would then disagree with the invoice it was printed from. Each line gets
 * its whole paise, and the few left over go to the lines that lost the most when rounded down.
 */
export function lineTaxes(lines: InvoiceLine[], tax: number): number[] {
  const exact = lines.map((l) => (lineNet(l) * l.taxRate) / 100);
  const out = exact.map((x) => Math.floor(x));
  let left = tax - out.reduce((s, x) => s + x, 0);
  const byRemainder = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    out[i]! += 1;
    left -= 1;
  }
  return out;
}

export type PaymentLike = { amount: number; status: "SUCCESS" | "REVERSED" };

export type InvoiceStatus = "CANCELLED" | "PAID" | "PARTIALLY_PAID" | "UNPAID";

/** One name for each state everywhere: "Part paid" in sentences, "PART PAID" on tags and exports. */
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = { PAID: "Paid", PARTIALLY_PAID: "Part paid", UNPAID: "Unpaid", CANCELLED: "Cancelled" };
export const INVOICE_STATUS_TAG: Record<InvoiceStatus, string> = { PAID: "PAID", PARTIALLY_PAID: "PART PAID", UNPAID: "UNPAID", CANCELLED: "CANCELLED" };

export type InvoiceState = {
  paid: number;
  balance: number;
  status: InvoiceStatus;
  /** Days past the due date while a balance remains; 0 otherwise. */
  overdueDays: number;
};

/**
 * Less than a rupee left after a payment is a round-off, not a due: a GST invoice of ₹2,557.06 paid as ₹2,557 is
 * settled. Nobody can hand over six paise, and the balance would show as ₹0 while the invoice sat in Receivables.
 */
export const ROUND_OFF_PAISE = 100;

/** What is still owed on an invoice of `total` after `paid` has come in: 0 once only a round-off is left. */
export function balanceDue(total: number, paid: number): number {
  const left = Math.max(0, total - paid);
  return paid > 0 && left < ROUND_OFF_PAISE ? 0 : left;
}

/**
 * Paid state is never stored (rule 3): balance = total − successful payments, less any round-off (balanceDue).
 * A cancelled invoice has no balance.
 */
export function invoiceState(
  invoice: { total: number; cancelled: boolean; dueDate: IsoDate },
  payments: PaymentLike[],
  today: IsoDate,
): InvoiceState {
  const paid = payments.filter((p) => p.status === "SUCCESS").reduce((s, p) => s + p.amount, 0);
  const balance = invoice.cancelled ? 0 : balanceDue(invoice.total, paid);
  const status: InvoiceStatus = invoice.cancelled
    ? "CANCELLED"
    : balance <= 0
      ? "PAID"
      : paid > 0
        ? "PARTIALLY_PAID"
        : "UNPAID";
  const overdueDays = balance > 0 ? Math.max(0, daysBetween(today, invoice.dueDate)) : 0;
  return { paid, balance, status, overdueDays };
}

/** Formats paise as Indian rupees, e.g. 123456789 → "₹12,34,567.89". */
export const formatInr = (paise: number): string =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);
