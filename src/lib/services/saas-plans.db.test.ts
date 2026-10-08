import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { createMember } from "./members";
import { saveBranch } from "./settings";
import { billingHistory, confirmDemoPayment, gymPlan, startPayment } from "./saas";

const DAY = 86_400_000;
let phone = 9_700_000_000;
const member = (name: string) => ({ name, gender: "Female" as const, phone: String(phone++), source: "Walk-in" as const, tags: [] });

describe.skipIf(!hasDb)("FITRON plans (database)", () => {
  // Payments to FITRON go through Razorpay only. With its keys unset the app runs in demo mode (not in production).
  beforeAll(() => {
    vi.stubEnv("FITRON_RAZORPAY_KEY_ID", "");
    vi.stubEnv("FITRON_RAZORPAY_KEY_SECRET", "");
  });
  afterAll(() => vi.unstubAllEnvs());

  it("runs a trial, locks when it ends, and reopens once the plan is paid", async () => {
    const gym = await makeGym();
    await db.organization.update({ where: { id: gym.org.id }, data: { plan: "enterprise", trialEndsAt: new Date(Date.now() + 7 * DAY) } });
    const owner = await gym.user("Super Admin");
    const inA = pick(owner, gym.a.id);
    expect((await gymPlan(gym.org.id)).standing.kind).toBe("TRIAL");
    await createMember(inA, member("Trial Tara"));

    await db.organization.update({ where: { id: gym.org.id }, data: { trialEndsAt: new Date(Date.now() - 2 * DAY) } });
    expect((await gymPlan(gym.org.id)).standing.kind).toBe("LAPSED");
    await expect(createMember(inA, member("Locked Lata"))).rejects.toThrow(/plan has ended/);

    await expect(startPayment(owner, { kind: "PLAN", plan: "professional" }, "MONTHLY")).rejects.toThrow(/2 branches/);
    await expect(startPayment(owner, { kind: "PLAN", plan: "ai-pro" }, "MONTHLY")).rejects.toThrow(/Gym Accounting or Gym Partnership plan/);
    const c = await startPayment(owner, { kind: "PLAN", plan: "enterprise" }, "MONTHLY");
    expect(c.mode).toBe("DEMO");
    expect(c.total).toBe(3_99_900); // the listed Enterprise price, GST inside
    // Started is not paid: the plan stays locked and the history shows only what was paid.
    expect((await gymPlan(gym.org.id)).standing.kind).toBe("LAPSED");
    expect((await billingHistory(owner)).map((h) => h.id)).not.toContain(c.id);

    const paid = await confirmDemoPayment(owner, c.id);
    expect(paid).toMatchObject({ status: "PAID", mode: "DEMO" });
    expect(paid?.invoiceNo).toMatch(/^FIT\//);
    const plan = await gymPlan(gym.org.id);
    expect(plan).toMatchObject({ key: "enterprise", cycle: "MONTHLY" });
    expect(plan.standing.kind).toBe("PAID");
    await createMember(inA, member("Paid Pooja"));
    expect((await billingHistory(owner)).map((h) => h.id)).toContain(c.id);
    // Paying twice for the same demo payment changes nothing.
    expect((await confirmDemoPayment(owner, c.id))?.invoiceNo).toBe(paid?.invoiceNo);
  });

  it("takes no payment on a live server until Razorpay is set up", async () => {
    const gym = await makeGym();
    await db.organization.update({ where: { id: gym.org.id }, data: { plan: "enterprise", trialEndsAt: new Date(Date.now() + 3 * DAY) } });
    const owner = await gym.user("Super Admin");
    const before = await db.branchSubscription.count({ where: { orgId: gym.org.id } });
    vi.stubEnv("NODE_ENV", "production");
    try {
      await expect(startPayment(owner, { kind: "PLAN", plan: "enterprise" }, "YEARLY")).rejects.toThrow(/Payments to FITRON aren't switched on yet/);
      await expect(startPayment(owner, { kind: "BRANCH", branchId: null }, "YEARLY")).rejects.toThrow(/aren't switched on yet/);
      // A demo payment started elsewhere can't be marked paid on a live server either.
      vi.stubEnv("NODE_ENV", "test");
      const demo = await startPayment(owner, { kind: "BRANCH", branchId: null }, "YEARLY");
      vi.stubEnv("NODE_ENV", "production");
      await expect(confirmDemoPayment(owner, demo.id)).rejects.toThrow(/made online with Razorpay/);
    } finally {
      vi.stubEnv("NODE_ENV", "test");
    }
    // Nothing was left half-made by the refused ones: only the one demo row exists.
    expect(await db.branchSubscription.count({ where: { orgId: gym.org.id } })).toBe(before + 1);
  });

  it("caps Starter at 100 active members and one branch", async () => {
    const gym = await makeGym();
    await db.branch.delete({ where: { id: gym.b.id } });
    await db.organization.update({ where: { id: gym.org.id }, data: { plan: "starter", trialEndsAt: new Date(Date.now() + 7 * DAY) } });
    const owner = await gym.user("Super Admin", [gym.a.id]);
    await db.member.createMany({
      data: Array.from({ length: 100 }, (_, i) => ({ orgId: gym.org.id, branchId: gym.a.id, code: `S-${i}`, name: `M${i}`, gender: "Male", phone: String(phone++), source: "Walk-in", createdById: owner.id })),
    });
    await expect(createMember(owner, member("Over Omar"))).rejects.toThrow(/allows 100 active members/);
    // A suspended member frees a place.
    await db.member.updateMany({ where: { orgId: gym.org.id, code: "S-0" }, data: { suspended: true } });
    await createMember(owner, member("Room Rhea"));

    await expect(saveBranch(owner, null, { name: "Second", address: "", phone: "" })).rejects.toThrow(/for one branch/);
    await expect(startPayment(owner, { kind: "BRANCH", branchId: null }, "MONTHLY")).rejects.toThrow(/for one branch/);
  });
});
