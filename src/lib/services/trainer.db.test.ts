import { createHmac, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasDb } from "@/test/db";
import { db } from "@/lib/db";
import { appUrl } from "./accounts";
import { addDays } from "@/lib/domain/dates";
import { RAZORPAY_PLANS } from "@/lib/domain/razorpay-plans";
import { COACH_DAILY_LIMIT } from "@/lib/domain/trainer";
import {
  deleteTrainerAccount,
  deleteTrainerChat,
  exportTrainer,
  findOrCreateTrainer,
  loadTrainer,
  redeemTrainerLink,
  refundCoachMessage,
  requestTrainerLink,
  saveTrainerChat,
  saveTrainerState,
  startTrainerPayment,
  startTrainerTrial,
  takeCoachMessage,
} from "./trainer";
import { confirmTrainerSubscription } from "./trainer-billing";
import { coachSystem, profileLines } from "./trainer-coach";
import { currentPlan } from "./trainer-session";
import { fromIso, toIso, todayIso } from "./time";

const email = () => `t-${randomUUID().slice(0, 8)}@test.local`;
const member = (id: string) => db.trainerMember.findUniqueOrThrow({ where: { id } });

const SECRET = "test-secret";
const planAmounts = new Map(Object.values(RAZORPAY_PLANS).flatMap((c) => Object.values(c).map((p) => [p!.id, p!.amount] as const)));

/**
 * FITRON's Razorpay keys, and a stand-in for Razorpay's API that knows the live plans and accepts every payment.
 * `pay` runs the member through Checkout's success step for a payment they started, as the browser would.
 */
function razorpayOn() {
  vi.stubEnv("FITRON_RAZORPAY_KEY_ID", "rzp_live_x");
  vi.stubEnv("FITRON_RAZORPAY_KEY_SECRET", SECRET);
  const amounts = new Map<string, number>();
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname.replace(/^\/v1/, "");
      const id = path.split("/")[2] ?? "";
      if (path.startsWith("/plans/")) return reply({ id, item: { amount: planAmounts.get(id), currency: "INR" } });
      if (path === "/subscriptions") return reply({ id: `sub_${randomUUID().slice(0, 10)}`, status: "created" });
      if (path.endsWith("/cancel")) return reply({ id, status: "cancelled" });
      if (path.startsWith("/payments/")) return reply({ id, status: "captured", amount: amounts.get(id) ?? 0 });
      return reply({ error: { description: `fake Razorpay has no ${init?.method ?? "GET"} ${path}` } }, 404);
    }),
  );
  return {
    pay: async (memberId: string, a: Parameters<typeof startTrainerPayment>[1]) => {
      const pay = await startTrainerPayment(memberId, a);
      const paymentId = `pay_${randomUUID().slice(0, 10)}`;
      amounts.set(paymentId, pay.total);
      const signature = createHmac("sha256", SECRET).update(`${paymentId}|${pay.subscriptionId}`).digest("hex");
      await confirmTrainerSubscription(memberId, pay.id, { paymentId, subscriptionId: pay.subscriptionId, signature });
      return pay;
    },
  };
}

describe.skipIf(!hasDb)("AI Trainer (database)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("an email link creates the account once and works only once", async () => {
    const e = email();
    const r = await requestTrainerLink(e.toUpperCase());
    // No SMTP in tests: the link comes back to show on screen. It points at APP_URL, not the request's host.
    expect(r.devLink!.startsWith(`${appUrl()}/api/trainer/auth/verify?token=`)).toBe(true);
    const token = new URL(r.devLink!).searchParams.get("token")!;
    const m = await redeemTrainerLink(token);
    expect(m?.email).toBe(e);
    expect(m?.emailVerifiedAt).toBeTruthy();
    expect(await redeemTrainerLink(token)).toBeNull();
    expect(await redeemTrainerLink("not-a-token")).toBeNull();
    // Google with the same email finds the same account.
    expect((await findOrCreateTrainer(e, "GOOGLE", "Asha")).id).toBe(m!.id);
    await expect(requestTrainerLink("nope")).rejects.toThrow(/valid email/);
  });

  it("saves the app state and today's log, and loads progress and the week's review", async () => {
    const m = await findOrCreateTrainer(email(), "EMAIL");
    const plan = { Mon: "Push", Tue: "Pull", Wed: "Legs", Thu: "Rest", Fri: "Push", Sat: "Pull", Sun: "Rest" };
    const today = "2026-09-30"; // a Wednesday
    await saveTrainerState(m.id, { profile: { ob: { name: "Asha", weight: "72", referral: "none" }, plan, junk: "dropped" }, day: { water: 1.5, habits: { workout: true, meals: true, extra: true }, workoutDone: true }, onboarded: true }, "2026-09-29");
    await saveTrainerState(m.id, { day: { water: 2.04, habits: { protein: true }, workoutDone: true } }, today);

    const d = await loadTrainer(m.id, today);
    expect(d.member.name).toBe("Asha");
    expect(d.member.onboarded).toBe(true);
    expect(d.member.access).toBe("LOCKED");
    expect(d.profile).toEqual({ ob: { name: "Asha", weight: "72", referral: "none" }, plan });
    expect(d.today).toMatchObject({ date: today, water: 2, focus: "Legs", workoutDone: true, habits: { workout: false, protein: true } });
    expect(d.progress.streak).toBe(2);
    expect(d.progress.weights).toEqual([{ date: "2026-09-29", kg: 72 }]);
    expect(d.progress.byFocus).toEqual([{ focus: "Pull", count: 1 }, { focus: "Legs", count: 1 }]);
    expect(d.review).toMatchObject({ weekStart: "2026-09-28", workouts: 2, planned: 5, consistency: 40, nutrition: 50, avgWater: 1.8 });
    expect(d.coach).toEqual({ used: 0, limit: COACH_DAILY_LIMIT["ai-pro"] });
    expect(await db.trainerReview.count({ where: { memberId: m.id } })).toBe(1);
  });

  it("keeps chats without photos, and deletes them", async () => {
    const m = await findOrCreateTrainer(email(), "EMAIL");
    await saveTrainerChat(m.id, "c1", "Knee pain", [{ role: "user", text: "Hi", media: { kind: "image", name: "knee.jpg", url: "data:image/png;base64,AAA" } }, { role: "coach", text: "Hello" }]);
    let d = await loadTrainer(m.id);
    expect(d.chats).toHaveLength(1);
    expect(d.chats[0]!.messages).toEqual([{ role: "user", text: "Hi", media: { kind: "image", name: "knee.jpg" } }, { role: "coach", text: "Hello" }]);
    await expect(saveTrainerChat(m.id, "../x", "t", [])).rejects.toThrow(/Bad chat id/);
    await deleteTrainerChat(m.id, "c1");
    d = await loadTrainer(m.id);
    expect(d.chats).toHaveLength(0);
  });

  it("the coach needs a trial or a plan, and stops at the plan's daily limit", async () => {
    const m = await findOrCreateTrainer(email(), "EMAIL");
    const today = todayIso();
    expect(await takeCoachMessage(m, today)).toMatchObject({ ok: false, reason: "LOCKED" });

    const t = await startTrainerTrial(m.id, "ai-pro");
    await expect(startTrainerTrial(m.id)).rejects.toThrow(/already been used/);
    expect(await takeCoachMessage(t, today)).toEqual({ ok: true, used: 1, limit: 25 });
    await refundCoachMessage(m.id, today);
    await db.trainerCoachUsage.update({ where: { memberId_date: { memberId: m.id, date: fromIso(today) } }, data: { count: 24 } });
    expect(await takeCoachMessage(t, today)).toEqual({ ok: true, used: 25, limit: 25 });
    expect(await takeCoachMessage(t, today)).toMatchObject({ ok: false, reason: "LIMIT" });
    expect(await takeCoachMessage(t, today)).toMatchObject({ ok: false, reason: "LIMIT" });

    // AI Premium has the higher limit, and messages turned away earlier don't use it up.
    const p = await db.trainerMember.update({ where: { id: m.id }, data: { plan: "ai-premium" } });
    expect(await takeCoachMessage(p, today)).toEqual({ ok: true, used: 26, limit: 100 });
  });

  it("nothing can be paid until FITRON's Razorpay keys are set", async () => {
    vi.stubEnv("FITRON_RAZORPAY_KEY_ID", "");
    vi.stubEnv("FITRON_RAZORPAY_KEY_SECRET", "");
    const m = await findOrCreateTrainer(email(), "EMAIL");
    await startTrainerTrial(m.id, "ai-pro");
    await expect(startTrainerPayment(m.id, { plan: "ai-premium", cycle: "YEARLY", kind: "purchase" })).rejects.toThrow(/Payments aren't switched on yet/);
    // The member's input is still checked first, and no payment row is left behind.
    await expect(startTrainerPayment(m.id, { plan: "elite", cycle: "MONTHLY", kind: "purchase" })).rejects.toThrow(/Pick AI Pro/);
    expect(await db.trainerPayment.count({ where: { memberId: m.id } })).toBe(0);
  });

  it("a payment through Razorpay starts the plan after the trial", async () => {
    const rz = razorpayOn();
    const m = await findOrCreateTrainer(email(), "EMAIL", "Ravi");
    await startTrainerTrial(m.id, "ai-pro");
    await expect(startTrainerPayment(m.id, { plan: "elite", cycle: "MONTHLY", kind: "purchase" })).rejects.toThrow(/Pick AI Pro/);
    const pay = await rz.pay(m.id, { plan: "ai-premium", cycle: "YEARLY", kind: "purchase" });
    // The listed ₹4,999 is what is paid; the GST is inside it.
    expect(pay).toMatchObject({ mode: "SUBSCRIPTION", base: 423_644, gst: 76_256, total: 4_99_900, keyId: "rzp_live_x" });
    const row = await db.trainerPayment.findUniqueOrThrow({ where: { id: pay.id } });
    expect(row).toMatchObject({ status: "PAID", gstIncluded: true, mode: "SUBSCRIPTION" });

    const after = await member(m.id);
    const trialEnd = todayIso(after.trialEndsAt!);
    expect(toIso(row.periodStart!)).toBe(trialEnd);
    expect(after).toMatchObject({ plan: "ai-premium", cycle: "YEARLY", planCancelled: false });
    expect(toIso(after.paidUntil!)).toBe(toIso(row.periodEnd!));
    expect(toIso(after.paidUntil!) > addDays(trialEnd, 360)).toBe(true);
    expect((await loadTrainer(m.id)).member.access).toBe("ACTIVE");
  });

  it("moving down to AI Pro waits until the AI Premium time already paid for runs out", async () => {
    const rz = razorpayOn();
    const m = await findOrCreateTrainer(email(), "EMAIL");
    await rz.pay(m.id, { plan: "ai-premium", cycle: "MONTHLY", kind: "purchase" });
    const pro = await rz.pay(m.id, { plan: "ai-pro", cycle: "MONTHLY", kind: "renew" });
    const done = await db.trainerPayment.findUniqueOrThrow({ where: { id: pro.id } });
    // Still Premium for the month already paid; Pro starts the day after.
    expect((await member(m.id)).plan).toBe("ai-premium");
    expect(await currentPlan(await member(m.id))).toMatchObject({ plan: "ai-premium" });
    // When the Pro month has started, the plan follows it.
    await db.trainerPayment.update({ where: { id: pro.id }, data: { periodStart: fromIso(todayIso()) } });
    expect(await currentPlan(await member(m.id))).toMatchObject({ plan: "ai-pro" });
    expect((await member(m.id)).plan).toBe("ai-pro");
    expect(done.periodStart && toIso(done.periodStart) > todayIso()).toBe(true);
  });

  it("moving up to AI Premium starts at once", async () => {
    const rz = razorpayOn();
    const m = await findOrCreateTrainer(email(), "EMAIL");
    await rz.pay(m.id, { plan: "ai-pro", cycle: "MONTHLY", kind: "purchase" });
    await rz.pay(m.id, { plan: "ai-premium", cycle: "MONTHLY", kind: "upgrade" });
    expect(await currentPlan(await member(m.id))).toMatchObject({ plan: "ai-premium" });
  });

  it("exports the member's data, and deleting the account keeps only the payments", async () => {
    const m = await findOrCreateTrainer(email(), "EMAIL");
    await saveTrainerState(m.id, { profile: { ob: { name: "Del", weight: "80" } }, day: { water: 1 } });
    await saveTrainerChat(m.id, "c1", "Hi", [{ role: "user", text: "Hi" }]);
    razorpayOn();
    const pay = await startTrainerPayment(m.id, { plan: "ai-pro", cycle: "MONTHLY", kind: "purchase" });
    await db.trainerSession.create({ data: { id: `secret-${m.id}`, memberId: m.id, expiresAt: new Date(Date.now() + 86_400_000), ip: "203.0.113.5", userAgent: "Phone" } });
    await db.trainerCoachUsage.create({ data: { memberId: m.id, date: fromIso(todayIso()), count: 3 } });
    const x = await exportTrainer(m.id);
    expect(x.account.email).toBe(m.email);
    expect(x.account.signupVia).toBe("EMAIL");
    expect(x.days).toHaveLength(1);
    expect(x.chats).toHaveLength(1);
    expect(x.signedInDevices).toEqual([expect.objectContaining({ ip: "203.0.113.5", device: "Phone" })]);
    expect(x.coachMessagesPerDay).toEqual([{ date: todayIso(), messages: 3 }]);
    expect(JSON.stringify(x)).not.toContain(`secret-${m.id}`);

    await deleteTrainerAccount(m.id);
    const gone = await member(m.id);
    expect(gone.email).toBe(`deleted-${m.id}@deleted.fitron.in`);
    expect(gone.profile).toEqual({});
    expect(await db.trainerDay.count({ where: { memberId: m.id } })).toBe(0);
    expect(await db.trainerChat.count({ where: { memberId: m.id } })).toBe(0);
    expect(await db.trainerPayment.count({ where: { id: pay.id } })).toBe(1);
    // The email is free to sign up again as a new account.
    expect((await findOrCreateTrainer(m.email, "EMAIL")).id).not.toBe(m.id);
  });

  it("the free trial is once per email, even after deleting the account", async () => {
    const e = email();
    const first = await findOrCreateTrainer(e, "EMAIL");
    await startTrainerTrial(first.id, "ai-premium");
    await deleteTrainerAccount(first.id);
    const again = await findOrCreateTrainer(e, "GOOGLE");
    expect(again.id).not.toBe(first.id);
    await expect(startTrainerTrial(again.id, "ai-premium")).rejects.toThrow(/already had a free trial/);
    // A deleted account that never used a trial doesn't block anyone.
    const f = email();
    const unused = await findOrCreateTrainer(f, "EMAIL");
    await deleteTrainerAccount(unused.id);
    await expect(startTrainerTrial((await findOrCreateTrainer(f, "EMAIL")).id)).resolves.toBeTruthy();
  });

  it("the app can't change the member's plan: only the trial or a confirmed payment can", async () => {
    const m = await findOrCreateTrainer(email(), "EMAIL");
    await startTrainerTrial(m.id, "ai-pro");
    await saveTrainerState(m.id, { plan: "ai-premium", cycle: "YEARLY" } as Parameters<typeof saveTrainerState>[1]);
    const after = await member(m.id);
    expect(after.plan).toBe("ai-pro");
    expect(after.cycle).toBe("YEARLY");
  });

  it("the coach prompt uses the saved onboarding answers over what the app sent", () => {
    const lines = profileLines({ ob: { name: "Asha", goal: "Lose fat", injuries: ["Knee"], timeOfDay: "Morning", supps: ["Whey"], suppCustom: ["Creatine"] } }, { name: "Old", kcal: 1800 });
    expect(lines).toEqual(["- Main goal: Lose fat", "- Injuries: Knee", "- Trains at: Morning", "- Supplements: Whey, Creatine", "- Calorie target (kcal/day): 1800"]);
    const sys = coachSystem({ name: "Asha", plan: "ai-premium" }, lines);
    expect(sys).toContain("AI Premium plan");
    expect(sys).toContain("- Main goal: Lose fat");
    expect(sys).not.toMatch(/Asha|Old/);
    // City and state only when the member left "Use my city for food suggestions" on.
    const where = { ob: { city: "Ranchi", state: "Jharkhand", goal: "Lose fat" } };
    expect(profileLines(where, {})).toContain("- City: Ranchi");
    const off = profileLines({ ...where, consentPrefs: { city: false } }, { city: "Ranchi", state: "Jharkhand" });
    expect(off.join("\n")).not.toMatch(/Ranchi|Jharkhand/);
  });

  it("keeps the day's logged sets, cleaned, and shows each lift's progress", async () => {
    const m = await findOrCreateTrainer(email(), "EMAIL");
    await saveTrainerState(m.id, { day: { workoutDone: true, sets: [{ ex: "Bench Press", kg: 40, reps: 10 }, { ex: " Bench Press ", kg: "42.3", reps: 8.4 }, { ex: "", kg: 10, reps: 5 }, { ex: "Squat", kg: 999, reps: 5 }, { ex: "Squat", kg: 60, reps: 0 }, "junk"] } }, "2026-09-20");
    await saveTrainerState(m.id, { day: { workoutDone: true, sets: [{ ex: "Bench Press", kg: 45, reps: 8 }] } }, "2026-09-27");
    const d = await loadTrainer(m.id, "2026-09-27");
    expect(d.today?.sets).toEqual([{ ex: "Bench Press", kg: 45, reps: 8 }]);
    expect(d.progress.strength).toEqual([{ ex: "Bench Press", first: { kg: 42.5, reps: 8, date: "2026-09-20" }, best: { kg: 45, reps: 8, date: "2026-09-27" }, sessions: 2 }]);
    // Saving the day without sets leaves them as they are.
    await saveTrainerState(m.id, { day: { water: 1 } }, "2026-09-27");
    expect((await loadTrainer(m.id, "2026-09-27")).today?.sets).toHaveLength(1);
    expect((await exportTrainer(m.id)).days.map((d) => d.sets?.length)).toEqual([2, 1]);
  });
});
