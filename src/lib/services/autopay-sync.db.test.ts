import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const rzp = vi.hoisted(() => ({
  ready: null as string | null,
  getSubscription: vi.fn(),
  listSubscriptionInvoices: vi.fn(),
  getPayment: vi.fn(),
  createPlan: vi.fn(),
  createSubscription: vi.fn(),
  subscriptionAction: vi.fn(),
}));
vi.mock("@/lib/integrations/razorpay", () => ({
  razorpayReady: () => rzp.ready,
  getSubscription: rzp.getSubscription,
  listSubscriptionInvoices: rzp.listSubscriptionInvoices,
  getPayment: rzp.getPayment,
  createPlan: rzp.createPlan,
  createSubscription: rzp.createSubscription,
  subscriptionAction: rzp.subscriptionAction,
  pingRazorpay: vi.fn(),
  verifyWebhook: vi.fn(),
}));

import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { addDays } from "@/lib/domain/dates";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { sellMembership } from "./billing";
import { changeMandate, createMandate, retryDemoDebit, retryLiveDebit, runAutopayDay, syncOrExplain, syncWithRazorpay } from "./autopay";
import { runDailyJobs } from "./jobs";
import { putSetting } from "./settings";
import { todayIso } from "./time";

describe.skipIf(!hasDb)("autopay sync and demo simulation (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  let planId: string;
  let phone = 9866600000;
  const today = todayIso();
  let all: typeof admin;
  const newMember = async (u = admin) => createMember(u, { name: `Asha ${phone}`, gender: "Female", phone: String(phone++), source: "Walk-in", tags: [] });

  beforeAll(async () => {
    gym = await makeGym();
    all = await gym.user("Super Admin");
    admin = pick(all, gym.a.id);
    planId = (await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 100000, regFee: 0, discount: 0, gstApplicable: true, features: [] })).id;
  });
  beforeEach(() => {
    rzp.ready = null;
    Object.values(rzp).forEach((f) => typeof f === "function" && "mockReset" in f && f.mockReset());
  });

  const demo = async () => {
    const m = await newMember();
    const first = await sellMembership(admin, m.id, { planId, startDate: today, discount: 0, includeRegFee: false, payAmount: 118000, payMethod: "UPI" });
    const md = await createMandate(admin, { memberId: m.id, planId });
    await changeMandate(admin, md.id, "approve-demo");
    return { m, md, debit: addDays(first.membership.endDate.toISOString().slice(0, 10), 1) };
  };
  const live = async (user = admin) => {
    const m = await newMember(user);
    const md = await db.autopayMandate.create({ data: { code: `MD-T${phone++}`, orgId: gym.org.id, branchId: user.branchIds[0]!, memberId: m.id, planId, amount: 118000, months: 1, mode: "live", subscriptionId: `sub_${randomUUID()}`, status: "Active", createdById: admin.id } });
    return { m, md };
  };

  it("demo failure schedules a retry, notifies, messages, then renews on the retry day", async () => {
    const { m, md, debit } = await demo();
    expect(await runAutopayDay(gym.org.id, debit, { roll: 0.99 })).toMatchObject({ failed: 1 });
    const f = await db.autopayMandate.findUniqueOrThrow({ where: { id: md.id } });
    expect(f).toMatchObject({ status: "Failed", retries: 1 });
    expect(f.nextRetryOn?.toISOString().slice(0, 10)).toBe(addDays(debit, 2));
    expect(f.lastResult).toContain("retry 1 of 3");
    expect(await db.notification.count({ where: { orgId: gym.org.id, type: "AUTOPAY", text: { contains: md.code } } })).toBe(1);
    expect(await db.whatsAppMessage.count({ where: { memberId: m.id, templateKey: "due" } })).toBe(1);
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: "autopay.failed", entityId: md.id } })).toBe(1);
    expect(await runAutopayDay(gym.org.id, debit, { roll: 0 })).toMatchObject({ charged: 0 });
    expect(await runAutopayDay(gym.org.id, addDays(debit, 2), { roll: 0 })).toMatchObject({ charged: 1 });
    const a = await db.autopayMandate.findUniqueOrThrow({ where: { id: md.id } });
    expect(a).toMatchObject({ status: "Active", retries: 0, nextRetryOn: null });
    expect(await db.membership.count({ where: { memberId: m.id, type: "AUTOPAY" } })).toBe(1);
  });

  it("halts when retries run out, and a halted debit can be retried", async () => {
    const { md } = await demo();
    await db.autopayMandate.update({ where: { id: md.id }, data: { status: "Failed", retries: 3 } });
    const r = await retryDemoDebit(admin, md.id, { roll: 0.99 });
    expect(r.result).toBe("halted");
    const h = await db.autopayMandate.findUniqueOrThrow({ where: { id: md.id } });
    expect(h.status).toBe("Halted");
    expect(h.lastResult).toMatch(/3 retries used/);
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: "autopay.halted", entityId: md.id } })).toBe(1);
    expect((await retryDemoDebit(admin, md.id, { roll: 0 })).result).toBe("renewed");
    expect((await db.autopayMandate.findUniqueOrThrow({ where: { id: md.id } })).status).toBe("Active");
  });

  it("respects the retries and gap settings", async () => {
    await putSetting(admin, "autopay", { retries: 1, retryGap: 5 });
    try {
      const { md, debit } = await demo();
      await runAutopayDay(gym.org.id, debit, { roll: 0.99 });
      const f = await db.autopayMandate.findUniqueOrThrow({ where: { id: md.id } });
      expect(f.status).toBe("Failed");
      expect(f.nextRetryOn?.toISOString().slice(0, 10)).toBe(addDays(debit, 5));
      await runAutopayDay(gym.org.id, addDays(debit, 5), { roll: 0.99 });
      expect((await db.autopayMandate.findUniqueOrThrow({ where: { id: md.id } })).status).toBe("Halted");
    } finally {
      await putSetting(admin, "autopay", { retries: 3, retryGap: 2 });
    }
  });

  it("live retry without a subscription: keys missing is an error, otherwise it re-creates the mandate", async () => {
    const { md } = await live();
    await db.autopayMandate.update({ where: { id: md.id }, data: { subscriptionId: null, status: "Failed", lastResult: "Razorpay: down" } });
    rzp.ready = "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not set on the server.";
    await expect(retryLiveDebit(admin, md.id)).rejects.toThrow(/not set on the server/);
    rzp.ready = null;
    rzp.createPlan.mockResolvedValue("plan_x");
    rzp.createSubscription.mockResolvedValue({ id: `sub_new_${md.id}`, short_url: "https://rzp.io/x", status: "created" });
    expect(await retryLiveDebit(admin, md.id)).toMatch(/Mandate created on Razorpay/);
    expect(await db.autopayMandate.findUniqueOrThrow({ where: { id: md.id } })).toMatchObject({ status: "Pending", subscriptionId: `sub_new_${md.id}` });
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: "autopay.retry", entityId: md.id } })).toBe(1);
  });

  it("sync records a paid invoice once, applies status changes, and stores the last sync", async () => {
    const { m, md } = await live();
    const sid = md.subscriptionId!;
    const chargeAt = Math.floor(Date.now() / 1000) + 30 * 86400;
    rzp.getSubscription.mockResolvedValue({ id: sid, status: "active", charge_at: chargeAt, paid_count: 1 });
    rzp.listSubscriptionInvoices.mockResolvedValue({ items: [{ id: "inv_1", status: "paid", payment_id: `pay_${sid}`, amount: 118000 }] });
    const r = await syncWithRazorpay(admin, { mandateIds: [md.id] });
    expect(r).toMatchObject({ checked: 1, charged: 1, errors: 0 });
    expect(await db.membership.count({ where: { memberId: m.id, type: "AUTOPAY" } })).toBe(1);
    expect(await db.autopayEvent.count({ where: { eventId: `sync:${sid}:inv_1` } })).toBe(1);
    const again = await syncWithRazorpay(admin, { mandateIds: [md.id] });
    expect(again.charged).toBe(0);
    expect(await db.membership.count({ where: { memberId: m.id, type: "AUTOPAY" } })).toBe(1);
    expect(await db.autopayEvent.count({ where: { eventId: `sync:${sid}:inv_1` } })).toBe(1);

    rzp.getSubscription.mockResolvedValue({ id: sid, status: "halted", charge_at: null, paid_count: 1 });
    rzp.listSubscriptionInvoices.mockResolvedValue({ items: [] });
    const h = await syncWithRazorpay(all);
    expect(h.changed).toBeGreaterThanOrEqual(1);
    expect((await db.autopayMandate.findUniqueOrThrow({ where: { id: md.id } })).status).toBe("Halted");
    expect(await db.notification.count({ where: { orgId: gym.org.id, type: "AUTOPAY", text: { contains: md.code } } })).toBe(1);
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: "autopay.sync", entityId: md.id } })).toBeGreaterThanOrEqual(1);
    const st = (await db.setting.findUniqueOrThrow({ where: { orgId_key: { orgId: gym.org.id, key: "autopay" } } })).value as { lastSyncAt?: string; lastSync?: { checked: number } };
    expect(st.lastSyncAt).toBeTruthy();
    expect(st.lastSync?.checked).toBeGreaterThanOrEqual(1);
  });

  it("sync skips other branches and survives one failing mandate", async () => {
    const onlyB = pick(admin, gym.b.id);
    const { md: mA } = await live(pick(admin, gym.a.id));
    const { md: mB } = await live(onlyB);
    rzp.getSubscription.mockImplementation(async (id: string) => {
      if (id === mB.subscriptionId) throw new Error("boom");
      return { id, status: "active", charge_at: null, paid_count: 0 };
    });
    rzp.listSubscriptionInvoices.mockResolvedValue({ items: [] });
    const r = await syncWithRazorpay(onlyB, { mandateIds: [mA.id, mB.id] });
    expect(r).toMatchObject({ checked: 1, errors: 1 });
    expect(r.error).toContain("boom");
    const both = await syncWithRazorpay(all, { mandateIds: [mA.id, mB.id] });
    expect(both).toMatchObject({ checked: 2, errors: 1 });
  });

  it("demo mode only explains the sync and never calls Razorpay", async () => {
    await live();
    const msg = await syncOrExplain(admin);
    expect(msg).toMatch(/^Demo mode: nothing to sync/);
    expect(msg).toMatch(/live mandate\(s\)? would be checked|live mandates? would be checked/);
    expect(rzp.getSubscription).not.toHaveBeenCalled();
  });

  it("the daily job skips the sync in demo mode", async () => {
    const jobs = await runDailyJobs(gym.org.id, addDays(today, 40));
    const j = jobs.find((x) => x.name === "autopay.sync");
    expect(j).toBeTruthy();
    expect(JSON.stringify(j)).toContain("skipped");
    expect(rzp.getSubscription).not.toHaveBeenCalled();
  });
});
