import { describe, expect, it } from "vitest";
import { istInstant } from "@/lib/services/time";
import { DEFAULT_RULE, defaultRule, holdUntil, inQuietHours, matchRule, ruleText, skipReason, validateRule, type MemberFacts, type Rule } from "./wa-rules";

const rule = (over: Partial<Rule>): Rule => ({ ...DEFAULT_RULE, ...over });
const facts = (over: Partial<MemberFacts> = {}): MemberFacts => ({ daysLeft: 20, planId: "p1", gender: "Male", outstanding: 0, onAutopay: false, oldestOverdueDays: null, lastVisitDaysAgo: 2, birthdayToday: false, nextDebitInDays: null, ...over });
const today = "2026-10-03";

describe("quiet hours", () => {
  it("spans midnight with the default 21:00–08:00", () => {
    for (const [t, q] of [["22:30", true], ["03:00", true], ["07:59", true], ["08:00", false], ["12:00", false], ["20:59", false], ["21:00", true]] as const) expect(inQuietHours(t, "21:00", "08:00"), t).toBe(q);
  });
  it("works inside one day, and from == to means never", () => {
    expect(inQuietHours("14:00", "13:00", "15:00")).toBe(true);
    expect(inQuietHours("15:00", "13:00", "15:00")).toBe(false);
    expect(inQuietHours("12:00", "13:00", "15:00")).toBe(false);
    expect(inQuietHours("03:00", "08:00", "08:00")).toBe(false);
  });
});

describe("holdUntil", () => {
  it("holds a 7:00 rule run at 6:30 until quiet hours end at 8:00", () => {
    expect(holdUntil(istInstant(today, "06:30"), today, "07:00", "21:00", "08:00")).toEqual(istInstant(today, "08:00"));
  });
  it("sends now when the rule time has passed and it isn't quiet", () => {
    expect(holdUntil(istInstant(today, "10:00"), today, "07:00", "21:00", "08:00")).toBeNull();
  });
  it("waits for the rule time when quiet hours are off", () => {
    expect(holdUntil(istInstant(today, "06:00"), today, "07:00", "08:00", "08:00")).toEqual(istInstant(today, "07:00"));
  });
  it("holds an evening run until tomorrow morning", () => {
    expect(holdUntil(istInstant(today, "22:00"), today, "07:00", "21:00", "08:00")).toEqual(istInstant("2026-10-04", "08:00"));
  });
});

describe("matchRule", () => {
  it("before and after expiry match the exact day", () => {
    const r = rule({ when: "before_expiry", days: 7 });
    expect(matchRule(r, facts({ daysLeft: 7 }))).toBe(true);
    expect(matchRule(r, facts({ daysLeft: 6 }))).toBe(false);
    expect(matchRule(rule({ when: "after_expiry", days: 0 }), facts({ daysLeft: 0 }))).toBe(true);
    expect(matchRule(rule({ when: "after_expiry", days: 3 }), facts({ daysLeft: -3 }))).toBe(true);
    expect(matchRule(rule({ when: "after_expiry", days: 3 }), facts({ daysLeft: -2 }))).toBe(false);
    expect(matchRule(r, facts({ daysLeft: null }))).toBe(false);
  });
  it("dues age needs an open balance that old", () => {
    const r = rule({ when: "dues_age", days: 5 });
    expect(matchRule(r, facts({ outstanding: 50000, oldestOverdueDays: 5 }))).toBe(true);
    expect(matchRule(r, facts({ outstanding: 50000, oldestOverdueDays: 4 }))).toBe(false);
    expect(matchRule(r, facts({ outstanding: 0, oldestOverdueDays: 9 }))).toBe(false);
  });
  it("no visit applies to active members only", () => {
    const r = rule({ when: "no_visit", days: 14 });
    expect(matchRule(r, facts({ lastVisitDaysAgo: 14 }))).toBe(true);
    expect(matchRule(r, facts({ lastVisitDaysAgo: 13 }))).toBe(false);
    expect(matchRule(r, facts({ lastVisitDaysAgo: 30, daysLeft: -1 }))).toBe(false);
  });
  it("birthday, before debit, and never for event or manual", () => {
    expect(matchRule(rule({ when: "birthday" }), facts({ birthdayToday: true }))).toBe(true);
    expect(matchRule(rule({ when: "birthday" }), facts())).toBe(false);
    expect(matchRule(rule({ when: "before_debit", days: 1 }), facts({ nextDebitInDays: 1 }))).toBe(true);
    expect(matchRule(rule({ when: "before_debit", days: 1 }), facts({ nextDebitInDays: 2 }))).toBe(false);
    expect(matchRule(rule({ when: "event" }), facts({ daysLeft: 0, birthdayToday: true }))).toBe(false);
    expect(matchRule(rule({ when: "manual" }), facts({ birthdayToday: true }))).toBe(false);
  });
  it("filters by plan, gender, minimum balance and autopay", () => {
    const hit = facts({ birthdayToday: true, outstanding: 40000, onAutopay: true });
    expect(matchRule(rule({ when: "birthday", planId: "p1" }), hit)).toBe(true);
    expect(matchRule(rule({ when: "birthday", planId: "p2" }), hit)).toBe(false);
    expect(matchRule(rule({ when: "birthday", gender: "Male" }), hit)).toBe(true);
    expect(matchRule(rule({ when: "birthday", gender: "Female" }), hit)).toBe(false);
    expect(matchRule(rule({ when: "birthday", minDue: 40000 }), hit)).toBe(true);
    expect(matchRule(rule({ when: "birthday", minDue: 40001 }), hit)).toBe(false);
    expect(matchRule(rule({ when: "birthday", excludeAutopay: true }), hit)).toBe(false);
    expect(matchRule(rule({ when: "birthday", excludeAutopay: true }), { ...hit, onAutopay: false })).toBe(true);
  });
});

describe("skipReason", () => {
  const r = rule({ when: "before_expiry", days: 7, maxPerWeek: 2, excludeAutopay: true });
  it("checks the number, the repeat window, the weekly cap, then autopay", () => {
    expect(skipReason({ onAutopay: true }, { validNumber: false, sentWithinWindow: true, autoThisWeek: 5, windowDays: 3, rule: r })).toBe("Invalid WhatsApp number");
    expect(skipReason({ onAutopay: true }, { validNumber: true, sentWithinWindow: true, autoThisWeek: 5, windowDays: 3, rule: r })).toBe("Already sent within 3 days");
    expect(skipReason({ onAutopay: true }, { validNumber: true, sentWithinWindow: false, autoThisWeek: 2, windowDays: 3, rule: r })).toBe("Weekly limit of 2 reached");
    expect(skipReason({ onAutopay: true }, { validNumber: true, sentWithinWindow: false, autoThisWeek: 1, windowDays: 3, rule: r })).toBe("On UPI autopay");
    expect(skipReason({ onAutopay: false }, { validNumber: true, sentWithinWindow: false, autoThisWeek: 1, windowDays: 3, rule: r })).toBeNull();
  });
});

describe("ruleText", () => {
  it("words every kind of rule with a 12-hour clock", () => {
    expect(ruleText(rule({ when: "event" }), "New membership sold")).toBe("Sent instantly when: New membership sold");
    expect(ruleText(rule({ when: "before_expiry", days: 7 }), "")).toBe("Daily at 7:00 am to members whose membership ends in 7 days");
    expect(ruleText(rule({ when: "before_expiry", days: 1, time: "18:30" }), "")).toBe("Daily at 6:30 pm to members whose membership ends in 1 day");
    expect(ruleText(rule({ when: "after_expiry", days: 0 }), "")).toBe("Daily at 7:00 am to members on the day their membership expired");
    expect(ruleText(rule({ when: "after_expiry", days: 3 }), "")).toBe("Daily at 7:00 am to members 3 days after their membership expired");
    expect(ruleText(rule({ when: "dues_age", days: 5 }), "")).toBe("Daily at 7:00 am to members with a balance unpaid for 5+ days");
    expect(ruleText(rule({ when: "no_visit", days: 14 }), "")).toBe("Daily at 7:00 am to active members who haven't visited for 14 days");
    expect(ruleText(rule({ when: "birthday" }), "")).toBe("Daily at 7:00 am to members with a birthday");
    expect(ruleText(rule({ when: "before_debit", days: 1 }), "")).toBe("Daily at 7:00 am, 1 day before each autopay debit");
    expect(ruleText(rule({ when: "manual" }), "")).toBe("Only sent when staff send it");
  });
  it("adds the filters", () => {
    expect(ruleText(rule({ when: "dues_age", days: 5, planId: "p1", gender: "Female", minDue: 50000, excludeAutopay: true }), "", "Monthly")).toBe(
      "Daily at 7:00 am to members with a balance unpaid for 5+ days · plan Monthly · female members · balance over ₹500 · skips autopay members",
    );
    expect(ruleText(defaultRule("exp7"), "")).toBe("Daily at 7:00 am to members whose membership ends in 7 days · skips autopay members");
  });
});

describe("validateRule", () => {
  it("needs days for a scheduled rule, not for an event", () => {
    expect(() => validateRule({ when: "dues_age", days: "" })).toThrow("Enter the number of days.");
    expect(() => validateRule({ when: "before_expiry", days: -1 })).toThrow("Enter the number of days.");
    expect(validateRule({ when: "event", days: "" })).toMatchObject({ when: "event", days: 0 });
    expect(validateRule({ when: "birthday" })).toMatchObject({ when: "birthday", days: 0, time: "07:00" });
  });
  it("falls back to 7:00 and a weekly cap of 3, clamps the cap, and keeps the filters", () => {
    expect(validateRule({ when: "dues_age", days: 5, time: "7am", maxPerWeek: "x" })).toMatchObject({ time: "07:00", maxPerWeek: 3 });
    expect(validateRule({ when: "dues_age", days: 5, time: "18:30", maxPerWeek: 500 })).toMatchObject({ time: "18:30", maxPerWeek: 99 });
    expect(validateRule({ when: "dues_age", days: 5, maxPerWeek: 0 })).toMatchObject({ maxPerWeek: 1 });
    expect(validateRule({ when: "no_visit", days: "14", planId: "p1", gender: "Female", minDue: -5, excludeAutopay: true })).toEqual({ when: "no_visit", days: 14, time: "07:00", planId: "p1", gender: "Female", minDue: 0, maxPerWeek: 3, excludeAutopay: true });
    expect(validateRule({ when: "no_visit", days: 14, gender: "Other", planId: "" })).toMatchObject({ gender: null, planId: null });
    expect(() => validateRule({ when: "sometimes" })).toThrow("Pick a trigger.");
  });
});
