import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { addDays, daysBetween } from "@/lib/domain/dates";
import { byMember, cancellationRate, coveredOn, renewalRate, type MemberFact, type MembershipFact } from "@/lib/domain/ltv";
import { metric, pct, cac as cacOf, type MetricResult, type Period } from "@/lib/domain/metrics";
import { profitAndLoss } from "./accounting";
import { fromIso, todayIso, toIso } from "./time";

// The shared analytics layer every Business Intelligence module reads through (docs/BUSINESS-INTELLIGENCE.md §4).
// One place turns the gym's records into membership facts and period figures, limited to the branches the caller may
// see, so Revenue Recovery, Lifetime Value, the simulators, the Growth Engine and Benchmarking never disagree about a
// number. Everything here only reads.

/** What a calculation needs to know about who is asking: the gym and the branches in view. */
export type Scope = Pick<CurrentUser, "orgId" | "branchIds">;

/**
 * A scope for the daily jobs, which run for a gym rather than a person: every branch, no permissions. Services that
 * take a CurrentUser only read orgId and branchIds from it on the read paths used here.
 */
export async function systemScope(orgId: string): Promise<CurrentUser> {
  const branches = await db.branch.findMany({ where: { orgId }, select: { id: true, name: true, active: true } });
  return {
    id: "",
    name: "FITRON",
    email: "",
    photoKey: null,
    orgId,
    orgName: "",
    role: "System",
    perms: new Set(),
    branches,
    branch: "ALL",
    branchIds: branches.map((b) => b.id),
    can: () => false,
    planBlocked: false,
    plan: { key: "system", name: "System", custom: true },
    has: () => true,
  };
}

/** One branch of a scope, for branch-by-branch comparisons. */
export const branchScope = (u: CurrentUser, branchId: string): CurrentUser => ({ ...u, branch: branchId, branchIds: [branchId] });

export type MembershipFacts = { members: MemberFact[]; memberships: MembershipFact[]; byMember: Map<string, MembershipFact[]> };

/** Every member (not walk-in, not deleted) of the branches in view, with all their memberships (valid and cancelled). */
export async function membershipFacts(s: Scope): Promise<MembershipFacts> {
  const members = await db.member.findMany({ where: { orgId: s.orgId, branchId: { in: s.branchIds }, deletedAt: null, walkIn: false }, select: { id: true, createdAt: true, source: true, branchId: true, suspended: true } });
  const rows = await db.membership.findMany({
    where: { memberId: { in: members.map((m) => m.id) } },
    select: { memberId: true, type: true, status: true, startDate: true, endDate: true, price: true, discount: true, branchId: true, plan: { select: { name: true } }, invoice: { select: { date: true } } },
  });
  const memberships: MembershipFact[] = rows.map((r) => ({ memberId: r.memberId, planName: r.plan.name, start: toIso(r.startDate), end: toIso(r.endDate), net: r.price - r.discount, type: r.type, status: r.status, soldOn: toIso(r.invoice.date), branchId: r.branchId }));
  const facts: MemberFact[] = members.map((m) => ({ id: m.id, joined: todayIso(m.createdAt), source: m.source, branchId: m.branchId, suspended: m.suspended }));
  return { members: facts, memberships, byMember: byMember(memberships) };
}

/** Members (not suspended) covered by a membership on `day`. */
export function activeOn(f: MembershipFacts, day: string): number {
  let n = 0;
  for (const m of f.members) if (!m.suspended && coveredOn(f.byMember.get(m.id) ?? [], day)) n++;
  return n;
}

/** Months between the first membership start and today: how much history the gym has. */
export function monthsOfHistory(f: MembershipFacts, today = todayIso()): number {
  const first = f.memberships.reduce<string | null>((a, m) => (!a || m.start < a ? m.start : a), null);
  return first ? Math.floor(daysBetween(today, first) / 30.44) : 0;
}

/** The period of the same length just before `p`. */
export function previousPeriod(p: Period): Period {
  const days = daysBetween(p.to, p.from) + 1;
  return { from: addDays(p.from, -days), to: addDays(p.from, -1) };
}

export type BusinessSnapshot = {
  period: Period;
  revenue: number;
  /** Operating expenses incl. depreciation and disposal losses, as Month overview shows them */
  expenses: number;
  net: number;
  marginPct: number | null;
  expenseRatioPct: number | null;
  expenseGroups: { group: string; amount: number }[];
  collected: number;
  activeMembersStart: number;
  activeMembers: number;
  newMembers: number;
  renewal: { ended: number; renewed: number; rate: number | null; pending: number };
  cancellation: { sold: number; cancelled: number; rate: number | null };
  revenuePerActive: number | null;
  marketingSpend: number;
  cac: number | null;
  cacWarnings: string[];
  monthsOfHistory: number;
  /** Whether enough happened in the period for the rates to mean anything */
  warnings: string[];
};

/** The figures of one period for the branches in view, every one from the records (Profit & loss, memberships, members). */
export async function snapshot(u: CurrentUser, p: Period, facts?: MembershipFacts, today = todayIso()): Promise<BusinessSnapshot> {
  const f = facts ?? (await membershipFacts(u));
  const pl = await profitAndLoss(u, p);
  const expenses = pl.totalExpenses + pl.depreciation + pl.disposalLoss;
  const net = pl.net;
  const activeMembers = activeOn(f, p.to > today ? today : p.to);
  const activeMembersStart = activeOn(f, addDays(p.from, -1));
  const newMembers = f.members.filter((m) => m.joined >= p.from && m.joined <= p.to).length;
  const renewal = renewalRate(f.byMember, p, today);
  const cancellation = cancellationRate(f.memberships, p);
  const marketingSpend = pl.expenseGroups.find((g) => g.key === "Marketing")?.amount ?? 0;
  const c = cacOf(marketingSpend, newMembers);
  const warnings: string[] = [];
  if (renewal.ended < 10) warnings.push(`Only ${renewal.ended} memberships ended in this period: the renewal rate is not yet a trend.`);
  if (renewal.pending) warnings.push(`${renewal.pending} memberships ended recently enough that the member may still renew; they are not counted either way.`);
  return {
    period: p,
    revenue: pl.totalRevenue,
    expenses,
    net,
    marginPct: pct(net, pl.totalRevenue),
    expenseRatioPct: pct(expenses, pl.totalRevenue),
    expenseGroups: pl.expenseGroups.map((g) => ({ group: g.key, amount: g.amount })),
    collected: pl.collected,
    activeMembersStart,
    activeMembers,
    newMembers,
    renewal,
    cancellation,
    revenuePerActive: activeMembers > 0 ? Math.round(pl.totalRevenue / activeMembers) : null,
    marketingSpend,
    cac: c.value,
    cacWarnings: c.warnings,
    monthsOfHistory: monthsOfHistory(f, today),
    warnings,
  };
}

/** The snapshot's headline figures as MetricResults, with the definitions attached, for screens and the AI tools. */
export function snapshotMetrics(s: BusinessSnapshot): MetricResult[] {
  const p = s.period;
  return [
    metric("fin.revenue", s.revenue, p),
    metric("fin.expenses", s.expenses, p),
    metric("fin.net", s.net, p),
    metric("fin.margin", s.marginPct, p),
    metric("fin.expenseRatio", s.expenseRatioPct, p),
    metric("bench.activeMembers", s.activeMembers, p),
    metric("bench.revenuePerActive", s.revenuePerActive, p),
    metric("ltv.renewalRate", s.renewal.rate, p, { warnings: s.warnings }),
    metric("ltv.cancellation", s.cancellation.rate, p),
    metric("ltv.cac", s.cac, p, { warnings: s.cacWarnings }),
  ];
}

/** "2026-10" → its first and last day. */
export const monthPeriodOf = (ym: string): Period => {
  const [y, m] = ym.split("-").map(Number);
  return { from: `${ym}-01`, to: new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10) };
};

/** Members with open balances, per member, for the branches in view (used by Recovery and the AI tools). */
export async function openInvoicesInScope(s: Scope) {
  return db.invoice.findMany({
    where: { orgId: s.orgId, branchId: { in: s.branchIds }, status: "ISSUED" },
    select: { id: true, number: true, memberId: true, branchId: true, total: true, dueDate: true, date: true, payments: { select: { amount: true, status: true, date: true } }, member: { select: { id: true, name: true, phone: true, code: true, suspended: true, walkIn: true, erasedAt: true } } },
  });
}

export { fromIso };
