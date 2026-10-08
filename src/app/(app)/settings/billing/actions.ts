"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";
import "@/lib/zod-config";
import { requirePermission } from "@/lib/auth/current";
import { cancelAutoRenewal, confirmCheckout, confirmDemoPayment, confirmSubscription, quoteGymCoupon, startPayment, type Checkout } from "@/lib/services/saas";
import { saveBillingDetails as saveDetails, saveRenewalReminders as saveReminders } from "@/lib/services/subscription";
import { billingDetailsInput, renewalInput } from "@/lib/validation/settings";
import { UserError } from "@/lib/services/errors";
import { log } from "@/lib/log";

type Result<T = null> = { ok: true; data: T } | { ok: false; error: string };

async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    log.error("fitron_billing.failed", e);
    return { ok: false, error: "Couldn't start the payment. Try again in a minute." };
  }
}

const For = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PLAN"), plan: z.string().min(1) }),
  z.object({ kind: z.literal("BRANCH"), branchId: z.string().nullable() }),
  z.object({ kind: z.literal("SERVICE"), service: z.string().min(1), amount: z.number().int().positive().optional() }),
]);

/** `cycle` is MONTHLY or YEARLY for a plan or branch, and ONCE for a one-time add-on. `coupon` is the code typed in the coupon box, if any. */
export async function startPaymentAction(what: unknown, cycle: string, coupon?: string): Promise<Result<Checkout>> {
  const u = await requirePermission("settings.manage", { allowBlocked: true });
  const c = z.enum(["MONTHLY", "YEARLY", "ONCE"]).safeParse(cycle);
  if (!c.success) return { ok: false, error: "Pick monthly or yearly." };
  const w = For.safeParse(what);
  if (!w.success) return { ok: false, error: "Pick what to pay for." };
  const r = await wrap(() => startPayment(u, w.data, c.data, typeof coupon === "string" ? coupon : undefined));
  // A coupon that makes the payment free is already paid: the plan has changed.
  if (r.ok && r.data.mode === "FREE") revalidatePath("/", "layout");
  return r;
}

/** The coupon box before paying: what the typed code does to this payment's price, or why it can't be used. Changes nothing. */
export async function previewCouponAction(what: unknown, cycle: string, code: string) {
  const u = await requirePermission("settings.manage", { allowBlocked: true });
  const c = z.enum(["MONTHLY", "YEARLY", "ONCE"]).safeParse(cycle);
  if (!c.success) return { ok: false, error: "Pick monthly or yearly." } as const;
  const w = For.safeParse(what);
  if (!w.success) return { ok: false, error: "Pick what to pay for." } as const;
  return wrap(() => quoteGymCoupon(u, w.data, c.data, String(code)));
}

export async function confirmDemoAction(id: string): Promise<Result> {
  const u = await requirePermission("settings.manage", { allowBlocked: true });
  const r = await wrap(() => confirmDemoPayment(u, id));
  revalidatePath("/", "layout");
  return r.ok ? { ok: true, data: null } : r;
}

export async function confirmCheckoutAction(a: { orderId: string; paymentId: string; signature: string }): Promise<Result> {
  const u = await requirePermission("settings.manage", { allowBlocked: true });
  const r = await wrap(() => confirmCheckout(u, a));
  revalidatePath("/", "layout");
  return r.ok ? { ok: true, data: null } : r;
}

export async function confirmSubscriptionAction(a: { paymentId: string; subscriptionId: string; signature: string }): Promise<Result<{ status: "PAID" | "PROCESSING" }>> {
  const u = await requirePermission("settings.manage", { allowBlocked: true });
  const r = await wrap(() => confirmSubscription(u, a));
  revalidatePath("/", "layout");
  return r;
}

/** Stop a plan or extra branch renewing by itself. It stays valid to the end of the period already paid. */
export async function cancelAutoRenewalAction(id: string): Promise<Result> {
  const u = await requirePermission("settings.manage", { allowBlocked: true });
  const r = await wrap(() => cancelAutoRenewal(u, id));
  revalidatePath("/", "layout");
  return r.ok ? { ok: true, data: null } : r;
}

const back = (params: Record<string, string>) => redirect(`/settings/billing?${new URLSearchParams(params)}`);

/** Settings › Subscription forms: save, then back to the page with a notice (same pattern as Settings). */
async function save<T extends z.ZodType>(schema: T, fd: FormData, section: string, fn: (v: z.infer<T>) => Promise<void>) {
  const parsed = schema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) back({ error: parsed.error.issues[0]?.message ?? "Check the form.", section });
  try {
    await fn(parsed.data as z.infer<T>);
  } catch (e) {
    if (e instanceof UserError) back({ error: e.message, section });
    throw e;
  }
  revalidatePath("/settings/billing");
  revalidatePath("/", "layout");
  back({ saved: section });
}

/** Renewal reminders: how many days ahead, and whether WhatsApp and email go out. A lapsed gym can still change this. */
export async function saveRenewalReminders(fd: FormData) {
  const u = await requirePermission("settings.manage", { allowBlocked: true });
  await save(renewalInput, fd, "reminders", (v) => saveReminders(u, v));
}

/** Billing details printed on FITRON's receipts. A lapsed gym can still change this. */
export async function saveBillingDetails(fd: FormData) {
  const u = await requirePermission("settings.manage", { allowBlocked: true });
  await save(billingDetailsInput, fd, "details", (v) => saveDetails(u, v));
}
