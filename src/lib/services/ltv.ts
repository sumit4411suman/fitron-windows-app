import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { addMonths } from "@/lib/domain/dates";
import { churnWindow, cohorts, segments, tenureMonths, type MembershipFact } from "@/lib/domain/ltv";
import { avgPaise, ltvEstimate, metric, monthlyChurnPct, type MetricResult, type Period } from "@/lib/domain/metrics";
import { activeOn, membershipFacts, monthsOfHistory, snapshot, type MembershipFacts } from "./analytics";
import { UserError } from "./errors";
import { fromIso, todayIso, toIso } from "./time";

// Member Lifetime Value Engine (docs/BUSINESS-INTELLIGENCE.md, Module 2): reproducible figures from the gym's own
// memberships and invoices, with every estimate labelled and refused when the data cannot carry it.

export type LtvFilters = { plan?: string; source?: string };

const applyFilters = (f: MembershipFacts, filters: LtvFilters): MembershipFacts => {
  if (!filters.plan && !filters.source) return f;
  const members = f.members.filter((m) => {
    if (filters.source && m.source !== filters.source) return false;
    if (filters.plan) {
      const list = f.byMember.get(m.id) ?? [];
      // The member's current or latest plan.
      const latest = list[list.length - 1];
      if (!latest || latest.planName !== filters.plan) return false;
    }
    return true;
  });
  const ids = new Set(members.map((m) => m.id));
  const memberships = f.memberships.filter((x) => ids.has(x.memberId));
  const byMember = new Map([...f.byMember.entries()].filter(([id]) => ids.has(id)));
  return { members, memberships, byMember };
};

export type LtvReport = Awaited<ReturnType<typeof ltvReport>>;

/** The whole engine for a period and cohort filter: metrics with definitions, cohorts, segments and the estimate's basis. */
export async function ltvReport(u: CurrentUser, period: Period, filters: LtvFilters = {}, today = todayIso()) {
  const all = await membershipFacts(u);
  const f = applyFilters(all, filters);
  const snap = await snapshot(u, period, f, today);
  // Historical revenue per member: net invoice lines of each member's issued invoices (memberships and everything else),
  // all time; and the same lines dated in the period, which is the filtered view's revenue.
  const items = await db.invoiceItem.findMany({ where: { invoice: { orgId: u.orgId, branchId: { in: u.branchIds }, status: "ISSUED", memberId: { in: f.members.map((m) => m.id) } } }, select: { amount: true, invoice: { select: { memberId: true, date: true } } } });
  const revenueBy = new Map<string, number>();
  let periodRevenue = 0;
  for (const it of items) {
    revenueBy.set(it.invoice.memberId, (revenueBy.get(it.invoice.memberId) ?? 0) + it.amount);
    const d = toIso(it.invoice.date);
    if (d >= period.from && d <= period.to) periodRevenue += it.amount;
  }
  const withPlan = f.members.filter((m) => (f.byMember.get(m.id) ?? []).length);
  const revenuePerMember = avgPaise(withPlan.map((m) => revenueBy.get(m.id) ?? 0));
  const tenures = withPlan.map((m) => tenureMonths(f.byMember.get(m.id) ?? [], today)).filter((t): t is number => t !== null);
  const avgTenure = tenures.length ? Math.round((tenures.reduce((s, t) => s + t, 0) / tenures.length) * 10) / 10 : null;
  // Churn over the last six months for the estimate.
  const months = 6;
  const cw = churnWindow(f.byMember, today, months);
  const churn = monthlyChurnPct(cw.start, cw.lost, months);
  // Revenue per active member per month: the period's revenue over its active members, per month of the period.
  const periodMonths = Math.max(1, Math.round(((fromIso(period.to).getTime() - fromIso(period.from).getTime()) / 86_400_000 + 1) / 30.44));
  const monthlyPerActive = snap.activeMembers > 0 ? Math.round(periodRevenue / snap.activeMembers / periodMonths) : null;
  const history = monthsOfHistory(f, today);
  const est = ltvEstimate({ avgMonthlyRevenuePerActive: monthlyPerActive, monthlyChurnPct: churn, members: withPlan.length, monthsOfHistory: history });
  const ratio = est.value !== null && snap.cac !== null && snap.cac > 0 ? Math.round((est.value / snap.cac) * 10) / 10 : null;
  const metrics: MetricResult[] = [
    metric("ltv.revenue", revenuePerMember, period, { warnings: withPlan.length ? [] : ["No member in this view has held a membership."] }),
    metric("ltv.tenure", avgTenure, period),
    metric("ltv.renewalRate", snap.renewal.rate, period, { warnings: snap.warnings }),
    metric("ltv.cancellation", snap.cancellation.rate, period),
    metric("ltv.arpm", snap.activeMembers > 0 ? Math.round(periodRevenue / activeAny(f, period)) : null, period),
    metric("ltv.cac", snap.cac, period, { warnings: snap.cacWarnings }),
    metric("ltv.estimate", est.value, period, { warnings: est.warnings }),
    metric("ltv.ratio", ratio, period, { warnings: ratio === null ? ["Needs both a lifetime value estimate and an acquisition cost."] : [] }),
  ];
  const plans = [...new Set(all.memberships.map((m) => m.planName))].sort();
  const sources = [...new Set(all.members.map((m) => m.source))].sort();
  const byPlan = segments(f.members, f.byMember, today, (_, list) => list[list.length - 1]?.planName ?? null);
  const bySource = segments(f.members, f.byMember, today, (m) => m.source || "Unknown");
  const branchName = new Map(u.branches.map((b) => [b.id, b.name]));
  const byBranch = segments(f.members, f.byMember, today, (m) => branchName.get(m.branchId) ?? null);
  return {
    period,
    filters,
    metrics,
    members: f.members.length,
    withMembership: withPlan.length,
    activeMembers: snap.activeMembers,
    newMembers: snap.newMembers,
    renewal: snap.renewal,
    cancellation: snap.cancellation,
    /** Net invoice revenue of the members in this view, dated in the period (the Profit & loss figure when unfiltered). */
    revenue: periodRevenue,
    estimate: { value: est.value, warnings: est.warnings, basis: { monthlyRevenuePerActive: monthlyPerActive, monthlyChurnPct: churn, churnWindowMonths: months, membersAtStart: cw.start, membersLost: cw.lost, monthsOfHistory: history } },
    cohorts: cohorts(f.members, f.byMember, today, 12),
    byPlan,
    bySource,
    byBranch: u.branchIds.length > 1 ? byBranch : [],
    options: { plans, sources },
    completeness: completeness(f, all),
  };
}

/** Members who held a membership covering any day of the period (the ARPM denominator). */
function activeAny(f: MembershipFacts, p: Period): number {
  let n = 0;
  for (const m of f.members) if ((f.byMember.get(m.id) ?? []).some((x) => x.start <= p.to && x.end >= p.from)) n++;
  return Math.max(1, n);
}

/** What the data can and cannot say. */
function completeness(f: MembershipFacts, all: MembershipFacts) {
  const noSource = all.members.filter((m) => !m.source || m.source === "Unknown" || m.source === "Other").length;
  const imported = all.memberships.filter((m) => m.type === "IMPORT").length;
  const notes: string[] = [];
  if (noSource) notes.push(`${noSource} of ${all.members.length} members have no acquisition source recorded, so the source comparison leaves them out.`);
  if (imported) notes.push(`${imported} memberships were imported from before FITRON; their sale dates are the old dates where known.`);
  if (!f.memberships.length) notes.push("No memberships in this view yet.");
  notes.push("Revenue is net of discounts and before GST; cancelled invoices and reversed payments are already out. It is revenue, not profit.");
  return notes;
}

/** Members in one segment (plan, source or branch): the authorised, member-level drill-down behind an aggregate. */
export async function segmentMembers(u: CurrentUser, by: "plan" | "source" | "branch", key: string, today = todayIso()) {
  if (!u.can("members.view")) throw new UserError("Your role can't see member lists.");
  const f = await membershipFacts(u);
  const branchName = new Map(u.branches.map((b) => [b.id, b.name]));
  const keyOf = (m: MembershipFacts["members"][number], list: MembershipFact[]) => (by === "plan" ? (list[list.length - 1]?.planName ?? null) : by === "source" ? m.source || "Unknown" : (branchName.get(m.branchId) ?? null));
  const ids = f.members.filter((m) => keyOf(m, f.byMember.get(m.id) ?? []) === key).map((m) => m.id);
  const rows = await db.member.findMany({ where: { id: { in: ids.slice(0, 500) }, ...(u.can("members.all") ? {} : { trainerId: u.id }) }, select: { id: true, name: true, code: true, phone: true, createdAt: true }, orderBy: { name: "asc" } });
  return rows.map((m) => {
    const list = f.byMember.get(m.id) ?? [];
    return { ...m, joined: todayIso(m.createdAt), tenure: tenureMonths(list, today), active: list.some((x) => x.start <= today && x.end >= today), revenue: list.reduce((s, x) => s + x.net, 0) };
  });
}

/** Active members at the end of each of the last `n` months, for the trend line. */
export function activeTrend(f: MembershipFacts, today = todayIso(), n = 12) {
  const out: { month: string; active: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const ym = addMonths(`${today.slice(0, 7)}-01`, -i).slice(0, 7);
    const [y, m] = ym.split("-").map(Number);
    const end = toIso(new Date(Date.UTC(y!, m!, 0)));
    out.push({ month: ym, active: activeOn(f, end > today ? today : end) });
  }
  return out;
}
