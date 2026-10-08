import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { addDays } from "@/lib/domain/dates";
import { verifyWebhook } from "@/lib/integrations/razorpay";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { sellMembership } from "./billing";
import { applyDeliveryStatus, sendTemplate } from "./whatsapp";
import { applyRazorpayEvent, autopayStats, changeMandate, createMandate, listMandates, retryDemoDebit, runAutopayDay } from "./autopay";
import { runDailyJobs } from "./jobs";
import { listNotifications } from "./notifications";
import { istInstant, todayIso } from "./time";
import { runRules } from "./wa-automation";

describe.skipIf(!hasDb)("WhatsApp, autopay and daily jobs (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  let planId: string;
  let phone = 9855500000;
  const today = todayIso();
  const newMember = async (over = {}) => createMember(admin, { name: `Riya ${phone}`, gender: "Female", phone: String(phone++), source: "Walk-in", tags: [], ...over });

  beforeAll(async () => {
    gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    // ₹1,000 a month + 18% GST = ₹1,180 per cycle
    planId = (await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 100000, regFee: 0, discount: 0, gstApplicable: true, features: [] })).id;
  });

  it("logs a message in demo mode, fills variables, and doesn't repeat a reminder inside the window", async () => {
    const m = await newMember();
    await sellMembership(admin, m.id, { planId, startDate: today, discount: 0, includeRegFee: false, payAmount: 0 });
    const first = await sendTemplate({ orgId: gym.org.id, memberId: m.id, key: "exp3" });
    expect(first).toMatchObject({ status: "Logged", provider: "demo", toNumber: `91${m.phone}` });
    expect(first!.body).toContain("Renewal amount: ₹1,180");
    expect(await sendTemplate({ orgId: gym.org.id, memberId: m.id, key: "exp3" })).toBeNull();
    expect(await sendTemplate({ orgId: gym.org.id, memberId: m.id, key: "exp3", force: true })).not.toBeNull();
    // Non-reminder templates are never de-duplicated.
    await sendTemplate({ orgId: gym.org.id, memberId: m.id, key: "payment" });
    expect(await sendTemplate({ orgId: gym.org.id, memberId: m.id, key: "payment" })).not.toBeNull();
  });

  it("stores a failed message with its error and raises an alert", async () => {
    const m = await newMember();
    await db.member.update({ where: { id: m.id }, data: { phone: "12345", whatsapp: null } });
    const r = await sendTemplate({ orgId: gym.org.id, memberId: m.id, key: "welcome" });
    expect(r).toMatchObject({ status: "Failed", error: expect.stringMatching(/No valid WhatsApp number/) });
    expect((await listNotifications(admin)).some((n) => n.type === "WA_FAILED")).toBe(true);
  });

  it("delivery receipts only move a message forward", async () => {
    const m = await newMember();
    const msg = await sendTemplate({ orgId: gym.org.id, memberId: m.id, key: "welcome" });
    await db.whatsAppMessage.update({ where: { id: msg!.id }, data: { status: "Sent", providerMessageId: `wamid.${msg!.id}` } });
    await applyDeliveryStatus(`wamid.${msg!.id}`, "read", new Date());
    await applyDeliveryStatus(`wamid.${msg!.id}`, "delivered", new Date());
    expect((await db.whatsAppMessage.findUnique({ where: { id: msg!.id } }))?.status).toBe("Read");
  });

  it("daily jobs send expiry reminders once and don't run twice in a day", async () => {
    const m = await newMember();
    // A one-month plan starting so that it ends in exactly 7 days.
    const start = addDays(addDays(today, 7), -29);
    const s = await sellMembership(admin, m.id, { planId, startDate: start, discount: 0, includeRegFee: false, payAmount: 0 });
    expect(addDays(today, 7)).toBe(s.membership.endDate.toISOString().slice(0, 10));
    // A daytime run, outside quiet hours, so the reminder goes straight out.
    const first = await runDailyJobs(gym.org.id, today, istInstant(today, "10:00"));
    expect(first.find((j) => j.name === "reminders.expiry")?.status).toBe("ran");
    expect(await db.whatsAppMessage.count({ where: { memberId: m.id, templateKey: "exp7", status: "Logged" } })).toBe(1);
    const second = await runDailyJobs(gym.org.id, today, istInstant(today, "10:00"));
    expect(second.every((j) => j.status === "skipped")).toBe(true);
  });

  it("demo autopay: approve, notice a day ahead, then renew on the debit date exactly once", async () => {
    const m = await newMember();
    const first = await sellMembership(admin, m.id, { planId, startDate: today, discount: 0, includeRegFee: false, payAmount: 118000, payMethod: "UPI" });
    const md = await createMandate(admin, { memberId: m.id, planId });
    expect(md).toMatchObject({ mode: "demo", status: "Pending", amount: 118000 });
    await expect(createMandate(admin, { memberId: m.id, planId })).rejects.toThrow(/already has autopay/);
    await changeMandate(admin, md.id, "approve-demo");
    const debit = addDays(first.membership.endDate.toISOString().slice(0, 10), 1);
    // The day-ahead notice is the autopay template's rule (1 day before each debit).
    const notice = await runRules(gym.org.id, null, ["autopay"], addDays(debit, -1), istInstant(addDays(debit, -1), "10:00"), null);
    expect(notice.sent).toBeGreaterThanOrEqual(1);
    expect(await db.whatsAppMessage.count({ where: { memberId: m.id, templateKey: "autopay" } })).toBe(1);
    expect(await runAutopayDay(gym.org.id, debit, { roll: 0 })).toMatchObject({ charged: 1 });
    expect(await runAutopayDay(gym.org.id, debit)).toMatchObject({ charged: 0 });
    const ms = await db.membership.findMany({ where: { memberId: m.id }, orderBy: { startDate: "asc" } });
    expect(ms.map((x) => x.type)).toEqual(["NEW", "AUTOPAY"]);
    expect(ms[1]!.startDate.toISOString().slice(0, 10)).toBe(debit);
    const pay = await db.payment.findFirst({ where: { memberId: m.id, txnRef: { startsWith: "demo_" } } });
    expect(pay).toMatchObject({ amount: 118000, method: "UPI" });
  });

  it("a failed demo debit can be retried, and the screen counts it as collected", async () => {
    const m = await newMember();
    await sellMembership(admin, m.id, { planId, startDate: today, discount: 0, includeRegFee: false, payAmount: 118000, payMethod: "UPI" });
    await expect(createMandate(admin, { memberId: m.id, planId, vpa: "not a upi id" })).rejects.toThrow(/UPI ID/);
    const md = await createMandate(admin, { memberId: m.id, planId, vpa: "Riya@OkIcici" });
    expect(md.vpa).toBe("riya@okicici");
    await expect(retryDemoDebit(admin, md.id)).rejects.toThrow(/Only a failed debit/);
    await db.autopayMandate.update({ where: { id: md.id }, data: { status: "Failed", retries: 1 } });
    expect((await retryDemoDebit(admin, md.id, { roll: 0 })).result).toBe("renewed");
    expect((await db.autopayMandate.findUniqueOrThrow({ where: { id: md.id } })).status).toBe("Active");
    const stats = await autopayStats(admin, await listMandates(admin));
    expect(stats.debits.get(md.id)).toBe(1);
    expect(stats.collected).toBeGreaterThanOrEqual(118000);
  });

  it("Razorpay webhooks: signature check, charge renews once, failure alerts", async () => {
    const secret = "whsec_test";
    const raw = JSON.stringify({ event: "x" });
    const sig = createHmac("sha256", secret).update(raw).digest("hex");
    expect(verifyWebhook(raw, sig, secret)).toBe(true);
    expect(verifyWebhook(raw + " ", sig, secret)).toBe(false);
    expect(verifyWebhook(raw, null, secret)).toBe(false);

    const m = await newMember();
    await sellMembership(admin, m.id, { planId, startDate: today, discount: 0, includeRegFee: false, payAmount: 0 });
    const md = await createMandate(admin, { memberId: m.id, planId });
    await db.autopayMandate.update({ where: { id: md.id }, data: { mode: "live", subscriptionId: `sub_${md.id}` } });
    const sub = { id: `sub_${md.id}`, status: "active", notes: { fitron_mandate: md.id } };
    expect(await applyRazorpayEvent(`ev1_${md.id}`, { event: "subscription.activated", payload: { subscription: { entity: sub } } })).toBe("active");
    const charged = { event: "subscription.charged", payload: { subscription: { entity: sub }, payment: { entity: { id: `pay_${md.id}`, amount: 118000, status: "captured" } } } };
    expect(await applyRazorpayEvent(`ev2_${md.id}`, charged)).toBe("renewed");
    expect(await applyRazorpayEvent(`ev2_${md.id}`, charged)).toBe("duplicate");
    // Same payment under a new event id still renews only once.
    expect(await applyRazorpayEvent(`ev3_${md.id}`, charged)).toBe("duplicate");
    expect(await db.membership.count({ where: { memberId: m.id, type: "AUTOPAY" } })).toBe(1);
    expect(await applyRazorpayEvent(`ev4_${md.id}`, { event: "payment.failed", payload: { payment: { entity: { id: "pay_x", subscription_id: sub.id, error_description: "Insufficient balance" } } } })).toBe("failed");
    expect((await db.autopayMandate.findUnique({ where: { id: md.id } }))?.status).toBe("Failed");
    expect((await listNotifications(admin)).some((n) => n.type === "AUTOPAY" && /Insufficient balance/.test(n.text))).toBe(true);
    expect(await applyRazorpayEvent(`ev_unknown_${md.id}`, { event: "subscription.activated", payload: { subscription: { entity: { id: "sub_nope" } } } })).toBe("unknown-mandate");
  });
});
