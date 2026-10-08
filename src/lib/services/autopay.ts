import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { writeBranch } from "@/lib/auth/current";
import { systemUser } from "@/lib/auth/system";
import type { Prisma } from "@/generated/prisma/client";
import { addDays } from "@/lib/domain/dates";
import { invoiceTotals } from "@/lib/domain/billing";
import { rupeesText } from "@/lib/domain/whatsapp";
import { createPlan, createSubscription, getPayment, getSubscription, listSubscriptionInvoices, pingRazorpay, razorpayReady, subscriptionAction } from "@/lib/integrations/razorpay";
import { simulateDebit } from "@/lib/domain/autopay";
import { fmtDate } from "@/lib/format";
import { withAutopayDefaults, type AutopaySettings } from "@/lib/domain/integrations";
import { audit } from "./audit";
import { sellMembership, suggestedStart } from "./billing";
import { UserError } from "./errors";
import { memberScope } from "./members";
import { nextNumber } from "./sequence";
import { notify } from "./notifications";
import { getSetting, putSetting } from "./settings";
import { getTax } from "./tax";
import { fromIso, toIso, todayIso } from "./time";
import { sendTemplate } from "./whatsapp";

export type AutopayMode = "demo" | "live";
export const getAutopayMode = async (orgId: string): Promise<AutopayMode> => ((await getSetting<{ mode?: AutopayMode }>(orgId, "autopay"))?.mode === "live" ? "live" : "demo");

/** Settings › Integrations & AI › UPI autopay: mode, retries and the last connection check. */
export const getAutopaySettings = async (orgId: string): Promise<AutopaySettings> => withAutopayDefaults(await getSetting<Partial<AutopaySettings>>(orgId, "autopay"));

const webhookSet = () => !!process.env.RAZORPAY_WEBHOOK_SECRET?.trim();

/**
 * "Test connection": in live mode, one authenticated GET to Razorpay with the gym's server keys.
 * The result is stored on the setting (audited, never the secret); the page only shows what was stored.
 */
export async function checkAutopayConnection(u: CurrentUser) {
  const s = await getAutopaySettings(u.orgId);
  if (s.mode !== "live") return s;
  const checkedAt = new Date().toISOString();
  const missing = razorpayReady();
  let result: Partial<AutopaySettings>;
  if (missing) result = { connOk: false, error: missing, webhookOk: false, checkedAt };
  else {
    try {
      await pingRazorpay();
      result = { connOk: true, keyId: process.env.RAZORPAY_KEY_ID?.trim(), webhookOk: webhookSet(), error: undefined, checkedAt };
    } catch (e) {
      result = { connOk: false, error: e instanceof Error ? e.message : String(e), webhookOk: webhookSet(), checkedAt };
    }
  }
  // JSON drops undefined, so a cleared error really goes away.
  await putSetting(u, "autopay", JSON.parse(JSON.stringify(result)));
  return { ...s, ...result };
}

const scope = (u: CurrentUser): Prisma.AutopayMandateWhereInput => ({ orgId: u.orgId, branchId: { in: u.branchIds } });

export async function listMandates(u: CurrentUser, status?: string) {
  const rows = await db.autopayMandate.findMany({
    where: { ...scope(u), ...(status ? { status } : {}) },
    orderBy: [{ status: "asc" }, { nextDebitOn: "asc" }],
    include: { member: { select: { id: true, code: true, name: true, phone: true } } },
  });
  const plans = new Map((await db.membershipPlan.findMany({ where: { orgId: u.orgId }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  return rows.map((r) => ({ ...r, planName: plans.get(r.planId) ?? "—" }));
}

export const getMandate = (u: CurrentUser, id: string) => db.autopayMandate.findFirst({ where: { ...scope(u), id }, include: { member: true, events: { orderBy: { createdAt: "desc" }, take: 30 } } });

/** Plan price after its standard discount, with GST: what each autopay cycle debits. */
async function cycleAmount(orgId: string, plan: { price: number; discount: number; gstApplicable: boolean }) {
  const tax = await getTax(orgId);
  return invoiceTotals([{ qty: 1, rate: plan.price, discount: plan.discount, taxRate: tax.enabled && plan.gstApplicable ? tax.rate : 0 }]).total;
}

/**
 * Sets up autopay for a member on a plan. Live mode creates the Razorpay plan and subscription
 * and sends the approval link on WhatsApp; demo mode waits for "Approve (demo)".
 */
/** A UPI ID: name@handle. */
export const VPA = /^[\w.-]{2,}@[a-z][a-z0-9]{1,}$/i;

/** Finds or creates the Razorpay plan, creates the subscription and stores its id and approval link. */
async function createAtRazorpay(m: { id: string; orgId: string; amount: number; months: number }, plan: { name: string; months: number }, startOn: string, memberCode: string) {
  const plans = (await getSetting<Record<string, string>>(m.orgId, "autopay_plans")) ?? {};
  const key = `${m.amount}|${plan.months}`;
  let rzpPlan = plans[key];
  if (!rzpPlan) {
    rzpPlan = await createPlan(m.amount, plan.months, `${plan.name} (${plan.months} month${plan.months > 1 ? "s" : ""})`);
    const value = { ...plans, [key]: rzpPlan };
    await db.setting.upsert({ where: { orgId_key: { orgId: m.orgId, key: "autopay_plans" } }, create: { orgId: m.orgId, key: "autopay_plans", value }, update: { value } });
  }
  const sub = await createSubscription({ planId: rzpPlan, startAt: fromIso(startOn), notes: { fitron_mandate: m.id, member: memberCode } });
  await db.autopayMandate.update({ where: { id: m.id }, data: { subscriptionId: sub.id, shortUrl: sub.short_url ?? null } });
  return sub.short_url ?? null;
}

export async function createMandate(u: CurrentUser, a: { memberId: string; planId: string; startOn?: string; vpa?: string }) {
  const vpa = a.vpa?.trim().toLowerCase() || null;
  if (vpa && !VPA.test(vpa)) throw new UserError("Enter a UPI ID like name@okicici.", "vpa");
  const member = await db.member.findFirst({ where: { ...memberScope(u), id: a.memberId, walkIn: false } });
  if (!member) throw new UserError("Member not found.", "member");
  const plan = await db.membershipPlan.findFirst({ where: { orgId: u.orgId, id: a.planId, status: "ACTIVE" } });
  if (!plan) throw new UserError("Pick an active plan.", "planId");
  const open = await db.autopayMandate.findFirst({ where: { memberId: member.id, status: { in: ["Pending", "Active", "Paused"] } } });
  if (open) throw new UserError(`${member.name} already has autopay (${open.code}). Cancel it first.`);
  const mode = await getAutopayMode(u.orgId);
  if (mode === "live" && razorpayReady()) throw new UserError(`Autopay is set to live but ${razorpayReady()}`);
  const amount = await cycleAmount(u.orgId, plan);
  const startOn = a.startOn ?? (await suggestedStart(member.id)).start;
  const branchId = member.branchId ?? writeBranch(u);

  const mandate = await db.$transaction(async (tx) => {
    const n = await nextNumber(tx, u.orgId, "mandate", 1001);
    const m = await tx.autopayMandate.create({ data: { code: `MD-${n}`, orgId: u.orgId, branchId, memberId: member.id, planId: plan.id, amount, months: plan.months, mode, vpa, nextDebitOn: fromIso(startOn), createdById: u.id } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "autopay.create", entity: "AutopayMandate", entityId: m.id, after: m });
    return m;
  });

  if (mode === "live") {
    try {
      mandate.shortUrl = await createAtRazorpay(mandate, plan, startOn, member.code);
    } catch (e) {
      await db.autopayMandate.update({ where: { id: mandate.id }, data: { status: "Failed", lastResult: `Razorpay: ${e instanceof Error ? e.message : String(e)}` } });
      throw new UserError(`Razorpay refused the mandate: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await sendTemplate({ orgId: u.orgId, memberId: member.id, key: "mandate", userId: u.id, auto: true, vars: { plan_name: plan.name, amount: rupeesText(amount), link: mandate.shortUrl ?? "(demo mode, no real link)" } }).catch(() => null);
  return mandate;
}

async function update(tx: Prisma.TransactionClient, orgId: string, userId: string | null, id: string, data: Prisma.AutopayMandateUpdateInput, action: string) {
  const before = await tx.autopayMandate.findUniqueOrThrow({ where: { id } });
  const after = await tx.autopayMandate.update({ where: { id }, data });
  await audit(tx, { orgId, userId, action, entity: "AutopayMandate", entityId: id, before, after });
  return after;
}

/** Pause, resume or cancel. Live mandates are changed at Razorpay first. */
export async function changeMandate(u: CurrentUser, id: string, action: "pause" | "resume" | "cancel" | "approve-demo") {
  const m = await db.autopayMandate.findFirst({ where: { ...scope(u), id } });
  if (!m) throw new UserError("Mandate not found.");
  const allowed: Record<typeof action, string[]> = { pause: ["Active"], resume: ["Paused", "Halted", "Failed"], cancel: ["Pending", "Active", "Paused", "Halted", "Failed"], "approve-demo": ["Pending"] };
  if (!allowed[action].includes(m.status)) throw new UserError(`Can't ${action.replace("-demo", "")} a mandate that is ${m.status.toLowerCase()}.`);
  if (action === "approve-demo" && m.mode !== "demo") throw new UserError("Live mandates are approved by the member in their UPI app.");
  if (m.mode === "live" && m.subscriptionId && action !== "approve-demo") {
    try {
      await subscriptionAction(m.subscriptionId, action);
    } catch (e) {
      throw new UserError(`Razorpay: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const status = { pause: "Paused", resume: "Active", cancel: "Cancelled", "approve-demo": "Active" }[action];
  await db.$transaction((tx) => update(tx, u.orgId, u.id, id, { status, retries: action === "resume" ? 0 : undefined, lastResult: action === "approve-demo" ? "Approved (demo)" : undefined }, `autopay.${action}`));
}

/**
 * A successful debit: renews the membership with an AUTOPAY invoice and records the payment.
 * Idempotent on the provider's payment id, so a repeated webhook or job does nothing.
 */
export async function recordCharge(mandateId: string, charge: { paymentId: string; amount: number }) {
  const m = await db.autopayMandate.findUniqueOrThrow({ where: { id: mandateId } });
  if (await db.payment.findFirst({ where: { orgId: m.orgId, txnRef: charge.paymentId } })) return "duplicate";
  const sys = await systemUser(m.orgId, m.createdById);
  const plan = await db.membershipPlan.findFirst({ where: { id: m.planId, orgId: m.orgId } });
  if (!plan || plan.status !== "ACTIVE") {
    await db.$transaction(async (tx) => {
      await update(tx, m.orgId, null, m.id, { lastResult: `Charged ₹${rupeesText(charge.amount)} but the plan is no longer active. Renew by hand.` }, "autopay.charge_unapplied");
      await notify(tx, { orgId: m.orgId, branchId: m.branchId, type: "AUTOPAY", text: `Autopay ${m.code} was charged but its plan is inactive. Renew the member by hand.`, link: `/autopay/${m.id}` });
    });
    return "plan-inactive";
  }
  const { start } = await suggestedStart(m.memberId);
  const total = await cycleAmount(m.orgId, plan);
  const r = await sellMembership(sys, m.memberId, { planId: plan.id, startDate: start, discount: plan.discount, includeRegFee: false, payAmount: Math.min(charge.amount, total), payMethod: "UPI", payRef: charge.paymentId }, { type: "AUTOPAY" });
  const next = addDays(toIso(r.membership.endDate), 1);
  await db.$transaction((tx) => update(tx, m.orgId, null, m.id, { status: "Active", retries: 0, nextRetryOn: null, nextDebitOn: fromIso(next), lastResult: `Charged ₹${rupeesText(charge.amount)} on ${todayIso()} (${r.invoice.number})` }, "autopay.charged"));
  await sendTemplate({ orgId: m.orgId, memberId: m.memberId, key: "renewal", auto: true, invoiceId: r.invoice.id, vars: { invoice_number: r.invoice.number, amount: rupeesText(r.invoice.total) } }).catch(() => null);
  return "renewed";
}

type RzpEvent = {
  event: string;
  payload?: {
    subscription?: { entity?: { id?: string; status?: string; charge_at?: number | null; notes?: Record<string, string> } };
    payment?: { entity?: { id?: string; amount?: number; status?: string; error_description?: string | null; notes?: Record<string, string>; subscription_id?: string } };
  };
};

/** Applies one verified Razorpay webhook. Replays of the same event id are ignored. */
export async function applyRazorpayEvent(eventId: string, ev: RzpEvent) {
  if (await db.autopayEvent.findUnique({ where: { eventId } })) return "duplicate";
  const sub = ev.payload?.subscription?.entity;
  const pay = ev.payload?.payment?.entity;
  const ref = sub?.notes?.fitron_mandate ?? pay?.notes?.fitron_mandate;
  const sid = sub?.id ?? pay?.subscription_id;
  const m = (ref && (await db.autopayMandate.findUnique({ where: { id: ref } }))) || (sid && (await db.autopayMandate.findUnique({ where: { subscriptionId: sid } }))) || null;
  const logged = await db.autopayEvent.create({ data: { eventId, mandateId: m?.id ?? null, type: ev.event, payload: ev as Prisma.InputJsonValue } });
  if (!m) {
    await db.autopayEvent.update({ where: { id: logged.id }, data: { result: "No matching mandate" } });
    return "unknown-mandate";
  }
  const chargeAt = sub?.charge_at ? toIso(new Date(sub.charge_at * 1000 + 330 * 60_000)) : null;
  const set = (data: Prisma.AutopayMandateUpdateInput, alert?: string) =>
    db.$transaction(async (tx) => {
      await update(tx, m.orgId, null, m.id, data, `autopay.${ev.event}`);
      if (alert) await notify(tx, { orgId: m.orgId, branchId: m.branchId, type: "AUTOPAY", text: alert, link: `/autopay/${m.id}` });
    });
  let result: string;
  switch (ev.event) {
    case "subscription.authenticated":
    case "subscription.activated":
    case "subscription.resumed":
      await set({ status: "Active", ...(chargeAt ? { nextDebitOn: fromIso(chargeAt) } : {}), lastResult: ev.event === "subscription.resumed" ? "Resumed" : "Approved by member" });
      result = "active";
      break;
    case "subscription.charged":
      result = pay?.id && pay.amount ? await recordCharge(m.id, { paymentId: pay.id, amount: pay.amount }) : "no-payment";
      if (chargeAt) await db.autopayMandate.update({ where: { id: m.id }, data: { nextDebitOn: fromIso(chargeAt) } });
      break;
    case "subscription.pending":
    case "payment.failed":
      await set({ status: "Failed", retries: { increment: 1 }, lastResult: pay?.error_description ?? "Debit failed; Razorpay will retry" }, `Autopay ${m.code} debit failed: ${pay?.error_description ?? "Razorpay will retry"}`);
      result = "failed";
      break;
    case "subscription.halted":
      await set({ status: "Halted", lastResult: "Retries exhausted. Collect by hand." }, `Autopay ${m.code} stopped after failed retries. Collect the renewal at the desk.`);
      result = "halted";
      break;
    case "subscription.paused":
      await set({ status: "Paused", lastResult: "Paused" });
      result = "paused";
      break;
    case "subscription.cancelled":
    case "subscription.completed":
      await set({ status: "Cancelled", lastResult: ev.event === "subscription.completed" ? "All cycles done" : "Cancelled" });
      result = "cancelled";
      break;
    default:
      result = "ignored";
  }
  await db.autopayEvent.update({ where: { id: logged.id }, data: { result } });
  return result;
}

type DebitResult = { result: "renewed" | "failed" | "halted" | "duplicate" | "plan-inactive"; reason?: string; retries?: number; nextRetryOn?: string | null };

/** One simulated demo debit (settings: retries, retryGap). Success renews; failure schedules a retry or halts. */
async function demoDebit(m: { id: string; orgId: string; branchId: string; memberId: string; code: string; amount: number; retries: number }, today: string, opts?: { roll?: number }, userId: string | null = null): Promise<DebitResult> {
  const st = await getAutopaySettings(m.orgId);
  const o = simulateDebit({ mandateId: m.id, today, retries: m.retries, maxRetries: st.retries, retryGap: st.retryGap, roll: opts?.roll });
  if (o.ok) return { result: (await recordCharge(m.id, { paymentId: `demo_${m.code}_${today}_${m.retries}`, amount: m.amount })) as DebitResult["result"] };
  const text = o.halted
    ? `Autopay ${m.code} stopped after ${st.retries} failed tries: ${o.reason}. Collect the renewal at the desk.`
    : `Autopay ${m.code} debit failed: ${o.reason}. Retry on ${fmtDate(o.nextRetryOn)}.`;
  await db.$transaction(async (tx) => {
    await update(tx, m.orgId, userId, m.id, { status: o.halted ? "Halted" : "Failed", retries: o.retries, nextRetryOn: o.nextRetryOn ? fromIso(o.nextRetryOn) : null, lastResult: o.lastResult }, o.halted ? "autopay.halted" : "autopay.failed");
    await notify(tx, { orgId: m.orgId, branchId: m.branchId, type: "AUTOPAY", text, link: `/autopay/${m.id}` });
  });
  const [member, gym] = await Promise.all([db.member.findUnique({ where: { id: m.memberId }, select: { name: true } }), getSetting<{ name?: string }>(m.orgId, "gym")]);
  const first = member?.name.split(" ")[0] ?? "there";
  const gymName = gym?.name ?? "the gym";
  const body = o.halted
    ? `Hi ${first}, we could not collect your ${gymName} renewal of ₹${rupeesText(m.amount)} after ${st.retries} tries. Please pay at the desk or approve a new autopay.`
    : `Hi ${first}, your UPI autopay of ₹${rupeesText(m.amount)} for ${gymName} did not go through (${o.reason.toLowerCase()}). We will retry on ${fmtDate(o.nextRetryOn)}. Keep the balance ready or pay at the desk.`;
  await sendTemplate({ orgId: m.orgId, memberId: m.memberId, key: "due", auto: true, force: true, body }).catch(() => null);
  return { result: o.halted ? "halted" : "failed", reason: o.reason, retries: o.retries, nextRetryOn: o.nextRetryOn };
}

/**
 * Daily, in demo mode: the simulated debit on the renewal date, and the scheduled retries of failed ones.
 * Live debits come from Razorpay webhooks. The notice a day ahead is the "Autopay debit notice" rule.
 */
export async function runAutopayDay(orgId: string, today = todayIso(), opts?: { roll?: number }) {
  const d = fromIso(today);
  const due = await db.autopayMandate.findMany({ where: { orgId, mode: "demo", OR: [{ status: "Active", nextDebitOn: { lte: d } }, { status: "Failed", nextRetryOn: { lte: d } }] } });
  let charged = 0;
  let failed = 0;
  let halted = 0;
  for (const m of due) {
    const r = await demoDebit(m, today, opts);
    if (r.result === "renewed") charged++;
    else if (r.result === "failed") failed++;
    else if (r.result === "halted") halted++;
  }
  return { charged, failed, halted };
}

/** The Autopay screen's numbers (prototype KPIs): debits due in a week, collected in 30 days, debits per mandate. */
export async function autopayStats(u: CurrentUser, mandates: { id: string; memberId: string; createdAt: Date }[], today = todayIso()) {
  const [collected, charges] = await Promise.all([
    db.payment.aggregate({
      where: { orgId: u.orgId, branchId: { in: u.branchIds }, status: "SUCCESS", date: { gte: fromIso(addDays(today, -30)) }, invoice: { membership: { type: "AUTOPAY" } } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.membership.findMany({ where: { memberId: { in: mandates.map((m) => m.memberId) }, type: "AUTOPAY" }, select: { memberId: true, createdAt: true } }),
  ]);
  const debits = new Map(mandates.map((m) => [m.id, charges.filter((c) => c.memberId === m.memberId && c.createdAt >= m.createdAt).length]));
  return { collected: collected._sum.amount ?? 0, collectedCount: collected._count._all, debits };
}

/** "Retry now" on a failed or halted demo mandate: one more simulated attempt straight away. */
export async function retryDemoDebit(u: CurrentUser, id: string, opts?: { roll?: number }) {
  const m = await db.autopayMandate.findFirst({ where: { ...scope(u), id } });
  if (!m) throw new UserError("Mandate not found.");
  if (m.mode !== "demo") throw new UserError("This is a live mandate. Use the Razorpay retry.");
  if (!["Failed", "Halted"].includes(m.status)) throw new UserError("Only a failed debit can be retried.");
  return demoDebit(m, todayIso(), opts, u.id);
}

export type SyncSummary = { checked: number; charged: number; changed: number; applied: number; errors: number; error?: string };

const RZP_STATUS: Record<string, string> = { created: "Pending", authenticated: "Active", active: "Active", pending: "Failed", halted: "Halted", cancelled: "Cancelled", paused: "Paused", completed: "Cancelled", expired: "Cancelled" };

/**
 * "Sync with Razorpay": pulls each live mandate's subscription and paid invoices and applies what the
 * webhook may have missed. Idempotent: charges dedupe on the payment id, state changes on a sync event id.
 */
export async function syncWithRazorpay(u: CurrentUser | { orgId: string }, opts?: { mandateIds?: string[] }): Promise<SyncSummary> {
  const missing = razorpayReady();
  if (missing) throw new UserError(missing);
  const user = "branchIds" in u ? u : null;
  const orgId = u.orgId;
  const mandates = await db.autopayMandate.findMany({
    where: { orgId, mode: "live", subscriptionId: { not: null }, status: { not: "Cancelled" }, ...(user ? { branchId: { in: user.branchIds } } : {}), ...(opts?.mandateIds ? { id: { in: opts.mandateIds } } : {}) },
  });
  const sum: SyncSummary = { checked: 0, charged: 0, changed: 0, applied: 0, errors: 0 };
  for (const m of mandates) {
    sum.checked++;
    try {
      const sid = m.subscriptionId!;
      const [sub, inv] = await Promise.all([getSubscription(sid), listSubscriptionInvoices(sid)]);
      for (const i of inv.items ?? []) {
        if (i.status !== "paid" || !i.payment_id) continue;
        const eventId = `sync:${sid}:${i.id}`;
        if (await db.autopayEvent.findUnique({ where: { eventId } })) continue;
        const result = await recordCharge(m.id, { paymentId: i.payment_id, amount: i.amount ?? m.amount });
        await db.autopayEvent.create({ data: { eventId, mandateId: m.id, type: "sync.charged", payload: i as unknown as Prisma.InputJsonValue, result } });
        if (result === "renewed") sum.charged++;
      }
      const cur = await db.autopayMandate.findUniqueOrThrow({ where: { id: m.id } });
      const status = RZP_STATUS[sub.status] ?? cur.status;
      const chargeAt = sub.charge_at ? toIso(new Date(sub.charge_at * 1000 + 330 * 60_000)) : null;
      const nextIso = cur.nextDebitOn ? toIso(cur.nextDebitOn) : null;
      const nextDebit = chargeAt && !["Cancelled", "Halted"].includes(status) ? chargeAt : nextIso;
      if (status === cur.status && nextDebit === nextIso) continue;
      let reason = "";
      if (status === "Failed" && cur.status !== "Failed") {
        const lastPaymentId = [...(inv.items ?? [])].reverse().find((i) => i.payment_id && i.status !== "paid")?.payment_id;
        reason = (lastPaymentId && (await getPayment(lastPaymentId).catch(() => null))?.error_description) || "";
      }
      const lastResult = {
        Active: `Synced with Razorpay · active${nextDebit ? `, next debit ${fmtDate(nextDebit)}` : ""}`,
        Failed: reason ? `${reason} · Razorpay is retrying` : "Debit failed; Razorpay is retrying",
        Halted: "Halted by Razorpay after repeated failures. Collect by hand.",
        Cancelled: sub.status === "completed" ? "All cycles done" : "Cancelled at Razorpay",
        Paused: "Paused at Razorpay",
        Pending: "Waiting for the member to approve",
      }[status] ?? "Synced with Razorpay";
      const eventId = `sync:${sid}:${sub.status}:${sub.charge_at ?? 0}:${sub.paid_count ?? 0}`;
      if (await db.autopayEvent.findUnique({ where: { eventId } })) continue;
      await db.$transaction(async (tx) => {
        await update(tx, orgId, user?.id ?? null, m.id, { status, nextDebitOn: nextDebit ? fromIso(nextDebit) : null, lastResult }, "autopay.sync");
        if (status === "Halted" && cur.status !== "Halted") await notify(tx, { orgId, branchId: m.branchId, type: "AUTOPAY", text: `Autopay ${m.code} stopped after failed retries. Collect the renewal at the desk.`, link: `/autopay/${m.id}` });
        if (status === "Failed" && cur.status !== "Failed") await notify(tx, { orgId, branchId: m.branchId, type: "AUTOPAY", text: `Autopay ${m.code} debit failed: ${reason || "Razorpay is retrying"}`, link: `/autopay/${m.id}` });
        await tx.autopayEvent.create({ data: { eventId, mandateId: m.id, type: "subscription.synced", payload: sub as unknown as Prisma.InputJsonValue, result: `${cur.status}→${status}` } });
      });
      sum.changed++;
    } catch (e) {
      sum.errors++;
      sum.error ??= `${m.code}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  sum.applied = sum.charged + sum.changed;
  if (!opts?.mandateIds) {
    const prev = await getSetting<Record<string, unknown>>(orgId, "autopay");
    const value = JSON.parse(JSON.stringify({ ...(prev ?? {}), lastSyncAt: new Date().toISOString(), lastSync: sum })) as Prisma.InputJsonValue;
    await db.$transaction(async (tx) => {
      await tx.setting.upsert({ where: { orgId_key: { orgId, key: "autopay" } }, create: { orgId, key: "autopay", value }, update: { value } });
      await audit(tx, { orgId, userId: user?.id ?? null, action: "autopay.sync", entity: "Setting", entityId: "autopay", after: sum });
    });
  }
  return sum;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The text under "Sync with Razorpay": demo mode only explains; live mode syncs. */
export async function syncOrExplain(u: CurrentUser) {
  if ((await getAutopayMode(u.orgId)) === "demo") {
    const n = await db.autopayMandate.count({ where: { ...scope(u), mode: "live", status: { not: "Cancelled" } } });
    return `Demo mode: nothing to sync. In live mode this asks Razorpay for the latest status, charges and failures of every live mandate and records them here.${n ? ` ${plural(n, "live mandate")} would be checked.` : ""}`;
  }
  const missing = razorpayReady();
  if (missing) throw new UserError(`Live mode, but ${missing}`);
  const r = await syncWithRazorpay(u);
  if (!r.checked && !r.errors) return "No live mandates to sync yet.";
  let msg = r.applied ? `${plural(r.applied, "update")} from Razorpay applied: ${plural(r.charged, "debit")} recorded, ${plural(r.changed, "status change")}.` : `Up to date with Razorpay. ${plural(r.checked, "mandate")} checked.`;
  if (r.errors) msg += ` ${plural(r.errors, "mandate")} could not be checked: ${r.error}`;
  return msg;
}

/** "Retry now" on a live mandate: re-create it at Razorpay, resume a halted one, or ask Razorpay what happened. */
export async function retryLiveDebit(u: CurrentUser, id: string) {
  const m = await db.autopayMandate.findFirst({ where: { ...scope(u), id }, include: { member: { select: { name: true, code: true } } } });
  if (!m) throw new UserError("Mandate not found.");
  if (m.mode !== "live") throw new UserError("This is a demo mandate.");
  if (!["Failed", "Halted"].includes(m.status)) throw new UserError("Only a failed debit can be retried.");
  const missing = razorpayReady();
  if (missing) throw new UserError(`Live mode, but ${missing}`);
  const first = m.member.name.split(" ")[0]!;
  if (!m.subscriptionId) {
    const plan = await db.membershipPlan.findFirst({ where: { id: m.planId, orgId: m.orgId } });
    if (!plan) throw new UserError("The plan of this mandate no longer exists.");
    let link: string | null;
    try {
      link = await createAtRazorpay(m, plan, m.nextDebitOn ? toIso(m.nextDebitOn) : todayIso(), m.member.code);
    } catch (e) {
      throw new UserError(`Razorpay refused the mandate: ${e instanceof Error ? e.message : String(e)}`);
    }
    await db.$transaction((tx) => update(tx, m.orgId, u.id, m.id, { status: "Pending", retries: 0, lastResult: "Approval link sent" }, "autopay.retry"));
    await sendTemplate({ orgId: m.orgId, memberId: m.memberId, key: "mandate", userId: u.id, auto: true, vars: { plan_name: plan.name, amount: rupeesText(m.amount), link: link ?? "(no link)" } }).catch(() => null);
    return `Mandate created on Razorpay. Approval link sent to ${first}.`;
  }
  let resumed = false;
  if (m.status === "Halted") {
    try {
      await subscriptionAction(m.subscriptionId, "resume");
      resumed = true;
    } catch (e) {
      throw new UserError(`Razorpay: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const r = await syncWithRazorpay(u, { mandateIds: [m.id] });
  const after = await db.autopayMandate.findUniqueOrThrow({ where: { id: m.id } });
  await db.$transaction((tx) => audit(tx, { orgId: m.orgId, userId: u.id, action: "autopay.retry", entity: "AutopayMandate", entityId: m.id, before: m, after }));
  if (r.errors) throw new UserError(`Razorpay: ${r.error}`);
  if (r.charged) return "Debit succeeded. Membership renewed and invoice sent.";
  const next = after.nextDebitOn && after.status === "Active" ? ` · next attempt ${fmtDate(toIso(after.nextDebitOn))}` : "";
  return resumed ? `Asked Razorpay to resume the mandate. Latest: ${after.lastResult ?? after.status}${next}` : `Razorpay is still retrying this debit. Latest: ${after.lastResult ?? after.status}${next}`;
}
