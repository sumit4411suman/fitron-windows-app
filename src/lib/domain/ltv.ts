// Member Lifetime Value Engine: cohort, retention, renewal and tenure maths over plain membership facts
// (docs/BUSINESS-INTELLIGENCE.md, Module 2). Pure: src/lib/services/ltv.ts reads the records and calls these.

import { monthsBetween, pct } from "./metrics";

export type MembershipFact = {
  memberId: string;
  planName: string;
  start: string;
  end: string;
  /** Price after discount, paise */
  net: number;
  type: string;
  /** VALID | CANCELLED */
  status: string;
  /** Sale date (invoice date) */
  soldOn: string;
  branchId: string;
};

export type MemberFact = {
  id: string;
  /** Join date (IST calendar date the member was added) */
  joined: string;
  source: string;
  branchId: string;
  suspended: boolean;
};

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const addMonths = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + n);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, last));
  return x.toISOString().slice(0, 10);
};

/** Memberships by member, valid ones only, oldest first. */
export function byMember(ms: MembershipFact[]): Map<string, MembershipFact[]> {
  const out = new Map<string, MembershipFact[]>();
  for (const m of ms) if (m.status === "VALID") out.set(m.memberId, [...(out.get(m.memberId) ?? []), m]);
  for (const list of out.values()) list.sort((a, b) => a.start.localeCompare(b.start));
  return out;
}

/** Whether a member had a membership covering `day`. */
export const coveredOn = (list: MembershipFact[], day: string) => list.some((m) => m.start <= day && m.end >= day);

/** Tenure in months: first start to last end (today while still active), per member. */
export function tenureMonths(list: MembershipFact[], today: string): number | null {
  if (!list.length) return null;
  const first = list[0]!.start;
  const lastEnd = list.reduce((a, m) => (m.end > a ? m.end : a), list[0]!.end);
  return monthsBetween(first, lastEnd > today ? today : lastEnd);
}

export const RENEWAL_GAP_DAYS = 30;

/**
 * Renewal rate for memberships that ended in the period: renewed when the same member has another valid membership
 * starting within 30 days after the end (a gap of a month still counts as the same relationship).
 */
export function renewalRate(all: Map<string, MembershipFact[]>, period: { from: string; to: string }, today: string): { ended: number; renewed: number; rate: number | null; pending: number } {
  let ended = 0;
  let renewed = 0;
  let pending = 0;
  for (const list of all.values()) {
    for (const m of list) {
      if (m.end < period.from || m.end > period.to) continue;
      const window = addDays(m.end, RENEWAL_GAP_DAYS);
      const next = list.find((x) => x !== m && x.start > m.end && x.start <= window);
      if (next) {
        ended++;
        renewed++;
      } else if (window > today) {
        // The member may still renew: not counted either way yet.
        pending++;
      } else ended++;
    }
  }
  return { ended, renewed, rate: pct(renewed, ended), pending };
}

/** Cancellation rate: memberships cancelled ÷ memberships sold in the period (by sale date). */
export function cancellationRate(ms: MembershipFact[], period: { from: string; to: string }): { sold: number; cancelled: number; rate: number | null } {
  const sold = ms.filter((m) => m.soldOn >= period.from && m.soldOn <= period.to);
  const cancelled = sold.filter((m) => m.status === "CANCELLED").length;
  return { sold: sold.length, cancelled, rate: pct(cancelled, sold.length) };
}

export type CohortRow = {
  /** YYYY-MM the members joined */
  cohort: string;
  members: number;
  /** Retention after 1, 3, 6 and 12 months: percent still covered, or null when the cohort is too young to observe. */
  retained: Record<"m1" | "m3" | "m6" | "m12", number | null>;
  /** Net revenue so far from this cohort's memberships, paise */
  revenue: number;
  revenuePerMember: number;
  /** Average tenure so far, months */
  avgTenure: number | null;
};

export const RETENTION_POINTS = { m1: 1, m3: 3, m6: 6, m12: 12 } as const;

/** Retention by signup month: of those who joined in the month, who still held a membership N months after joining. */
export function cohorts(members: MemberFact[], ms: Map<string, MembershipFact[]>, today: string, months = 12): CohortRow[] {
  const out = new Map<string, MemberFact[]>();
  const cut = addMonths(`${today.slice(0, 7)}-01`, -(months - 1));
  for (const m of members) {
    if (m.joined < cut) continue;
    const k = m.joined.slice(0, 7);
    out.set(k, [...(out.get(k) ?? []), m]);
  }
  return [...out.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cohort, list]) => {
      const retained = {} as CohortRow["retained"];
      for (const [key, n] of Object.entries(RETENTION_POINTS) as [keyof typeof RETENTION_POINTS, number][]) {
        // Observable only once every member of the cohort has reached the point.
        const latestJoin = list.reduce((a, m) => (m.joined > a ? m.joined : a), list[0]!.joined);
        if (addMonths(latestJoin, n) > today) {
          retained[key] = null;
          continue;
        }
        const kept = list.filter((m) => coveredOn(ms.get(m.id) ?? [], addMonths(m.joined, n))).length;
        retained[key] = pct(kept, list.length);
      }
      const revenue = list.reduce((s, m) => s + (ms.get(m.id) ?? []).reduce((t, x) => t + x.net, 0), 0);
      const tenures = list.map((m) => tenureMonths(ms.get(m.id) ?? [], today)).filter((t): t is number => t !== null);
      return { cohort, members: list.length, retained, revenue, revenuePerMember: Math.round(revenue / list.length), avgTenure: tenures.length ? Math.round((tenures.reduce((s, t) => s + t, 0) / tenures.length) * 10) / 10 : null };
    });
}

export type SegmentRow = { key: string; members: number; revenue: number; revenuePerMember: number; avgTenure: number | null; active: number };

/** Member value by a grouping (plan, source, branch): revenue, revenue per member, tenure, how many are active today. */
export function segments(members: MemberFact[], ms: Map<string, MembershipFact[]>, today: string, keyOf: (m: MemberFact, list: MembershipFact[]) => string | null): SegmentRow[] {
  const out = new Map<string, { members: number; revenue: number; tenures: number[]; active: number }>();
  for (const m of members) {
    const list = ms.get(m.id) ?? [];
    const key = keyOf(m, list);
    if (!key) continue;
    const s = out.get(key) ?? { members: 0, revenue: 0, tenures: [], active: 0 };
    s.members++;
    s.revenue += list.reduce((t, x) => t + x.net, 0);
    const t = tenureMonths(list, today);
    if (t !== null) s.tenures.push(t);
    if (!m.suspended && coveredOn(list, today)) s.active++;
    out.set(key, s);
  }
  return [...out.entries()]
    .map(([key, s]) => ({ key, members: s.members, revenue: s.revenue, revenuePerMember: Math.round(s.revenue / s.members), avgTenure: s.tenures.length ? Math.round((s.tenures.reduce((a, b) => a + b, 0) / s.tenures.length) * 10) / 10 : null, active: s.active }))
    .sort((a, b) => b.revenue - a.revenue);
}

/** Members lost over the last `months` months: covered at the start of the window, not covered today. */
export function churnWindow(ms: Map<string, MembershipFact[]>, today: string, months: number): { start: number; lost: number } {
  const from = addMonths(today, -months);
  let start = 0;
  let lost = 0;
  for (const list of ms.values()) {
    if (!coveredOn(list, from)) continue;
    start++;
    if (!coveredOn(list, today)) lost++;
  }
  return { start, lost };
}
