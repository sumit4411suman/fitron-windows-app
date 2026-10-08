import { describe, expect, it } from "vitest";
import { clockMinutes, dueReminders, fmtClock, type ReminderInput } from "./trainer-reminders";

const base: ReminderInput = {
  today: "2026-10-03",
  clock: "07:00",
  prefs: { workout: true, meals: true, water: true, sleep: true },
  notificationsOn: true,
  focusMode: false,
  focus: "Chest",
  workoutTime: "6:30 PM",
  access: { status: "ACTIVE", until: "2026-12-01" },
  planCancelled: false,
  workoutDone: false,
  water: 1,
  waterGoal: 3,
  sent: {},
};
const keys = (i: Partial<ReminderInput>) => dueReminders({ ...base, ...i }).map((r) => r.key);

describe("clock", () => {
  it("reads 12-hour and 24-hour times", () => {
    expect(clockMinutes("6:30 PM")).toBe(18 * 60 + 30);
    expect(clockMinutes("12:15 AM")).toBe(15);
    expect(clockMinutes("12:00 PM")).toBe(720);
    expect(clockMinutes("07:05")).toBe(425);
    expect(clockMinutes("25:00")).toBeNull();
    expect(clockMinutes("soon")).toBeNull();
    expect(fmtClock(18 * 60 + 30)).toBe("6:30 PM");
  });
});

describe("due reminders", () => {
  it("sends the morning brief once, with the day's focus and workout time", () => {
    const r = dueReminders(base);
    expect(r.map((x) => x.key)).toEqual(["morning"]);
    expect(r[0]!.title).toBe("Today: Chest");
    expect(r[0]!.body).toContain("at 6:30 PM");
    expect(keys({ sent: { morning: "2026-10-03" } })).toEqual([]);
    expect(keys({ sent: { morning: "2026-10-02" } })).toEqual(["morning"]);
    expect(dueReminders({ ...base, focus: "Rest" })[0]!.title).toBe("Rest day");
  });

  it("times the workout, water, lunch and sleep nudges to the member's day", () => {
    expect(keys({ clock: "18:05" })).toEqual(["workout"]);
    expect(keys({ clock: "18:05", workoutDone: true })).toEqual([]);
    expect(keys({ clock: "18:05", prefs: { workout: false, water: true } })).toEqual([]);
    expect(keys({ clock: "11:30" })).toEqual(["water-1"]);
    expect(keys({ clock: "11:30", water: 3 })).toEqual([]);
    expect(keys({ clock: "13:00" })).toEqual(["lunch"]);
    expect(keys({ clock: "16:30" })).toEqual(["water-2"]);
    expect(keys({ clock: "22:00" })).toEqual(["sleep"]);
    expect(keys({ clock: "03:00" })).toEqual([]);
  });

  it("respects the master switch and full-focus mode", () => {
    expect(keys({ notificationsOn: false })).toEqual([]);
    expect(keys({ focusMode: true })).toEqual([]);
  });

  it("warns before a trial or a plan ends, in the morning only", () => {
    const trial = { status: "TRIAL", endsAt: new Date("2026-10-04T10:00:00Z") } as const;
    expect(keys({ access: trial })).toEqual(["trial", "morning"]);
    expect(dueReminders({ ...base, access: trial })[0]!.title).toBe("Your free trial ends tomorrow");
    expect(keys({ access: trial, clock: "15:00" })).toEqual([]);
    expect(keys({ access: { status: "TRIAL", endsAt: new Date("2026-10-20T10:00:00Z") } })).toEqual(["morning"]);
    expect(keys({ access: { status: "ACTIVE", until: "2026-10-05" } })).toEqual(["renewal", "morning"]);
    expect(keys({ access: { status: "ACTIVE", until: "2026-10-05" }, planCancelled: true })).toEqual(["morning"]);
    expect(keys({ access: { status: "LOCKED", trialUsed: true } })).toEqual(["morning"]);
  });
});
