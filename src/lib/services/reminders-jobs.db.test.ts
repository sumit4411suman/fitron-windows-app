import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { addDays } from "@/lib/domain/dates";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { sellMembership } from "./billing";
import { getAccessRules } from "./attendance";
import { saveReminderSettings } from "./reminders";
import { runDailyJobs } from "./jobs";
import { istInstant, todayIso } from "./time";

describe.skipIf(!hasDb)("daily reminder jobs follow Settings › Reminders (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  let memberId: string;
  const today = todayIso();
  const result = (out: Awaited<ReturnType<typeof runDailyJobs>>, name: string) => out.find((j) => j.name === name);

  beforeAll(async () => {
    gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    const planId = (await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 100000, regFee: 0, discount: 0, gstApplicable: false, features: [] })).id;
    memberId = (await createMember(admin, { name: "Fifteen Days", gender: "Female", phone: "9855600001", source: "Walk-in", tags: [], dob: addDays(today, -365 * 25) })).id;
    // A one-month plan starting so that it ends in exactly 15 days.
    const s = await sellMembership(admin, memberId, { planId, startDate: addDays(addDays(today, 15), -29), discount: 0, includeRegFee: false, payAmount: 100000, payMethod: "Cash" });
    expect(s.membership.endDate.toISOString().slice(0, 10)).toBe(addDays(today, 15));
  });

  it("sends the 15-day reminder when that day is on, and nothing when only 7 is on", async () => {
    // The pills switch the expiry templates' Auto-send, which the rule engine reads. Runs at 10 am, outside quiet hours.
    const graceDays = (await getAccessRules(gym.org.id)).graceDays;
    await saveReminderSettings(admin, { expiryDays: [7], dedupDays: 3, dueEveryDays: 0, defaultMonths: 1, graceDays, birthdays: false });
    const quiet = await runDailyJobs(gym.org.id, addDays(today, -1), istInstant(addDays(today, -1), "10:00"));
    expect(result(quiet, "reminders.expiry")).toMatchObject({ status: "ran", result: { sent: 0 } });
    expect(await db.whatsAppMessage.count({ where: { memberId } })).toBe(0);
    expect(result(quiet, "reminders.dues")).toMatchObject({ status: "ran", result: { note: "off" } });
    expect(result(quiet, "reminders.birthday")).toMatchObject({ status: "ran", result: { note: "off" } });

    await saveReminderSettings(admin, { expiryDays: [15], dedupDays: 3, dueEveryDays: 3, defaultMonths: 1, graceDays, birthdays: true });
    const out = await runDailyJobs(gym.org.id, today, istInstant(today, "10:00"));
    expect(result(out, "reminders.expiry")).toMatchObject({ status: "ran", result: { sent: 1 } });
    expect(result(out, "reminders.dues")).toMatchObject({ status: "ran", result: { sent: 0 } });
    expect(result(out, "reminders.birthday")).toMatchObject({ status: "ran", result: { sent: 0 } });
    const msgs = await db.whatsAppMessage.findMany({ where: { memberId } });
    expect(msgs.map((m) => m.templateKey)).toEqual(["exp15"]);
    expect(msgs[0]).toMatchObject({ provider: "demo", status: "Logged" });
  });
});
