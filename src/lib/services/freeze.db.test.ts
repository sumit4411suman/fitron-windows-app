import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays } from "@/lib/domain/dates";
import { hasDb, makeGym, pick } from "@/test/db";
import { createMember, summarize } from "./members";
import { createPlan } from "./plans";
import { sellMembership } from "./billing";
import { checkIn } from "./attendance";
import { freezeMembership, frozenMemberIds, openFreeze, transferMember, unfreezeMembership } from "./freeze";
import { todayIso } from "./time";

describe.skipIf(!hasDb)("freeze and transfer (database)", () => {
  it("moves the end date, blocks check-in while frozen, and gives unused days back", async () => {
    const gym = await makeGym();
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const today = todayIso();
    const plan = await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    const m = await createMember(admin, { name: "Goes Away", gender: "Female", phone: "9876555001", source: "Walk-in", tags: [] });
    await sellMembership(admin, m.id, { planId: plan.id, startDate: addDays(today, -5), discount: 0, includeRegFee: false, payAmount: 150000, payMethod: "Cash" });
    const end = (await summarize([m.id])).get(m.id)!.latestEnd!;

    await expect(freezeMembership(admin, m.id, { days: 120, from: today, reason: "Travel" })).rejects.toThrow(/1 to 90/);
    const r = await freezeMembership(admin, m.id, { days: 10, from: today, reason: "Travel" });
    expect(r.newEnd).toBe(addDays(end, 10));
    await expect(freezeMembership(admin, m.id, { days: 5, from: today, reason: "Travel" })).rejects.toThrow(/Already frozen/);
    expect(await checkIn(admin, m.id)).toMatchObject({ ok: false, blocked: expect.stringMatching(/frozen/) });

    expect(await unfreezeMembership(admin, m.id)).toEqual({ returned: 10, newEnd: end });
    expect(await openFreeze(m.id)).toBeNull();
    expect((await checkIn(admin, m.id)).ok).toBe(true);
    expect((await db.auditLog.findMany({ where: { orgId: gym.org.id, action: { in: ["membership.freeze", "membership.unfreeze"] } } })).length).toBe(2);
  });

  it("transfers a member to another of the user's branches", async () => {
    const gym = await makeGym();
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const m = await createMember(admin, { name: "Moves House", gender: "Male", phone: "9876555002", source: "Walk-in", tags: [] });
    await expect(transferMember(admin, m.id, gym.a.id)).rejects.toThrow(/different branch/);
    await transferMember(admin, m.id, gym.b.id, "Moved house");
    expect((await db.member.findUniqueOrThrow({ where: { id: m.id } })).branchId).toBe(gym.b.id);
  });
  it("lists the members whose freeze is still on hold", async () => {
    const gym = await makeGym();
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const today = todayIso();
    const plan = await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    const ms = [];
    for (const [i, name] of ["One", "Two", "Three", "Four"].entries()) {
      const m = await createMember(admin, { name: `Hold ${name}`, gender: "Female", phone: `98765560${i}1`, source: "Walk-in", tags: [] });
      await sellMembership(admin, m.id, { planId: plan.id, startDate: addDays(today, -5), discount: 0, includeRegFee: false, payAmount: 150000, payMethod: "Cash" });
      ms.push(m);
    }
    const [m1, m2, m3, m4] = ms as [(typeof ms)[0], (typeof ms)[0], (typeof ms)[0], (typeof ms)[0]];
    await freezeMembership(admin, m1.id, { days: 10, from: today, reason: "Travel" });
    await freezeMembership(admin, m2.id, { days: 3, from: addDays(today, 2), reason: "Travel" });
    await freezeMembership(admin, m3.id, { days: 5, from: today, reason: "Travel" });
    await unfreezeMembership(admin, m3.id);
    await db.membershipFreeze.create({ data: { orgId: admin.orgId, memberId: m4.id, membershipId: (await db.membership.findFirstOrThrow({ where: { memberId: m4.id } })).id, fromDate: new Date(addDays(today, -20) + "T00:00:00Z"), days: 5, reason: "Old", createdById: admin.id } });
    const ids = await frozenMemberIds([m1.id, m2.id, m3.id, m4.id]);
    expect([...ids].sort()).toEqual([m1.id, m2.id].sort());
    expect((await frozenMemberIds([])).size).toBe(0);
  });
});
