// Settings › Reminders: the gym's reminder schedule and the "Scheduled jobs" summary under it.

import { fmtTime } from "@/lib/format";

/** Setting "reminders" (org-level JSON). Grace days live in Setting "access" so door rules keep one source. */
export type ReminderSettings = {
  /** Days before expiry that get a WhatsApp reminder (0 = on the day). */
  expiryDays: number[];
  /** Rule 5: don't repeat a reminder template to a member within this many days. */
  dedupDays: number;
  /** Send a dues reminder every N days while a balance is overdue. 0 = off. */
  dueEveryDays: number;
  /** Preselected plan length when selling, and the length of a new plan. */
  defaultMonths: number;
  birthdays: boolean;
};

export const DEFAULT_REMINDERS: ReminderSettings = { expiryDays: [7, 3, 1, 0], dedupDays: 3, dueEveryDays: 3, defaultMonths: 1, birthdays: true };

/** The prototype's expiry-reminder pills, in display order. */
export const EXPIRY_CHIPS = [15, 7, 3, 1, 0] as const;

export const expiryChipLabel = (d: number) => (d === 0 ? "On expiry" : `${d} day${d === 1 ? "" : "s"} before`);

type Job = { name: string; label: string };
type Run = { name: string; startedAt: Date; result: Record<string, unknown> | null; error: string | null; finishedAt: Date | null };

const MORNING = "Every morning, about 6:30";
/** The reminder jobs the tab describes in its own words, in the prototype's order; the rest of JOBS follow with their labels. */
const REMINDER_JOBS = ["reminders.expiry", "reminders.dues", "reminders.birthday", "reminders.winback", "autopay"] as const;

/** "15 days, 7 days, 3 days and 1 day before, and on expiry", from the days that are on. */
export function expiryScheduleText(days: number[]) {
  const before = [...new Set(days)].filter((d) => d > 0).sort((a, b) => b - a);
  const onDay = days.includes(0);
  const parts = before.map((d) => `${d} day${d === 1 ? "" : "s"}`);
  const beforeText = parts.length ? `${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]} before` : "";
  if (beforeText && onDay) return `${beforeText}, and on expiry`;
  return beforeText || (onDay ? "on expiry" : "off");
}

/** Today's status of one job, worded like the Daily jobs page. */
export function runStatus(run: Run | undefined) {
  if (!run) return "not run yet today";
  if (run.error) return `failed: ${run.error}`;
  const result = run.result ? Object.entries(run.result).map(([k, v]) => `${k} ${v}`).join(", ") : "";
  return `ran ${fmtTime(run.startedAt)}${result ? `, ${result}` : ""}`;
}

/** The "Scheduled jobs" rows: what each morning's run does with these settings, and how today's went. */
export function scheduledJobRows(s: ReminderSettings, opts: { winbackOn: boolean; jobs: Job[]; runs: Run[] }): { k: string; v: string }[] {
  const latest = new Map<string, Run>();
  for (const r of opts.runs) if (!latest.has(r.name) || r.startedAt > latest.get(r.name)!.startedAt) latest.set(r.name, r);
  const text: Record<(typeof REMINDER_JOBS)[number], string> = {
    "reminders.expiry": `Expiry reminders on WhatsApp · ${expiryScheduleText(s.expiryDays)}`,
    "reminders.dues": `Payment reminders on WhatsApp · ${s.dueEveryDays > 0 ? `every ${s.dueEveryDays} day${s.dueEveryDays === 1 ? "" : "s"} while a balance is overdue` : "off"}`,
    "reminders.birthday": `Birthday wishes${s.birthdays ? "" : " (off)"}`,
    "reminders.winback": `Win-back offers to members who stopped coming${opts.winbackOn ? "" : " (off)"}`,
    autopay: "UPI Autopay notices and demo debits",
  };
  const rows: { name: string; v: string }[] = REMINDER_JOBS.map((name) => ({ name, v: text[name] }));
  for (const j of opts.jobs) if (!(j.name in text)) rows.push({ name: j.name, v: j.label });
  return rows.map(({ name, v }) => ({ k: MORNING, v: `${v} · ${runStatus(latest.get(name))}` }));
}
