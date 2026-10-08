import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym } from "@/test/db";
import { RAZORPAY_PLANS } from "@/lib/domain/razorpay-plans";

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("@/lib/integrations/email", () => ({
  emailReady: () => true,
  sendEmail: async (m: { to: string; subject: string; text: string }) => {
    sent.push(m);
    return { sent: true };
  },
}));

const { applyFitronBillingEvent, autoRenewals, cancelAutoRenewal, confirmCheckout, confirmDemoPayment, confirmSubscription, getBillingInvoice, gymPlan, startPayment } = await import("./saas");
const { createMember } = await import("./members");
const { lockSubscription } = await import("./subscriptions");
const { saveBranch } = await import("./settings");
const { deleteTrainerAccount, findOrCreateTrainer, loadTrainer, setTrainerRenewal, startTrainerPayment, startTrainerTrial } = await import("./trainer");
const { confirmTrainerSubscription } = await import("./trainer-billing");
const { partnership } = await import("./trainer-gym");

const SECRET = "test-secret";
const DAY = 86_400_000;
const planIds = new Map(Object.values(RAZORPAY_PLANS).flatMap((c) => Object.values(c).map((p) => [p!.id, p!.amount] as const)));
const sign = (paymentId: string, subscriptionId: string) => createHmac("sha256", SECRET).update(`${paymentId}|${subscriptionId}`).digest("hex");
const uid = () => randomUUID().slice(0, 10);

type Call = { method: string; path: string; body?: Record<string, unknown> };

/** A stand-in for Razorpay's API that records every call. `planAmounts` overrides what a plan id charges. */
function fakeRazorpay(planAmounts: Record<string, number> = {}) {
  const calls: Call[] = [];
  const payments = new Map<string, { status: string; amount: number }>();
  const stopped = new Set<string>();
  let cancelsFail = false;
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname.replace(/^\/v1/, "");
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ method, path, body });
      const id = path.split("/")[2] ?? "";
      if (method === "GET" && path.startsWith("/plans/")) return reply({ id, item: { amount: planAmounts[id] ?? planIds.get(id), currency: "INR" } });
      if (method === "POST" && path === "/subscriptions") return reply({ id: `sub_${uid()}`, status: "created", plan_id: body?.plan_id });
      if (method === "POST" && path.endsWith("/cancel")) {
        if (cancelsFail) return reply({ error: { description: "Razorpay is down" } }, 503);
        stopped.add(id);
        return reply({ id, status: "cancelled" });
      }
      if (method === "GET" && path.startsWith("/subscriptions/")) return cancelsFail ? reply({ error: { description: "Razorpay is down" } }, 503) : reply({ id, status: stopped.has(id) ? "cancelled" : "active" });
      if (method === "GET" && path.startsWith("/payments/")) return reply({ id, ...(payments.get(id) ?? { status: "captured", amount: 0 }) });
      if (method === "POST" && path === "/orders") return reply({ id: `order_${uid()}`, amount: body?.amount, status: "created" });
      return reply({ error: { description: `fake Razorpay has no ${method} ${path}` } }, 404);
    }),
  );
  return {
    calls,
    pay: (id: string, amount: number, status = "captured") => payments.set(id, { status, amount }),
    /** While true, Razorpay can't be reached to stop a subscription. */
    failCancels: (on: boolean) => void (cancelsFail = on),
    cancelled: () => calls.filter((c) => c.method === "POST" && c.path.endsWith("/cancel")).map((c) => c.path.split("/")[2]),
  };
}

const charged = (subId: string, payId: string, amount: number, status = "active") => ({
  event: "subscription.charged",
  payload: {
    subscription: { entity: { id: subId, status, paid_count: 1, charge_at: Math.floor(Date.now() / 1000) + 30 * 86_400 } },
    payment: { entity: { id: payId, order_id: `order_${payId}`, status: "captured", amount } },
  },
});

/** A self-signed-up gym on a free trial, with one open branch (so single-branch plans can be paid for). */
async function trialGym(plan = "starter") {
  const gym = await makeGym();
  await db.organization.update({ where: { id: gym.org.id }, data: { plan, trialEndsAt: new Date(Date.now() + 3 * DAY) } });
  await db.branch.update({ where: { id: gym.b.id }, data: { active: false } });
  return { gym, owner: await gym.user("Super Admin") };
}

describe.skipIf(!hasDb)("Razorpay subscriptions for gym plans (database)", () => {
  beforeAll(() => {
    vi.stubEnv("FITRON_RAZORPAY_KEY_ID", "rzp_live_x");
    vi.stubEnv("FITRON_RAZORPAY_KEY_SECRET", SECRET);
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  beforeEach(() => {
    sent.length = 0;
  });

  it("after the 7-day trial, a gym pays through Razorpay for the plan it took at sign-up, and the gym opens again", async () => {
    const { owner, gym } = await trialGym("professional");
    await db.organization.update({ where: { id: gym.org.id }, data: { planCycle: "YEARLY" } });
    const take = (name: string) => ({ name, gender: "Female" as const, phone: `98${Math.floor(1e7 + Math.random() * 9e7)}`, source: "Walk-in" as const, tags: [] });
    await createMember({ ...owner, branch: gym.a.id, branchIds: [gym.a.id] }, take("During Trial"));

    await db.organization.update({ where: { id: gym.org.id }, data: { trialEndsAt: new Date(Date.now() - 2 * DAY) } });
    const ended = await gymPlan(gym.org.id);
    expect(ended).toMatchObject({ key: "professional", cycle: "YEARLY", standing: { kind: "LAPSED" } });
    await expect(createMember({ ...owner, branch: gym.a.id, branchIds: [gym.a.id] }, take("Locked Out"))).rejects.toThrow(/plan has ended/);

    // The plan and cycle taken at sign-up are what is paid for, by Razorpay.
    const rz = fakeRazorpay();
    const c = await startPayment(owner, { kind: "PLAN", plan: ended.key }, ended.cycle);
    if (c.mode !== "SUBSCRIPTION") throw new Error(`expected Razorpay, got ${c.mode}`);
    expect(c).toMatchObject({ total: 19_99_000, description: "Gym Accounting Professional, 1 year (GST included)" });
    expect(rz.calls.find((x) => x.path === "/subscriptions")!.body).toMatchObject({ plan_id: "plan_TkDEIlOqINlEsy", total_count: 10 });
    const pid = `pay_${uid()}`;
    rz.pay(pid, 19_99_000);
    await confirmSubscription(owner, { paymentId: pid, subscriptionId: c.subscriptionId, signature: sign(pid, c.subscriptionId) });
    expect((await gymPlan(gym.org.id)).standing.kind).toBe("PAID");
    await createMember({ ...owner, branch: gym.a.id, branchIds: [gym.a.id] }, take("Back In"));
  });

  it("starts a plan: checks the live plan's amount, makes the subscription, and keeps a pending row", async () => {
    const { owner, gym } = await trialGym();
    const rz = fakeRazorpay();
    const c = await startPayment(owner, { kind: "PLAN", plan: "professional" }, "MONTHLY");
    if (c.mode !== "SUBSCRIPTION") throw new Error(`expected a subscription, got ${c.mode}`);
    expect(c).toMatchObject({ total: 1_99_900, keyId: "rzp_live_x", description: "Gym Accounting Professional, 1 month (GST included)" });
    // The live plan is read before anyone is sent to pay, then the subscription is made on it.
    expect(rz.calls.map((x) => `${x.method} ${x.path}`)).toEqual(["GET /plans/plan_TkDDXb0qPjvxEO", "POST /subscriptions"]);
    expect(rz.calls[1]!.body).toMatchObject({ plan_id: "plan_TkDDXb0qPjvxEO", total_count: 120, quantity: 1, notes: { kind: "GYM_PLAN", plan: "professional", org: gym.org.id } });
    const row = await db.branchSubscription.findUniqueOrThrow({ where: { id: c.id } });
    // ₹1,999 is paid in full; the GST is inside it.
    expect(row).toMatchObject({ mode: "SUBSCRIPTION", status: "PENDING", razorpaySubscriptionId: c.subscriptionId, base: 1_69_407, gst: 30_493, total: 1_99_900 });
    expect(await db.razorpaySubscription.findUniqueOrThrow({ where: { id: c.subscriptionId } })).toMatchObject({ kind: "GYM_PLAN", plan: "professional", cycle: "MONTHLY", orgId: gym.org.id, status: "created" });
  });

  it("refuses to send anyone to pay when the live plan charges something other than the price list", async () => {
    const { owner, gym } = await trialGym();
    const rz = fakeRazorpay({ plan_TkDDXb0qPjvxEO: 1_49_900 });
    await expect(startPayment(owner, { kind: "PLAN", plan: "professional" }, "MONTHLY")).rejects.toThrow(/isn't set up correctly/);
    expect(rz.calls.some((x) => x.path === "/subscriptions")).toBe(false);
    expect(await db.branchSubscription.count({ where: { orgId: gym.org.id } })).toBe(0);
    expect(await db.razorpaySubscription.count({ where: { orgId: gym.org.id } })).toBe(0);
  });

  it("confirms the first payment only with Razorpay's signature, from the gym that started it, once Razorpay says it's captured", async () => {
    const { owner, gym } = await trialGym();
    const rz = fakeRazorpay();
    const c = await startPayment(owner, { kind: "PLAN", plan: "professional" }, "MONTHLY");
    if (c.mode !== "SUBSCRIPTION") throw new Error("expected a subscription");
    const pid = `pay_${uid()}`;
    const a = { paymentId: pid, subscriptionId: c.subscriptionId, signature: sign(pid, c.subscriptionId) };
    await expect(confirmSubscription(owner, { ...a, signature: "forged" })).rejects.toThrow(/couldn't confirm/);
    await expect(confirmSubscription(await (await makeGym()).user("Super Admin"), a)).rejects.toThrow(/not found/);
    expect(await db.branchSubscription.count({ where: { orgId: gym.org.id, status: "PAID" } })).toBe(0);

    // Authorised but not captured yet: nothing is switched on; the webhook finishes it when the money lands.
    rz.pay(pid, 1_99_900, "authorized");
    expect(await confirmSubscription(owner, a)).toEqual({ status: "PROCESSING" });
    expect((await db.branchSubscription.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("PENDING");

    rz.pay(pid, 1_99_900);
    expect(await confirmSubscription(owner, a)).toEqual({ status: "PAID" });
    const paid = await db.branchSubscription.findUniqueOrThrow({ where: { id: c.id } });
    expect(paid).toMatchObject({ status: "PAID", razorpayPaymentId: pid, total: 1_99_900 });
    expect(paid.invoiceNo).toMatch(/^FIT\/\d{4}-\d{2}\/\d{5}$/);
    expect((await db.organization.findUniqueOrThrow({ where: { id: gym.org.id } })).plan).toBe("professional");
    expect((await getBillingInvoice(owner, c.id))?.sub.id).toBe(c.id);
  });

  it("records a payment once, whether Checkout's reply and the webhook come one after the other or together", async () => {
    const { owner, gym } = await trialGym();
    const rz = fakeRazorpay();
    const c = await startPayment(owner, { kind: "PLAN", plan: "starter" }, "MONTHLY");
    if (c.mode !== "SUBSCRIPTION") throw new Error("expected a subscription");
    const pid = `pay_${uid()}`;
    rz.pay(pid, 99_900);
    const results = await Promise.all([confirmSubscription(owner, { paymentId: pid, subscriptionId: c.subscriptionId, signature: sign(pid, c.subscriptionId) }), applyFitronBillingEvent(charged(c.subscriptionId, pid, 99_900))]);
    expect(results[0]).toEqual({ status: "PAID" });
    expect(["paid", "already recorded"]).toContain(results[1]);
    expect(await db.branchSubscription.count({ where: { orgId: gym.org.id, kind: "PLAN", status: "PAID" } })).toBe(1);
    // The same webhook delivered again changes nothing.
    expect(await applyFitronBillingEvent(charged(c.subscriptionId, pid, 99_900))).toBe("already recorded");
    expect(await db.branchSubscription.count({ where: { orgId: gym.org.id } })).toBe(1);
    // The webhook alone is enough, if Checkout's reply never arrives.
    const { owner: o2, gym: g2 } = await trialGym();
    const c2 = await startPayment(o2, { kind: "PLAN", plan: "starter" }, "MONTHLY");
    if (c2.mode !== "SUBSCRIPTION") throw new Error("expected a subscription");
    expect(await applyFitronBillingEvent(charged(c2.subscriptionId, `pay_${uid()}`, 99_900))).toBe("paid");
    expect(await db.branchSubscription.count({ where: { orgId: g2.org.id, status: "PAID" } })).toBe(1);
  });

  it("takes one charge at a time per subscription: a charge waits while another is being recorded", async () => {
    const { owner } = await trialGym();
    fakeRazorpay();
    const c = await startPayment(owner, { kind: "PLAN", plan: "starter" }, "MONTHLY");
    if (c.mode !== "SUBSCRIPTION") throw new Error("expected a subscription");
    let held!: () => void;
    const acquired = new Promise<void>((r) => (held = r));
    const holder = db.$transaction(
      async (tx) => {
        await lockSubscription(tx, c.subscriptionId);
        held();
        await new Promise((r) => setTimeout(r, 700));
      },
      { timeout: 10_000 },
    );
    await acquired;
    const t0 = Date.now();
    expect(await applyFitronBillingEvent(charged(c.subscriptionId, `pay_${uid()}`, 99_900))).toBe("paid");
    expect(Date.now() - t0, "recording the charge waited for the lock").toBeGreaterThanOrEqual(500);
    await holder;
    // Another subscription's charges are not held up by it.
    const other = await trialGym();
    fakeRazorpay();
    const c2 = await startPayment(other.owner, { kind: "PLAN", plan: "starter" }, "MONTHLY");
    if (c2.mode !== "SUBSCRIPTION") throw new Error("expected a subscription");
    const holder2 = db.$transaction(
      async (tx) => {
        await lockSubscription(tx, c.subscriptionId);
        await new Promise((r) => setTimeout(r, 400));
      },
      { timeout: 10_000 },
    );
    const t1 = Date.now();
    await applyFitronBillingEvent(charged(c2.subscriptionId, `pay_${uid()}`, 99_900));
    expect(Date.now() - t1).toBeLessThan(400);
    await holder2;
  });

  it("makes each renewal its own paid period with its own invoice, and tells the gym", async () => {
    const { owner, gym } = await trialGym("professional");
    const rz = fakeRazorpay();
    const c = await startPayment(owner, { kind: "PLAN", plan: "professional" }, "MONTHLY");
    if (c.mode !== "SUBSCRIPTION") throw new Error("expected a subscription");
    const p1 = `pay_${uid()}`;
    rz.pay(p1, 1_99_900);
    await confirmSubscription(owner, { paymentId: p1, subscriptionId: c.subscriptionId, signature: sign(p1, c.subscriptionId) });
    sent.length = 0;

    const p2 = `pay_${uid()}`;
    expect(await applyFitronBillingEvent(charged(c.subscriptionId, p2, 1_99_900))).toBe("paid");
    const rows = await db.branchSubscription.findMany({ where: { orgId: gym.org.id, status: "PAID" }, orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ mode: "SUBSCRIPTION", razorpaySubscriptionId: c.subscriptionId, razorpayPaymentId: p2, total: 1_99_900, kind: "PLAN", plan: "professional" });
    expect(rows[1]!.invoiceNo).not.toBe(rows[0]!.invoiceNo);
    // The renewal's period starts the day after the first one ends: no days lost, none doubled.
    expect(rows[1]!.periodStart!.getTime()).toBe(rows[0]!.periodEnd!.getTime() + DAY);
    expect(sent.map((m) => m.subject)).toEqual(["Your FITRON plan renewed"]);
    // The subscription's state follows the event.
    expect(await db.razorpaySubscription.findUniqueOrThrow({ where: { id: c.subscriptionId } })).toMatchObject({ status: "active", paidCount: 1 });
    expect((await autoRenewals(gym.org.id)).map((r) => r.what)).toEqual(["Professional plan"]);
    expect((await autoRenewals(gym.org.id))[0]!.nextChargeAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("charges nothing twice: paying for another plan ends the old renewal, and a late charge on the old one doesn't flip the plan back", async () => {
    const { owner, gym } = await trialGym();
    const rz = fakeRazorpay();
    const first = await startPayment(owner, { kind: "PLAN", plan: "starter" }, "MONTHLY");
    if (first.mode !== "SUBSCRIPTION") throw new Error("expected a subscription");
    // The same plan and cycle can't be started twice while it renews.
    const p1 = `pay_${uid()}`;
    rz.pay(p1, 99_900);
    await confirmSubscription(owner, { paymentId: p1, subscriptionId: first.subscriptionId, signature: sign(p1, first.subscriptionId) });
    await db.razorpaySubscription.update({ where: { id: first.subscriptionId }, data: { status: "active" } });
    await expect(startPayment(owner, { kind: "PLAN", plan: "starter" }, "MONTHLY")).rejects.toThrow(/already renews automatically/);

    const second = await startPayment(owner, { kind: "PLAN", plan: "professional" }, "MONTHLY");
    if (second.mode !== "SUBSCRIPTION") throw new Error("expected a subscription");
    const p2 = `pay_${uid()}`;
    rz.pay(p2, 1_99_900);
    await confirmSubscription(owner, { paymentId: p2, subscriptionId: second.subscriptionId, signature: sign(p2, second.subscriptionId) });
    expect((await db.organization.findUniqueOrThrow({ where: { id: gym.org.id } })).plan).toBe("professional");
    expect(rz.cancelled()).toEqual([first.subscriptionId]);
    expect(await db.razorpaySubscription.findUniqueOrThrow({ where: { id: first.subscriptionId } })).toMatchObject({ status: "cancelled" });

    // A charge for the old plan that was already on its way: the money is recorded, the plan stays, and the stop is retried.
    expect(await applyFitronBillingEvent(charged(first.subscriptionId, `pay_${uid()}`, 99_900))).toBe("paid");
    expect((await db.organization.findUniqueOrThrow({ where: { id: gym.org.id } })).plan).toBe("professional");
    expect(rz.cancelled()).toEqual([first.subscriptionId, first.subscriptionId]);
  });

  it("lets the gym stop a renewal, only its own, and keeps the paid period", async () => {
    const { owner, gym } = await trialGym();
    const rz = fakeRazorpay();
    const c = await startPayment(owner, { kind: "PLAN", plan: "starter" }, "MONTHLY");
    if (c.mode !== "SUBSCRIPTION") throw new Error("expected a subscription");
    const pid = `pay_${uid()}`;
    rz.pay(pid, 99_900);
    await confirmSubscription(owner, { paymentId: pid, subscriptionId: c.subscriptionId, signature: sign(pid, c.subscriptionId) });
    await db.razorpaySubscription.update({ where: { id: c.subscriptionId }, data: { status: "active" } });

    await expect(cancelAutoRenewal(await (await makeGym()).user("Super Admin"), c.subscriptionId)).rejects.toThrow(/isn't renewing/);
    await cancelAutoRenewal(owner, c.subscriptionId);
    expect(rz.cancelled()).toEqual([c.subscriptionId]);
    expect(await autoRenewals(gym.org.id)).toEqual([]);
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: "billing.autorenew-cancelled" } })).toBe(1);
    await expect(cancelAutoRenewal(owner, c.subscriptionId)).rejects.toThrow(/isn't renewing/);
    // What was paid stays valid.
    expect((await db.branchSubscription.findFirstOrThrow({ where: { orgId: gym.org.id, status: "PAID" } })).periodEnd!.getTime()).toBeGreaterThan(Date.now());
    // A stale "active" event can't make a renewal we stopped look alive again.
    await applyFitronBillingEvent({ event: "subscription.activated", payload: { subscription: { entity: { id: c.subscriptionId, status: "active" } } } });
    expect(await autoRenewals(gym.org.id)).toEqual([]);
  });

  it("keeps a stop that Razorpay hasn't confirmed visible and retryable, so a renewal never looks stopped while it can still charge", async () => {
    const { owner, gym } = await trialGym();
    const rz = fakeRazorpay();
    const c = await startPayment(owner, { kind: "PLAN", plan: "starter" }, "MONTHLY");
    if (c.mode !== "SUBSCRIPTION") throw new Error("expected a subscription");
    const pid = `pay_${uid()}`;
    rz.pay(pid, 99_900);
    await confirmSubscription(owner, { paymentId: pid, subscriptionId: c.subscriptionId, signature: sign(pid, c.subscriptionId) });
    await db.razorpaySubscription.update({ where: { id: c.subscriptionId }, data: { status: "active" } });

    rz.failCancels(true);
    await expect(cancelAutoRenewal(owner, c.subscriptionId)).rejects.toThrow(/couldn't reach Razorpay/);
    // Still listed, marked as a stop waiting for Razorpay, and no audit entry for a stop that didn't happen.
    expect(await autoRenewals(gym.org.id)).toEqual([expect.objectContaining({ id: c.subscriptionId, stopPending: true, status: "active" })]);
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: "billing.autorenew-cancelled" } })).toBe(0);
    // A charge that arrives meanwhile is recorded, and the stop is attempted again.
    rz.failCancels(false);
    expect(await applyFitronBillingEvent(charged(c.subscriptionId, `pay_${uid()}`, 99_900))).toBe("paid");
    expect(await autoRenewals(gym.org.id)).toEqual([]);
    expect((await db.razorpaySubscription.findUniqueOrThrow({ where: { id: c.subscriptionId } })).status).toBe("cancelled");

    // And the gym can simply try again by hand.
    const again = await startPayment(owner, { kind: "PLAN", plan: "professional" }, "MONTHLY");
    if (again.mode !== "SUBSCRIPTION") throw new Error("expected a subscription");
    const p2 = `pay_${uid()}`;
    rz.pay(p2, 1_99_900);
    await confirmSubscription(owner, { paymentId: p2, subscriptionId: again.subscriptionId, signature: sign(p2, again.subscriptionId) });
    await db.razorpaySubscription.update({ where: { id: again.subscriptionId }, data: { status: "active" } });
    rz.failCancels(true);
    await expect(cancelAutoRenewal(owner, again.subscriptionId)).rejects.toThrow(/couldn't reach Razorpay/);
    rz.failCancels(false);
    await cancelAutoRenewal(owner, again.subscriptionId);
    expect(await autoRenewals(gym.org.id)).toEqual([]);
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: "billing.autorenew-cancelled" } })).toBe(1);
  });

  it("tells the gym once when a renewal fails and when Razorpay gives up", async () => {
    const { owner, gym } = await trialGym();
    const rz = fakeRazorpay();
    const c = await startPayment(owner, { kind: "PLAN", plan: "starter" }, "MONTHLY");
    if (c.mode !== "SUBSCRIPTION") throw new Error("expected a subscription");
    const pid = `pay_${uid()}`;
    rz.pay(pid, 99_900);
    await confirmSubscription(owner, { paymentId: pid, subscriptionId: c.subscriptionId, signature: sign(pid, c.subscriptionId) });
    sent.length = 0;
    const event = (e: string, status: string) => ({ event: e, payload: { subscription: { entity: { id: c.subscriptionId, status } } } });
    expect(await applyFitronBillingEvent(event("subscription.pending", "pending"))).toBe("synced");
    expect(await applyFitronBillingEvent(event("subscription.pending", "pending"))).toBe("synced");
    expect(sent.map((m) => m.subject)).toEqual(["Your FITRON renewal payment failed"]);
    await applyFitronBillingEvent(event("subscription.halted", "halted"));
    expect(sent.map((m) => m.subject)).toEqual(["Your FITRON renewal payment failed", "Your FITRON plan stopped renewing"]);
    expect((await db.razorpaySubscription.findUniqueOrThrow({ where: { id: c.subscriptionId } })).status).toBe("halted");
    expect(await db.notification.count({ where: { orgId: gym.org.id, type: "BILLING" } })).toBe(2);
    expect(await applyFitronBillingEvent(event("subscription.activated", "active"))).toBe("synced");
    expect(await applyFitronBillingEvent({ event: "subscription.charged", payload: { subscription: { entity: { id: "sub_not_ours", status: "active" } } } })).toBe("unknown subscription");
  });

  it("renews an extra branch monthly, follows the branch that claims the paid slot, and takes a yearly branch as one payment", async () => {
    const gym = await makeGym();
    const owner = await gym.user("Super Admin");
    const rz = fakeRazorpay();
    const branch = (name: string) => ({ name, address: "Main Road", phone: "9000000001" });
    await saveBranch(owner, null, branch("C"));
    const c = await startPayment(owner, { kind: "BRANCH", branchId: null }, "MONTHLY");
    if (c.mode !== "SUBSCRIPTION") throw new Error("expected a subscription");
    expect(c.total).toBe(49_900);
    expect(rz.calls.find((x) => x.path === "/subscriptions")!.body).toMatchObject({ plan_id: "plan_TkDH5pzzDQgwgw", total_count: 120 });
    const p1 = `pay_${uid()}`;
    rz.pay(p1, 49_900);
    await confirmSubscription(owner, { paymentId: p1, subscriptionId: c.subscriptionId, signature: sign(p1, c.subscriptionId) });

    await saveBranch(owner, null, branch("D"));
    const d = await db.branch.findFirstOrThrow({ where: { orgId: gym.org.id, name: "D" } });
    expect((await db.razorpaySubscription.findUniqueOrThrow({ where: { id: c.subscriptionId } })).branchId).toBe(d.id);
    await applyFitronBillingEvent(charged(c.subscriptionId, `pay_${uid()}`, 49_900));
    const renewal = await db.branchSubscription.findFirstOrThrow({ where: { razorpaySubscriptionId: c.subscriptionId, status: "PAID" }, orderBy: { createdAt: "desc" } });
    expect(renewal).toMatchObject({ kind: "BRANCH", branchId: d.id });
    // That branch can't be set up to renew twice.
    await db.razorpaySubscription.update({ where: { id: c.subscriptionId }, data: { status: "active" } });
    await expect(startPayment(owner, { kind: "BRANCH", branchId: d.id }, "MONTHLY")).rejects.toThrow(/already renews automatically/);
    // There is no yearly Razorpay plan for a branch, so a yearly branch is one order (not a subscription).
    const y = await startPayment(owner, { kind: "BRANCH", branchId: d.id }, "YEARLY");
    expect(y).toMatchObject({ mode: "LIVE", total: 4_99_000 });
  });

  it("sells Gym Partnership plans like gym plans: a subscription monthly, one order yearly", async () => {
    const { owner, gym } = await trialGym();
    const rz = fakeRazorpay();
    const m = await startPayment(owner, { kind: "PLAN", plan: "partner-software" }, "MONTHLY");
    expect(m).toMatchObject({ mode: "SUBSCRIPTION", total: 1_99_900, description: "Gym Partnership Software Partner, 1 month (GST included)" });
    expect(rz.calls.find((x) => x.path === "/subscriptions")!.body).toMatchObject({ plan_id: "plan_TkDG4XSmAuXH57" });
    expect(await startPayment(owner, { kind: "PLAN", plan: "partner-software" }, "YEARLY")).toMatchObject({ mode: "LIVE", total: 19_99_000 });
    // The AI Trainer's plans are not for gyms.
    await expect(startPayment(owner, { kind: "PLAN", plan: "ai-pro" }, "MONTHLY")).rejects.toThrow(/Gym Accounting or Gym Partnership/);
    expect(await db.branchSubscription.count({ where: { orgId: gym.org.id, kind: "PLAN", plan: "ai-pro" } })).toBe(0);
  });

  it("sells one-time add-ons: fixed or quoted, GST inside, one order, no period, a numbered invoice", async () => {
    const { owner, gym } = await trialGym();
    fakeRazorpay();
    const o = await startPayment(owner, { kind: "SERVICE", service: "onboarding" }, "ONCE");
    if (o.mode !== "LIVE") throw new Error("expected one order");
    expect(o).toMatchObject({ total: 99_900, description: "Gym onboarding and setup (GST included)" });
    const row = await db.branchSubscription.findUniqueOrThrow({ where: { id: o.id } });
    expect(row).toMatchObject({ kind: "SERVICE", plan: "onboarding", cycle: "ONCE", base: 84_661, gst: 15_239, total: 99_900, mode: "LIVE" });
    // A fixed add-on can't be paid at another amount.
    expect(await startPayment(owner, { kind: "SERVICE", service: "onboarding", amount: 1 }, "ONCE")).toMatchObject({ total: 99_900 });

    const pid = `pay_${uid()}`;
    const sig = createHmac("sha256", SECRET).update(`${o.orderId}|${pid}`).digest("hex");
    expect((await confirmCheckout(owner, { orderId: o.orderId, paymentId: pid, signature: sig }))?.status).toBe("PAID");
    const paid = await db.branchSubscription.findUniqueOrThrow({ where: { id: o.id } });
    expect(paid.periodStart).toBeNull();
    expect(paid.periodEnd).toBeNull();
    expect(paid.invoiceNo).toMatch(/^FIT\/\d{4}-\d{2}\/\d{5}$/);
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: "billing.service-paid" } })).toBe(1);
    // An add-on doesn't touch the plan or any branch.
    expect((await db.organization.findUniqueOrThrow({ where: { id: gym.org.id } })).plan).toBe("starter");
    expect(await applyFitronBillingEvent({ event: "payment.captured", payload: { payment: { entity: { id: pid, order_id: o.orderId } } } })).toBe("paid");
    expect(await db.branchSubscription.count({ where: { orgId: gym.org.id, status: "PAID" } })).toBe(1);

    // Quoted work: the agreed amount, in whole rupees, not below the starting price and not absurd.
    await expect(startPayment(owner, { kind: "SERVICE", service: "data-migration", amount: 500 }, "ONCE")).rejects.toThrow(/starts at ₹999/);
    await expect(startPayment(owner, { kind: "SERVICE", service: "data-migration", amount: 10_00_001 }, "ONCE")).rejects.toThrow(/most one payment/);
    await expect(startPayment(owner, { kind: "SERVICE", service: "nope" }, "ONCE")).rejects.toThrow(/Pick an add-on/);
    expect(await startPayment(owner, { kind: "SERVICE", service: "data-migration", amount: 1_500 }, "ONCE")).toMatchObject({ total: 1_50_000 });
    expect(await startPayment(owner, { kind: "SERVICE", service: "data-migration" }, "ONCE")).toMatchObject({ total: 99_900 });
    // A plan or branch needs a billing cycle.
    await expect(startPayment(owner, { kind: "PLAN", plan: "starter" }, "ONCE")).rejects.toThrow(/monthly or yearly/);
  });

  it("without Razorpay keys, add-ons and partner plans go through the demo flow (development only)", async () => {
    vi.stubEnv("FITRON_RAZORPAY_KEY_ID", "");
    vi.stubEnv("FITRON_RAZORPAY_KEY_SECRET", "");
    try {
      const { owner, gym } = await trialGym();
      const s = await startPayment(owner, { kind: "SERVICE", service: "branding" }, "ONCE");
      expect(s).toMatchObject({ mode: "DEMO", total: 4_99_900 });
      expect((await confirmDemoPayment(owner, s.id))?.invoiceNo).toMatch(/^FIT\//);
      const p = await startPayment(owner, { kind: "PLAN", plan: "partner-referral" }, "MONTHLY");
      await confirmDemoPayment(owner, p.id);
      expect((await db.organization.findUniqueOrThrow({ where: { id: gym.org.id } })).plan).toBe("partner-referral");
      expect(await startPayment(owner, { kind: "PLAN", plan: "starter" }, "MONTHLY")).toMatchObject({ mode: "DEMO", total: 99_900 });
      // With the keys set, the plan renews itself instead of being paid by hand.
      vi.stubEnv("FITRON_RAZORPAY_KEY_ID", "rzp_live_x");
      vi.stubEnv("FITRON_RAZORPAY_KEY_SECRET", SECRET);
      fakeRazorpay();
      expect(await startPayment(owner, { kind: "PLAN", plan: "starter" }, "MONTHLY")).toMatchObject({ mode: "SUBSCRIPTION" });
    } finally {
      vi.stubEnv("FITRON_RAZORPAY_KEY_ID", "rzp_live_x");
      vi.stubEnv("FITRON_RAZORPAY_KEY_SECRET", SECRET);
    }
  });
});

describe.skipIf(!hasDb)("Razorpay subscriptions for AI Trainer members (database)", () => {
  beforeAll(() => {
    vi.stubEnv("FITRON_RAZORPAY_KEY_ID", "rzp_live_x");
    vi.stubEnv("FITRON_RAZORPAY_KEY_SECRET", SECRET);
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  beforeEach(() => {
    sent.length = 0;
  });

  const member = async () => {
    const m = await findOrCreateTrainer(`t-${uid()}@test.local`, "EMAIL", "Ravi");
    await startTrainerTrial(m.id, "ai-pro");
    return m;
  };

  it("after the 7-day trial, a member pays through Razorpay for the plan they took, and the app opens again", async () => {
    const m = await findOrCreateTrainer(`t-${uid()}@test.local`, "EMAIL", "Meera");
    await startTrainerTrial(m.id, "ai-premium");
    await db.trainerMember.update({ where: { id: m.id }, data: { trialEndsAt: new Date(Date.now() - 2 * DAY) } });
    const locked = (await loadTrainer(m.id)).member;
    // The plan taken is on the account, so the app can offer it, and coach messages stay shut until it is paid.
    expect(locked).toMatchObject({ plan: "ai-premium", access: "LOCKED", autoRenew: false });

    const rz = fakeRazorpay();
    const pay = await startTrainerPayment(m.id, { plan: locked.plan, cycle: "YEARLY", kind: "purchase" });
    if (pay.mode !== "SUBSCRIPTION") throw new Error(`expected Razorpay, got ${pay.mode}`);
    expect(pay).toMatchObject({ total: 4_99_900, description: "AI Premium, 1 year (GST included)" });
    expect(rz.calls.find((x) => x.path === "/subscriptions")!.body).toMatchObject({ plan_id: "plan_TkDC21kuHfIXCY", total_count: 10 });
    const pid = `pay_${uid()}`;
    rz.pay(pid, 4_99_900);
    expect(await confirmTrainerSubscription(m.id, pay.id, { paymentId: pid, subscriptionId: pay.subscriptionId, signature: sign(pid, pay.subscriptionId) })).toEqual({ status: "PAID" });
    expect((await loadTrainer(m.id)).member).toMatchObject({ plan: "ai-premium", cycle: "YEARLY", access: "ACTIVE", autoRenew: true });
  });

  it("starts, confirms and renews a plan, with the GST inside the listed price", async () => {
    const m = await member();
    const rz = fakeRazorpay();
    const pay = await startTrainerPayment(m.id, { plan: "ai-pro", cycle: "MONTHLY", kind: "purchase" });
    if (pay.mode !== "SUBSCRIPTION") throw new Error("expected a subscription");
    expect(pay).toMatchObject({ total: 29_900, base: 25_339, gst: 4_561, keyId: "rzp_live_x", description: "AI Pro, 1 month (GST included)", prefill: { name: "Ravi", email: m.email } });
    expect(rz.calls.map((x) => `${x.method} ${x.path}`)).toEqual(["GET /plans/plan_TkD9pDREcTR3NX", "POST /subscriptions"]);
    expect(rz.calls[1]!.body).toMatchObject({ total_count: 120, notes: { kind: "TRAINER", plan: "ai-pro", member: m.id } });
    expect(await db.trainerPayment.findUniqueOrThrow({ where: { id: pay.id } })).toMatchObject({ mode: "SUBSCRIPTION", status: "PENDING", gstIncluded: true, razorpaySubscriptionId: pay.subscriptionId });

    const pid = `pay_${uid()}`;
    const a = { paymentId: pid, subscriptionId: pay.subscriptionId, signature: sign(pid, pay.subscriptionId) };
    await expect(confirmTrainerSubscription(m.id, pay.id, { ...a, signature: "forged" })).rejects.toThrow(/couldn't confirm/);
    const other = await member();
    await expect(confirmTrainerSubscription(other.id, pay.id, a)).rejects.toThrow(/not found/);
    rz.pay(pid, 29_900, "authorized");
    expect(await confirmTrainerSubscription(m.id, pay.id, a)).toEqual({ status: "PROCESSING" });
    rz.pay(pid, 29_900);
    expect(await confirmTrainerSubscription(m.id, pay.id, a)).toEqual({ status: "PAID" });
    const paid = await db.trainerMember.findUniqueOrThrow({ where: { id: m.id } });
    expect(paid.paidUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(await applyFitronBillingEvent(charged(pay.subscriptionId, pid, 29_900))).toBe("already recorded");
    expect(await db.trainerPayment.count({ where: { memberId: m.id, status: "PAID" } })).toBe(1);

    // The next month's charge: a new paid row that extends the period by one month, and an email.
    const before = paid.paidUntil!;
    expect(await applyFitronBillingEvent(charged(pay.subscriptionId, `pay_${uid()}`, 29_900))).toBe("paid");
    const rows = await db.trainerPayment.findMany({ where: { memberId: m.id, status: "PAID" }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.kind, r.total, r.gstIncluded])).toEqual([["purchase", 29_900, true], ["renew", 29_900, true]]);
    expect((await db.trainerMember.findUniqueOrThrow({ where: { id: m.id } })).paidUntil!.getTime()).toBeGreaterThan(before.getTime() + 27 * DAY);
    expect(sent.map((x) => x.subject)).toEqual(["Your FITRON plan renewed"]);
    expect((await loadTrainer(m.id)).member).toMatchObject({ access: "ACTIVE", autoRenew: true });
  });

  it("stops charging when the member stops renewing, and a stopped renewal can't be switched back on", async () => {
    const m = await member();
    const rz = fakeRazorpay();
    const pay = await startTrainerPayment(m.id, { plan: "ai-pro", cycle: "YEARLY", kind: "purchase" });
    if (pay.mode !== "SUBSCRIPTION") throw new Error("expected a subscription");
    const pid = `pay_${uid()}`;
    rz.pay(pid, 1_99_900);
    await confirmTrainerSubscription(m.id, pay.id, { paymentId: pid, subscriptionId: pay.subscriptionId, signature: sign(pid, pay.subscriptionId) });
    await db.razorpaySubscription.update({ where: { id: pay.subscriptionId }, data: { status: "active" } });
    // Already renewing this plan: not a second subscription.
    await expect(startTrainerPayment(m.id, { plan: "ai-pro", cycle: "YEARLY", kind: "renew" })).rejects.toThrow(/already renews automatically/);

    expect((await setTrainerRenewal(m.id, true)).planCancelled).toBe(true);
    expect(rz.cancelled()).toEqual([pay.subscriptionId]);
    expect((await loadTrainer(m.id)).member).toMatchObject({ autoRenew: false });
    await expect(setTrainerRenewal(m.id, false)).rejects.toThrow(/can't be switched back on/);
    expect((await db.trainerMember.findUniqueOrThrow({ where: { id: m.id } })).planCancelled).toBe(true);
    // Paying for a plan again starts a fresh subscription and turns renewal back on.
    const again = await startTrainerPayment(m.id, { plan: "ai-pro", cycle: "YEARLY", kind: "purchase" });
    expect(again.mode).toBe("SUBSCRIPTION");
  });

  it("a stop Razorpay hasn't confirmed keeps the member's plan renewing in the app, and can't be undone by resuming", async () => {
    const m = await member();
    const rz = fakeRazorpay();
    const pay = await startTrainerPayment(m.id, { plan: "ai-pro", cycle: "MONTHLY", kind: "purchase" });
    if (pay.mode !== "SUBSCRIPTION") throw new Error("expected a subscription");
    const pid = `pay_${uid()}`;
    rz.pay(pid, 29_900);
    await confirmTrainerSubscription(m.id, pay.id, { paymentId: pid, subscriptionId: pay.subscriptionId, signature: sign(pid, pay.subscriptionId) });
    await db.razorpaySubscription.update({ where: { id: pay.subscriptionId }, data: { status: "active" } });
    rz.failCancels(true);
    await expect(setTrainerRenewal(m.id, true)).rejects.toThrow(/couldn't reach Razorpay/);
    // Not marked as stopped, and still shown as renewing so the member can try again.
    expect((await db.trainerMember.findUniqueOrThrow({ where: { id: m.id } })).planCancelled).toBe(false);
    expect((await loadTrainer(m.id)).member).toMatchObject({ autoRenew: true });
    await expect(setTrainerRenewal(m.id, false)).rejects.toThrow(/can't be switched back on/);
    rz.failCancels(false);
    expect((await setTrainerRenewal(m.id, true)).planCancelled).toBe(true);
    expect((await loadTrainer(m.id)).member).toMatchObject({ autoRenew: false });
  });

  it("ends the old plan's renewal when the member moves to another plan", async () => {
    const m = await member();
    const rz = fakeRazorpay();
    const pro = await startTrainerPayment(m.id, { plan: "ai-pro", cycle: "MONTHLY", kind: "purchase" });
    if (pro.mode !== "SUBSCRIPTION") throw new Error("expected a subscription");
    const p1 = `pay_${uid()}`;
    rz.pay(p1, 29_900);
    await confirmTrainerSubscription(m.id, pro.id, { paymentId: p1, subscriptionId: pro.subscriptionId, signature: sign(p1, pro.subscriptionId) });
    await db.razorpaySubscription.update({ where: { id: pro.subscriptionId }, data: { status: "active" } });
    const premium = await startTrainerPayment(m.id, { plan: "ai-premium", cycle: "MONTHLY", kind: "upgrade" });
    if (premium.mode !== "SUBSCRIPTION") throw new Error("expected a subscription");
    const p2 = `pay_${uid()}`;
    rz.pay(p2, 49_900);
    await confirmTrainerSubscription(m.id, premium.id, { paymentId: p2, subscriptionId: premium.subscriptionId, signature: sign(p2, premium.subscriptionId) });
    expect(rz.cancelled()).toEqual([pro.subscriptionId]);
    expect((await db.trainerMember.findUniqueOrThrow({ where: { id: m.id } })).plan).toBe("ai-premium");
    // A charge on the old plan that was already on its way is recorded but doesn't move the member back to AI Pro.
    await applyFitronBillingEvent(charged(pro.subscriptionId, `pay_${uid()}`, 29_900));
    expect((await db.trainerMember.findUniqueOrThrow({ where: { id: m.id } })).plan).toBe("ai-premium");
  });

  it("stops the subscription when the member deletes their account", async () => {
    const m = await member();
    const rz = fakeRazorpay();
    const pay = await startTrainerPayment(m.id, { plan: "ai-premium", cycle: "MONTHLY", kind: "purchase" });
    if (pay.mode !== "SUBSCRIPTION") throw new Error("expected a subscription");
    const pid = `pay_${uid()}`;
    rz.pay(pid, 49_900);
    await confirmTrainerSubscription(m.id, pay.id, { paymentId: pid, subscriptionId: pay.subscriptionId, signature: sign(pid, pay.subscriptionId) });
    await db.razorpaySubscription.update({ where: { id: pay.subscriptionId }, data: { status: "active" } });
    await deleteTrainerAccount(m.id);
    expect(rz.cancelled()).toEqual([pay.subscriptionId]);
  });

  it("works a gym's partner share out from the price before GST: a ₹299 month (GST inside) pays 70% of ₹253.39, and an older payment pays 70% of its own before-GST price", async () => {
    const gym = await makeGym();
    const owner = await gym.user("Super Admin");
    const month = new Date().toISOString().slice(0, 7);
    const paidAt = new Date();
    const make = async (gstIncluded: boolean) => {
      const m = await findOrCreateTrainer(`t-${uid()}@test.local`, "EMAIL");
      await db.trainerMember.update({ where: { id: m.id }, data: { orgId: gym.org.id } });
      const money = gstIncluded ? { base: 25_339, gst: 4_561, total: 29_900 } : { base: 29_900, gst: 5_382, total: 35_282 };
      await db.trainerPayment.create({ data: { memberId: m.id, plan: "ai-pro", cycle: "MONTHLY", kind: "purchase", ...money, gstIncluded, mode: "UPI", status: "PAID", paidAt } });
    };
    await make(true);
    await make(false);
    const p = await partnership(owner, month);
    // 70% of ₹253.39 is ₹177.37; the older payment's before-GST price was the full ₹299, so 70% of it is ₹209.30.
    expect(p.paid.map((x) => [x.base, x.share])).toEqual([[25_339, 17_737], [29_900, 20_930]]);
    expect(p.totals).toMatchObject({ base: 55_239, share: 38_667 });
  });
});
