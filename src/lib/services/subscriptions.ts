import "server-only";
import { db } from "@/lib/db";
import type { Prisma, RazorpaySubscription } from "@/generated/prisma/client";
import type { Cycle } from "@/lib/domain/pricing";
import { BRANCH_PLAN_KEY, RENEWING_STATUSES, razorpayPlan, SUBSCRIPTION_CHARGES, type RazorpayPlan, type SubscriptionKind } from "@/lib/domain/razorpay-plans";
import { cancelFitronSubscription, createFitronPlan, createFitronSubscription, fitronKeyId, fitronTestMode, getFitronPlan, getFitronSubscription, listFitronPlans } from "@/lib/integrations/razorpay";
import { UserError } from "./errors";
import { log } from "@/lib/log";

// Plans that renew themselves through Razorpay Subscriptions (FITRON's own account). This file is the bookkeeping
// of the subscriptions themselves: make one, stop one, keep our copy of its state. What a charge does for a gym or
// an AI Trainer member (period, invoice, plan) is in saas.ts and trainer-billing.ts.

type Tx = Prisma.TransactionClient | typeof db;

/** Fitron's Razorpay keys are set, so the plans that have a Razorpay plan renew themselves. */
export const subscriptionsLive = () => fitronKeyId() !== null;

export type NewSubscription = {
  kind: SubscriptionKind;
  /** Plan key from pricing.ts; null for an extra branch. */
  plan: string | null;
  cycle: Cycle;
  /** What the price list says one period costs (paise, GST included): the Razorpay plan must charge exactly this. */
  expectedTotal: number;
  orgId?: string;
  memberId?: string;
  branchId?: string | null;
};

const testPlanIds = new Map<string, string>();

/**
 * The Razorpay plan id to subscribe to. With live keys it is the id in razorpay-plans.ts. A test account has none of
 * those plans, so with test keys the plan is looked up by name in the test account, and made once if it is missing.
 */
async function planIdFor(entry: RazorpayPlan, planKey: string, cycle: Cycle): Promise<string> {
  if (!fitronTestMode()) return entry.id;
  const name = `FITRON test ${planKey} ${cycle.toLowerCase()}`;
  const period = cycle === "YEARLY" ? "yearly" : "monthly";
  const cacheKey = `${fitronKeyId() ?? ""}|${name}|${entry.amount}`;
  const known = testPlanIds.get(cacheKey);
  if (known) return known;
  let id: string | undefined;
  for (let skip = 0; skip < 500 && !id; skip += 100) {
    const page = (await listFitronPlans(skip)).items ?? [];
    id = page.find((p) => p.item?.name === name && p.item.amount === entry.amount && (p.item.currency ?? "INR") === "INR" && p.period === period && (p.interval ?? 1) === 1)?.id;
    if (page.length < 100) break;
  }
  id ??= (await createFitronPlan({ name, period, amount: entry.amount })).id;
  testPlanIds.set(cacheKey, id);
  return id;
}

/**
 * Makes the Razorpay subscription and keeps a row for it. The live plan's amount is checked first: a plan id whose
 * price drifted from the price list would charge people something other than what they were shown.
 */
export async function createSubscription(a: NewSubscription): Promise<RazorpaySubscription> {
  const planKey = a.kind === "BRANCH" ? BRANCH_PLAN_KEY : a.plan;
  const entry = razorpayPlan(planKey, a.cycle);
  if (!entry || entry.amount !== a.expectedTotal) throw new Error(`No Razorpay plan charges ${a.expectedTotal} paise for ${a.plan ?? BRANCH_PLAN_KEY} ${a.cycle}`);
  const planId = await planIdFor(entry, planKey ?? BRANCH_PLAN_KEY, a.cycle);
  const live = await getFitronPlan(planId);
  if (live.item?.amount !== entry.amount || (live.item?.currency ?? "INR") !== "INR") {
    log.error("subscriptions.plan_mismatch", new Error(`Razorpay plan ${planId} charges ${live.item?.amount} ${live.item?.currency}, the price list says ${entry.amount} INR`));
    throw new UserError("Online payment for this plan isn't set up correctly yet. Write to hello@fitron.in and we will sort it out.");
  }
  const notes: Record<string, string> = { kind: a.kind, cycle: a.cycle, ...(a.plan ? { plan: a.plan } : {}), ...(a.orgId ? { org: a.orgId } : {}), ...(a.memberId ? { member: a.memberId } : {}), ...(a.branchId ? { branch: a.branchId } : {}) };
  const sub = await createFitronSubscription({ planId, totalCount: SUBSCRIPTION_CHARGES[a.cycle], notes });
  return db.razorpaySubscription.create({
    data: { id: sub.id, kind: a.kind, orgId: a.orgId ?? null, memberId: a.memberId ?? null, plan: a.plan, branchId: a.branchId ?? null, cycle: a.cycle, status: sub.status || "created" },
  });
}

const GONE = ["cancelled", "completed", "expired"];

/**
 * Stops a subscription. The intent is written first (`cancelledAt`), so a charge already on its way is not mistaken
 * for the plan continuing; then Razorpay is told, and only when it confirms is the status "cancelled". Returns false
 * when Razorpay could not be reached: the subscription then still shows as renewing, with `cancelledAt` set (a stop
 * waiting to be confirmed), so it can be tried again, by the gym or member or by the next charge that arrives for it.
 * A subscription Razorpay has already ended counts as stopped.
 */
export async function stopSubscription(id: string): Promise<boolean> {
  await db.razorpaySubscription.updateMany({ where: { id, cancelledAt: null }, data: { cancelledAt: new Date() } });
  try {
    await cancelFitronSubscription(id);
  } catch (e) {
    const state = await getFitronSubscription(id).catch(() => null);
    if (!state || !GONE.includes(state.status)) {
      log.error("subscriptions.cancel_failed", e, { subscription: id });
      return false;
    }
  }
  await db.razorpaySubscription.updateMany({ where: { id, status: { notIn: GONE } }, data: { status: "cancelled" } });
  return true;
}

/**
 * Subscriptions Razorpay may still charge: authorised, active, pending a retry or paused. One we asked to stop but
 * Razorpay has not confirmed is still here, with `cancelledAt` set (see stopSubscription).
 */
export const renewingSubscriptions = (where: { orgId?: string; memberId?: string; kind?: SubscriptionKind }, tx: Tx = db) =>
  tx.razorpaySubscription.findMany({ where: { ...where, status: { in: [...RENEWING_STATUSES] } }, orderBy: { createdAt: "desc" } });

export type SubscriptionEntity = { id?: string; status?: string; charge_at?: number | null; paid_count?: number };

/** Keeps our copy of a subscription in step with what Razorpay reports. One whose stop Razorpay confirmed never shows as renewing again, whatever a late event says. */
export async function syncSubscription(e: SubscriptionEntity, tx: Tx = db) {
  if (!e.id) return null;
  const row = await tx.razorpaySubscription.findUnique({ where: { id: e.id } });
  if (!row) return null;
  const status = e.status ? (row.status === "cancelled" && (RENEWING_STATUSES as readonly string[]).includes(e.status) ? "cancelled" : e.status) : row.status;
  return tx.razorpaySubscription.update({
    where: { id: e.id },
    data: { status, ...(typeof e.paid_count === "number" ? { paidCount: e.paid_count } : {}), ...(e.charge_at !== undefined ? { nextChargeAt: e.charge_at ? new Date(e.charge_at * 1000) : null } : {}) },
  });
}

/**
 * A payment on a subscription has been captured, so it is live: shown as renewing straight away, without waiting for
 * Razorpay's webhook to say so. (Not when we have already asked to stop it.)
 */
export const markCharged = (tx: Prisma.TransactionClient, id: string) =>
  tx.razorpaySubscription.updateMany({ where: { id, status: { in: ["created", "authenticated"] }, cancelledAt: null }, data: { status: "active" } });

/** One charge at a time per subscription: the checkout's reply and Razorpay's webhook for the same payment arrive together. */
// The lock function returns `void`, which the Prisma driver can't read back as a column, so it is run with $executeRaw.
export const lockSubscription = (tx: Prisma.TransactionClient, id: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
