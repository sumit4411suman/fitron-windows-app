import "server-only";
import { db } from "@/lib/db";
import type { Prisma, RazorpaySubscription } from "@/generated/prisma/client";
import { addDays } from "@/lib/domain/dates";
import { findPlan, type Cycle } from "@/lib/domain/pricing";
import { razorpayPlan } from "@/lib/domain/razorpay-plans";
import { gstInside } from "@/lib/domain/saas";
import { trainerPeriod } from "@/lib/domain/trainer";
import { sendEmail } from "@/lib/integrations/email";
import { getFitronPayment, verifyCheckout, verifySubscriptionPayment } from "@/lib/integrations/razorpay";
import { markCouponUsed } from "./coupons";
import { UserError } from "./errors";
import { lockSubscription, markCharged, renewingSubscriptions, stopSubscription } from "./subscriptions";
import { fromIso, toIso, todayIso } from "./time";
import { log } from "@/lib/log";

// What a payment does for an AI Trainer member: the plan and the paid period, when Razorpay charges a subscription that renews itself (below).

const label = (plan: string, cycle: string) => `${findPlan(plan)?.name ?? plan}, ${cycle === "YEARLY" ? "yearly" : "monthly"}`;

/**
 * Marks a member's payment paid, once: sets the plan and the paid period (one period after what they already have).
 * A move to AI Pro waits until the AI Premium time already paid for runs out; a move up to AI Premium starts at once.
 * `keepPlan`: the payment came from a subscription the member has already moved off, so it extends the time but does
 * not switch the plan back.
 */
export async function activateTrainerPaymentIn(tx: Prisma.TransactionClient, id: string, opts: { keepPlan?: boolean } = {}) {
  const today = todayIso();
  await tx.$queryRaw`SELECT id FROM "TrainerPayment" WHERE id = ${id} FOR UPDATE`;
  const fresh = await tx.trainerPayment.findUniqueOrThrow({ where: { id }, include: { member: true } });
  if (fresh.status === "PAID") return fresh;
  const m = fresh.member;
  const trialLast = m.trialEndsAt ? addDays(todayIso(m.trialEndsAt), -1) : null;
  const period = trainerPeriod(fresh.cycle as Cycle, today, m.paidUntil ? toIso(m.paidUntil) : null, trialLast);
  const paidPremiumLeft = m.plan === "ai-premium" && !!m.paidUntil && toIso(m.paidUntil) >= today;
  const plan = opts.keepPlan || (fresh.plan === "ai-pro" && paidPremiumLeft) ? m.plan : fresh.plan;
  await tx.trainerMember.update({ where: { id: m.id }, data: { plan, ...(opts.keepPlan ? {} : { cycle: fresh.cycle }), paidUntil: fromIso(period.end), planCancelled: false } });
  return tx.trainerPayment.update({
    where: { id },
    data: { status: "PAID", paidAt: new Date(), periodStart: fromIso(period.start), periodEnd: fromIso(period.end) },
    include: { member: true },
  });
}

/**
 * A charge on a member's Razorpay subscription: Checkout's reply for the first payment, or Razorpay's webhook for any
 * payment. The first charge pays the row made when the member started; each renewal is a new row. One at a time per
 * subscription, and a payment already recorded changes nothing.
 */
export async function recordTrainerCharge(subId: string, paymentId: string, amount: number | null) {
  const out = await db.$transaction(async (tx) => {
    await lockSubscription(tx, subId);
    const seen = await tx.trainerPayment.findUnique({ where: { razorpayPaymentId: paymentId } });
    if (seen) return { row: seen, fresh: false, sub: null, renewal: false };
    const sub = await tx.razorpaySubscription.findUniqueOrThrow({ where: { id: subId } });
    if (!sub.memberId || !sub.plan) throw new Error(`Subscription ${subId} has no member`);
    let row = await tx.trainerPayment.findFirst({ where: { razorpaySubscriptionId: subId, status: "PENDING" }, orderBy: { createdAt: "asc" } });
    const renewal = !row;
    const listed = amount ?? razorpayPlan(sub.plan, sub.cycle)?.amount;
    if (!listed) throw new Error(`Don't know what subscription ${subId} charges`);
    const money = gstInside(listed);
    if (!row) {
      row = await tx.trainerPayment.create({
        data: { memberId: sub.memberId, plan: sub.plan, cycle: sub.cycle, kind: "renew", ...money, gstIncluded: true, mode: "SUBSCRIPTION", razorpaySubscriptionId: subId },
      });
    } else if (row.total !== listed) {
      log.warn("trainer_billing.subscription_amount_differs", new Error(`Subscription ${subId} charged ${listed}, expected ${row.total}`));
      row = await tx.trainerPayment.update({ where: { id: row.id }, data: money });
    }
    await tx.trainerPayment.update({ where: { id: row.id }, data: { razorpayPaymentId: paymentId } });
    // A subscription the member has already moved off (another plan paid, or renewal stopped) must not switch the plan back.
    const movedOn = !!sub.cancelledAt && !!(await tx.trainerPayment.findFirst({ where: { memberId: sub.memberId, status: "PAID", createdAt: { gt: sub.createdAt }, NOT: { razorpaySubscriptionId: subId } }, select: { id: true } }));
    const done = await activateTrainerPaymentIn(tx, row.id, { keepPlan: movedOn });
    await markCharged(tx, subId);
    return { row: done, fresh: true, sub, renewal };
  });
  if (out.fresh && out.sub) {
    const sub = out.sub as RazorpaySubscription;
    // We had stopped this one but it charged anyway (the stop never reached Razorpay): try again.
    if (sub.cancelledAt) await stopSubscription(sub.id);
    // The member paid for another plan: the old plan's renewal ends so it is not charged twice.
    else if (!out.renewal) for (const other of await renewingSubscriptions({ memberId: sub.memberId!, kind: "TRAINER" })) if (other.id !== sub.id) await stopSubscription(other.id);
    if (out.renewal) {
      await sendEmail({
        to: out.row.member.email,
        subject: "Your FITRON plan renewed",
        text: `Hi ${out.row.member.name || "there"},\n\nYour ${label(out.row.plan, out.row.cycle)} plan renewed automatically: Rs ${(out.row.total / 100).toFixed(2)} charged, active until ${out.row.periodEnd ? toIso(out.row.periodEnd) : ""}.\nTo stop renewals, open the app, Settings, Subscription.\n\nFITRON\nhello@fitron.in`,
      }).catch((e) => log.error("trainer_billing.renewal_email_failed", e));
    }
  }
  return out;
}

/**
 * Checkout's success handler for the member's first payment. Trusted only when Razorpay's signature checks out and
 * Razorpay says the payment went through; the webhook records it too, whichever comes first.
 */
export async function confirmTrainerSubscription(memberId: string, id: string, a: { paymentId: string; subscriptionId: string; signature: string }) {
  const p = await db.trainerPayment.findFirst({ where: { id, memberId, mode: "SUBSCRIPTION", razorpaySubscriptionId: a.subscriptionId } });
  if (!p) throw new UserError("Payment not found. Close this and start again.");
  if (!verifySubscriptionPayment(a.paymentId, a.subscriptionId, a.signature)) throw new UserError("Razorpay couldn't confirm this payment. If money left your account, your plan turns on once Razorpay tells us.");
  const pay = await getFitronPayment(a.paymentId);
  if (pay.status !== "captured") return { status: "PROCESSING" as const };
  const { row } = await recordTrainerCharge(a.subscriptionId, a.paymentId, pay.amount ?? null);
  return { status: row.status === "PAID" ? ("PAID" as const) : ("PROCESSING" as const) };
}

/**
 * A plan paid for with a coupon is one payment, not a subscription. If the member has plans renewing by themselves other than
 * this one, their next charge would switch the plan back, so they stop (the same as when a member pays for another plan).
 */
async function afterCouponPayment(p: { memberId: string; plan: string; cycle: string; couponCode: string | null }) {
  if (!p.couponCode) return;
  for (const other of await renewingSubscriptions({ memberId: p.memberId, kind: "TRAINER" })) if (other.plan !== p.plan || other.cycle !== p.cycle) await stopSubscription(other.id);
}

/**
 * Marks a one-time Razorpay payment (made at a coupon's price) paid, once, and turns the plan on. `paymentId` is null for a
 * 100% coupon, which has nothing to pay. Checkout's reply and Razorpay's webhook both call this: the second changes nothing.
 */
export async function completeTrainerPayment(where: { id: string } | { razorpayOrderId: string }, paymentId: string | null) {
  const out = await db.$transaction(async (tx) => {
    const p = await tx.trainerPayment.findFirst({ where, select: { id: true } });
    if (!p) return null;
    const done = await activateTrainerPaymentIn(tx, p.id);
    if (paymentId) await tx.trainerPayment.updateMany({ where: { id: p.id, razorpayPaymentId: null }, data: { razorpayPaymentId: paymentId } });
    await markCouponUsed(tx, p.id);
    return done;
  });
  if (out) await afterCouponPayment(out);
  return out;
}

/** Checkout's success handler for a payment made at a coupon's price. Trusted only when Razorpay's signature checks out; the webhook records it too. */
export async function confirmTrainerOrder(memberId: string, id: string, a: { orderId: string; paymentId: string; signature: string }) {
  const p = await db.trainerPayment.findFirst({ where: { id, memberId, razorpayOrderId: a.orderId } });
  if (!p) throw new UserError("Payment not found. Close this and start again.");
  if (!verifyCheckout(a.orderId, a.paymentId, a.signature)) throw new UserError("Razorpay couldn't confirm this payment. If money left your account, your plan turns on once Razorpay tells us.");
  const row = await completeTrainerPayment({ id: p.id }, a.paymentId);
  return { status: row?.status === "PAID" ? ("PAID" as const) : ("PROCESSING" as const) };
}

/** Razorpay could not charge a renewal (pending: it will retry) or gave up (halted). The member is told by email. */
export async function trainerRenewalTrouble(sub: RazorpaySubscription, halted: boolean) {
  const m = sub.memberId ? await db.trainerMember.findUnique({ where: { id: sub.memberId }, select: { email: true, name: true, deletedEmailHash: true } }) : null;
  if (!m || m.deletedEmailHash) return;
  await sendEmail({
    to: m.email,
    subject: halted ? "Your FITRON plan stopped renewing" : "Your FITRON renewal payment failed",
    text: `Hi ${m.name || "there"},\n\n${
      halted
        ? "Automatic renewal of your plan has stopped after repeated failed charges. It stays active until the end of the period you already paid for. To keep it going, pick your plan again in the app, Settings, Subscription."
        : "We couldn't charge the renewal of your plan. Razorpay will try again in a day or two, so check that your UPI app or card has the money. It stays active until the end of the period you already paid for."
    }\n\nFITRON\nhello@fitron.in`,
  }).catch((e) => log.error("trainer_billing.trouble_email_failed", e));
}

/** Whether the member's plan renews itself, and when it is next charged, for the app's Subscription screen. */
export async function trainerRenewal(memberId: string) {
  const [live] = await renewingSubscriptions({ memberId, kind: "TRAINER" });
  return { autoRenew: !!live, nextChargeAt: live?.nextChargeAt ? toIso(live.nextChargeAt) : null };
}
