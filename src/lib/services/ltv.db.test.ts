import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, addMonths } from "@/lib/domain/dates";
import { hasDb, makeGym, pick } from "@/test/db";
import { createExpense } from "./expenses";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { sellMembership, cancelInvoice } from "./billing";
import { ltvReport, segmentMembers } from "./ltv";
import { snapshot, membershipFacts } from "./analytics";
import { todayIso } from "./time";

describe.skipIf(!hasDb)("member lifetime value (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<typeof gym.user>>;
  const today = todayIso();
  const period = { from: addMonths(`${today.slice(0, 7)}-01`, -2), to: today };

  beforeAll(async () => {
    gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    const monthly = await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 100_000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    const quarterly = await createPlan(admin, { name: "Quarterly", kind: "Membership", months: 3, price: 270_000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    // A loyal member: three monthly plans back to back, the last covering today.
    const loyal = await createMember(admin, { name: "Loyal", gender: "Female", phone: "9876531001", source: "Instagram", tags: [] });
    // Three one-month plans back to back (a one-month plan ends the day before the same date next month).
    const first = addDays(today, -70);
    const second = addMonths(first, 1);
    const third = addMonths(second, 1);
    await sellMembership(admin, loyal.id, { planId: monthly.id, startDate: first, discount: 0, includeRegFee: false, payAmount: 100_000, payMethod: "Cash" });
    await sellMembership(admin, loyal.id, { planId: monthly.id, startDate: second, discount: 10_000, includeRegFee: false, payAmount: 90_000, payMethod: "Cash" });
    await sellMembership(admin, loyal.id, { planId: monthly.id, startDate: third, discount: 0, includeRegFee: false, payAmount: 100_000, payMethod: "Cash" });
    // A one-and-done member whose plan ended 45 days ago.
    const gone = await createMember(admin, { name: "Gone", gender: "Male", phone: "9876531002", source: "Walk-in", tags: [] });
    await sellMembership(admin, gone.id, { planId: monthly.id, startDate: addDays(today, -75), discount: 0, includeRegFee: false, payAmount: 100_000, payMethod: "Cash" });
    // A quarterly member whose sale was cancelled.
    const cancelled = await createMember(admin, { name: "Cancelled", gender: "Male", phone: "9876531003", source: "Walk-in", tags: [] });
    const s = await sellMembership(admin, cancelled.id, { planId: quarterly.id, startDate: today, discount: 0, includeRegFee: false, payAmount: 0 });
    await cancelInvoice(admin, s.invoice.id, "Changed mind");
    // Marketing spend this period, so acquisition cost can be worked out.
    await createExpense(admin, { date: today, categoryId: "marketing", description: "Instagram ads", amount: 300_000, method: "UPI" });
  });

  it("reads the period's facts once and agrees with the books", async () => {
    const s = await snapshot(admin, period);
    // Revenue: three monthly sales (100,000 + 90,000 + 100,000) plus Gone's 100,000 in the period; the cancelled one is out.
    expect(s.revenue).toBe(390_000);
    expect(s.activeMembers).toBe(1);
    expect(s.newMembers).toBe(3);
    expect(s.marketingSpend).toBe(300_000);
    expect(s.cac).toBe(100_000);
    expect(s.cancellation).toEqual({ sold: 5, cancelled: 1, rate: 20 });
    // Memberships ended in the period: Loyal's first two (renewed) and Gone's (not).
    expect(s.renewal).toMatchObject({ ended: 3, renewed: 2 });
    expect(s.renewal.rate).toBe(66.7);
  });

  it("produces the metrics with definitions, refuses the estimate on thin data, and segments by plan, source and branch", async () => {
    const r = await ltvReport(admin, period);
    const by = Object.fromEntries(r.metrics.map((m) => [m.id, m]));
    // Two members have held a membership (the cancelled sale left none): 390,000 over 2.
    expect(by["ltv.revenue"]!.value).toBe(195_000);
    expect(by["ltv.revenue"]!.definition).toContain("before GST");
    expect(by["ltv.renewalRate"]!.value).toBe(66.7);
    expect(by["ltv.renewalRate"]!.warnings[0]).toContain("not yet a trend");
    expect(by["ltv.cac"]!.value).toBe(100_000);
    expect(by["ltv.estimate"]!.value).toBeNull();
    expect(by["ltv.estimate"]!.kind).toBe("estimate");
    expect(by["ltv.estimate"]!.warnings.join(" ")).toContain("at least 20 members");
    expect(by["ltv.ratio"]!.value).toBeNull();
    expect(by["ltv.tenure"]!.value).toBeGreaterThan(0);
    expect(r.byPlan.find((p) => p.key === "Monthly")).toMatchObject({ members: 2, revenue: 390_000, active: 1 });
    expect(r.bySource.map((s) => s.key).sort()).toEqual(["Instagram", "Walk-in"]);
    expect(r.bySource.find((s) => s.key === "Instagram")).toMatchObject({ members: 1, revenue: 290_000, active: 1 });
    expect(r.cohorts.length).toBeGreaterThan(0);
    expect(r.cohorts[r.cohorts.length - 1]!.members).toBe(3);
    expect(r.completeness.some((n) => n.includes("not profit"))).toBe(true);
    expect(r.options.plans).toEqual(["Monthly", "Quarterly"]);
  });

  it("filters by source and plan without changing the definitions", async () => {
    const r = await ltvReport(admin, period, { source: "Instagram" });
    expect(r.members).toBe(1);
    expect(r.revenue).toBe(290_000);
    const p = await ltvReport(admin, period, { plan: "Quarterly" });
    // The cancelled member's latest valid membership list is empty, so no member has Quarterly as their latest plan.
    expect(p.members).toBe(0);
  });

  it("opens an aggregate into its members only for roles that may see members", async () => {
    const rows = await segmentMembers(admin, "source", "Instagram");
    expect(rows.map((m) => m.name)).toEqual(["Loyal"]);
    expect(rows[0]).toMatchObject({ active: true, revenue: 290_000 });
    const acct = pick(await gym.user("Accountant"), gym.a.id);
    await expect(segmentMembers(acct, "source", "Instagram")).rejects.toThrow("can't see member lists");
  });

  it("is limited to the gym and branches in view", async () => {
    const other = await makeGym();
    const r = await ltvReport(await other.user("Super Admin"), period);
    expect(r.members).toBe(0);
    expect(r.revenue).toBe(0);
    const b = pick(await gym.user("Super Admin"), gym.b.id);
    expect((await membershipFacts(b)).members).toHaveLength(0);
    expect(await db.member.count({ where: { orgId: gym.org.id } })).toBe(3);
  });
});
