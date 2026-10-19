import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, addMonths } from "@/lib/domain/dates";
import { MIN_COHORT_GYMS } from "@/lib/domain/benchmark";
import { isLocal } from "@/lib/runtime/edition";
import { hasDb, makeGym, pick } from "@/test/db";
import { createExpense } from "./expenses";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { sellMembership } from "./billing";
import { externalBenchmark, getBenchmarkConsent, internalBenchmark, setBenchmarkConsent, writeBenchmarkSnapshot } from "./benchmark";
import { todayIso } from "./time";

describe.skipIf(!hasDb)("benchmarking (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<typeof gym.user>>;
  const today = todayIso();
  const period = { from: `${today.slice(0, 7)}-01`, to: today };

  beforeAll(async () => {
    gym = await makeGym();
    admin = await gym.user("Super Admin");
    const a = pick(admin, gym.a.id);
    const b = pick(admin, gym.b.id);
    const plan = await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 100_000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    for (let i = 0; i < 3; i++) {
      const m = await createMember(a, { name: `A${i}`, gender: "Male", phone: `987657100${i}`, source: "Walk-in", tags: [] });
      await sellMembership(a, m.id, { planId: plan.id, startDate: addDays(today, -2), discount: 0, includeRegFee: false, payAmount: 100_000, payMethod: "Cash" });
    }
    const mb = await createMember(b, { name: "B0", gender: "Female", phone: "9876572000", source: "Walk-in", tags: [] });
    await sellMembership(b, mb.id, { planId: plan.id, startDate: addDays(today, -2), discount: 0, includeRegFee: false, payAmount: 100_000, payMethod: "Cash" });
    await createExpense(a, { date: today, categoryId: "rent", description: "Rent A", amount: 150_000, method: "Cash" });
    await createExpense(b, { date: today, categoryId: "rent", description: "Rent B", amount: 90_000, method: "Cash" });
  });

  it("compares the branches over the same period from the shared figures and ranks them by defined metrics", async () => {
    const r = await internalBenchmark(admin, period, today);
    expect(r.rows.map((x) => x.name).sort()).toEqual(["A", "B"]);
    const A = r.rows.find((x) => x.name === "A")!;
    const B = r.rows.find((x) => x.name === "B")!;
    expect(A.metrics.revenue).toBe(300_000);
    expect(B.metrics.revenue).toBe(100_000);
    expect(A.metrics.activeMembers).toBe(3);
    expect(A.metrics.revenuePerActive).toBe(100_000);
    expect(A.metrics.expenseRatio).toBe(50);
    expect(B.metrics.expenseRatio).toBe(90);
    expect(A.rank.revenue).toBe(1);
    expect(B.rank.revenue).toBe(2);
    expect(A.rank.expenseRatio).toBe(1); // lower is better
    expect(A.rank.cac).toBeNull();
    expect(r.metrics.find((m) => m.key === "expenseRatio")!.definition).toContain("÷");
    // Reconciles with the Profit & loss figures branch by branch.
    const sumRevenue = r.rows.reduce((s, x) => s + (x.metrics.revenue ?? 0), 0);
    expect(sumRevenue).toBe(400_000);
  });

  it("shows a branch-limited user only their branch", async () => {
    const only = await gym.user("Admin", [gym.b.id]);
    const r = await internalBenchmark(only, period, today);
    expect(r.rows.map((x) => x.name)).toEqual(["B"]);
  });

  it.skipIf(isLocal())("keeps external benchmarking unavailable until consent, aggregation and a large enough cohort exist", async () => {
    const month = addMonths(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
    // Snapshots left by earlier runs of this suite (test gyms) would widen the size-band pool; the pool is shared by design.
    const stale = await db.organization.findMany({ where: { name: { startsWith: "Test gym " } }, select: { id: true } });
    await db.benchmarkSnapshot.deleteMany({ where: { orgId: { in: stale.map((o) => o.id) } } });
    expect((await getBenchmarkConsent(gym.org.id)).optIn).toBe(false);
    let e = await externalBenchmark(admin, today);
    expect(e.available).toBe(false);
    expect(e.reason).toContain("not opted in");
    // Writing a snapshot without consent writes nothing.
    expect(await writeBenchmarkSnapshot(gym.org.id, month, today)).toBeNull();
    expect(await db.benchmarkSnapshot.count({ where: { orgId: gym.org.id } })).toBe(0);
    const acct = await gym.user("Accountant");
    await expect(setBenchmarkConsent(acct, true)).rejects.toThrow("Super Admin");
    // A state of its own, so this test's cohort is exactly its own peers whatever other rows the pool holds.
    const state = `Teststate ${gym.org.id.slice(-6)}`;
    await db.setting.upsert({ where: { orgId_key: { orgId: gym.org.id, key: "gym" } }, create: { orgId: gym.org.id, key: "gym", value: { state } }, update: { value: { state } } });
    await setBenchmarkConsent(admin, true);
    expect((await getBenchmarkConsent(gym.org.id)).consentById).toBe(admin.id);
    e = await externalBenchmark(admin, today);
    expect(e.reason).toContain("not been aggregated yet");
    await writeBenchmarkSnapshot(gym.org.id, month, today);
    const snap = await db.benchmarkSnapshot.findUniqueOrThrow({ where: { orgId_month: { orgId: gym.org.id, month } } });
    expect(Object.keys(snap.metrics as object).sort()).toEqual(["activeMembers", "cac", "expenseRatio", "newMembers", "operatingMargin", "renewalRate", "revenue", "revenuePerActive"]);
    expect(JSON.stringify(snap.metrics)).not.toContain("A0"); // no member, no name
    e = await externalBenchmark(admin, today);
    expect(e.available).toBe(false);
    expect(e.reason).toContain(`comparisons open at ${MIN_COHORT_GYMS}`);
    expect(e.cohort?.sizeBand).toBe("xs");
    // Enough peers in the same band make the comparison available, in aggregate only.
    const peers: string[] = [];
    for (let i = 0; i < MIN_COHORT_GYMS; i++) {
      const g = await makeGym();
      peers.push(g.org.id);
      await db.benchmarkSnapshot.create({ data: { orgId: g.org.id, month, cohort: { sizeBand: "xs", state }, metrics: { revenue: (i + 1) * 100_000, activeMembers: i + 1, revenuePerActive: 100_000, renewalRate: null, expenseRatio: 40 + i, operatingMargin: 60 - i, newMembers: i, cac: null } } });
    }
    e = await externalBenchmark(admin, today);
    expect(e.available).toBe(true);
    expect(e.cohortGyms).toBe(MIN_COHORT_GYMS);
    expect(e.cohort?.state).toBe(state);
    const rpa = e.comparisons.find((c) => c.key === "revenuePerActive")!;
    expect(rpa.sample).toBe(MIN_COHORT_GYMS);
    expect(rpa.median).toBe(100_000);
    // This gym had no active member in that month, so its own figure is missing and no percentile is claimed.
    expect(rpa.percentile).toBeNull();
    expect(rpa.unavailable).toContain("Your own figure");
    const nm = e.comparisons.find((c) => c.key === "newMembers")!;
    expect(nm).toMatchObject({ value: 0, sample: MIN_COHORT_GYMS, percentile: 5, unavailable: null });
    expect(e.comparisons.find((c) => c.key === "renewalRate")!.unavailable).toContain("at least");
    expect(e.methodology.length).toBeGreaterThan(3);
    // Withdrawing consent removes the gym's rows from the pool.
    await setBenchmarkConsent(admin, false);
    expect(await db.benchmarkSnapshot.count({ where: { orgId: gym.org.id } })).toBe(0);
    expect((await externalBenchmark(admin, today)).reason).toContain("not opted in");
    await db.benchmarkSnapshot.deleteMany({ where: { orgId: { in: peers } } });
  });

  it.skipIf(!isLocal())("is not offered on FITRON for Windows", async () => {
    await expect(setBenchmarkConsent(admin, true)).rejects.toThrow("fitron.in");
    expect((await externalBenchmark(admin, today)).reason).toContain("Windows");
  });
});
