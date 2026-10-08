import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { addDays } from "@/lib/domain/dates";
import { checkOut } from "./attendance";
import { sellMembership } from "./billing";
import { freezeMembership } from "./freeze";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { checkInPoint, selfCheckIn } from "./self-checkin";
import { todayIso } from "./time";

describe.skipIf(!hasDb)("member self check-in from the poster QR (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  let planId: string;
  let phone = 9_844_400_000;
  const today = todayIso();

  /** A member of branch A with a one-month plan that started `daysAgo` days ago, or with no plan at all. */
  async function member(name: string, plan: { daysAgo: number } | null = { daysAgo: 0 }, branch = gym.a.id) {
    const m = await createMember(pick(admin, branch), { name, gender: "Female", phone: String(phone++), source: "Walk-in", tags: [] });
    if (plan) await sellMembership(pick(admin, branch), m.id, { planId, startDate: addDays(today, -plan.daysAgo), discount: 0, includeRegFee: false, payAmount: 150000, payMethod: "UPI" });
    return m;
  }
  const visits = (memberId: string) => db.attendance.findMany({ where: { memberId } });

  beforeAll(async () => {
    gym = await makeGym();
    admin = await gym.user("Super Admin");
    planId = (await createPlan(pick(admin, gym.a.id), { name: "Monthly", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: true, features: [] })).id;
  });

  it("welcomes a member by first name and records a QR visit at that branch, with no staff user", async () => {
    const m = await member("Asha Verma");
    const r = await selfCheckIn(gym.a.id, m.phone);
    expect(r).toMatchObject({ status: "in", firstName: "Asha" });
    expect(r.status === "in" && r.at).toMatch(/\d{1,2}:\d{2}\s?(am|pm)/i);
    expect(await visits(m.id)).toMatchObject([{ branchId: gym.a.id, type: "MEMBER", method: "QR", createdById: null, checkOut: null, override: null }]);
  });

  it("accepts the number the way people type it, and asks again for one that isn't a mobile number", async () => {
    const m = await member("Bela Rao");
    expect((await selfCheckIn(gym.a.id, ` +91 ${m.phone.slice(0, 5)} ${m.phone.slice(5)} `)).status).toBe("in");
    await expect(selfCheckIn(gym.a.id, "12345")).rejects.toThrow(/10-digit/);
    await expect(selfCheckIn(gym.a.id, "")).rejects.toThrow(/10-digit/);
  });

  it("a second scan says they are already in, and many at the same moment let them in once", async () => {
    const m = await member("Charu Das");
    expect((await selfCheckIn(gym.a.id, m.phone)).status).toBe("in");
    expect((await selfCheckIn(gym.a.id, m.phone)).status).toBe("inside");
    expect(await visits(m.id)).toHaveLength(1);

    // Several members, each scanned eight times at once: without the lock a pair of scans sometimes both get in.
    for (const name of ["Divya Nair", "Eka Sen", "Fiza Mir", "Gauri Rao", "Hira Lal"]) {
      const n = await member(name);
      const together = await Promise.all(Array.from({ length: 8 }, () => selfCheckIn(gym.a.id, n.phone)));
      expect(together.filter((x) => x.status === "in"), name).toHaveLength(1);
      expect(together.filter((x) => x.status === "inside"), name).toHaveLength(7);
      expect(await visits(n.id), name).toHaveLength(1);
    }

    // Once the desk has checked them out, they can come in again.
    await checkOut(pick(admin, gym.a.id), (await visits(m.id))[0]!.id);
    expect((await selfCheckIn(gym.a.id, m.phone)).status).toBe("in");
    expect(await visits(m.id)).toHaveLength(2);
  });

  it("gives every refusal the same answer, so nobody learns whether a number is a member or why one is turned away", async () => {
    const expired = await member("Esha Khan", { daysAgo: 90 });
    const never = await member("Farah Ali", null);
    const suspended = await member("Gita Iyer");
    await db.member.update({ where: { id: suspended.id }, data: { suspended: true } });
    const frozen = await member("Hema Jain");
    await freezeMembership(pick(admin, gym.a.id), frozen.id, { days: 10, from: today, reason: "Travelling" });
    const deleted = await member("Indu Menon");
    await db.member.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    const erased = await member("Jaya Pillai");
    await db.member.update({ where: { id: erased.id }, data: { erasedAt: new Date() } });
    const otherBranch = await member("Kiran Shah", { daysAgo: 0 }, gym.b.id);

    for (const m of [expired, never, suspended, frozen, deleted, erased, otherBranch]) {
      expect(await selfCheckIn(gym.a.id, m.phone), m.name).toEqual({ status: "desk" });
      expect(await visits(m.id), m.name).toHaveLength(0);
    }
    expect(await selfCheckIn(gym.a.id, "9000000099")).toEqual({ status: "desk" });
    // The other branch's own poster does let that member in.
    expect((await selfCheckIn(gym.b.id, otherBranch.phone)).status).toBe("in");
  });

  it("only knows branches that exist and are open, and only gyms whose plan has attendance and has not ended", async () => {
    expect(await checkInPoint("no-such-branch")).toBeNull();
    const point = await checkInPoint(gym.a.id);
    expect(point).toMatchObject({ branchId: gym.a.id, branchName: "A", gymName: gym.org.name, open: true });

    const other = await makeGym();
    const m = await createMember(pick(await other.user("Super Admin"), other.a.id), { name: "Lata Bose", gender: "Female", phone: String(phone++), source: "Walk-in", tags: [] });
    const DAY = 86_400_000;
    // Starter has no attendance; Professional on a trial that has ended with nothing paid is locked.
    await db.organization.update({ where: { id: other.org.id }, data: { plan: "starter", trialEndsAt: new Date(Date.now() + 7 * DAY) } });
    expect(await checkInPoint(other.a.id)).toMatchObject({ open: false });
    expect(await selfCheckIn(other.a.id, m.phone)).toEqual({ status: "desk" });
    await db.organization.update({ where: { id: other.org.id }, data: { plan: "professional", trialEndsAt: new Date(Date.now() + 7 * DAY) } });
    expect(await checkInPoint(other.a.id)).toMatchObject({ open: true });
    await db.organization.update({ where: { id: other.org.id }, data: { trialEndsAt: new Date(Date.now() - 3 * DAY) } });
    expect(await checkInPoint(other.a.id)).toMatchObject({ open: false });
    expect(await selfCheckIn(other.a.id, m.phone)).toEqual({ status: "desk" });

    await db.branch.update({ where: { id: gym.b.id }, data: { active: false } });
    expect(await checkInPoint(gym.b.id)).toBeNull();
  });
});
