import { invoiceTotals, formatInr, type InvoiceLine } from "./billing";
import { fmtDate } from "@/lib/format";

// Fitron AI prepares accounting actions as drafts. Everything the user sees in a draft is built here from the
// validated numbers, never from the model's own words, so the preview is exactly what Confirm will do.

/** The accounting actions a draft can carry. The WhatsApp draft is a separate kind kept by the older path. */
export const DRAFT_KINDS = ["INVOICE", "MEMBERSHIP_SALE", "PAYMENT", "EXPENSE", "CANCEL_INVOICE", "REVERSE_PAYMENT"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];
export const isDraftKind = (k: string): k is DraftKind => (DRAFT_KINDS as readonly string[]).includes(k);

/** How long a draft stays confirmable: balances, plans and months can change under it. */
export const DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
export const draftExpired = (createdAt: Date, now = Date.now()) => now - createdAt.getTime() > DRAFT_TTL_MS;

/** Starts the result of a draft that failed a check when its button was pressed, so the card and the model know nothing was saved. */
export const NOT_SAVED = "Not saved:";
/** Starts the result of a draft retired because another card for the same action on the same member was confirmed. */
export const NO_LONGER = "No longer available:";

/** The button label for each kind. */
export const CONFIRM_LABEL: Record<DraftKind, string> = {
  INVOICE: "Create invoice",
  MEMBERSHIP_SALE: "Sell membership",
  PAYMENT: "Record payment",
  EXPENSE: "Record expense",
  CANCEL_INVOICE: "Cancel invoice",
  REVERSE_PAYMENT: "Reverse payment",
};

const MAX_RUPEES = 100_000_000; // ₹10 crore: a typo guard, not a business limit

/** Rupees (a number, or text like "₹1,499.50") → whole paise; null if it isn't a sensible non-negative amount. */
export function paise(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(/[₹,\s]/g, "")) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > MAX_RUPEES) return null;
  return Math.round(n * 100);
}

/** Rupees as the plain text the form schemas parse ("1499.5"), or null. */
export function rupeeText(v: unknown): string | null {
  const p = paise(v);
  return p == null ? null : (p / 100).toFixed(2);
}

export type PreviewLine = { description: string; qty: number; rate: number; discount: number; taxRate: number };

/** The invoice as the user will see it: lines, totals, GST and what is paid now. */
export function invoicePreview(a: { member: string; date: string; dueDate: string; lines: PreviewLine[]; gstLabel: string; payAmount: number; payMethod?: string }): string {
  const l: InvoiceLine[] = a.lines;
  const t = invoiceTotals(l);
  const out = [`Invoice for ${a.member}`, `Date ${fmtDate(a.date)} · due ${fmtDate(a.dueDate)}`];
  a.lines.forEach((x, i) => {
    const gross = x.qty * x.rate;
    const net = gross - x.discount;
    out.push(`${i + 1}. ${x.description}: ${x.qty} × ${formatInr(x.rate)} = ${formatInr(gross)}${x.discount ? `, discount ${formatInr(x.discount)}` : ""}${x.taxRate ? `, GST ${x.taxRate}% ${formatInr(Math.round((net * x.taxRate) / 100))}` : ", no GST"}`);
  });
  out.push(`Subtotal ${formatInr(t.subtotal)}${t.discount ? ` · Discount ${formatInr(t.discount)}` : ""} · ${t.tax ? `GST ${formatInr(t.tax)} (${a.gstLabel})` : "No GST"} · Total ${formatInr(t.total)}`);
  out.push(a.payAmount > 0 ? `Received now: ${formatInr(a.payAmount)} by ${a.payMethod}${a.payAmount < t.total ? `; balance ${formatInr(t.total - a.payAmount)} due ${fmtDate(a.dueDate)}` : " (paid in full)"}` : `Nothing received now; ${formatInr(t.total)} due ${fmtDate(a.dueDate)}`);
  return out.join("\n");
}

export function salePreview(a: { member: string; plan: string; months: number; start: string; end: string; price: number; discount: number; regFee: number; taxRate: number; gstLabel: string; renewal: boolean; payAmount: number; payMethod?: string; offer?: string | null; category?: string }): string {
  const lines: InvoiceLine[] = [{ qty: 1, rate: a.price, discount: a.discount, taxRate: a.taxRate }];
  if (a.regFee > 0) lines.push({ qty: 1, rate: a.regFee, discount: 0, taxRate: a.taxRate });
  const t = invoiceTotals(lines);
  const out = [
    `${a.renewal ? "Renew" : "Sell"} ${a.plan} (${a.months} ${a.months === 1 ? "month" : "months"}) for ${a.member}`,
    `Membership ${fmtDate(a.start)} to ${fmtDate(a.end)}${a.category && a.category !== "Standard" ? ` · ${a.category} price` : ""}`,
    `Plan price ${formatInr(a.price)}${a.discount ? ` · discount ${formatInr(a.discount)}${a.offer ? ` (includes offer ${a.offer})` : ""}` : ""}${a.regFee ? ` · registration fee ${formatInr(a.regFee)}` : ""}`,
    `${t.tax ? `GST ${formatInr(t.tax)} (${a.gstLabel})` : "No GST"} · Invoice total ${formatInr(t.total)}`,
    a.payAmount > 0 ? `Received now: ${formatInr(a.payAmount)} by ${a.payMethod}${a.payAmount < t.total ? `; balance ${formatInr(t.total - a.payAmount)}` : " (paid in full)"}` : `Nothing received now; ${formatInr(t.total)} will be owed`,
  ];
  return out.join("\n");
}

export const paymentPreview = (a: { invoice: string; member: string; amount: number; method: string; date: string; balance: number; ref?: string }) =>
  [`Record a payment of ${formatInr(a.amount)} by ${a.method} on ${fmtDate(a.date)}`, `Invoice ${a.invoice} · ${a.member}${a.ref ? ` · ref ${a.ref}` : ""}`, `Balance before ${formatInr(a.balance)}, after ${formatInr(a.balance - a.amount)}${a.balance - a.amount === 0 ? " (fully paid)" : ""}`].join("\n");

export const expensePreview = (a: { date: string; category: string; group: string; description: string; amount: number; method: string; vendor?: string; billNo?: string; branch: string }) =>
  [`Expense: ${a.description}`, `${formatInr(a.amount)} · ${a.category} (${a.group}) · paid by ${a.method} on ${fmtDate(a.date)}`, `${a.vendor ? `Vendor ${a.vendor}` : "No vendor"}${a.billNo ? ` · bill ${a.billNo}` : ""} · ${a.branch}`].join("\n");

export const cancelPreview = (a: { invoice: string; member: string; total: number; paid: number; reason: string; hasMembership: boolean }) =>
  [
    `Cancel invoice ${a.invoice} (${a.member}, total ${formatInr(a.total)})`,
    `Reason: ${a.reason}`,
    `It drops out of revenue and GST.${a.paid > 0 ? ` Its payments (${formatInr(a.paid)}) will be reversed.` : ""}${a.hasMembership ? " The membership it created will be cancelled." : ""}`,
    "This cannot be undone; a corrected invoice would have to be raised.",
  ].join("\n");

export const reversePreview = (a: { code: string; invoice: string; member: string; amount: number; method: string; reason: string }) =>
  [`Reverse payment ${a.code} of ${formatInr(a.amount)} (${a.method}) on invoice ${a.invoice} for ${a.member}`, `Reason: ${a.reason}`, "The invoice's balance goes back up by this amount."].join("\n");

/** Zod problems as one short plain sentence for the model to relay. */
export function problemText(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 3)
    .map((i) => `${i.path.length ? `${i.path.map(String).join(".")}: ` : ""}${i.message}`)
    .join("; ");
}
