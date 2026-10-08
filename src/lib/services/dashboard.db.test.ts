import { beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@/lib/domain/dates";
import { hasDb, makeGym, pick } from "@/test/db";
import { createMember } from "./members";
import { createExpense } from "./expenses";
import { freezeMembership, unfreezeMembership } from "./freeze";
import { createPlan } from "./plans";
import { sellMembership } from "./billing";
import { dashboardData } from "./dashboard";
import { todayIso } from "./time";

describe.skipIf(!hasDb)("dashboard (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  const today = todayIso();

  beforeAll(async () => {
    gym = await makeGym();
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const plan = await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    const paid = await createMember(admin, { name: "Paid Up", gender: "Female", phone: "9876511001", source: "Walk-in", tags: [] });
    const owing = await createMember(admin, { name: "Owes Money", gender: "Male", phone: "9876511002", source: "Walk-in", tags: [] });
    const lapsed = await createMember(admin, { name: "Long Gone", gender: "Male", phone: "9876511003", source: "Walk-in", tags: [] });
    // Ends in 3 days, paid by UPI today.
    await sellMembership(admin, paid.id, { planId: plan.id, startDate: addDays(today, -27), discount: 0, includeRegFee: false, payAmount: 150000, payMethod: "UPI" });
    // Active for most of a month, nothing paid.
    await sellMembership(admin, owing.id, { planId: plan.id, startDate: addDays(today, -5), discount: 0, includeRegFee: false, payAmount: 0 });
    // Expired 20 days ago.
    await sellMembership(admin, lapsed.id, { planId: plan.id, startDate: addDays(today, -50), discount: 0, includeRegFee: false, payAmount: 150000, payMethod: "Cash" });
  });

  it("computes the owner's cards the way the prototype does", async () => {
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const d = await dashboardData(admin, "month");
    expect(d.hero).toMatchObject({ active: 2, total: 3, expired: 1, exp7: 1, exp7Value: 150000, openCount: 1, outstanding: 150000 });
    expect(d.kpis.mrr).toBe(300000);
    expect(d.expiring.map((m) => m.name)).toEqual(["Paid Up"]);
    expect(d.outstanding.map((o) => o.name)).toEqual(["Owes Money"]);
    expect(d.plans).toEqual([expect.objectContaining({ name: "Monthly", members: 2 })]);
    expect(d.series).toHaveLength(12);
    expect(d.series.at(-1)!.active).toBe(2);
  });

  it("counts every member for the accountant, and gives the front desk its own cards", async () => {
    const acct = pick(await gym.user("Accountant"), gym.a.id);
    expect((await dashboardData(acct, "month")).hero.active).toBe(2);
    const desk = await gym.user("Receptionist", [gym.a.id]);
    const d = await dashboardData(desk, "month");
    expect(d.frontDesk).toMatchObject({ checkins: 0, paymentsDue: 1 });
    expect(d.fin).toBe(false);
  });
  it("counts memberships on hold for the front desk", async () => {
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const plan = await createPlan(admin, { name: "Holdable", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    const m = await createMember(admin, { name: "On Hold", gender: "Male", phone: "9876511009", source: "Walk-in", tags: [] });
    await sellMembership(admin, m.id, { planId: plan.id, startDate: addDays(today, -5), discount: 0, includeRegFee: false, payAmount: 150000, payMethod: "Cash" });
    const desk = await gym.user("Receptionist", [gym.a.id]);
    expect((await dashboardData(desk, "month")).frontDesk!.frozen).toBe(0);
    await freezeMembership(admin, m.id, { days: 7, from: today, reason: "Travel" });
    expect((await dashboardData(desk, "month")).frontDesk!.frozen).toBe(1);
    const deskB = await gym.user("Receptionist", [gym.b.id]);
    expect((await dashboardData(deskB, "month")).frontDesk!.frozen).toBe(0);
    await unfreezeMembership(admin, m.id);
    expect((await dashboardData(desk, "month")).frontDesk!.frozen).toBe(0);
  });

  it("compares branches with expenses and net for every role", async () => {
    const adminB = pick(await gym.user("Super Admin"), gym.b.id);
    await createExpense(adminB, { date: today, categoryId: "rent", description: "Rent", amount: 30000, method: "Cash" });
    const d = await dashboardData(await gym.user("Super Admin"), "month");
    expect(d.branches!.map((b) => b.id)).toEqual([gym.a.id, gym.b.id]);
    const [a, b] = d.branches!;
    expect(a).toMatchObject({ expenses: 0, due: 150000 });
    expect(a!.collected).toBeGreaterThan(0);
    expect(a!.net).toBe(a!.collected - a!.expenses);
    expect(b).toMatchObject({ expenses: 30000 });
    expect(b!.net).toBe(b!.collected - 30000);
    const desk = await gym.user("Receptionist", [gym.a.id, gym.b.id]);
    const r = (await dashboardData(desk, "month")).branches!;
    expect(r.map((x) => [x.expenses, x.net, x.collected, x.due])).toEqual(d.branches!.map((x) => [x.expenses, x.net, x.collected, x.due]));
    expect((await dashboardData(await gym.user("Receptionist", [gym.a.id]), "month")).branches).toBeNull();
  });
});
