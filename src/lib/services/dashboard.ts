import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { addDays, daysBetween } from "@/lib/domain/dates";
import { monthEnd, monthsBack, periodRange, type PeriodKey } from "@/lib/domain/periods";
import { memberScope } from "./members";
import { frozenTodayIds } from "./freeze";
import { listReceivables } from "./billing";
import { profitAndLoss } from "./accounting";
import { fromIso, todayIso, toIso } from "./time";

type Range = { from: string; to: string };

const between = (r: Range) => ({ gte: fromIso(r.from), lte: fromIso(r.to) });
const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
/** The IST calendar date of a timestamp. */
const istDate = (d: Date) => todayIso(d);

export type DashMember = {
  id: string;
  name: string;
  code: string;
  phone: string;
  branchId: string;
  planName: string | null;
  daysLeft: number | null;
  /** A membership covers today. A member whose plan starts later isn't active yet. */
  current: boolean;
  /** Price after discount of the latest membership, the renewal value. */
  curFinal: number;
  curMonths: number;
  joined: string;
  suspended: boolean;
  dob: string | null;
  trainerId: string | null;
  workoutPlanId: string | null;
  dietPlanId: string | null;
  riskScore: number | null;
  riskReasons: string[];
};

/** Members with their latest membership, computed the way the prototype derives them. */
async function loadMembers(u: CurrentUser, today: string) {
  // Trainers see their own members; everyone else counts the whole branch, including the accountant, who can't open member profiles.
  const scope = u.can("members.view") ? memberScope(u) : { orgId: u.orgId, branchId: { in: u.branchIds }, deletedAt: null };
  const members = await db.member.findMany({
    where: { ...scope, walkIn: false },
    select: {
      id: true, name: true, code: true, phone: true, branchId: true, createdAt: true, suspended: true, dob: true,
      trainerId: true, workoutPlanId: true, dietPlanId: true, riskScore: true, riskReasons: true,
    },
  });
  const rows0 = await db.membership.findMany({
    where: { memberId: { in: members.map((m) => m.id) }, status: "VALID" },
    select: { memberId: true, type: true, startDate: true, endDate: true, price: true, discount: true, branchId: true, plan: { select: { name: true, months: true } }, invoice: { select: { date: true } } },
    orderBy: { startDate: "asc" },
  });
  // Sale date: the invoice date. Selling in Fitron dates the invoice today; a migrated row carries the old sale date.
  // The start date can be weeks away (a backdated or future-dated plan), which is why "sold this month" doesn't use it.
  const memberships = rows0.map(({ invoice, ...x }) => ({ ...x, soldOn: toIso(invoice.date) }));
  const byMember = new Map<string, typeof memberships>();
  for (const ms of memberships) byMember.set(ms.memberId, [...(byMember.get(ms.memberId) ?? []), ms]);
  const rows: DashMember[] = members.map((m) => {
    const list = byMember.get(m.id) ?? [];
    const latest = list.reduce<(typeof list)[number] | null>((a, b) => (!a || b.endDate >= a.endDate ? b : a), null);
    const covering = list.find((x) => toIso(x.startDate) <= today && toIso(x.endDate) >= today);
    const plan = (covering ?? latest)?.plan;
    return {
      id: m.id,
      name: m.name,
      code: m.code,
      phone: m.phone,
      branchId: m.branchId,
      planName: plan?.name ?? null,
      daysLeft: latest ? daysBetween(toIso(latest.endDate), today) : null,
      current: !!covering,
      curFinal: latest ? latest.price - latest.discount : 0,
      curMonths: latest?.plan.months || 1,
      // Join date: when the member was added to Fitron (IST), not the first plan's start, which may be backdated.
      joined: istDate(m.createdAt),
      suspended: m.suspended,
      dob: m.dob ? toIso(m.dob) : null,
      trainerId: m.trainerId,
      workoutPlanId: m.workoutPlanId,
      dietPlanId: m.dietPlanId,
      riskScore: m.riskScore,
      riskReasons: m.riskReasons,
    };
  });
  return { rows, memberships };
}

/** Active: a membership covers today and the member isn't suspended. A plan that starts next week doesn't count yet. */
const isActive = (m: DashMember) => m.current && !m.suspended;

const riskLevel = (score: number | null) => (score === null ? null : score >= 60 ? "High risk" : score >= 40 ? "Medium risk" : null);

/** Everything the dashboard shows, for the picked branch(es) and period. */
export async function dashboardData(u: CurrentUser, period: PeriodKey, custom: { from?: string; to?: string } = {}) {
  const today = todayIso();
  const range = periodRange(period, today, custom.from, custom.to);
  const fin = u.can("accounting.view");
  const seesMoney = u.can("invoices.view");
  const branch = { orgId: u.orgId, branchId: { in: u.branchIds } };

  // Same days of last month, for the "+12%" chips (prototype: only on This month). Clamped to the end of that
  // month: on the 31st there is no "31 Feb", so the comparison runs to its last day instead.
  const last = periodRange("last", today);
  const sameTo = addDays(last.from, Number(today.slice(8, 10)) - 1);
  const sameLast: Range = { from: last.from, to: sameTo > last.to ? last.to : sameTo };
  const months = monthsBack(today);
  const year: Range = { from: `${months[0]}-01`, to: today };

  const [{ rows: M, memberships }, recv, payRange, payToday, paySameLast, pl, plSameLast, items12, exp12, planItems] = await Promise.all([
    loadMembers(u, today),
    seesMoney ? listReceivables(u) : null,
    seesMoney ? db.payment.findMany({ where: { ...branch, status: "SUCCESS", date: between(range) }, select: { amount: true, method: true, branchId: true } }) : [],
    seesMoney ? db.payment.aggregate({ where: { ...branch, status: "SUCCESS", date: fromIso(today) }, _sum: { amount: true }, _count: true }) : null,
    seesMoney ? db.payment.aggregate({ where: { ...branch, status: "SUCCESS", date: between(sameLast) }, _sum: { amount: true } }) : null,
    fin ? profitAndLoss(u, range) : null,
    fin && period === "month" ? profitAndLoss(u, sameLast) : null,
    fin
      ? db.invoiceItem.findMany({ where: { invoice: { ...branch, status: "ISSUED", date: between(year) } }, select: { amount: true, invoice: { select: { date: true } } } })
      : [],
    fin ? db.expense.findMany({ where: { ...branch, status: "ACTIVE", capital: false, date: between(year) }, select: { amount: true, date: true, branchId: true } }) : [],
    db.invoiceItem.findMany({
      where: { planId: { not: null }, invoice: { ...branch, status: "ISSUED", date: between(range) } },
      select: { amount: true, planId: true },
    }),
  ]);

  const active = M.filter(isActive);
  const exp7 = M.filter((m) => m.daysLeft !== null && m.daysLeft >= 0 && m.daysLeft <= 7);
  const expired = M.filter((m) => m.daysLeft !== null && m.daysLeft < 0);
  const open = recv?.list ?? [];
  const inRange = (d: string) => d >= range.from && d <= range.to;
  const inSameLast = (d: string) => d >= sameLast.from && d <= sameLast.to;
  // A first plan (sold here or migrated) is a new membership; a renewal, by hand or by autopay, is a renewal.
  const isNew = (x: { type: string }) => x.type === "NEW" || x.type === "IMPORT";
  const isRenewal = (x: { type: string }) => x.type === "RENEWAL" || x.type === "AUTOPAY";
  const msRange = memberships.filter((x) => inRange(x.soldOn));
  const msSameLast = memberships.filter((x) => inSameLast(x.soldOn));
  const newMs = msRange.filter(isNew);
  const renMs = msRange.filter(isRenewal);
  const collected = sum(payRange, (p) => p.amount);
  const delta = (now: number, prev: number | undefined) => {
    if (period !== "month" || !prev) return null;
    const d = Math.round(((now - prev) / prev) * 100);
    return { text: `${d > 0 ? "+" : ""}${d}%`, good: d >= 0 };
  };

  // Last 12 months: revenue, expenses, net, new and renewal memberships, active members at month end.
  const series = months.map((k) => {
    const r = sum(items12.filter((i) => toIso(i.invoice.date).startsWith(k)), (i) => i.amount);
    const e = sum(exp12.filter((x) => toIso(x.date).startsWith(k)), (x) => x.amount);
    const me = monthEnd(k) > today ? today : monthEnd(k);
    const sold = memberships.filter((x) => x.soldOn.startsWith(k));
    return {
      month: k,
      revenue: r,
      expenses: e,
      net: r - e,
      newCount: sold.filter(isNew).length,
      renewCount: sold.filter(isRenewal).length,
      active: new Set(memberships.filter((x) => toIso(x.startDate) <= me && toIso(x.endDate) >= me).map((x) => x.memberId)).size,
    };
  });

  // Plan distribution: active members per plan, and revenue per plan in the period.
  const plans = await db.membershipPlan.findMany({ where: { id: { in: [...new Set(planItems.map((i) => i.planId!))] } }, select: { id: true, name: true } });
  const planName = new Map(plans.map((p) => [p.id, p.name]));
  const byPlan = new Map<string, { members: number; revenue: number }>();
  for (const m of active) if (m.planName) byPlan.set(m.planName, { members: (byPlan.get(m.planName)?.members ?? 0) + 1, revenue: 0 });
  for (const i of planItems) {
    const n = planName.get(i.planId!);
    if (n && byPlan.has(n)) byPlan.get(n)!.revenue += i.amount;
  }

  const methods = new Map<string, number>();
  for (const p of payRange) methods.set(p.method, (methods.get(p.method) ?? 0) + p.amount);

  const risk = M.filter((m) => riskLevel(m.riskScore))
    .sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0))
    .slice(0, 5)
    .map((m) => ({ id: m.id, name: m.name, sub: m.riskReasons.slice(0, 2).join(" · "), level: riskLevel(m.riskScore)! }));

  return {
    today,
    range,
    fin,
    seesMoney,
    hero: {
      active: active.length,
      total: M.length,
      expired: expired.length,
      revenue: pl?.totalRevenue ?? 0,
      revenueDelta: delta(pl?.totalRevenue ?? 0, plSameLast?.totalRevenue),
      collected,
      collectedCount: payRange.length,
      collectedDelta: delta(collected, paySameLast?._sum.amount ?? undefined),
      outstanding: recv?.total ?? 0,
      openCount: open.length,
      overdueCount: open.filter((i) => i.overdueDays > 0).length,
      exp7: exp7.length,
      exp7Value: sum(exp7, (m) => m.curFinal),
    },
    kpis: {
      newMembers: M.filter((m) => inRange(m.joined)).length,
      newMembersLast: M.filter((m) => inSameLast(m.joined)).length,
      todayCollected: payToday?._sum.amount ?? 0,
      todayCount: payToday?._count ?? 0,
      expenses: pl?.totalExpenses ?? 0,
      net: pl?.net ?? 0,
      mrr: Math.round(sum(active, (m) => m.curFinal / m.curMonths)),
      newMemberships: newMs.length,
      newMembershipsValue: sum(newMs, (x) => x.price - x.discount),
      newMembershipsLast: msSameLast.filter(isNew).length,
      renewals: renMs.length,
      renewalsValue: sum(renMs, (x) => x.price - x.discount),
      renewalsLast: msSameLast.filter(isRenewal).length,
      /** Which date the counts above use, for the cards' labels. */
      joinedBy: "join date",
      soldBy: "sale date",
      pending: open.length,
      expired: expired.length,
    },
    series,
    plans: [...byPlan.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.members - a.members),
    methods: [...methods.entries()].map(([method, amount]) => ({ method, amount })).sort((a, b) => b.amount - a.amount),
    outstanding: [...open]
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 6)
      .map((i) => ({ memberId: i.member.id, name: i.member.name, number: i.number, overdueDays: i.overdueDays, due: toIso(i.dueDate), balance: i.balance })),
    expiring: [...exp7].sort((a, b) => a.daysLeft! - b.daysLeft!).slice(0, 6),
    risk,
    branches: u.branch === "ALL" && u.branches.length > 1 ? await branchComparison(u, range, today, M, recv?.list ?? null) : null,
    frontDesk: u.role === "Receptionist" ? await frontDesk(u, today, M, open) : null,
    trainer: u.role === "Trainer" ? await trainerView(u, today, M) : null,
  };
}

export type Dashboard = Awaited<ReturnType<typeof dashboardData>>;

/** "All branches": one row per branch, as in the prototype. */
async function branchComparison(
  u: CurrentUser,
  range: Range,
  today: string,
  M: DashMember[],
  recvList: { branchId: string; balance: number }[] | null,
) {
  const [checkins, expenses, payments, open] = await Promise.all([
    db.attendance.groupBy({ by: ["branchId"], where: { branchId: { in: u.branchIds }, date: fromIso(today) }, _count: true }),
    db.expense.groupBy({ by: ["branchId"], where: { orgId: u.orgId, branchId: { in: u.branchIds }, status: "ACTIVE", capital: false, date: between(range) }, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["branchId"], where: { orgId: u.orgId, branchId: { in: u.branchIds }, status: "SUCCESS", date: between(range) }, _sum: { amount: true } }),
    recvList ? Promise.resolve(recvList) : listReceivables(u).then((r) => r.list),
  ]);
  return u.branches.filter((b) => b.active).map((b) => {
    const mine = M.filter((m) => m.branchId === b.id);
    const col = payments.find((p) => p.branchId === b.id)?._sum.amount ?? 0;
    const ex = expenses.find((e) => e.branchId === b.id)?._sum.amount ?? 0;
    return {
      id: b.id,
      name: b.name,
      active: mine.filter(isActive).length,
      total: mine.length,
      today: checkins.find((c) => c.branchId === b.id)?._count ?? 0,
      exp7: mine.filter((m) => m.daysLeft !== null && m.daysLeft >= 0 && m.daysLeft <= 7).length,
      collected: col,
      expenses: ex,
      net: col - ex,
      due: sum(open.filter((i) => i.branchId === b.id), (i) => i.balance),
    };
  });
}

/** The front desk's cards (prototype roleDash, Receptionist). */
async function frontDesk(u: CurrentUser, today: string, M: DashMember[], open: { dueDate: Date; balance: number }[]) {
  const [att, followUps, bookings, frozenIds] = await Promise.all([
    db.attendance.findMany({ where: { branchId: { in: u.branchIds }, date: fromIso(today) }, select: { checkOut: true } }),
    db.lead.count({ where: { orgId: u.orgId, branchId: { in: u.branchIds }, stage: { notIn: ["Won", "Lost"] }, followUpOn: { lte: fromIso(today) } } }),
    db.booking.count({ where: { date: fromIso(today), status: { not: "Cancelled" }, classSlot: { orgId: u.orgId, branchId: { in: u.branchIds } } } }),
    frozenTodayIds(M.map((m) => m.id), today),
  ]);
  return {
    checkins: att.length,
    inside: att.filter((a) => !a.checkOut).length,
    paymentsDue: open.filter((i) => toIso(i.dueDate) <= today).length,
    newToday: M.filter((m) => m.joined === today).length,
    followUps,
    bookings,
    frozen: frozenIds.size,
    birthdays: M.filter((m) => m.dob?.slice(5) === today.slice(5)).length,
  };
}

/** A trainer's own members (prototype roleDash, Trainer). */
async function trainerView(u: CurrentUser, today: string, M: DashMember[]) {
  const mine = M.filter((m) => m.trainerId === u.id);
  const ids = new Set(mine.map((m) => m.id));
  const [att, bookings] = await Promise.all([
    db.attendance.findMany({ where: { branchId: { in: u.branchIds }, date: fromIso(today), memberId: { in: [...ids] } }, select: { memberId: true } }),
    db.booking.count({ where: { date: fromIso(today), status: { not: "Cancelled" }, classSlot: { orgId: u.orgId, branchId: { in: u.branchIds }, trainerId: u.id } } }),
  ]);
  return {
    mine: mine.length,
    trainedToday: new Set(att.map((a) => a.memberId)).size,
    bookings,
    expiring: mine.filter((m) => m.daysLeft !== null && m.daysLeft >= 0 && m.daysLeft <= 7).length,
    onWorkout: mine.filter((m) => m.workoutPlanId).length,
    onDiet: mine.filter((m) => m.dietPlanId).length,
    highRisk: mine.filter((m) => (m.riskScore ?? 0) >= 60).length,
  };
}
