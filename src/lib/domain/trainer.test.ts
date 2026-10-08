import { describe, expect, it } from "vitest";
import { isCycle, isTrainerPaymentKind, isTrainerPlan, plannedSessions, progress, reviewInsight, streak, trainerAccess, trainerPeriod, trainerPrice, weekNumbers, weekStart, type DayLog, strength } from "./trainer";

const day = (date: string, x: Partial<DayLog> = {}): DayLog => ({ date, water: 0, habits: {}, workoutDone: false, focus: null, weightKg: null, ...x });

describe("what the app may send", () => {
  it("accepts only the two AI Trainer plans", () => {
    expect(isTrainerPlan("ai-pro")).toBe(true);
    expect(isTrainerPlan("ai-premium")).toBe(true);
    for (const bad of ["professional", "AI-PRO", "", null, undefined, 1, {}]) expect(isTrainerPlan(bad)).toBe(false);
  });
  it("accepts only a monthly or yearly cycle, so a typo is never billed as a month", () => {
    expect(isCycle("MONTHLY")).toBe(true);
    expect(isCycle("YEARLY")).toBe(true);
    for (const bad of ["monthly", "yearly", "WEEKLY", "", null, undefined, 1]) expect(isCycle(bad)).toBe(false);
  });
  it("accepts only the four things a payment can be for", () => {
    for (const k of ["purchase", "upgrade", "renew", "month"]) expect(isTrainerPaymentKind(k)).toBe(true);
    for (const bad of ["yearly", "Purchase", "", null, undefined, 1]) expect(isTrainerPaymentKind(bad)).toBe(false);
  });
});

describe("AI Trainer prices", () => {
  it("uses FITRON's price list, which has the 18% GST inside it", () => {
    expect(trainerPrice("ai-pro", "MONTHLY")).toEqual({ base: 25_339, gst: 4_561, total: 29_900 });
    expect(trainerPrice("ai-pro", "YEARLY").total).toBe(1_99_900);
    expect(trainerPrice("ai-premium", "MONTHLY").total).toBe(49_900);
    expect(trainerPrice("ai-premium", "YEARLY")).toEqual({ base: 4_23_644, gst: 76_256, total: 4_99_900 });
  });

});

describe("access", () => {
  const now = new Date("2026-10-02T06:00:00Z");
  it("is active through the last paid day", () => {
    expect(trainerAccess({ paidUntil: "2026-10-02", trialEndsAt: null }, "2026-10-02", now)).toEqual({ status: "ACTIVE", until: "2026-10-02" });
    expect(trainerAccess({ paidUntil: "2026-10-01", trialEndsAt: null }, "2026-10-02", now).status).toBe("LOCKED");
  });
  it("is on trial until the trial ends, then locked with the trial used", () => {
    expect(trainerAccess({ paidUntil: null, trialEndsAt: new Date("2026-10-05T00:00:00Z") }, "2026-10-02", now).status).toBe("TRIAL");
    expect(trainerAccess({ paidUntil: null, trialEndsAt: new Date("2026-10-01T00:00:00Z") }, "2026-10-02", now)).toEqual({ status: "LOCKED", trialUsed: true });
    expect(trainerAccess({ paidUntil: null, trialEndsAt: null }, "2026-10-02", now)).toEqual({ status: "LOCKED", trialUsed: false });
  });
});

describe("paid periods", () => {
  it("starts today when nothing is running", () => expect(trainerPeriod("MONTHLY", "2026-10-02", null, null)).toEqual({ start: "2026-10-02", end: "2026-11-01" }));
  it("starts after a running trial", () => expect(trainerPeriod("YEARLY", "2026-10-02", null, "2026-10-08")).toEqual({ start: "2026-10-09", end: "2027-10-08" }));
  it("extends a running paid period", () => expect(trainerPeriod("MONTHLY", "2026-10-02", "2026-10-20", "2026-09-01").start).toBe("2026-10-21"));
});

describe("log numbers", () => {
  const today = "2026-10-02"; // a Friday
  it("finds the Monday", () => {
    expect(weekStart(today)).toBe("2026-09-28");
    expect(weekStart("2026-09-28")).toBe("2026-09-28");
    expect(weekStart("2026-10-04")).toBe("2026-09-28");
  });
  it("counts the streak back from today, or from yesterday when today is empty", () => {
    const d = [day("2026-09-29", { habits: { water: true } }), day("2026-09-30", { workoutDone: true }), day("2026-10-01", { habits: { meals: true } })];
    expect(streak(d, today)).toBe(3);
    expect(streak([...d, day(today, { habits: { sleep: true } })], today)).toBe(4);
    expect(streak([day("2026-09-29", { habits: { water: true } })], today)).toBe(0);
  });
  it("counts this week's workouts against the plan and nutrition over logged days", () => {
    const d = [day("2026-09-27", { workoutDone: true }), day("2026-09-28", { workoutDone: true, water: 2, habits: { meals: true, protein: true } }), day("2026-10-01", { workoutDone: true, water: 3, habits: { meals: true } })];
    const w = weekNumbers(d, today, 4);
    expect(w).toMatchObject({ start: "2026-09-28", workouts: 2, planned: 4, consistency: 50, nutrition: 75, avgWater: 2.5, daysLogged: 2 });
    expect(reviewInsight(w)).toMatch(/on pace: 2 of 4/);
    expect(reviewInsight(weekNumbers([], today, 4))).toMatch(/Nothing logged yet/);
  });
  it("builds progress: weeks, weights, focus counts and this week's days", () => {
    const d = [
      day("2026-09-10", { workoutDone: true, focus: "Legs", weightKg: 80 }),
      day("2026-09-20", { workoutDone: true, focus: "Chest", weightKg: 80 }),
      day("2026-09-29", { workoutDone: true, focus: "Legs", weightKg: 79.2, habits: { steps: true, meals: true } }),
    ];
    const p = progress(d, today, 3);
    expect(p.totalWorkouts).toBe(3);
    expect(p.weeks.map((w) => w.done)).toEqual([1, 1, 0, 1]);
    expect(p.weights).toEqual([{ date: "2026-09-10", kg: 80 }, { date: "2026-09-29", kg: 79.2 }]);
    expect(p.byFocus[0]).toEqual({ focus: "Legs", count: 2 });
    expect(p.thisWeek[1]).toEqual({ date: "2026-09-29", workout: true, nutrition: 50, steps: true });
    expect(plannedSessions({ Mon: "Chest", Tue: "Rest", Wed: "Legs" })).toBe(2);
  });

  it("tracks each lift from its first day to its best, by the heaviest set of the day", () => {
    const d = [
      day("2026-09-20", { workoutDone: true, sets: [{ ex: "Bench Press", kg: 40, reps: 10 }, { ex: "Bench Press", kg: 45, reps: 6 }, { ex: "Squat", kg: 60, reps: 8 }] }),
      day("2026-09-10", { workoutDone: true, sets: [{ ex: "Bench Press", kg: 40, reps: 8 }] }),
      day("2026-09-29", { workoutDone: true, sets: [{ ex: "Bench Press", kg: 45, reps: 8 }] }),
    ];
    const s = strength(d);
    expect(s.map((l) => l.ex)).toEqual(["Bench Press", "Squat"]);
    expect(s[0]).toEqual({ ex: "Bench Press", first: { kg: 40, reps: 8, date: "2026-09-10" }, best: { kg: 45, reps: 8, date: "2026-09-29" }, sessions: 3 });
    expect(progress(d, today, 3).strength[1]?.sessions).toBe(1);
    expect(strength([day("2026-09-10", {})])).toEqual([]);
  });
});
