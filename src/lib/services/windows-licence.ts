import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { lockRow, nextFitronInvoiceNumber } from "@/lib/db-dialect";
import { log } from "@/lib/log";
import { isLocal } from "@/lib/runtime/edition";
import { createOrder, fitronKeyId, verifyCheckout } from "@/lib/integrations/razorpay";
import { signLicence } from "@/lib/licence/issue";
import { findPlan } from "@/lib/domain/pricing";
import type { Cycle } from "@/lib/domain/saas";
import { buyerDetails, CLAIM, INSTALLATION_ID, isWindowsPlan, windowsLicence, windowsPeriod, windowsPrice, type WindowsPlan } from "@/lib/domain/windows-licence";
import { UserError } from "./errors";
import { fitronSeller } from "./saas";
import { fromIso, todayIso, toIso } from "./time";
import type { Prisma } from "@/generated/prisma/client";

// FITRON for Windows licences, bought on fitron.in (docs/local-windows/LICENSING.md). The owner presses Buy in Settings ›
// Licence on the computer, which makes a one-time claim and opens fitron.in/windows/buy in the browser. They pay with
// Razorpay into FITRON's own account; the payment (confirmed by Razorpay's signature, and again by its webhook) becomes a
// licence signed for that one computer, which the computer collects with its claim (src/lib/licence/purchase.ts).
//
// fitron.in keeps the order (FITRON's sales record, never deleted), never anything about the gym's members or books: the
// computer sends only its installation id and the claim, and the buyer types a name, an email and, if they like, a phone
// and GSTIN for the receipt.
//
// The licence is signed with FITRON_LICENCE_SIGNING_KEY (an Ed25519 private key, PEM) under the id
// FITRON_LICENCE_SIGNING_KEY_ID, whose public half is in src/lib/licence/keys.ts. Without it a paid order waits for its
// licence and the payment is kept: the computer is told it is being prepared, and it is issued as soon as the key is set.

export const claimHash = (claim: string) => createHash("sha256").update(claim, "utf8").digest("hex");

function cloudOnly() {
  if (isLocal()) throw new UserError("Licences are bought on fitron.in.");
}

/** The signing key, from the server's environment. The PEM may be stored with "\n" for its line breaks, or base64. */
export function signingKey(env: Record<string, string | undefined> = process.env): { id: string; pem: string } | null {
  const id = env.FITRON_LICENCE_SIGNING_KEY_ID?.trim();
  let pem = env.FITRON_LICENCE_SIGNING_KEY?.trim();
  if (!id || !pem) return null;
  if (!pem.includes("BEGIN")) pem = Buffer.from(pem, "base64").toString("utf8");
  return { id, pem: pem.replace(/\\n/g, "\n") };
}

export type WindowsCheckout =
  | { mode: "LIVE"; id: string; total: number; keyId: string; orderId: string; name: string; description: string; prefill: { name: string; email: string; contact?: string } }
  | { mode: "DEMO"; id: string; total: number };

/** Starts paying for a licence: the order, and Razorpay's order for Checkout. */
export async function startWindowsLicence(input: { installationId: unknown; claim: unknown; plan: unknown; cycle: unknown; licensee?: unknown; email?: unknown; phone?: unknown; gstin?: unknown }): Promise<WindowsCheckout> {
  cloudOnly();
  const installationId = typeof input.installationId === "string" ? input.installationId : "";
  const claim = typeof input.claim === "string" ? input.claim : "";
  if (!INSTALLATION_ID.test(installationId) || !CLAIM.test(claim)) throw new UserError("This link is not complete. Open it again from Settings › Licence in FITRON on your computer.");
  const plan = typeof input.plan === "string" && isWindowsPlan(input.plan) ? input.plan : null;
  const cycle = input.cycle === "MONTHLY" || input.cycle === "YEARLY" ? input.cycle : null;
  if (!plan || !cycle) throw new UserError("Pick a plan, monthly or yearly.");
  const buyer = buyerDetails(input);
  if ("error" in buyer) throw new UserError(buyer.error);
  const price = windowsPrice(plan, cycle);
  const keyId = fitronKeyId();
  // A demo payment moves no money, so a live server never starts one.
  if (!keyId && process.env.NODE_ENV === "production") throw new UserError("Payments to FITRON aren't switched on yet. Write to hello@fitron.in and we will send your licence.");
  const order = await db.windowsLicenceOrder.create({ data: { installationId, claimHash: claimHash(claim), plan, cycle, ...price, ...buyer } });
  const name = findPlan(plan)?.name ?? plan;
  if (!keyId) return { mode: "DEMO", id: order.id, total: price.total };
  const rz = await createOrder({ amount: price.total, receipt: order.id, notes: { kind: "windows-licence", order: order.id, plan, cycle } });
  await db.windowsLicenceOrder.update({ where: { id: order.id }, data: { razorpayOrderId: rz.id } });
  return {
    mode: "LIVE",
    id: order.id,
    total: price.total,
    keyId,
    orderId: rz.id,
    name: fitronSeller().name,
    description: `FITRON Gym Accounting for Windows, ${name}, 1 ${cycle === "YEARLY" ? "year" : "month"} (GST included)`,
    prefill: { name: buyer.licensee, email: buyer.email, ...(buyer.phone ? { contact: buyer.phone } : {}) },
  };
}

async function invoiceNumber(tx: Prisma.TransactionClient, today: string) {
  const n = await nextFitronInvoiceNumber(tx);
  const y = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0);
  return `FIT/${y}-${String(y + 1).slice(2)}/${String(n).padStart(5, "0")}`;
}

/** The licence of a paid order, signed now, when the server has the key. */
function sign(o: { id: string; plan: string; licensee: string; installationId: string; periodEnd: Date | null; paidAt: Date | null }, today: string) {
  const key = signingKey();
  if (!key || !o.periodEnd || !isWindowsPlan(o.plan)) return null;
  const licenceId = `FITW-${today.slice(0, 4)}-${o.id.slice(-10).toUpperCase()}`;
  const text = signLicence(windowsLicence({ licenceId, keyId: key.id, licensee: o.licensee, plan: o.plan as WindowsPlan, installationId: o.installationId, today, periodEnd: toIso(o.periodEnd) }), key.pem);
  return { licenceId, licenceText: text };
}

/**
 * Marks an order paid, once: its period (after the computer's current one), FITRON's invoice number, and the licence.
 * Idempotent: Checkout's confirmation and the webhook may both arrive.
 */
async function markPaid(where: { id: string } | { razorpayOrderId: string }, paymentId: string | null, amount: number | null) {
  return db.$transaction(async (tx) => {
    const found = await tx.windowsLicenceOrder.findFirst({ where });
    if (!found) return null;
    await lockRow(tx, "WindowsLicenceOrder", found.id);
    const o = await tx.windowsLicenceOrder.findUniqueOrThrow({ where: { id: found.id } });
    if (o.status === "PAID") return o;
    if (amount !== null && amount !== o.total) {
      // Never silently: the money is in FITRON's account, so a person looks at it.
      log.error("windows_licence.amount_mismatch", new Error(`Order ${o.id}: Razorpay captured ${amount} paise, the order is ${o.total}.`));
      return o;
    }
    const today = todayIso();
    const last = await tx.windowsLicenceOrder.findFirst({ where: { installationId: o.installationId, status: "PAID", periodEnd: { not: null } }, orderBy: { periodEnd: "desc" }, select: { periodEnd: true } });
    const p = windowsPeriod(o.cycle as Cycle, today, last?.periodEnd ? toIso(last.periodEnd) : null);
    const paid = { ...o, periodEnd: fromIso(p.end), paidAt: new Date() };
    const licence = sign(paid, today);
    if (!licence) log.error("windows_licence.no_signing_key", new Error(`Order ${o.id} is paid; its licence waits for FITRON_LICENCE_SIGNING_KEY.`));
    return tx.windowsLicenceOrder.update({
      where: { id: o.id },
      data: { status: "PAID", paidAt: paid.paidAt, periodStart: fromIso(p.start), periodEnd: fromIso(p.end), razorpayPaymentId: paymentId, invoiceNo: await invoiceNumber(tx, today), ...(licence ?? {}) },
    });
  });
}

/** Checkout reported success: trusted only if Razorpay's signature checks out. The webhook confirms it as well. */
export async function confirmWindowsLicenceCheckout(a: { orderId: string; paymentId: string; signature: string }) {
  cloudOnly();
  if (!verifyCheckout(a.orderId, a.paymentId, a.signature)) throw new UserError("Razorpay couldn't confirm this payment. If money left your account, your licence arrives once Razorpay tells us.");
  const done = await markPaid({ razorpayOrderId: a.orderId }, a.paymentId, null);
  if (!done) throw new UserError("Payment not found.");
  return { paid: done.status === "PAID" };
}

/** Development and tests only (no Razorpay keys): the payment is simulated. Never on a live server. */
export async function confirmWindowsLicenceDemo(id: string) {
  cloudOnly();
  if (process.env.NODE_ENV === "production") throw new UserError("Payments are made with Razorpay.");
  const o = await db.windowsLicenceOrder.findUnique({ where: { id } });
  if (!o || o.razorpayOrderId) throw new UserError("Payment not found.");
  return markPaid({ id }, null, null);
}

type RzpPayment = { id?: string; order_id?: string; amount?: number; notes?: Record<string, string> | unknown[] };

/** Razorpay's webhook for FITRON's account: a captured or failed payment for a Windows licence. Null when it is not one. */
export async function applyWindowsLicencePayment(event: string, pay: RzpPayment): Promise<string | null> {
  if (!pay.order_id) return null;
  const order = await db.windowsLicenceOrder.findUnique({ where: { razorpayOrderId: pay.order_id }, select: { id: true, status: true } });
  if (!order) return null;
  if (event === "payment.captured" && pay.id) {
    const done = await markPaid({ id: order.id }, pay.id, typeof pay.amount === "number" ? pay.amount : null);
    return done?.status === "PAID" ? "paid" : "held";
  }
  if (event === "payment.failed" && order.status === "PENDING") {
    await db.windowsLicenceOrder.update({ where: { id: order.id }, data: { status: "FAILED" } });
    return "failed";
  }
  return "ignored";
}

export type ClaimAnswer = { status: "paid"; licence: string } | { status: "preparing" } | { status: "pending" } | { status: "none" };

/**
 * The computer collects what it bought: the newest paid licence for its installation and claim. A paid order whose
 * licence is not signed yet (the key was missing) is signed now if the key has been set since.
 */
export async function claimWindowsLicence(input: { installationId?: unknown; claim?: unknown }): Promise<ClaimAnswer> {
  cloudOnly();
  const installationId = typeof input.installationId === "string" ? input.installationId : "";
  const claim = typeof input.claim === "string" ? input.claim : "";
  if (!INSTALLATION_ID.test(installationId) || !CLAIM.test(claim)) return { status: "none" };
  const mine = { installationId, claimHash: claimHash(claim) };
  const paid = await db.windowsLicenceOrder.findFirst({ where: { ...mine, status: "PAID" }, orderBy: { paidAt: "desc" } });
  if (paid) {
    if (paid.licenceText) return { status: "paid", licence: paid.licenceText };
    const licence = sign(paid, paid.paidAt ? todayIso(paid.paidAt) : todayIso());
    if (!licence) return { status: "preparing" };
    const done = await db.windowsLicenceOrder.updateMany({ where: { id: paid.id, licenceText: null }, data: licence });
    if (done.count) return { status: "paid", licence: licence.licenceText };
    const again = await db.windowsLicenceOrder.findUniqueOrThrow({ where: { id: paid.id }, select: { licenceText: true } });
    return again.licenceText ? { status: "paid", licence: again.licenceText } : { status: "preparing" };
  }
  return (await db.windowsLicenceOrder.count({ where: { ...mine, status: "PENDING" } })) ? { status: "pending" } : { status: "none" };
}
