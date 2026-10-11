import { beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@/lib/domain/dates";
import { hasDb, makeGym, pick } from "@/test/db";
import { createMember, listMembers } from "./members";
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

  it("counts new members by join date and memberships by sale date, not by the plan's start date", async () => {
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const d = await dashboardData(admin, "month");
    // All three were added and sold today, even though "Long Gone" started 50 days back and is already expired.
    expect(d.kpis).toMatchObject({ newMembers: 3, newMemberships: 3, renewals: 0, newMembersLast: 0, newMembershipsLast: 0, renewalsLast: 0, joinedBy: "join date", soldBy: "sale date" });
    expect(d.series.at(-1)).toMatchObject({ newCount: 3, renewCount: 0 });
    expect(d.series.slice(0, -1).every((s) => s.newCount === 0 && s.renewCount === 0)).toBe(true);
    const t = await dashboardData(admin, "today");
    expect(t.kpis).toMatchObject({ newMembers: 3, newMemberships: 3 });
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

describe.skipIf(!hasDb)("dashboard active members (database)", () => {
  it("doesn't count a member whose plan starts later as active, and lists them as Starts later", async () => {
    const gym = await makeGym();
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const today = todayIso();
    const plan = await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    const now = await createMember(admin, { name: "Training Now", gender: "Female", phone: "9876512001", source: "Walk-in", tags: [] });
    const later = await createMember(admin, { name: "Starts Next Week", gender: "Male", phone: "9876512002", source: "Walk-in", tags: [] });
    await sellMembership(admin, now.id, { planId: plan.id, startDate: addDays(today, -3), discount: 0, includeRegFee: false, payAmount: 150000, payMethod: "UPI" });
    await sellMembership(admin, later.id, { planId: plan.id, startDate: addDays(today, 7), discount: 0, includeRegFee: false, payAmount: 150000, payMethod: "UPI" });
    const d = await dashboardData(admin, "month");
    expect(d.hero).toMatchObject({ active: 1, total: 2 });
    const { rows } = await listMembers(admin, {});
    expect(Object.fromEntries(rows.map((r) => [r.name, r.status]))).toEqual({ "Training Now": "ACTIVE", "Starts Next Week": "UPCOMING" });
  });
});
