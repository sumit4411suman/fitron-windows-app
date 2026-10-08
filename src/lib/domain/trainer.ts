// AI Trainer (the member app at /trainer): plans, access, and the numbers the app shows from a
// member's daily log. Pure functions, so they can be tested without a database.
import { addDays, daysBetween, membershipEndDate, type IsoDate } from "./dates";
import { findPlan, TRIAL_DAYS, type Cycle } from "./pricing";
import { gstInside } from "./saas";

export const TRAINER_PLANS = ["ai-pro", "ai-premium"] as const;
export type TrainerPlan = (typeof TRAINER_PLANS)[number];
export const isTrainerPlan = (k: unknown): k is TrainerPlan => TRAINER_PLANS.includes(k as TrainerPlan);

/** What a payment is for. A bad value is refused rather than quietly turned into "purchase". */
export const TRAINER_PAYMENT_KINDS = ["purchase", "upgrade", "renew", "month"] as const;
export type TrainerPaymentKind = (typeof TRAINER_PAYMENT_KINDS)[number];
export const isTrainerPaymentKind = (k: unknown): k is TrainerPaymentKind => TRAINER_PAYMENT_KINDS.includes(k as TrainerPaymentKind);

export const isCycle = (c: unknown): c is Cycle => c === "MONTHLY" || c === "YEARLY";

/** AI Coach messages a member may send per day (India time). AI Premium has the higher limit. */
export const COACH_DAILY_LIMIT: Record<TrainerPlan, number> = { "ai-pro": 25, "ai-premium": 100 };

export const TRAINER_TRIAL_DAYS = TRIAL_DAYS;

/** Price of one period in paise: the listed price, which has the 18% GST inside it. */
export function trainerPrice(plan: TrainerPlan, cycle: Cycle) {
  const p = findPlan(plan);
  if (!p || p.product !== "AI_TRAINER") throw new Error(`Not an AI Trainer plan: ${plan}`);
  return gstInside(p.price[cycle]);
}


export type Access = { status: "ACTIVE"; until: IsoDate } | { status: "TRIAL"; endsAt: Date } | { status: "LOCKED"; trialUsed: boolean };

/** Paid through a date (inclusive), on a running trial, or locked until they pay or start the trial. */
export function trainerAccess(m: { paidUntil: IsoDate | null; trialEndsAt: Date | null }, today: IsoDate, now = new Date()): Access {
  if (m.paidUntil && m.paidUntil >= today) return { status: "ACTIVE", until: m.paidUntil };
  if (m.trialEndsAt && m.trialEndsAt > now) return { status: "TRIAL", endsAt: m.trialEndsAt };
  return { status: "LOCKED", trialUsed: !!m.trialEndsAt };
}

/** Monday of the week that holds `d`. */
export function weekStart(d: IsoDate): IsoDate {
  const dow = new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
  return addDays(d, -((dow + 6) % 7));
}

/** One logged set: the exercise as shown, the load and the reps. */
export type SetLog = { ex: string; kg: number; reps: number };
export type DayLog = { date: IsoDate; water: number; habits: Record<string, boolean>; workoutDone: boolean; focus: string | null; weightKg: number | null; sets?: SetLog[] };

/** A set is "heavier" by load first, then by reps at that load. */
const heavier = (a: { kg: number; reps: number }, b: { kg: number; reps: number }) => a.kg > b.kg || (a.kg === b.kg && a.reps > b.reps);

export type Lift = { ex: string; first: { kg: number; reps: number; date: IsoDate }; best: { kg: number; reps: number; date: IsoDate }; sessions: number };

/** Each exercise's heaviest set on the first day it was logged and on its best day ever, most-trained first. */
export function strength(days: DayLog[]): Lift[] {
  const byEx = new Map<string, Lift>();
  for (const d of [...days].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const top = new Map<string, SetLog>();
    for (const s of d.sets ?? []) if (!top.has(s.ex) || heavier(s, top.get(s.ex)!)) top.set(s.ex, s);
    for (const [ex, s] of top) {
      const l = byEx.get(ex);
      const at = { kg: s.kg, reps: s.reps, date: d.date };
      if (!l) byEx.set(ex, { ex, first: at, best: at, sessions: 1 });
      else {
        l.sessions++;
        if (heavier(s, l.best)) l.best = at;
      }
    }
  }
  return [...byEx.values()].sort((a, b) => b.sessions - a.sessions || b.best.kg - a.best.kg);
}

const HABITS = ["workout", "water", "steps", "protein", "meals", "sleep"] as const;
const active = (d: DayLog) => d.workoutDone || HABITS.some((h) => d.habits[h]);

/** Days in a row, ending today (or yesterday, if today has nothing yet), with something logged. */
export function streak(days: DayLog[], today: IsoDate) {
  const on = new Set(days.filter(active).map((d) => d.date));
  let d = on.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (on.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

/** Training days in the member's weekly split (Mon…Sun → focus). */
export const plannedSessions = (split: Record<string, string> | null | undefined) =>
  Object.values(split ?? {}).filter((f) => f && f !== "Rest").length;

export type WeekNumbers = { start: IsoDate; workouts: number; planned: number; consistency: number; nutrition: number; avgWater: number; daysLogged: number };

/** The week holding `today`: workouts done against the plan, meals/protein ticked, average water. */
export function weekNumbers(days: DayLog[], today: IsoDate, planned: number, start = weekStart(today)): WeekNumbers {
  const end = addDays(start, 6);
  const wk = days.filter((d) => d.date >= start && d.date <= end && d.date <= today);
  const workouts = wk.filter((d) => d.workoutDone).length;
  // Days with a log row: a member who joined mid-week isn't marked down for the days before.
  const logged = wk.length;
  const ticks = wk.reduce((a, d) => a + (d.habits.meals ? 1 : 0) + (d.habits.protein ? 1 : 0), 0);
  const watered = wk.filter((d) => d.water > 0);
  return {
    start,
    workouts,
    planned,
    consistency: planned ? Math.min(100, Math.round((workouts / planned) * 100)) : 0,
    nutrition: logged ? Math.round((ticks / (logged * 2)) * 100) : 0,
    avgWater: watered.length ? Math.round((watered.reduce((a, d) => a + d.water, 0) / watered.length) * 10) / 10 : 0,
    daysLogged: wk.filter(active).length,
  };
}

export type Progress = {
  week: WeekNumbers;
  streak: number;
  bestStreak: number;
  totalWorkouts: number;
  /** Last 4 weeks, oldest first */
  weeks: { label: string; done: number; planned: number }[];
  /** Body weight, one point per day it changed, oldest first (last 7) */
  weights: { date: IsoDate; kg: number }[];
  /** Sessions per focus over the last 6 weeks, most first */
  byFocus: { focus: string; count: number }[];
  /** Monday to Sunday of this week: workout done, share of meal/protein habits ticked (0–100), steps habit ticked */
  thisWeek: { date: IsoDate; workout: boolean; nutrition: number; steps: boolean }[];
  /** Lifts, from logged sets: most-trained first */
  strength: Lift[];
};

export function progress(days: DayLog[], today: IsoDate, planned: number): Progress {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : 1));
  const thisWeek = weekStart(today);
  const weeks = [3, 2, 1, 0].map((back, i) => {
    const s = addDays(thisWeek, -7 * back);
    const e = addDays(s, 6);
    return { label: `W${i + 1}`, done: sorted.filter((d) => d.date >= s && d.date <= e && d.workoutDone).length, planned };
  });
  let best = 0;
  let run = 0;
  let prev: IsoDate | null = null;
  for (const d of sorted.filter(active)) {
    run = prev && daysBetween(d.date, prev) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d.date;
  }
  const weights: { date: IsoDate; kg: number }[] = [];
  for (const d of sorted) if (d.weightKg && weights.at(-1)?.kg !== d.weightKg) weights.push({ date: d.date, kg: d.weightKg });
  const since = addDays(today, -42);
  const counts = new Map<string, number>();
  for (const d of sorted) if (d.workoutDone && d.date >= since && d.focus && d.focus !== "Rest") counts.set(d.focus, (counts.get(d.focus) ?? 0) + 1);
  return {
    week: weekNumbers(sorted, today, planned),
    streak: streak(sorted, today),
    bestStreak: best,
    totalWorkouts: sorted.filter((d) => d.workoutDone).length,
    weeks,
    weights: weights.slice(-7),
    byFocus: [...counts].map(([focus, count]) => ({ focus, count })).sort((a, b) => b.count - a.count),
    strength: strength(sorted),
    thisWeek: [0, 1, 2, 3, 4, 5, 6].map((i) => {
      const date = addDays(thisWeek, i);
      const d = sorted.find((x) => x.date === date);
      return { date, workout: !!d?.workoutDone, nutrition: d ? ((d.habits.meals ? 50 : 0) + (d.habits.protein ? 50 : 0)) : 0, steps: !!d?.habits.steps };
    }),
  };
}

/** The coach's line on the weekly review, from the week's numbers. */
export function reviewInsight(w: WeekNumbers) {
  if (!w.daysLogged) return "Nothing logged yet this week. Tick your habits and log today's session, and your review fills in as you go.";
  if (w.planned && w.workouts >= w.planned) return "Every planned session done this week, and your meals kept pace. Next week we'll add a little load to your main lifts.";
  if (w.consistency >= 50) return `You're on pace: ${w.workouts} of ${w.planned} sessions so far. Log the rest to close the week out, and keep meals consistent.`;
  return `${w.workouts} of ${w.planned} sessions so far. Pick the next one on your plan and log it; short sessions count too.`;
}

/** Next paid period: starts the day after the current one ends (or the trial, if still running), else today. */
export function trainerPeriod(cycle: Cycle, today: IsoDate, paidUntil: IsoDate | null, trialLastDay: IsoDate | null) {
  const last = paidUntil && paidUntil >= today ? paidUntil : trialLastDay && trialLastDay >= today ? trialLastDay : null;
  const start = last ? addDays(last, 1) : today;
  return { start, end: membershipEndDate(start, cycle === "YEARLY" ? 12 : 1) };
}

export const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 200;
