import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { log } from "@/lib/log";

// Razorpay Subscriptions (UPI Autopay). Keys live only in the server environment:
// RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET.

const env = (k: string) => process.env[k]?.trim() || "";
export const razorpayReady = () => (env("RAZORPAY_KEY_ID") && env("RAZORPAY_KEY_SECRET") ? null : "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not set on the server.");

/** Which Razorpay account: the gym's (member autopay) or Fitron's own (branch billing). */
type Account = "GYM" | "FITRON";
const keys = (a: Account) => (a === "GYM" ? { id: env("RAZORPAY_KEY_ID"), secret: env("RAZORPAY_KEY_SECRET") } : { id: env("FITRON_RAZORPAY_KEY_ID"), secret: env("FITRON_RAZORPAY_KEY_SECRET") });

async function rzp<T>(method: "GET" | "POST", path: string, body?: unknown, account: Account = "GYM"): Promise<T> {
  const k = keys(account);
  if (!k.id || !k.secret) throw new Error(account === "GYM" ? razorpayReady()! : "FITRON_RAZORPAY_KEY_ID and FITRON_RAZORPAY_KEY_SECRET are not set on the server.");
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: { Authorization: `Basic ${Buffer.from(`${k.id}:${k.secret}`).toString("base64")}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
  if (!res.ok) throw new Error(json.error?.description ?? `Razorpay returned ${res.status}`);
  return json;
}

/** "Test connection": the cheapest authenticated call. A wrong key surfaces as Razorpay's own description. */
export const pingRazorpay = () => rzp<{ items?: unknown[] }>("GET", "/plans?count=1");

/** A plan that charges `amount` paise every `months` months. */
export const createPlan = (amount: number, months: number, name: string) =>
  rzp<{ id: string }>("POST", "/plans", { period: "monthly", interval: months, item: { name, amount, currency: "INR" } }).then((p) => p.id);

export type Subscription = { id: string; short_url?: string; status: string; charge_at?: number | null };

export const createSubscription = (a: { planId: string; startAt?: Date; notes: Record<string, string> }) =>
  rzp<Subscription>("POST", "/subscriptions", {
    plan_id: a.planId,
    total_count: 120,
    quantity: 1,
    customer_notify: 1,
    ...(a.startAt && a.startAt.getTime() > Date.now() + 60_000 ? { start_at: Math.floor(a.startAt.getTime() / 1000) } : {}),
    notes: a.notes,
  });

export const subscriptionAction = (id: string, action: "pause" | "resume" | "cancel") =>
  rzp<Subscription>("POST", `/subscriptions/${id}/${action}`, action === "pause" ? { pause_at: "now" } : action === "resume" ? { resume_at: "now" } : { cancel_at_cycle_end: 0 });

export type SubscriptionState = { id: string; status: string; charge_at?: number | null; paid_count?: number; current_end?: number | null; ended_at?: number | null; notes?: Record<string, string> };
export const getSubscription = (id: string) => rzp<SubscriptionState>("GET", `/subscriptions/${encodeURIComponent(id)}`);

export type SubscriptionInvoice = { id: string; status: string; payment_id?: string | null; amount?: number; paid_at?: number | null };
export const listSubscriptionInvoices = (id: string) => rzp<{ items?: SubscriptionInvoice[] }>("GET", `/invoices?subscription_id=${encodeURIComponent(id)}&count=100`);

export const getPayment = (id: string) => rzp<{ id: string; status: string; error_description?: string | null }>("GET", `/payments/${encodeURIComponent(id)}`);

/** Razorpay signs the raw request body with the webhook secret (HMAC-SHA256, hex). */
export function verifyWebhook(rawBody: string, signature: string | null, secret = env("RAZORPAY_WEBHOOK_SECRET")) {
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Fitron's own account: extra-branch payments through Razorpay Checkout ──

/** Fitron's keys are Razorpay test keys (rzp_test_): no money moves, and the live plan ids don't exist in that account. */
export const fitronTestMode = () => env("FITRON_RAZORPAY_KEY_ID").startsWith("rzp_test_");

let warnedTestKeys = false;

/**
 * The public key id Checkout needs, or null when Fitron's keys aren't set (demo mode). Test keys count as not set on a
 * live server unless FITRON_ALLOW_TEST_PAYMENTS=1: a test payment is free, so it would give a real plan away.
 */
export const fitronKeyId = () => {
  const id = env("FITRON_RAZORPAY_KEY_ID");
  if (!id || !env("FITRON_RAZORPAY_KEY_SECRET")) return null;
  if (fitronTestMode() && process.env.NODE_ENV === "production" && env("FITRON_ALLOW_TEST_PAYMENTS") !== "1") {
    if (!warnedTestKeys) {
      warnedTestKeys = true;
      log.warn("razorpay.test_keys_refused", new Error("FITRON_RAZORPAY_KEY_ID is a test key on a live server. Set FITRON_ALLOW_TEST_PAYMENTS=1 to try payments, or use live keys."));
    }
    return null;
  }
  return id;
};

export const createOrder = (a: { amount: number; receipt: string; notes: Record<string, string> }) =>
  rzp<{ id: string; amount: number; status: string }>("POST", "/orders", { amount: a.amount, currency: "INR", receipt: a.receipt, notes: a.notes }, "FITRON");

/** Checkout's success handler returns this signature: HMAC-SHA256 of "order_id|payment_id" with the key secret. */
export function verifyCheckout(orderId: string, paymentId: string, signature: string) {
  const secret = env("FITRON_RAZORPAY_KEY_SECRET");
  if (!secret || !signature) return false;
  return verifyWebhook(`${orderId}|${paymentId}`, signature, secret);
}

export const fitronWebhookSecret = () => env("FITRON_RAZORPAY_WEBHOOK_SECRET");

// ── Fitron's own account: plans that renew themselves (Razorpay Subscriptions) ──

export type FitronSubscription = { id: string; status: string; plan_id?: string; charge_at?: number | null; paid_count?: number; current_end?: number | null };

/** A subscription on one of FITRON's Razorpay plans. The customer authorises and pays the first period in Checkout. */
export const createFitronSubscription = (a: { planId: string; totalCount: number; notes: Record<string, string> }) =>
  rzp<FitronSubscription>("POST", "/subscriptions", { plan_id: a.planId, total_count: a.totalCount, quantity: 1, customer_notify: 1, notes: a.notes }, "FITRON");

/** A plan's per-period amount (paise), to be sure the plan id charges what the price list says before anyone is sent to pay. */
export const getFitronPlan = (id: string) => rzp<{ id: string; period?: string; interval?: number; item?: { amount?: number; currency?: string } }>("GET", `/plans/${encodeURIComponent(id)}`, undefined, "FITRON");

export type FitronPlan = { id: string; period?: string; interval?: number; item?: { name?: string; amount?: number; currency?: string } };

/** One page (up to 100) of the plans in Fitron's Razorpay account. */
export const listFitronPlans = (skip: number) => rzp<{ items?: FitronPlan[] }>("GET", `/plans?count=100&skip=${skip}`, undefined, "FITRON");

/** A plan that charges `amount` paise every month or year. Only used in test mode, to make the test plans. */
export const createFitronPlan = (a: { name: string; period: "monthly" | "yearly"; amount: number }) =>
  rzp<FitronPlan>("POST", "/plans", { period: a.period, interval: 1, item: { name: a.name, amount: a.amount, currency: "INR" } }, "FITRON");

export const getFitronSubscription = (id: string) => rzp<FitronSubscription>("GET", `/subscriptions/${encodeURIComponent(id)}`, undefined, "FITRON");

export const getFitronPayment = (id: string) => rzp<{ id: string; status: string; amount?: number; captured?: boolean }>("GET", `/payments/${encodeURIComponent(id)}`, undefined, "FITRON");

/** Stops future charges now. What was already paid for stays valid: access runs on the paid period, not on Razorpay's state. */
export const cancelFitronSubscription = (id: string) => rzp<FitronSubscription>("POST", `/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: 0 }, "FITRON");

/** Checkout's success handler for a subscription returns this signature: HMAC-SHA256 of "payment_id|subscription_id" with the key secret. */
export function verifySubscriptionPayment(paymentId: string, subscriptionId: string, signature: string) {
  const secret = env("FITRON_RAZORPAY_KEY_SECRET");
  if (!secret || !signature || !paymentId || !subscriptionId) return false;
  return verifyWebhook(`${paymentId}|${subscriptionId}`, signature, secret);
}
