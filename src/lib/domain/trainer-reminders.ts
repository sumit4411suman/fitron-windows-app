// AI Trainer push reminders: which ones are due at a given Indian clock time, from the member's own
// settings, plan and day. Pure, so the hourly job's decisions can be tested without a database.
import { daysBetween, type IsoDate } from "./dates";
import type { Access } from "./trainer";

export type ReminderPrefs = { workout?: boolean; meals?: boolean; water?: boolean; sleep?: boolean };

export type ReminderInput = {
  today: IsoDate;
  /** Indian clock time now, "18:30" */
  clock: string;
  prefs: ReminderPrefs;
  /** The member's master switch and full-focus mode: either off means nothing is sent */
  notificationsOn: boolean;
  focusMode: boolean;
  /** Today's focus from the weekly split (Chest, Legs, Rest…) */
  focus: string | null;
  /** The workout's time in the member's day schedule, "18:30" */
  workoutTime: string | null;
  access: Access;
  planCancelled: boolean;
  workoutDone: boolean;
  /** Litres drunk today, and the goal */
  water: number;
  waterGoal: number;
  /** Reminder key → the date it was last sent, so each goes once a day */
  sent: Record<string, IsoDate>;
};

export type Reminder = { key: string; title: string; body: string; url: string };

/** "6:30 PM" or "18:30" → minutes since midnight, or null. */
export function clockMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (m[3]) h = (h % 12) + (/pm/i.test(m[3]) ? 12 : 0);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

const inWindow = (now: number, from: number, to: number) => now >= from && now < to;
const H = (h: number, m = 0) => h * 60 + m;
const days = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);
const APP = "/trainer";

/** The reminders to send now. Every one is keyed, and a key already sent today is skipped. */
export function dueReminders(i: ReminderInput): Reminder[] {
  const out: Reminder[] = [];
  if (!i.notificationsOn || i.focusMode) return out;
  const now = clockMinutes(i.clock);
  if (now === null) return out;
  const any = !!(i.prefs.workout || i.prefs.meals || i.prefs.water || i.prefs.sleep);
  const add = (key: string, title: string, body: string) => {
    if (i.sent[key] !== i.today) out.push({ key, title, body, url: APP });
  };
  const rest = !i.focus || i.focus === "Rest";
  const wt = clockMinutes(i.workoutTime);
  const at = wt !== null && i.workoutTime ? ` at ${fmtClock(wt)}` : "";

  // The account comes first: these go even with every reminder switched off, since they are about money.
  if (inWindow(now, H(6), H(12))) {
    if (i.access.status === "TRIAL") {
      const left = daysBetween(i.access.endsAt.toISOString().slice(0, 10), i.today);
      if (left <= 2) add("trial", `Your free trial ends ${days(Math.max(0, left))}`, "Choose a plan to keep your coach, meals and progress.");
    }
    if (i.access.status === "ACTIVE" && !i.planCancelled) {
      const left = daysBetween(i.access.until, i.today);
      if (left <= 3) add("renewal", `Your plan ends ${days(Math.max(0, left))}`, "Pay before then to stay on. Nothing is ever debited automatically.");
    }
  }
  if (!any) return out;

  if (inWindow(now, H(6), H(10))) {
    if (rest) add("morning", "Rest day", "Recovery today. Water, meals and sleep still count: tick them as you go.");
    else add("morning", `Today: ${i.focus}`, `Your ${i.focus} session is on the plan${at}. Tick your habits through the day.`);
  }
  if (i.prefs.workout && !rest && !i.workoutDone && wt !== null && inWindow(now, wt - 30, wt + 30)) add("workout", "Workout in 30 minutes", `${i.focus} session${at}. Your coach has the exercises ready.`);
  if (i.prefs.water && i.water < i.waterGoal) {
    const body = `${i.water} of ${i.waterGoal} L so far. Time for a glass.`;
    if (inWindow(now, H(11), H(13))) add("water-1", "Water check", body);
    if (inWindow(now, H(16), H(18))) add("water-2", "Water check", body);
  }
  if (i.prefs.meals && inWindow(now, H(12, 30), H(14, 30))) add("lunch", "Lunch time", "Your plan's lunch is on Nutrition, with what's near you.");
  if (i.prefs.sleep && inWindow(now, H(21, 30), H(23, 30))) add("sleep", "Wind down", "Aim for 7 hours tonight. Tomorrow's session is on your plan.");
  return out;
}

export function fmtClock(mins: number) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
