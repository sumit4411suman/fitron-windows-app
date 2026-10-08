import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym } from "@/test/db";
import { addDays } from "@/lib/domain/dates";
import { createCoupon, deleteCoupon, listCoupons, quoteCoupon, setCouponStatus } from "./coupons";
import { applyFitronBillingEvent, billingHistory, confirmDemoPayment, gymPlan, quoteGymCoupon, startPayment } from "./saas";
import { confirmTrainerOrder } from "./trainer-billing";
import { findOrCreateTrainer, quoteTrainerCoupon, startTrainerCouponPayment, startTrainerPayment } from "./trainer";
import { toIso, todayIso } from "./time";

const uid = () => randomUUID().slice(0, 8).toUpperCase();
const DAY = 86_400_000;
const input = (o: Partial<Parameters<typeof createCoupon>[1]> = {}) => ({ code: `C${uid()}`, description: "", percentOff: 99, appliesTo: "ALL" as const, validTill: null, usageLimit: null, ...o, payRupees: o.payRupees ?? null });
const coupon = (o: Partial<Parameters<typeof createCoupon>[1]> = {}) => createCoupon("team@fitron.in", input(o));

/** A gym that can pay for any plan: Enterprise, on trial. */
async function gym() {
  const g = await makeGym();
  await db.organization.update({ where: { id: g.org.id }, data: { plan: "enterprise", trialEndsAt: new Date(Date.now() + 3 * DAY) } });
  return { g, owner: await g.user("Super Admin") };
}

/** A stand-in for Razorpay's API that records the orders and subscriptions asked for. */
function fakeRazorpay() {
  const orders: { amount: number; receipt: string }[] = [];
  const paths: string[] = [];
  vi.stubEnv("FITRON_RAZORPAY_KEY_ID", "rzp_live_x");
  vi.stubEnv("FITRON_RAZORPAY_KEY_SECRET", "secret");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname.replace(/^\/v1/, "");
      paths.push(`${init?.method ?? "GET"} ${path}`);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (path === "/orders") {
        orders.push({ amount: Number(body.amount), receipt: String(body.receipt) });
        return new Response(JSON.stringify({ id: `order_${uid()}`, amount: body.amount, status: "created" }));
      }
      return new Response(JSON.stringify({ error: { description: `fake Razorpay has no ${path}` } }), { status: 404 });
    }),
  );
  return { orders, paths };
}

const captured = (orderId: string, paymentId = `pay_${uid()}`) => ({ event: "payment.captured", payload: { payment: { entity: { id: paymentId, order_id: orderId, status: "captured" } } } });
const failed = (orderId: string) => ({ event: "payment.failed", payload: { payment: { entity: { order_id: orderId, status: "failed" } } } });

describe.skipIf(!hasDb)("Coupons (database)", () => {
  beforeEach(() => {
    vi.stubEnv("FITRON_RAZORPAY_KEY_ID", "");
    vi.stubEnv("FITRON_RAZORPAY_KEY_SECRET", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("the FITRON team makes, pauses and removes coupons", async () => {
    const c = await coupon({ code: `MINE${uid()}`, percentOff: 50, usageLimit: 3, validTill: addDays(todayIso(), 30) });
    await expect(createCoupon("team@fitron.in", input({ code: c.code }))).rejects.toThrow(/already exists/);
    expect((await listCoupons()).find((x) => x.id === c.id)).toMatchObject({ code: c.code, percentOff: 50, uses: 0, state: "Active", usageLimit: 3 });

    await setCouponStatus(c.id, "PAUSED");
    expect((await listCoupons()).find((x) => x.id === c.id)?.state).toBe("Paused");
    await setCouponStatus(c.id, "ACTIVE");
    await deleteCoupon(c.id);
    expect((await listCoupons()).some((x) => x.id === c.id)).toBe(false);
    await expect(setCouponStatus(c.id, "PAUSED")).rejects.toThrow(/not found/);
  });

  it("refuses a code that is unknown, paused, past its day, for another product, or used up", async () => {
    const { g, owner } = await gym();
    const plan = { kind: "PLAN", plan: "enterprise" } as const;
    await expect(startPayment(owner, plan, "MONTHLY", "NOSUCHCODE")).rejects.toThrow(/isn't valid/);
    const paused = await coupon();
    await setCouponStatus(paused.id, "PAUSED");
    await expect(startPayment(owner, plan, "MONTHLY", paused.code)).rejects.toThrow(/isn't valid/);
    const old = await coupon({ validTill: addDays(todayIso(), -1) });
    await expect(startPayment(owner, plan, "MONTHLY", old.code)).rejects.toThrow(/has expired/);
    const trainerOnly = await coupon({ appliesTo: "TRAINER" });
    await expect(startPayment(owner, plan, "MONTHLY", trainerOnly.code)).rejects.toThrow(/only works on AI Trainer plans, not on this one/);
    const gymOnly = await coupon({ appliesTo: "GYM" });
    const member = await findOrCreateTrainer(`t-${uid()}@test.local`, "EMAIL");
    await expect(startTrainerCouponPayment(member.id, { plan: "ai-pro", cycle: "MONTHLY", kind: "purchase" }, gymOnly.code)).rejects.toThrow(/only works on gym plans.*not on this one/);
    // Nothing was left behind by any refusal.
    expect(await db.branchSubscription.count({ where: { orgId: g.org.id } })).toBe(0);
    expect(await db.trainerPayment.count({ where: { memberId: member.id } })).toBe(0);
  });

  it("a flat-price coupon charges ₹1 on any plan", async () => {
    const { owner } = await gym();
    const c = await coupon({ payRupees: 1 });
    expect(c.payPaise).toBe(100);
    const q = await quoteGymCoupon(owner, { kind: "PLAN", plan: "enterprise" }, "MONTHLY", c.code);
    expect(q).toMatchObject({ payPaise: 100, listTotal: 3_99_900, discount: 3_99_800, total: 100 });
    expect(await startPayment(owner, { kind: "PLAN", plan: "enterprise" }, "MONTHLY", c.code)).toMatchObject({ mode: "DEMO", total: 100 });
  });

  it("a gym pays the coupon price once, and each gym can use a coupon one time", async () => {
    const { g, owner } = await gym();
    const c = await coupon({ percentOff: 99 });
    const q = await quoteGymCoupon(owner, { kind: "PLAN", plan: "enterprise" }, "MONTHLY", c.code.toLowerCase());
    expect(q).toEqual({ code: c.code, percentOff: 99, payPaise: null, listTotal: 3_99_900, discount: 3_95_901, total: 3_999 });

    const pay = await startPayment(owner, { kind: "PLAN", plan: "enterprise" }, "MONTHLY", ` ${c.code.toLowerCase()} `);
    expect(pay).toMatchObject({ mode: "DEMO", total: 3_999 });
    const row = await db.branchSubscription.findUniqueOrThrow({ where: { id: pay.id } });
    // The books follow what was charged: GST is worked out on the reduced price.
    expect(row).toMatchObject({ total: 3_999, base: 3_389, gst: 610, couponCode: c.code, discount: 3_95_901, status: "PENDING" });
    // Started is not used: the use is held, not taken.
    expect((await listCoupons()).find((x) => x.id === c.id)?.uses).toBe(0);

    const paid = await confirmDemoPayment(owner, pay.id);
    expect(paid).toMatchObject({ status: "PAID", total: 3_999 });
    expect((await gymPlan(g.org.id)).standing.kind).toBe("PAID");
    expect((await listCoupons()).find((x) => x.id === c.id)).toMatchObject({ uses: 1, given: 3_95_901 });
    expect((await billingHistory(owner))[0]).toMatchObject({ couponCode: c.code, discount: 3_95_901 });
    await expect(startPayment(owner, { kind: "PLAN", plan: "enterprise" }, "MONTHLY", c.code)).rejects.toThrow(/already used/);
    // Another gym can still use it.
    const other = await gym();
    expect(await startPayment(other.owner, { kind: "BRANCH", branchId: null }, "YEARLY", c.code)).toMatchObject({ mode: "DEMO", total: 4_990 });
  });

  it("holds a use for a payment that was started, and gives it back when it is started again or fails", async () => {
    const c = await coupon({ usageLimit: 1 });
    const a = await gym();
    const b = await gym();
    const plan = { kind: "PLAN", plan: "enterprise" } as const;
    const first = await startPayment(a.owner, plan, "MONTHLY", c.code);
    // The one use is spoken for while A is paying.
    await expect(startPayment(b.owner, plan, "MONTHLY", c.code)).rejects.toThrow(/fully used/);
    // A starting again does not take a second one.
    const again = await startPayment(a.owner, plan, "MONTHLY", c.code);
    expect(await db.couponRedemption.findUniqueOrThrow({ where: { paymentId: first.id } })).toMatchObject({ status: "RELEASED" });
    expect(await db.couponRedemption.findUniqueOrThrow({ where: { paymentId: again.id } })).toMatchObject({ status: "PENDING" });
    // A hold that was never finished runs out.
    await db.couponRedemption.updateMany({ where: { couponId: c.id }, data: { createdAt: new Date(Date.now() - 3 * 3_600_000) } });
    const paidByB = await startPayment(b.owner, plan, "MONTHLY", c.code);
    await confirmDemoPayment(b.owner, paidByB.id);
    // Used up now: nobody else, A included.
    await expect(quoteCoupon(c.code, "GYM", { orgId: a.g.org.id }, 1000)).rejects.toThrow(/fully used/);
  });

  it("a 100% coupon turns the plan on with nothing to pay, even without Razorpay on a live server", async () => {
    const { g, owner } = await gym();
    await db.organization.update({ where: { id: g.org.id }, data: { trialEndsAt: new Date(Date.now() - 2 * DAY) } });
    expect((await gymPlan(g.org.id)).standing.kind).toBe("LAPSED");
    const c = await coupon({ percentOff: 100 });
    vi.stubEnv("NODE_ENV", "production");
    const pay = await startPayment(owner, { kind: "PLAN", plan: "enterprise" }, "YEARLY", c.code);
    expect(pay).toMatchObject({ mode: "FREE", total: 0 });
    const row = await db.branchSubscription.findUniqueOrThrow({ where: { id: pay.id } });
    expect(row).toMatchObject({ status: "PAID", mode: "COUPON", total: 0, discount: 39_99_000, couponCode: c.code });
    expect(row.invoiceNo).toMatch(/^FIT\//);
    expect(toIso(row.periodStart!)).toBe(todayIso());
    expect((await gymPlan(g.org.id)).standing.kind).toBe("PAID");
    expect((await listCoupons()).find((x) => x.id === c.id)?.uses).toBe(1);
    // A paid payment still can't be made without Razorpay on a live server.
    await expect(startPayment(owner, { kind: "BRANCH", branchId: null }, "YEARLY")).rejects.toThrow(/aren't switched on yet/);
    await expect(startPayment(owner, { kind: "BRANCH", branchId: null }, "YEARLY", (await coupon({ percentOff: 50 })).code)).rejects.toThrow(/aren't switched on yet/);
  });

  it("with Razorpay on, a coupon is one payment at the reduced amount, not a subscription", async () => {
    const rz = fakeRazorpay();
    const { g, owner } = await gym();
    const c = await coupon({ percentOff: 90 });
    // Without a coupon this plan is a subscription that renews itself...
    const pay = await startPayment(owner, { kind: "PLAN", plan: "enterprise" }, "MONTHLY", c.code);
    expect(pay).toMatchObject({ mode: "LIVE", total: 39_990 });
    // ...with one it is a single order for the reduced amount, and no subscription is made.
    expect(rz.orders).toEqual([{ amount: 39_990, receipt: pay.id }]);
    expect(rz.paths).toEqual(["POST /orders"]);
    expect(await db.branchSubscription.findUniqueOrThrow({ where: { id: pay.id } })).toMatchObject({ mode: "LIVE", status: "PENDING", razorpayOrderId: (pay as { orderId: string }).orderId });

    // Razorpay says it was captured: paid, once, and the coupon is used.
    const orderId = (pay as { orderId: string }).orderId;
    const paymentId = `pay_${uid()}`;
    expect(await applyFitronBillingEvent(captured(orderId, paymentId))).toBe("paid");
    expect(await applyFitronBillingEvent(captured(orderId, paymentId))).toBe("paid");
    expect(await db.branchSubscription.findUniqueOrThrow({ where: { id: pay.id } })).toMatchObject({ status: "PAID", razorpayPaymentId: paymentId, couponCode: c.code });
    expect((await listCoupons()).find((x) => x.id === c.id)?.uses).toBe(1);
    expect((await gymPlan(g.org.id)).key).toBe("enterprise");
  });

  it("a failed payment gives the coupon's use back, and a retry that goes through takes it", async () => {
    fakeRazorpay();
    const { owner } = await gym();
    const c = await coupon({ percentOff: 50, usageLimit: 1 });
    const pay = await startPayment(owner, { kind: "BRANCH", branchId: null }, "YEARLY", c.code);
    const orderId = (pay as { orderId: string }).orderId;
    await applyFitronBillingEvent(failed(orderId));
    expect(await db.couponRedemption.findUniqueOrThrow({ where: { paymentId: pay.id } })).toMatchObject({ status: "RELEASED" });
    // The member retried inside the same Checkout and it went through.
    await applyFitronBillingEvent(captured(orderId));
    expect(await db.couponRedemption.findUniqueOrThrow({ where: { paymentId: pay.id } })).toMatchObject({ status: "USED" });
  });

  it("an AI Trainer member pays the coupon price once with Razorpay", async () => {
    const rz = fakeRazorpay();
    const m = await findOrCreateTrainer(`t-${uid()}@test.local`, "EMAIL", "Ravi");
    const c = await coupon({ percentOff: 99, appliesTo: "TRAINER" });
    expect(await quoteTrainerCoupon(m.id, { plan: "ai-premium", cycle: "YEARLY", code: c.code })).toEqual({ code: c.code, percentOff: 99, payPaise: null, listTotal: 4_99_900, discount: 4_94_901, total: 4_999 });

    const pay = await startTrainerCouponPayment(m.id, { plan: "ai-premium", cycle: "YEARLY", kind: "purchase" }, c.code);
    expect(pay).toMatchObject({ mode: "LIVE", total: 4_999, base: 4_236, gst: 763, couponCode: c.code, keyId: "rzp_live_x" });
    expect(rz.orders).toEqual([{ amount: 4_999, receipt: pay.id }]);
    expect(rz.paths).toEqual(["POST /orders"]);
    const row = await db.trainerPayment.findUniqueOrThrow({ where: { id: pay.id } });
    expect(row).toMatchObject({ status: "PENDING", mode: "LIVE", gstIncluded: true, razorpayOrderId: (pay as { orderId: string }).orderId, discount: 4_94_901 });
    expect((await db.trainerMember.findUniqueOrThrow({ where: { id: m.id } })).paidUntil).toBeNull();

    const paymentId = `pay_${uid()}`;
    expect(await applyFitronBillingEvent(captured((pay as { orderId: string }).orderId, paymentId))).toBe("paid");
    // Razorpay sends the same event more than once: nothing changes the second time.
    expect(await applyFitronBillingEvent(captured((pay as { orderId: string }).orderId, paymentId))).toBe("paid");
    const done = await db.trainerPayment.findUniqueOrThrow({ where: { id: pay.id } });
    expect(done).toMatchObject({ status: "PAID", razorpayPaymentId: paymentId });
    expect(await db.trainerMember.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ plan: "ai-premium", cycle: "YEARLY" });
    expect((await db.trainerMember.findUniqueOrThrow({ where: { id: m.id } })).paidUntil).not.toBeNull();
    expect((await listCoupons()).find((x) => x.id === c.id)?.uses).toBe(1);
    // Once each.
    await expect(startTrainerCouponPayment(m.id, { plan: "ai-pro", cycle: "MONTHLY", kind: "renew" }, c.code)).rejects.toThrow(/already used/);
  });

  it("an AI Trainer member's Checkout reply is trusted only with Razorpay's signature", async () => {
    fakeRazorpay();
    const m = await findOrCreateTrainer(`t-${uid()}@test.local`, "EMAIL");
    const other = await findOrCreateTrainer(`t-${uid()}@test.local`, "EMAIL");
    const c = await coupon({ percentOff: 90, appliesTo: "TRAINER" });
    const pay = await startTrainerCouponPayment(m.id, { plan: "ai-pro", cycle: "MONTHLY", kind: "purchase" }, c.code);
    const orderId = (pay as { orderId: string }).orderId;
    const paymentId = `pay_${uid()}`;
    const sign = (o: string, p: string) => createHmac("sha256", "secret").update(`${o}|${p}`).digest("hex");

    await expect(confirmTrainerOrder(m.id, pay.id, { orderId, paymentId, signature: "forged" })).rejects.toThrow(/couldn't confirm this payment/);
    // Someone else's payment can't be confirmed by another member, nor with another order's id.
    await expect(confirmTrainerOrder(other.id, pay.id, { orderId, paymentId, signature: sign(orderId, paymentId) })).rejects.toThrow(/Payment not found/);
    await expect(confirmTrainerOrder(m.id, pay.id, { orderId: "order_other", paymentId, signature: sign("order_other", paymentId) })).rejects.toThrow(/Payment not found/);
    expect((await db.trainerPayment.findUniqueOrThrow({ where: { id: pay.id } })).status).toBe("PENDING");

    expect(await confirmTrainerOrder(m.id, pay.id, { orderId, paymentId, signature: sign(orderId, paymentId) })).toEqual({ status: "PAID" });
    expect(await confirmTrainerOrder(m.id, pay.id, { orderId, paymentId, signature: sign(orderId, paymentId) })).toEqual({ status: "PAID" });
    expect((await db.trainerMember.findUniqueOrThrow({ where: { id: m.id } })).paidUntil).not.toBeNull();
  });

  it("a 100% coupon turns an AI Trainer plan on with nothing to pay", async () => {
    const m = await findOrCreateTrainer(`t-${uid()}@test.local`, "EMAIL");
    const c = await coupon({ percentOff: 100 });
    const pay = await startTrainerCouponPayment(m.id, { plan: "ai-pro", cycle: "MONTHLY", kind: "purchase" }, c.code);
    expect(pay).toMatchObject({ mode: "FREE", total: 0 });
    expect(await db.trainerPayment.findUniqueOrThrow({ where: { id: pay.id } })).toMatchObject({ status: "PAID", mode: "COUPON", total: 0, discount: 29_900 });
    const after = await db.trainerMember.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.plan).toBe("ai-pro");
    expect(toIso(after.paidUntil!) >= addDays(todayIso(), 27)).toBe(true);
    // Paying with no coupon is still refused until Razorpay is set up.
    await expect(startTrainerPayment(m.id, { plan: "ai-pro", cycle: "MONTHLY", kind: "renew" })).rejects.toThrow(/Payments aren't switched on yet/);
    await expect(startTrainerCouponPayment(m.id, { plan: "ai-pro", cycle: "MONTHLY", kind: "renew" }, (await coupon({ percentOff: 50 })).code)).rejects.toThrow(/Payments aren't switched on yet/);
  });
});
