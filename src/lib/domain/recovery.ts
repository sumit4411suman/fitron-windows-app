// Membership Revenue Recovery: the rules that turn an unpaid invoice or a lapsed membership into a case with a priority
// and a recommended next step (docs/BUSINESS-INTELLIGENCE.md, Module 1). Pure functions; src/lib/services/recovery.ts
// reads the records and keeps the queue.

import { agingBucket, type AgingBucket } from "./metrics";

export type RecoveryKind = "DUES" | "RENEWAL";
export type RecoveryStatus = "OPEN" | "IN_PROGRESS" | "RECOVERED" | "RENEWED" | "CLOSED";
export const RECOVERY_STATUS_LABEL: Record<RecoveryStatus, string> = { OPEN: "Open", IN_PROGRESS: "In progress", RECOVERED: "Recovered", RENEWED: "Renewed", CLOSED: "Closed" };

/** Settings › Business intelligence › Recovery rules (the defaults match the prototype's reminder cadence). */
export type RecoveryRules = {
  /** Days after an invoice's due date before it enters the queue (0 = the day after). */
  graceDays: number;
  /** A balance under this (paise) is not worth a case. */
  minBalance: number;
  /** Days a lapsed membership stays a renewal opportunity. */
  renewalWindowDays: number;
  /** Days between follow-ups on one case. */
  followUpEveryDays: number;
  /** Attempts before the recommended step moves from a message to a call. */
  callAfterAttempts: number;
  /** Attempts before the queue suggests a decision (write off or close). */
  reviewAfterAttempts: number;
};

export const DEFAULT_RECOVERY_RULES: RecoveryRules = { graceDays: 0, minBalance: 10_000, renewalWindowDays: 60, followUpEveryDays: 3, callAfterAttempts: 2, reviewAfterAttempts: 5 };

export function withRecoveryDefaults(s: Partial<RecoveryRules> | null | undefined): RecoveryRules {
  const r = { ...DEFAULT_RECOVERY_RULES, ...(s ?? {}) };
  const clamp = (v: number, lo: number, hi: number, d: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
  return {
    graceDays: clamp(r.graceDays, 0, 90, DEFAULT_RECOVERY_RULES.graceDays),
    minBalance: clamp(r.minBalance, 0, 10_000_000, DEFAULT_RECOVERY_RULES.minBalance),
    renewalWindowDays: clamp(r.renewalWindowDays, 7, 365, DEFAULT_RECOVERY_RULES.renewalWindowDays),
    followUpEveryDays: clamp(r.followUpEveryDays, 1, 30, DEFAULT_RECOVERY_RULES.followUpEveryDays),
    callAfterAttempts: clamp(r.callAfterAttempts, 1, 10, DEFAULT_RECOVERY_RULES.callAfterAttempts),
    reviewAfterAttempts: clamp(r.reviewAfterAttempts, 2, 20, DEFAULT_RECOVERY_RULES.reviewAfterAttempts),
  };
}

export type DuesFacts = {
  balance: number;
  overdueDays: number;
  /** The member's membership covers today. */
  memberActive: boolean;
  /** The member has an active UPI autopay mandate: a reminder may be premature. */
  hasAutopay: boolean;
  attempts: number;
  /** A promise to pay still in the future. */
  promisedOn: string | null;
  today: string;
};

/** Whether an open invoice belongs in the queue at all. */
export function duesEligible(f: { balance: number; overdueDays: number; partPaid: boolean }, rules: RecoveryRules): boolean {
  if (f.balance < rules.minBalance) return false;
  // Past due (after the grace), or part paid: a part payment shows the member means to pay the rest.
  return f.overdueDays > rules.graceDays || (f.partPaid && f.overdueDays >= 0);
}

/**
 * Priority 0–100: bigger and older balances first, an active member before one who has left (they still come in), an
 * autopay mandate later (it may collect by itself), a kept promise waits.
 */
export function duesPriority(f: DuesFacts): number {
  let p = 0;
  // Amount: ₹500 → 10, ₹5,000 → 30, ₹50,000 → 50 (log scale, capped).
  p += Math.min(50, Math.max(0, Math.round(Math.log10(Math.max(1, f.balance / 100)) * 10 - 10)));
  // Age: up to 30 for 90+ days.
  p += Math.min(30, Math.round(f.overdueDays / 3));
  if (f.memberActive) p += 15;
  if (f.hasAutopay) p -= 15;
  if (f.promisedOn && f.promisedOn >= f.today) p -= 20;
  if (f.attempts >= 5) p -= 10;
  return Math.max(0, Math.min(100, p));
}

export type RenewalFacts = {
  /** Net price of the plan that ended, paise (an opportunity, not a debt). */
  lastPrice: number;
  daysSinceEnd: number;
  /** Visits in the last 30 days of the membership. */
  recentVisits: number;
  /** Memberships the member has held: a loyal member is likelier to come back. */
  tenureMemberships: number;
  hasDues: boolean;
};

export function renewalPriority(f: RenewalFacts): number {
  let p = 0;
  p += Math.min(30, Math.max(0, Math.round(Math.log10(Math.max(1, f.lastPrice / 100)) * 8 - 8)));
  // Freshest lapses first: the first fortnight is when most come back.
  p += f.daysSinceEnd <= 7 ? 30 : f.daysSinceEnd <= 14 ? 25 : f.daysSinceEnd <= 30 ? 15 : 5;
  p += Math.min(20, f.recentVisits * 4);
  p += Math.min(15, (f.tenureMemberships - 1) * 5);
  if (f.hasDues) p -= 10;
  return Math.max(0, Math.min(100, p));
}

export type NextAction = { action: string; on: string; kind: "message" | "call" | "review" | "wait" | "renew" };

/** The recommended next step for a dues case, from its history and the rules. */
export function duesNextAction(f: DuesFacts, rules: RecoveryRules, lastAttemptOn: string | null): NextAction {
  const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  if (f.promisedOn && f.promisedOn >= f.today) return { action: "Wait for the promised payment, then check", on: f.promisedOn, kind: "wait" };
  if (f.hasAutopay && f.attempts === 0) return { action: "Check the autopay mandate before reminding", on: f.today, kind: "review" };
  const due = lastAttemptOn ? addDays(lastAttemptOn, rules.followUpEveryDays) : f.today;
  const on = due < f.today ? f.today : due;
  if (f.attempts >= rules.reviewAfterAttempts) return { action: "Review: write off, dispute or keep following up", on, kind: "review" };
  if (f.attempts >= rules.callAfterAttempts) return { action: "Call the member", on, kind: "call" };
  return { action: f.attempts === 0 ? "Send a WhatsApp reminder" : "Send another WhatsApp reminder", on, kind: "message" };
}

export function renewalNextAction(f: RenewalFacts, attempts: number, lastAttemptOn: string | null, today: string, rules: RecoveryRules): NextAction {
  const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const due = lastAttemptOn ? addDays(lastAttemptOn, rules.followUpEveryDays) : today;
  const on = due < today ? today : due;
  if (attempts >= rules.reviewAfterAttempts) return { action: "Review: close the opportunity or keep in touch", on, kind: "review" };
  if (attempts >= rules.callAfterAttempts) return { action: "Call and offer a renewal", on, kind: "call" };
  return { action: attempts === 0 ? "Send a renewal message" : "Send another renewal message", on, kind: "message" };
}

export type AgingRow = { bucket: AgingBucket; count: number; amount: number };

/** Outstanding by ageing bucket, every bucket present in the fixed order. */
export function aging(rows: { balance: number; overdueDays: number }[]): AgingRow[] {
  const out = new Map<AgingBucket, AgingRow>();
  for (const b of ["Not yet due", "1–30 days", "31–60 days", "61–90 days", "Over 90 days"] as const) out.set(b, { bucket: b, count: 0, amount: 0 });
  for (const r of rows) {
    const o = out.get(agingBucket(r.overdueDays))!;
    o.count++;
    o.amount += r.balance;
  }
  return [...out.values()];
}
