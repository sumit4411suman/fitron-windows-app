// WhatsApp automation rules (prototype A.RULES, A.ruleText, A.autoMatch, A.quiet): when a template
// goes out by itself, to whom, and what holds it back. Pure functions; the clock is always passed in.

import { addDays } from "./dates";
import { fmtClock, formatRupees } from "@/lib/format";
import { istClock, istInstant, todayIso } from "@/lib/services/time";
import { UserError } from "@/lib/services/errors";

export const WHEN = {
  event: "When an event happens",
  before_expiry: "Days before membership expiry",
  after_expiry: "Days after membership expired",
  dues_age: "Balance unpaid for N days",
  no_visit: "No visit for N days",
  birthday: "On the member's birthday",
  before_debit: "Days before UPI autopay debit",
  manual: "Manual only",
} as const;
export type When = keyof typeof WHEN;

/** Rules the daily run works through; event and manual templates are sent by the desk or by what happens. */
export const SCHEDULED: When[] = ["before_expiry", "after_expiry", "dues_age", "no_visit", "birthday", "before_debit"];
export const NEEDS_DAYS: When[] = ["before_expiry", "after_expiry", "dues_age", "no_visit", "before_debit"];
export const isWhen = (s: string): s is When => s in WHEN;
export const isScheduled = (when: string) => (SCHEDULED as string[]).includes(when);

export type Rule = {
  when: When;
  days: number;
  /** "HH:MM" Indian time the daily run sends it. */
  time: string;
  planId: string | null;
  gender: "Male" | "Female" | null;
  /** Paise; 0 = any balance. */
  minDue: number;
  maxPerWeek: number;
  excludeAutopay: boolean;
};

export const DEFAULT_RULE: Rule = { when: "manual", days: 0, time: "07:00", planId: null, gender: null, minDue: 0, maxPerWeek: 3, excludeAutopay: false };

/** The prototype's rule for each template key (A.RULES), plus the app's 15-day reminder. */
export const DEFAULT_RULES: Record<string, Partial<Rule>> = {
  welcome: { when: "event" },
  payment: { when: "event" },
  invoice: { when: "event" },
  renewal: { when: "event" },
  mandate: { when: "event" },
  class: { when: "event" },
  due: { when: "dues_age", days: 5 },
  exp15: { when: "before_expiry", days: 15, excludeAutopay: true },
  exp7: { when: "before_expiry", days: 7, excludeAutopay: true },
  exp3: { when: "before_expiry", days: 3, excludeAutopay: true },
  exp1: { when: "before_expiry", days: 1, excludeAutopay: true },
  expired: { when: "after_expiry", days: 0 },
  autopay: { when: "before_debit", days: 1 },
  winback: { when: "no_visit", days: 14 },
  birthday: { when: "birthday" },
  campaign: { when: "manual" },
};

export const defaultRule = (key: string): Rule => ({ ...DEFAULT_RULE, ...(DEFAULT_RULES[key] ?? {}) });

/** The rule in words, as the template card shows it (prototype A.ruleText). */
export function ruleText(rule: Rule, trigger: string, planName?: string | null) {
  const t = fmtClock(rule.time);
  const n = rule.days;
  const words: Record<When, string> = {
    event: `Sent instantly when: ${trigger}`,
    before_expiry: `Daily at ${t} to members whose membership ends in ${n} day${n === 1 ? "" : "s"}`,
    after_expiry: `Daily at ${t} to members ${n ? `${n} days after` : "on the day"} their membership expired`,
    dues_age: `Daily at ${t} to members with a balance unpaid for ${n}+ days`,
    no_visit: `Daily at ${t} to active members who haven't visited for ${n} days`,
    birthday: `Daily at ${t} to members with a birthday`,
    before_debit: `Daily at ${t}, ${n} day before each autopay debit`,
    manual: "Only sent when staff send it",
  };
  const filters: string[] = [];
  if (rule.planId) filters.push(`plan ${planName ?? "?"}`);
  if (rule.gender) filters.push(`${rule.gender.toLowerCase()} members`);
  if (rule.minDue > 0) filters.push(`balance over ${formatRupees(rule.minDue)}`);
  if (rule.excludeAutopay) filters.push("skips autopay members");
  return words[rule.when] + (filters.length ? ` · ${filters.join(" · ")}` : "");
}

/** Prototype A.quiet: a window that may span midnight ("21:00" – "08:00"); from == to means no quiet hours. */
export function inQuietHours(nowHHMM: string, from: string, to: string) {
  return from > to ? nowHHMM >= from || nowHHMM < to : nowHHMM >= from && nowHHMM < to;
}

/**
 * When an automatic message may go out: null for right now (the rule's send time has passed and it
 * isn't quiet hours), else the first instant at or after the send time that is outside quiet hours.
 */
export function holdUntil(now: Date, today: string, ruleTime: string, quietFrom: string, quietTo: string): Date | null {
  const ruleAt = istInstant(today, ruleTime);
  const waitForRule = now.getTime() < ruleAt.getTime();
  const at = waitForRule ? ruleAt : now;
  const clock = waitForRule ? ruleTime : istClock(now);
  if (!inQuietHours(clock, quietFrom, quietTo)) return waitForRule ? ruleAt : null;
  const day = todayIso(at);
  const release = istInstant(day, quietTo);
  return release.getTime() > at.getTime() ? release : istInstant(addDays(day, 1), quietTo);
}

/** What the engine knows about one member today. */
export type MemberFacts = {
  /** Latest membership end − today; null without a membership. */
  daysLeft: number | null;
  planId: string | null;
  gender: string;
  /** Paise. */
  outstanding: number;
  onAutopay: boolean;
  /** Today − due date of the oldest open invoice. */
  oldestOverdueDays: number | null;
  /** From attendance, else days since the member joined. */
  lastVisitDaysAgo: number | null;
  birthdayToday: boolean;
  nextDebitInDays: number | null;
};

/** Prototype A.autoMatch: does this rule pick the member today? */
export function matchRule(rule: Rule, f: MemberFacts) {
  const n = rule.days;
  const hit: Record<When, () => boolean> = {
    before_expiry: () => f.daysLeft === n,
    after_expiry: () => f.daysLeft === -n,
    dues_age: () => f.outstanding > 0 && f.oldestOverdueDays !== null && f.oldestOverdueDays >= n,
    no_visit: () => f.daysLeft !== null && f.daysLeft >= 0 && f.lastVisitDaysAgo !== null && f.lastVisitDaysAgo >= n,
    birthday: () => f.birthdayToday,
    before_debit: () => f.nextDebitInDays === n,
    event: () => false,
    manual: () => false,
  };
  if (!hit[rule.when]()) return false;
  if (rule.planId && f.planId !== rule.planId) return false;
  if (rule.gender && f.gender !== rule.gender) return false;
  if (rule.minDue > 0 && f.outstanding < rule.minDue) return false;
  if (rule.excludeAutopay && f.onAutopay) return false;
  return true;
}

/** Why a matched member is skipped, in the order the prototype checks; null when they get the message. */
export function skipReason(f: Pick<MemberFacts, "onAutopay">, o: { validNumber: boolean; sentWithinWindow: boolean; autoThisWeek: number; windowDays: number; rule: Rule }) {
  if (!o.validNumber) return "Invalid WhatsApp number";
  if (o.sentWithinWindow) return `Already sent within ${o.windowDays} days`;
  if (o.autoThisWeek >= o.rule.maxPerWeek) return `Weekly limit of ${o.rule.maxPerWeek} reached`;
  if (o.rule.excludeAutopay && f.onAutopay) return "On UPI autopay";
  return null;
}

export type RuleInput = {
  when: string;
  days?: number | string | null;
  time?: string | null;
  planId?: string | null;
  gender?: string | null;
  /** Paise. */
  minDue?: number | string | null;
  maxPerWeek?: number | string | null;
  excludeAutopay?: boolean;
};

/** Checks a rule from the Edit rule form (prototype's 'rule' case) and fills the defaults. */
export function validateRule(input: RuleInput): Rule {
  if (!isWhen(input.when)) throw new UserError("Pick a trigger.", "when");
  const days = input.days === "" || input.days == null ? NaN : Number(input.days);
  if (NEEDS_DAYS.includes(input.when) && !(Number.isInteger(days) && days >= 0)) throw new UserError("Enter the number of days.", "days");
  const time = typeof input.time === "string" && /^\d{2}:\d{2}$/.test(input.time) ? input.time : "07:00";
  const perWeek = Number(input.maxPerWeek);
  const maxPerWeek = Number.isInteger(perWeek) ? Math.min(99, Math.max(1, perWeek)) : 3;
  const minDue = Math.max(0, Math.round(Number(input.minDue) || 0));
  const gender = input.gender === "Male" || input.gender === "Female" ? input.gender : null;
  return { when: input.when, days: Number.isInteger(days) && days >= 0 ? days : 0, time, planId: input.planId || null, gender, minDue, maxPerWeek, excludeAutopay: !!input.excludeAutopay };
}

/** The rule as the WhatsAppTemplate columns store it. */
export type RuleColumns = { ruleWhen: string; ruleDays: number; ruleTime: string; rulePlanId: string | null; ruleGender: string | null; ruleMinDue: number; ruleMaxPerWeek: number; ruleExcludeAutopay: boolean };

export const toColumns = (r: Rule): RuleColumns => ({ ruleWhen: r.when, ruleDays: r.days, ruleTime: r.time, rulePlanId: r.planId, ruleGender: r.gender, ruleMinDue: r.minDue, ruleMaxPerWeek: r.maxPerWeek, ruleExcludeAutopay: r.excludeAutopay });

export const fromColumns = (c: RuleColumns): Rule => ({
  when: isWhen(c.ruleWhen) ? c.ruleWhen : "manual",
  days: c.ruleDays,
  time: c.ruleTime,
  planId: c.rulePlanId,
  gender: c.ruleGender === "Male" || c.ruleGender === "Female" ? c.ruleGender : null,
  minDue: c.ruleMinDue,
  maxPerWeek: c.ruleMaxPerWeek,
  excludeAutopay: c.ruleExcludeAutopay,
});
