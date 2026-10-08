import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hasDb, makeGym } from "@/test/db";
import { db } from "@/lib/db";
import { platformGyms, platformOverview } from "./platform-admin";
import { todayIso } from "./time";

const pay = (orgId: string, userId: string, o: { kind: string; total: number; mode?: string; status?: string }) =>
  db.branchSubscription.create({ data: { orgId, kind: o.kind, plan: o.kind === "PLAN" ? "professional" : null, cycle: "MONTHLY", base: Math.round(o.total / 1.18), gst: o.total - Math.round(o.total / 1.18), total: o.total, mode: o.mode ?? "LIVE", status: o.status ?? "PAID", paidAt: new Date(), ...(o.kind === "PLAN" ? { periodStart: new Date(), periodEnd: new Date(Date.now() + 20 * 86_400_000) } : {}), createdById: userId } });

describe.skipIf(!hasDb)("FITRON admin: the whole SaaS (database)", () => {
  it("counts gyms by standing and sums only real, paid income", async () => {
    const today = todayIso();
    const before = await platformOverview(today);
    const g = await makeGym();
    const owner = await g.user("Super Admin");
    await db.organization.update({ where: { id: g.org.id }, data: { trialEndsAt: new Date(Date.now() + 5 * 86_400_000) } });
    await pay(g.org.id, owner.id, { kind: "PLAN", total: 118_000 });
    await pay(g.org.id, owner.id, { kind: "SERVICE", total: 59_000 });
    // None of these moved money.
    await pay(g.org.id, owner.id, { kind: "PLAN", total: 900_000, mode: "DEMO" });
    await pay(g.org.id, owner.id, { kind: "PLAN", total: 800_000, status: "PENDING" });
    const demo = await db.organization.create({ data: { name: `Demo ${randomUUID().slice(0, 6)}`, demo: true } });

    const after = await platformOverview(today);
    expect(after.gyms.total).toBe(before.gyms.total + 1);
    expect(after.gyms.paid).toBe(before.gyms.paid + 1);
    expect(after.income.all.all.total - before.income.all.all.total).toBe(177_000);
    expect(after.income.thisMonth.plans.total - before.income.thisMonth.plans.total).toBe(118_000);
    expect(after.income.thisMonth.services.total - before.income.thisMonth.services.total).toBe(59_000);
    expect(after.income.months).toHaveLength(6);

    const { rows } = await platformGyms({ q: g.org.name }, today);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: g.org.id, standing: "PAID", staff: 1, branches: 2, paid: 177_000, owner: { email: owner.email } });
    expect((await platformGyms({ q: demo.name }, today)).total).toBe(0);
    expect((await platformGyms({ q: owner.email, status: "TRIAL" }, today)).total).toBe(0);
    expect((await platformGyms({ q: owner.email, status: "PAID" }, today)).total).toBe(1);
  });
});
