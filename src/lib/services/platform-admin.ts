import "server-only";
import { db } from "@/lib/db";
import { addDays } from "@/lib/domain/dates";
import { findPlan } from "@/lib/domain/pricing";
import { planStanding } from "@/lib/domain/saas";
import { monthRange, partnerPayouts, prevMonth, trainerOverview } from "./trainer-admin";
import { toIso, todayIso } from "./time";

// ── The FITRON team's view of the whole SaaS: every gym, its people, and what FITRON has earned (fitron-admin) ──

/** A payment that moved money: paid, and not one a test server simulated. */
const REAL = { status: "PAID", mode: { not: "DEMO" } } as const;

export type Money = { total: number; base: number; count: number };
const zero = (): Money => ({ total: 0, base: 0, count: 0 });
const add = (a: Money, b: Money): Money => ({ total: a.total + b.total, base: a.base + b.base, count: a.count + b.count });

export type Income = { plans: Money; branches: Money; services: Money; trainer: Money; all: Money };

/** What FITRON was paid (GST included in `total`, left out of `base`), by source, in a month, or in all if no month is given. */
async function incomeIn(month?: string): Promise<Income> {
  const range = month ? { paidAt: { gte: monthRange(month).start, lt: monthRange(month).end } } : {};
  const [gym, trainer] = await Promise.all([
    db.branchSubscription.groupBy({ by: ["kind"], where: { ...REAL, ...range }, _sum: { total: true, base: true }, _count: true }),
    db.trainerPayment.aggregate({ where: { ...REAL, ...range }, _sum: { total: true, base: true }, _count: true }),
  ]);
  const of = (kind: string): Money => {
    const g = gym.find((r) => r.kind === kind);
    return g ? { total: g._sum.total ?? 0, base: g._sum.base ?? 0, count: g._count } : zero();
  };
  const plans = of("PLAN");
  const branches = of("BRANCH");
  const services = of("SERVICE");
  const t: Money = { total: trainer._sum.total ?? 0, base: trainer._sum.base ?? 0, count: trainer._count };
  return { plans, branches, services, trainer: t, all: [plans, branches, services, t].reduce(add, zero()) };
}

export type GymStanding = "TRIAL" | "PAID" | "GRACE" | "LAPSED" | "CUSTOM";

export type GymRow = {
  id: string;
  name: string;
  plan: string;
  planName: string;
  cycle: string;
  standing: GymStanding;
  /** Trial's last day, paid-until day or the day it lapsed, by standing. */
  until: string | null;
  createdAt: Date;
  owner: { name: string; email: string; phone: string } | null;
  staff: number;
  members: number;
  branches: number;
  lastLoginAt: Date | null;
  /** Everything the gym has paid FITRON, GST included, in paise. */
  paid: number;
};

/** Every real gym (not a demo) with its standing on FITRON's plans, its people and what it has paid, newest first. */
async function gymRows(today: string): Promise<GymRow[]> {
  const [orgs, planPaid, staff, members, branches, owners, paid] = await Promise.all([
    db.organization.findMany({ where: { demo: false }, select: { id: true, name: true, plan: true, planCycle: true, trialEndsAt: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
    db.branchSubscription.groupBy({ by: ["orgId"], where: { kind: "PLAN", status: "PAID" }, _max: { periodEnd: true } }),
    db.user.groupBy({ by: ["orgId"], where: { active: true, deletedAt: null }, _count: true, _max: { lastLoginAt: true } }),
    db.member.groupBy({ by: ["orgId"], where: { deletedAt: null, walkIn: false }, _count: true }),
    db.branch.groupBy({ by: ["orgId"], where: { active: true }, _count: true }),
    db.user.findMany({ where: { active: true, deletedAt: null, role: { name: "Super Admin" } }, orderBy: { createdAt: "asc" }, select: { orgId: true, name: true, email: true, phone: true } }),
    db.branchSubscription.groupBy({ by: ["orgId"], where: REAL, _sum: { total: true } }),
  ]);
  const by = <T extends { orgId: string }>(rows: T[]) => new Map(rows.map((r) => [r.orgId, r]));
  const planPaidBy = by(planPaid);
  const staffBy = by(staff);
  const membersBy = by(members);
  const branchesBy = by(branches);
  const paidBy = by(paid);
  const ownerBy = new Map<string, GymRow["owner"]>();
  for (const o of owners) if (!ownerBy.has(o.orgId)) ownerBy.set(o.orgId, { name: o.name, email: o.email, phone: o.phone });
  return orgs.map((o) => {
    const until = planPaidBy.get(o.id)?._max.periodEnd;
    // The trial is stored as sign-up time + 7 days, so its last day is the day before (as the gym's own plan page works it out).
    const trialLast = o.trialEndsAt ? addDays(todayIso(o.trialEndsAt), -1) : null;
    const s = planStanding(trialLast, until ? toIso(until) : null, today);
    return {
      id: o.id,
      name: o.name,
      plan: o.plan,
      planName: findPlan(o.plan)?.name ?? o.plan,
      cycle: o.planCycle,
      standing: s.kind,
      until: s.kind === "TRIAL" || s.kind === "PAID" || s.kind === "GRACE" ? s.until : s.kind === "LAPSED" ? s.since : null,
      createdAt: o.createdAt,
      owner: ownerBy.get(o.id) ?? null,
      staff: staffBy.get(o.id)?._count ?? 0,
      members: membersBy.get(o.id)?._count ?? 0,
      branches: branchesBy.get(o.id)?._count ?? 0,
      lastLoginAt: staffBy.get(o.id)?._max.lastLoginAt ?? null,
      paid: paidBy.get(o.id)?._sum.total ?? 0,
    };
  });
}

/** The numbers at the top of the FITRON admin: gyms by state, people, and income this month, last month, and in all. */
export async function platformOverview(today = todayIso()) {
  const month = today.slice(0, 7);
  const months = [month];
  while (months.length < 6) months.push(prevMonth(months[months.length - 1]!));
  const [gyms, perMonth, all, trainer, payouts] = await Promise.all([gymRows(today), Promise.all(months.map((m) => incomeIn(m))), incomeIn(), trainerOverview(today), partnerPayouts(month)]);
  const count = (k: GymStanding) => gyms.filter((g) => g.standing === k).length;
  const monthStart = monthRange(month).start;
  const byPlan = new Map<string, { key: string; name: string; gyms: number }>();
  for (const g of gyms) byPlan.set(g.plan, { key: g.plan, name: g.planName, gyms: (byPlan.get(g.plan)?.gyms ?? 0) + 1 });
  return {
    month,
    gyms: {
      total: gyms.length,
      trial: count("TRIAL"),
      paid: count("PAID"),
      grace: count("GRACE"),
      lapsed: count("LAPSED"),
      custom: count("CUSTOM"),
      newThisMonth: gyms.filter((g) => g.createdAt >= monthStart).length,
      byPlan: [...byPlan.values()].sort((a, b) => b.gyms - a.gyms),
    },
    people: { staff: gyms.reduce((n, g) => n + g.staff, 0), members: gyms.reduce((n, g) => n + g.members, 0), branches: gyms.reduce((n, g) => n + g.branches, 0) },
    trainer: { total: trainer.total, paying: trainer.active, trial: trainer.trial },
    income: { thisMonth: perMonth[0]!, lastMonth: perMonth[1]!, all, months: months.map((m, i) => ({ month: m, ...perMonth[i]!.all })) },
    /** What FITRON owes partner gyms for this month's AI Trainer payments. */
    payoutsOwed: payouts.totals.share,
  };
}

export type GymListFilter = { q?: string; status?: GymStanding | ""; page?: number; pageSize?: number };

/** Gyms, newest first. `status` narrows by plan standing; `q` matches the gym's name or its owner's name, email or phone. */
export async function platformGyms(f: GymListFilter, today = todayIso()) {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, f.pageSize ?? 50));
  const q = f.q?.trim().toLowerCase();
  const rows = (await gymRows(today)).filter((g) => (!f.status || g.standing === f.status) && (!q || [g.name, g.owner?.name, g.owner?.email, g.owner?.phone].some((v) => v?.toLowerCase().includes(q))));
  return { total: rows.length, page, pageSize, rows: rows.slice((page - 1) * pageSize, page * pageSize) };
}
