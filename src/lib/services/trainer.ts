import "server-only";
import { couponLabel } from "@/lib/domain/coupons";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import type { Prisma, TrainerMember } from "@/generated/prisma/client";
import { addDays } from "@/lib/domain/dates";
import { COACH_DAILY_LIMIT, isCycle, isTrainerPaymentKind, isTrainerPlan, plannedSessions, progress, reviewInsight, trainerAccess, trainerPrice, TRAINER_TRIAL_DAYS, validEmail, type DayLog, type SetLog, type TrainerPlan } from "@/lib/domain/trainer";
import type { Cycle } from "@/lib/domain/pricing";
import { razorpayPlan } from "@/lib/domain/razorpay-plans";
import { gstInside } from "@/lib/domain/saas";
import { emailReady, sendEmail } from "@/lib/integrations/email";
import { createOrder, fitronKeyId } from "@/lib/integrations/razorpay";
import { appUrl } from "./accounts";
import { quoteCoupon, reserveCoupon } from "./coupons";
import { isUniqueViolation, UserError } from "./errors";
import { createSubscription, renewingSubscriptions, stopSubscription } from "./subscriptions";
import { completeTrainerPayment, trainerRenewal } from "./trainer-billing";
import { gymView } from "./trainer-gym";
import { sha256 } from "./trainer-session";
import { fromIso, toIso, todayIso } from "./time";

// The AI Trainer member app (public/trainer, served at /trainer) keeps its data here:
// accounts, what the member told the app, their daily log, coach chats, and payments to FITRON.

const LINK_MINUTES = 30;

export const normEmail = (e: string) => e.trim().toLowerCase();

/** Find the member for a confirmed email, or create one. `via` records how the account started. */
export async function findOrCreateTrainer(email: string, via: "EMAIL" | "GOOGLE", name = "") {
  const e = normEmail(email);
  if (!validEmail(e)) throw new UserError("Enter a valid email address.");
  const now = new Date();
  try {
    return await db.trainerMember.upsert({
      where: { email: e },
      create: { email: e, name: name.slice(0, 100), signupVia: via, emailVerifiedAt: now },
      update: { emailVerifiedAt: now },
    });
  } catch (err) {
    // Two sign-ins racing to create the same account: the other one won.
    if (isUniqueViolation(err)) return db.trainerMember.findUniqueOrThrow({ where: { email: e } });
    throw err;
  }
}

/**
 * Emails a one-time sign-in link. The link both creates the account and signs in an existing one.
 * Without SMTP (development only) the link is returned so it can be shown on screen instead.
 */
/** Emails a one-time sign-in link. It always points at APP_URL (fitron.in), never at whatever address the request came in on. */
export async function requestTrainerLink(email: string) {
  const e = normEmail(email);
  if (!validEmail(e)) throw new UserError("Enter a valid email address.");
  const recent = await db.trainerLoginToken.count({ where: { email: e, createdAt: { gt: new Date(Date.now() - 3_600_000) } } });
  if (recent >= 5) throw new UserError("Too many links asked for this email. Use the latest one in your inbox, or try again in an hour.");
  const token = randomBytes(32).toString("base64url");
  await db.trainerLoginToken.create({ data: { id: sha256(token), email: e, expiresAt: new Date(Date.now() + LINK_MINUTES * 60_000) } });
  const link = `${appUrl()}/api/trainer/auth/verify?token=${token}`;
  const r = await sendEmail({
    to: e,
    subject: "Your FITRON sign-in link",
    text: `Tap this link to sign in to your FITRON AI Trainer:\n\n${link}\n\nIt works once and expires in ${LINK_MINUTES} minutes. If you didn't ask for it, ignore this email.\n\nFITRON\nhello@fitron.in`,
  });
  const devLink = !emailReady() && process.env.NODE_ENV !== "production" ? link : undefined;
  // Never tell them to check their inbox when nothing was sent.
  if (!r.sent && !devLink) throw new UserError("We couldn't send the email just now. Use Continue with Google, or try again in a few minutes.");
  return { sent: r.sent, devLink };
}

/** Uses a sign-in link once. Returns the member (created on first use), or null if the link is bad, used or expired. */
export async function redeemTrainerLink(token: string) {
  if (!token || token.length > 100) return null;
  const id = sha256(token);
  const claimed = await db.trainerLoginToken.updateMany({ where: { id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
  if (!claimed.count) return null;
  const t = await db.trainerLoginToken.findUniqueOrThrow({ where: { id } });
  return findOrCreateTrainer(t.email, "EMAIL");
}

// ── What the app keeps ──────────────────────────────────────────────────────

/** Keys of the app's state that are saved per member. Anything else the app sends is ignored. */
export const PROFILE_KEYS = ["ob", "plan", "schedule", "suppInfo", "supps", "suppList", "dietPref", "reminders", "notificationsOn", "focusMode", "theme", "groc", "avatar", "consentPrefs"] as const;
const MAX_PROFILE_BYTES = 400_000;

function cleanProfile(p: unknown) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return {};
  const out: Record<string, unknown> = {};
  for (const k of PROFILE_KEYS) if (k in (p as Record<string, unknown>)) out[k] = (p as Record<string, unknown>)[k];
  if (typeof out.avatar === "string" && (out.avatar.length > 200_000 || !out.avatar.startsWith("data:image/"))) delete out.avatar;
  if (JSON.stringify(out).length > MAX_PROFILE_BYTES) throw new UserError("That's more than the app can save.");
  return out;
}

const HABIT_KEYS = ["workout", "water", "steps", "protein", "meals", "sleep"];
function cleanHabits(h: unknown) {
  const out: Record<string, boolean> = {};
  if (h && typeof h === "object") for (const k of HABIT_KEYS) out[k] = !!(h as Record<string, unknown>)[k];
  return out;
}

export const dayLog = (d: { date: Date; water: number; habits: Prisma.JsonValue; workoutDone: boolean; focus: string | null; weightKg: number | null; sets?: Prisma.JsonValue }): DayLog => ({
  date: toIso(d.date),
  water: d.water,
  habits: (d.habits ?? {}) as Record<string, boolean>,
  workoutDone: d.workoutDone,
  focus: d.focus,
  weightKg: d.weightKg,
  sets: Array.isArray(d.sets) ? (d.sets as SetLog[]) : [],
});

const MAX_SETS_A_DAY = 80;
/** Logged sets as sent by the app: a named exercise, 0–500 kg to the half kilo, 1–100 reps. Anything else is dropped. */
function cleanSets(raw: unknown): SetLog[] {
  if (!Array.isArray(raw)) return [];
  const out: SetLog[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const { ex, kg, reps } = s as Record<string, unknown>;
    const name = String(ex ?? "").trim().slice(0, 60);
    const k = Math.round(Number(kg) * 2) / 2;
    const r = Math.round(Number(reps));
    if (!name || !(k >= 0 && k <= 500) || !(r >= 1 && r <= 100)) continue;
    out.push({ ex: name, kg: k, reps: r });
    if (out.length >= MAX_SETS_A_DAY) break;
  }
  return out;
}

/** The plan's training focus on a date, from the member's weekly split. */
function focusOn(profile: Record<string, unknown>, date: string) {
  const split = profile.plan as Record<string, string> | undefined;
  const key = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${date}T00:00:00Z`).getUTCDay()];
  return split?.[key] ?? null;
}

export type DayInput = { water?: number; habits?: unknown; workoutDone?: boolean; sets?: unknown };

/**
 * A new member has to say whether a partner gym referred them before the account is set up: "gym" means they
 * must also have entered that gym's trainer code (linked), "none" means nobody referred them.
 */
function requireReferralAnswer(m: Pick<TrainerMember, "orgId">, profile: Record<string, unknown>) {
  const referral = (profile.ob as { referral?: unknown } | undefined)?.referral;
  if (referral !== "gym" && referral !== "none") throw new UserError("Tell us whether a partner gym referred you.");
  if (referral === "gym" && !m.orgId) throw new UserError("Enter the code your gym gave you, so we know which gym referred you.");
}

/** Saves what the member changed: the app's state, and/or today's log. The plan itself never changes here: only starting the trial or a confirmed payment sets it. */
export async function saveTrainerState(memberId: string, input: { profile?: unknown; day?: DayInput; name?: string; onboarded?: boolean; consented?: boolean; cycle?: string }, today = todayIso()) {
  const m = await db.trainerMember.findUniqueOrThrow({ where: { id: memberId } });
  if (m.deletedEmailHash) return;
  const data: Prisma.TrainerMemberUpdateManyMutationInput = {};
  let profile = (m.profile ?? {}) as Record<string, unknown>;
  if (input.profile !== undefined) {
    profile = cleanProfile(input.profile);
    data.profile = profile as Prisma.InputJsonValue;
    const ob = profile.ob as { name?: string } | undefined;
    if (ob?.name && typeof ob.name === "string") data.name = ob.name.trim().slice(0, 100);
  }
  if (input.name !== undefined) data.name = String(input.name).trim().slice(0, 100);
  if (input.onboarded && !m.onboardedAt) {
    requireReferralAnswer(m, profile);
    data.onboardedAt = new Date();
  }
  if (input.consented && !m.consentedAt) data.consentedAt = new Date();
  if (input.cycle === "MONTHLY" || input.cycle === "YEARLY") data.cycle = input.cycle;
  // Not onto an account deleted while this save was on its way.
  if (Object.keys(data).length && !(await db.trainerMember.updateMany({ where: { id: memberId, deletedEmailHash: null }, data })).count) return;

  const weight = parseFloat(String((profile.ob as { weight?: unknown } | undefined)?.weight ?? ""));
  const weightKg = weight >= 25 && weight <= 300 ? weight : null;
  if (input.day || (input.profile !== undefined && weightKg)) {
    const d = input.day ?? {};
    const water = d.water === undefined ? undefined : Math.max(0, Math.min(20, Math.round(Number(d.water) * 10) / 10 || 0));
    const fields = {
      ...(water !== undefined ? { water } : {}),
      ...(d.habits !== undefined ? { habits: cleanHabits(d.habits) } : {}),
      ...(d.workoutDone !== undefined ? { workoutDone: !!d.workoutDone } : {}),
      ...(d.sets !== undefined ? { sets: cleanSets(d.sets) as unknown as Prisma.InputJsonValue } : {}),
      focus: focusOn(profile, today),
      ...(weightKg ? { weightKg } : {}),
    };
    await db.trainerDay.upsert({ where: { memberId_date: { memberId, date: fromIso(today) } }, create: { memberId, date: fromIso(today), ...fields }, update: fields });
  }
}

/** Everything the app needs on open: the account, saved state, today's log, chats, payments, progress and this week's review. */
export async function loadTrainer(memberId: string, today = todayIso()) {
  const m = await db.trainerMember.findUniqueOrThrow({ where: { id: memberId } });
  const since = addDays(today, -120);
  const [days, chats, payments] = await Promise.all([
    db.trainerDay.findMany({ where: { memberId, date: { gte: fromIso(since) } }, orderBy: { date: "asc" } }),
    db.trainerChat.findMany({ where: { memberId }, orderBy: { updatedAt: "desc" }, take: 40 }),
    db.trainerPayment.findMany({ where: { memberId, status: "PAID" }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const profile = (m.profile ?? {}) as Record<string, unknown>;
  const logs = days.map(dayLog);
  const planned = plannedSessions(profile.plan as Record<string, string> | undefined) || 4;
  const prog = progress(logs, today, planned);
  const review = await saveReview(memberId, prog.week, profile);
  const todayLog = logs.find((d) => d.date === today) ?? null;
  return {
    member: await memberWithRenewal(m, today),
    profile,
    today: todayLog,
    chats: chats.map((c) => ({ id: c.clientId, title: c.title, at: c.updatedAt.getTime(), messages: c.messages })),
    payments: payments.map(paymentView),
    progress: prog,
    review,
    coach: await coachUsage(m, today),
    gym: await gymView(m),
  };
}

/** The member as the app shows them, plus whether the plan renews itself (`autoRenew`) and when it is next charged. */
export async function memberWithRenewal(m: TrainerMember, today = todayIso()) {
  return { ...memberView(m, today), ...(await trainerRenewal(m.id)) };
}

export function memberView(m: TrainerMember, today = todayIso()) {
  const access = trainerAccess({ paidUntil: m.paidUntil ? toIso(m.paidUntil) : null, trialEndsAt: m.trialEndsAt }, today);
  return {
    email: m.email,
    name: m.name,
    plan: m.plan as TrainerPlan,
    cycle: m.cycle as Cycle,
    access: access.status,
    paidUntil: m.paidUntil ? toIso(m.paidUntil) : null,
    trialEndsAt: m.trialEndsAt?.toISOString() ?? null,
    trialUsed: !!m.trialEndsAt,
    planCancelled: m.planCancelled,
    onboarded: !!m.onboardedAt,
    consentedAt: m.consentedAt?.toISOString() ?? null,
  };
}

/** Keeps this week's review as it stands (one row per week), and returns it. */
async function saveReview(memberId: string, w: ReturnType<typeof progress>["week"], profile: Record<string, unknown>) {
  const focus = [...new Set(Object.values((profile.plan as Record<string, string>) ?? {}).filter((f) => f && f !== "Rest"))];
  const fields = { workouts: w.workouts, planned: w.planned, consistency: w.consistency, nutrition: w.nutrition, avgWater: w.avgWater, insight: reviewInsight(w), focus };
  const r = await db.trainerReview.upsert({ where: { memberId_weekStart: { memberId, weekStart: fromIso(w.start) } }, create: { memberId, weekStart: fromIso(w.start), ...fields }, update: fields });
  return { weekStart: toIso(r.weekStart), ...fields };
}

/** Past weekly reviews, newest first. */
export async function trainerReviews(memberId: string) {
  const rows = await db.trainerReview.findMany({ where: { memberId }, orderBy: { weekStart: "desc" }, take: 52 });
  return rows.map((r) => ({ weekStart: toIso(r.weekStart), workouts: r.workouts, planned: r.planned, consistency: r.consistency, nutrition: r.nutrition, avgWater: r.avgWater, insight: r.insight, focus: r.focus }));
}

// ── Chats ───────────────────────────────────────────────────────────────────

export async function saveTrainerChat(memberId: string, clientId: string, title: string, messages: unknown) {
  if (!/^[\w-]{1,40}$/.test(clientId)) throw new UserError("Bad chat id.");
  if (!Array.isArray(messages)) throw new UserError("Bad chat.");
  // Photos and videos stay on the phone; only their names are kept.
  const msgs = messages.slice(-80).map((x) => {
    const m = (x ?? {}) as { role?: unknown; text?: unknown; exs?: unknown; media?: { kind?: unknown; name?: unknown } };
    return {
      role: m.role === "user" ? "user" : "coach",
      text: String(m.text ?? "").slice(0, 8000),
      ...(Array.isArray(m.exs) ? { exs: m.exs.slice(0, 10).map((e) => ({ name: String((e as { name?: unknown }).name ?? "").slice(0, 100), scheme: String((e as { scheme?: unknown }).scheme ?? "").slice(0, 200) })) } : {}),
      ...(m.media ? { media: { kind: m.media.kind === "video" ? "video" : "image", name: String(m.media.name ?? "").slice(0, 120) } } : {}),
    };
  });
  const t = String(title || "New chat").slice(0, 80);
  await db.trainerChat.upsert({ where: { memberId_clientId: { memberId, clientId } }, create: { memberId, clientId, title: t, messages: msgs }, update: { title: t, messages: msgs } });
  // Keep the 40 most recent, like the app shows.
  const old = await db.trainerChat.findMany({ where: { memberId }, orderBy: { updatedAt: "desc" }, skip: 40, select: { id: true } });
  if (old.length) await db.trainerChat.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
}

export const deleteTrainerChat = (memberId: string, clientId: string) => db.trainerChat.deleteMany({ where: { memberId, clientId } });

// ── Plan, trial, payment ────────────────────────────────────────────────────

/** The free trial: once per account, and only for someone who hasn't paid. */
export async function startTrainerTrial(memberId: string, plan?: string) {
  const m = await db.trainerMember.findUniqueOrThrow({ where: { id: memberId } });
  if (m.trialEndsAt) throw new UserError("Your free trial has already been used. Pick a plan to keep going.");
  // Once per email, even across a deleted account.
  if (await db.trainerMember.findFirst({ where: { deletedEmailHash: sha256(m.email), trialEndsAt: { not: null } }, select: { id: true } })) {
    throw new UserError("This email has already had a free trial. Pick a plan to keep going.");
  }
  if (m.paidUntil && toIso(m.paidUntil) >= todayIso()) throw new UserError("Your plan is already active.");
  const updated = await db.trainerMember.updateMany({
    where: { id: memberId, trialEndsAt: null },
    data: { trialEndsAt: new Date(Date.now() + TRAINER_TRIAL_DAYS * 86_400_000), ...(isTrainerPlan(plan) ? { plan } : {}) },
  });
  if (!updated.count) throw new UserError("Your free trial has already been used. Pick a plan to keep going.");
  return db.trainerMember.findUniqueOrThrow({ where: { id: memberId } });
}

/**
 * Stop (or resume) renewal. For a plan that renews itself through Razorpay, stopping really stops the charges, and a
 * stopped subscription can't be revived: to carry on the member pays for a plan again. For a plan paid by UPI it
 * only records the member's choice, as nothing is charged on its own.
 */
export async function setTrainerRenewal(memberId: string, cancelled: boolean) {
  if (cancelled) {
    for (const sub of await renewingSubscriptions({ memberId, kind: "TRAINER" })) {
      if (!(await stopSubscription(sub.id))) throw new UserError("We couldn't reach Razorpay to stop the renewal just now. Nothing was changed; try again in a minute.");
    }
  } else {
    const live = await renewingSubscriptions({ memberId, kind: "TRAINER" });
    // A renewal that was stopped (or is being stopped: Razorpay hasn't confirmed yet) can't be switched back on.
    if (live.some((s) => s.cancelledAt) || (!live.length && (await db.razorpaySubscription.count({ where: { memberId, kind: "TRAINER", cancelledAt: { not: null } } })))) {
      throw new UserError("You stopped the automatic renewal, and it can't be switched back on. Pick your plan again to start renewing.");
    }
  }
  return db.trainerMember.update({ where: { id: memberId }, data: { planCancelled: cancelled } });
}

export const trainerPaymentRef = (id: string) => `FTR-${id.slice(-8).toUpperCase()}`;

function paymentView(p: { id: string; plan: string; cycle: string; kind: string; total: number; status: string; periodEnd: Date | null; createdAt: Date }) {
  return { id: p.id, ref: trainerPaymentRef(p.id), plan: p.plan, cycle: p.cycle, kind: p.kind, total: p.total, status: p.status, periodEnd: p.periodEnd ? toIso(p.periodEnd) : null, createdAt: p.createdAt.toISOString() };
}

/** The plan, cycle and kind of a payment as the app sent them, or the reason they are refused. */
function paymentArgs(a: { plan: string; cycle: string; kind: string }) {
  if (!isTrainerPlan(a.plan)) throw new UserError("Pick AI Pro or AI Premium.");
  if (!isCycle(a.cycle)) throw new UserError("Pick a monthly or yearly plan.");
  if (!isTrainerPaymentKind(a.kind)) throw new UserError("Couldn't tell what this payment is for. Close this and start again.");
  return { plan: a.plan, cycle: a.cycle as Cycle, kind: a.kind, name: a.plan === "ai-premium" ? "AI Premium" : "AI Pro", period: a.cycle === "YEARLY" ? "1 year" : "1 month" };
}

/** What a coupon would do to this plan's price, for the coupon box before paying. Changes nothing. */
export async function quoteTrainerCoupon(memberId: string, a: { plan: string; cycle: string; code: string }) {
  const { plan, cycle } = paymentArgs({ ...a, kind: "purchase" });
  const q = await quoteCoupon(a.code, "TRAINER", { memberId }, trainerPrice(plan, cycle).total);
  return { code: q.code, percentOff: q.percentOff, payPaise: q.payPaise, listTotal: q.listTotal, discount: q.discount, total: q.total };
}

/**
 * Starts a payment to FITRON for a plan period: a Razorpay subscription that renews itself, and Checkout opens for it.
 * The listed price has the GST inside it. Without Fitron's Razorpay keys nothing can be paid, here or in production.
 */
export async function startTrainerPayment(memberId: string, a: { plan: string; cycle: string; kind: string }) {
  const { plan, cycle, kind, name, period } = paymentArgs(a);
  const price = trainerPrice(plan, cycle);
  const keyId = fitronKeyId();
  if (!keyId) throw new UserError("Payments aren't switched on yet. Start the free trial for now, or write to hello@fitron.in.");
  if (!razorpayPlan(plan, cycle)) throw new UserError("This plan can't be paid online yet. Write to hello@fitron.in.");
  const m = await db.trainerMember.findUniqueOrThrow({ where: { id: memberId } });
  // Already renewing this plan and cycle: a second subscription would charge twice.
  if ((await renewingSubscriptions({ memberId, kind: "TRAINER" })).some((s) => s.plan === plan && s.cycle === cycle)) throw new UserError(`Your ${name} plan already renews automatically. To change it, pick another plan, or stop the renewal in Settings › Subscription first.`);
  const rz = await createSubscription({ kind: "TRAINER", plan, cycle, expectedTotal: price.total, memberId });
  const p = await db.trainerPayment.create({ data: { memberId, plan, cycle, kind, ...price, gstIncluded: true, mode: "SUBSCRIPTION", razorpaySubscriptionId: rz.id } });
  return { id: p.id, ref: trainerPaymentRef(p.id), plan, cycle, kind, ...price, mode: "SUBSCRIPTION" as const, keyId, subscriptionId: rz.id, name: "FITRON", description: `${name}, ${period} (GST included)`, prefill: { name: m.name, email: m.email } };
}

/**
 * Starts a payment to FITRON for a plan period with a coupon. The member pays the reduced price once: one Razorpay payment
 * (mode LIVE) that does not renew by itself, because a Razorpay plan has a fixed amount and a subscription cannot start at a
 * lower one. A 100% coupon has nothing to pay: the plan is on at once (mode FREE, needs no Razorpay).
 */
export async function startTrainerCouponPayment(memberId: string, a: { plan: string; cycle: string; kind: string }, code: string) {
  const { plan, cycle, kind, name, period } = paymentArgs(a);
  const quote = await quoteCoupon(code, "TRAINER", { memberId }, trainerPrice(plan, cycle).total);
  const price = gstInside(quote.total);
  const free = quote.total === 0;
  const keyId = fitronKeyId();
  if (!keyId && !free) throw new UserError("Payments aren't switched on yet. Start the free trial for now, or write to hello@fitron.in.");
  const m = await db.trainerMember.findUniqueOrThrow({ where: { id: memberId } });
  const p = await db.$transaction(async (tx) => {
    const row = await tx.trainerPayment.create({ data: { memberId, plan, cycle, kind, ...price, gstIncluded: true, mode: free ? "COUPON" : "LIVE", couponCode: quote.code, discount: quote.discount } });
    await reserveCoupon(tx, quote, "TRAINER", { memberId }, row.id);
    return row;
  });
  const out = { id: p.id, ref: trainerPaymentRef(p.id), plan, cycle, kind, ...price, couponCode: quote.code, discount: quote.discount, name: "FITRON", prefill: { name: m.name, email: m.email } };
  // Nothing to pay: the coupon is the payment.
  if (free) {
    await completeTrainerPayment({ id: p.id }, null);
    return { ...out, mode: "FREE" as const, description: `${name}, ${period}` };
  }
  const order = await createOrder({ amount: price.total, receipt: p.id, notes: { trainerPayment: p.id, member: memberId, cycle } });
  await db.trainerPayment.update({ where: { id: p.id }, data: { razorpayOrderId: order.id } });
  return { ...out, mode: "LIVE" as const, keyId: keyId!, orderId: order.id, description: `${name}, ${period} (GST included, coupon ${quote.code} ${couponLabel(quote.percentOff, quote.payPaise)})` };
}

// ── AI Coach limits ─────────────────────────────────────────────────────────

async function coachUsage(m: TrainerMember, today: string) {
  const u = await db.trainerCoachUsage.findUnique({ where: { memberId_date: { memberId: m.id, date: fromIso(today) } } });
  return { used: u?.count ?? 0, limit: COACH_DAILY_LIMIT[isTrainerPlan(m.plan) ? m.plan : "ai-pro"] };
}

export type CoachQuota = { ok: true; used: number; limit: number } | { ok: false; reason: "LOCKED" | "LIMIT"; used: number; limit: number };

/** Counts one coach message against today's limit for the member's plan. Locked accounts get none. */
export async function takeCoachMessage(m: TrainerMember, today = todayIso()): Promise<CoachQuota> {
  const limit = COACH_DAILY_LIMIT[isTrainerPlan(m.plan) ? m.plan : "ai-pro"];
  const access = trainerAccess({ paidUntil: m.paidUntil ? toIso(m.paidUntil) : null, trialEndsAt: m.trialEndsAt }, today);
  if (access.status === "LOCKED") return { ok: false, reason: "LOCKED", used: 0, limit };
  const row = await db.trainerCoachUsage.upsert({
    where: { memberId_date: { memberId: m.id, date: fromIso(today) } },
    create: { memberId: m.id, date: fromIso(today), count: 1 },
    update: { count: { increment: 1 } },
  });
  if (row.count > limit) {
    // Turned away, so it doesn't count: an upgrade later today gets its full extra allowance.
    await db.trainerCoachUsage.updateMany({ where: { memberId: m.id, date: fromIso(today), count: { gt: limit } }, data: { count: limit } });
    return { ok: false, reason: "LIMIT", used: limit, limit };
  }
  return { ok: true, used: row.count, limit };
}

/** Gives back a message that never got a reply (the model was down). */
export async function refundCoachMessage(memberId: string, today = todayIso()) {
  await db.trainerCoachUsage.updateMany({ where: { memberId, date: fromIso(today), count: { gt: 0 } }, data: { count: { decrement: 1 } } });
}

// ── Your data ───────────────────────────────────────────────────────────────

/** A copy of everything kept for the member (Settings › Request my data). */
export async function exportTrainer(memberId: string) {
  const m = await db.trainerMember.findUniqueOrThrow({
    where: { id: memberId },
    include: { days: { orderBy: { date: "asc" } }, chats: true, payments: true, reviews: true, sessions: { orderBy: { createdAt: "asc" } } },
  });
  const [usage, links] = await Promise.all([
    db.trainerCoachUsage.findMany({ where: { memberId }, orderBy: { date: "asc" } }),
    db.trainerLoginToken.findMany({ where: { email: m.email }, orderBy: { createdAt: "asc" } }),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    account: { ...memberView(m), signupVia: m.signupVia, createdAt: m.createdAt.toISOString(), emailVerifiedAt: m.emailVerifiedAt?.toISOString() ?? null, lastSeenAt: m.lastSeenAt?.toISOString() ?? null },
    profile: m.profile,
    days: m.days.map(dayLog),
    chats: m.chats.map((c) => ({ title: c.title, updatedAt: c.updatedAt, messages: c.messages })),
    weeklyReviews: m.reviews.map((r) => ({ weekStart: toIso(r.weekStart), workouts: r.workouts, planned: r.planned, consistency: r.consistency, nutrition: r.nutrition, avgWater: r.avgWater, insight: r.insight, focus: r.focus })),
    payments: m.payments.map(paymentView),
    gym: await gymView(m),
    // Devices signed in (the token itself is never included), sign-in emails, and AI Coach messages per day.
    signedInDevices: m.sessions.map((x) => ({ signedInAt: x.createdAt.toISOString(), lastSeenAt: x.lastSeenAt.toISOString(), expiresAt: x.expiresAt.toISOString(), ip: x.ip, device: x.userAgent })),
    signInEmails: links.map((t) => ({ sentAt: t.createdAt.toISOString(), usedAt: t.usedAt?.toISOString() ?? null })),
    coachMessagesPerDay: usage.map((u) => ({ date: toIso(u.date), messages: u.count })),
  };
}

/**
 * Deletes the member's fitness data and signs them out everywhere. Payment records stay (FITRON
 * must keep them for tax), tied to an account with no email or profile left.
 */
export async function deleteTrainerAccount(memberId: string) {
  const { email } = await db.trainerMember.findUniqueOrThrow({ where: { id: memberId }, select: { email: true } });
  // A deleted account must not keep being charged. Erasure still goes ahead if Razorpay can't be reached (the failure is
  // logged, and a charge that arrives later is refused by stopSubscription's retry in the charge handler).
  for (const sub of await renewingSubscriptions({ memberId, kind: "TRAINER" })) await stopSubscription(sub.id);
  await db.$transaction([
    db.trainerSession.deleteMany({ where: { memberId } }),
    db.trainerPush.deleteMany({ where: { memberId } }),
    db.trainerDay.deleteMany({ where: { memberId } }),
    db.trainerChat.deleteMany({ where: { memberId } }),
    db.trainerReview.deleteMany({ where: { memberId } }),
    db.trainerCoachUsage.deleteMany({ where: { memberId } }),
    db.trainerLoginToken.deleteMany({ where: { email } }),
    db.trainerMember.update({ where: { id: memberId }, data: { email: `deleted-${memberId}@deleted.fitron.in`, name: "", profile: {}, emailVerifiedAt: null, deletedEmailHash: sha256(email), orgId: null, gymMemberId: null, gymLinkedAt: null } }),
  ]);
}
