import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, daysBetween } from "@/lib/domain/dates";
import { hasDb, makeGym, pick } from "@/test/db";
import { createMember, summarize } from "./members";
import { createPlan } from "./plans";
import { sellMembership } from "./billing";
import { expiryKey, lastRenewalReminders, remindAllOverdue, remindDue, remindRenewal, renewalAmounts } from "./reminders";
import { todayIso } from "./time";

describe.skipIf(!hasDb)("reminders (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let owing: string;
  let ending: string;
  let fortnight: string;

  beforeAll(async () => {
    gym = await makeGym();
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const today = todayIso();
    const plan = await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    owing = (await createMember(admin, { name: "Owes", gender: "Male", phone: "9876522001", source: "Walk-in", tags: [] })).id;
    ending = (await createMember(admin, { name: "Ends Soon", gender: "Female", phone: "9876522002", source: "Walk-in", tags: [] })).id;
    const sale = await sellMembership(admin, owing, { planId: plan.id, startDate: addDays(today, -20), discount: 0, includeRegFee: false, payAmount: 0 });
    // Make the unpaid invoice overdue.
    await db.invoice.update({ where: { id: sale.invoice.id }, data: { dueDate: new Date(`${addDays(today, -10)}T00:00:00Z`) } });
    await sellMembership(admin, ending, { planId: plan.id, startDate: addDays(today, -28), discount: 10000, includeRegFee: false, payAmount: 140000, payMethod: "UPI" });
    fortnight = (await createMember(admin, { name: "Ends In Two Weeks", gender: "Male", phone: "9876522003", source: "Walk-in", tags: [] })).id;
    // A one-month plan starting so that it ends in exactly 15 days.
    await sellMembership(admin, fortnight, { planId: plan.id, startDate: addDays(addDays(today, 15), -29), discount: 0, includeRegFee: false, payAmount: 0 });
  });

  it("picks the expiry template by days left", () => {
    expect([expiryKey(15), expiryKey(10), expiryKey(8), expiryKey(7), expiryKey(5), expiryKey(3), expiryKey(1), expiryKey(0), expiryKey(-4)]).toEqual(["exp15", "exp15", "exp15", "exp7", "exp7", "exp3", "exp1", "expired", "expired"]);
  });

  it("sends a due reminder once, then skips repeats within the window", async () => {
    const desk = await gym.user("Receptionist", [gym.a.id]);
    expect(await remindDue(desk, owing)).toBe(true);
    expect(await remindDue(desk, owing)).toBe(false);
    expect(await remindAllOverdue(desk)).toEqual({ sent: 0, skipped: 1 });
  });

  it("sends the right renewal reminder and reports it as the last one", async () => {
    const desk = await gym.user("Receptionist", [gym.a.id]);
    expect(await remindRenewal(desk, ending)).toBe(true);
    const last = (await lastRenewalReminders([ending])).get(ending);
    const end = (await summarize([ending])).get(ending)!.latestEnd!;
    expect(last?.templateKey).toBe(expiryKey(daysBetween(end, todayIso())));
    expect((await renewalAmounts([ending])).get(ending)).toBe(140000);
  });

  it("sends the 15-day reminder to a member whose membership ends in 15 days", async () => {
    const desk = await gym.user("Receptionist", [gym.a.id]);
    expect(daysBetween((await summarize([fortnight])).get(fortnight)!.latestEnd!, todayIso())).toBe(15);
    expect(await remindRenewal(desk, fortnight)).toBe(true);
    const msg = await db.whatsAppMessage.findFirst({ where: { memberId: fortnight }, orderBy: { sentAt: "desc" } });
    expect(msg).toMatchObject({ templateKey: "exp15", status: "Logged" });
    expect(msg!.body).toContain("15 days from now");
    expect((await lastRenewalReminders([fortnight])).get(fortnight)?.templateKey).toBe("exp15");
  });
});
