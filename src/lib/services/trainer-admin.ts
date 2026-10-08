import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { findPlan, PARTNER_SHARE } from "@/lib/domain/pricing";
import { trainerAccess } from "@/lib/domain/trainer";
import { trainerPaymentRef } from "./trainer";
import { fromIso, toIso, todayIso } from "./time";

const label = (plan: string, cycle: string) => `${findPlan(plan)?.name ?? plan}, ${cycle === "YEARLY" ? "yearly" : "monthly"}`;

// ── The FITRON team's view of the whole AI Trainer (fitron-admin/trainer) ──────────────────────

export const monthRange = (month: string) => {
  const start = fromIso(`${month}-01`);
  return { start, end: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)) };
};
export const prevMonth = (month: string) => {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1));
  return d.toISOString().slice(0, 7);
};
const live = { deletedEmailHash: null } as const;

/** The numbers at the top of the page: members by state, and money this month and last. */
export async function trainerOverview(today = todayIso()) {
  const month = today.slice(0, 7);
  const last = prevMonth(month);
  const [total, onboarded, active, trial, linked, newThisMonth, seenWeek, paidThis, paidLast, coachToday] = await Promise.all([
    db.trainerMember.count({ where: live }),
    db.trainerMember.count({ where: { ...live, onboardedAt: { not: null } } }),
    db.trainerMember.count({ where: { ...live, paidUntil: { gte: fromIso(today) } } }),
    db.trainerMember.count({ where: { ...live, trialEndsAt: { gt: new Date() }, OR: [{ paidUntil: null }, { paidUntil: { lt: fromIso(today) } }] } }),
    db.trainerMember.count({ where: { ...live, orgId: { not: null } } }),
    db.trainerMember.count({ where: { ...live, createdAt: { gte: monthRange(month).start } } }),
    db.trainerMember.count({ where: { ...live, lastSeenAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
    db.trainerPayment.aggregate({ where: { status: "PAID", paidAt: { gte: monthRange(month).start, lt: monthRange(month).end } }, _sum: { total: true, base: true }, _count: true }),
    db.trainerPayment.aggregate({ where: { status: "PAID", paidAt: { gte: monthRange(last).start, lt: monthRange(last).end } }, _sum: { total: true, base: true }, _count: true }),
    db.trainerCoachUsage.aggregate({ where: { date: fromIso(today) }, _sum: { count: true } }),
  ]);
  return {
    month,
    total,
    onboarded,
    active,
    trial,
    locked: Math.max(0, onboarded - active - trial),
    linked,
    newThisMonth,
    seenWeek,
    thisMonth: { count: paidThis._count, total: paidThis._sum.total ?? 0, base: paidThis._sum.base ?? 0 },
    lastMonth: { count: paidLast._count, total: paidLast._sum.total ?? 0, base: paidLast._sum.base ?? 0 },
    coachToday: coachToday._sum.count ?? 0,
  };
}

export type TrainerListFilter = { q?: string; status?: "active" | "trial" | "locked" | "linked" | "new" | ""; page?: number; pageSize?: number };

/** Members, newest first, with their state and gym. `status` narrows; `q` matches name, email or gym. */
export async function trainerMembers(f: TrainerListFilter, today = todayIso()) {
  const q = f.q?.trim();
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 50));
  const byStatus: Record<string, Prisma.TrainerMemberWhereInput> = {
    active: { paidUntil: { gte: fromIso(today) } },
    trial: { trialEndsAt: { gt: new Date() }, OR: [{ paidUntil: null }, { paidUntil: { lt: fromIso(today) } }] },
    locked: { onboardedAt: { not: null }, OR: [{ paidUntil: null }, { paidUntil: { lt: fromIso(today) } }], AND: [{ OR: [{ trialEndsAt: null }, { trialEndsAt: { lte: new Date() } }] }] },
    linked: { orgId: { not: null } },
    new: { createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
  };
  // Both narrowings may use OR, so they go side by side under AND rather than merged.
  const where: Prisma.TrainerMemberWhereInput = {
    ...live,
    AND: [
      ...(f.status ? [byStatus[f.status]!] : []),
      ...(q ? [{ OR: [{ name: { contains: q, mode: "insensitive" as const } }, { email: { contains: q, mode: "insensitive" as const } }, { org: { name: { contains: q, mode: "insensitive" as const } } }] }] : []),
    ],
  };
  const [total, rows, paid] = await Promise.all([
    db.trainerMember.count({ where }),
    db.trainerMember.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { org: { select: { name: true } }, gymMember: { select: { code: true } } } }),
    db.trainerPayment.groupBy({ by: ["memberId"], where: { status: "PAID" }, _sum: { total: true } }),
  ]);
  const lifetime = new Map(paid.map((p) => [p.memberId, p._sum.total ?? 0]));
  return {
    total,
    page,
    pageSize,
    rows: rows.map((m) => {
      const access = trainerAccess({ paidUntil: m.paidUntil ? toIso(m.paidUntil) : null, trialEndsAt: m.trialEndsAt }, today);
      return {
        id: m.id,
        name: m.name,
        email: m.email,
        plan: m.plan,
        cycle: m.cycle,
        access: access.status,
        paidUntil: m.paidUntil ? toIso(m.paidUntil) : null,
        trialEndsAt: m.trialEndsAt ? toIso(m.trialEndsAt) : null,
        planCancelled: m.planCancelled,
        onboarded: !!m.onboardedAt,
        signupVia: m.signupVia,
        gym: m.org?.name ?? null,
        gymCode: m.gymMember?.code ?? null,
        createdAt: m.createdAt,
        lastSeenAt: m.lastSeenAt,
        lifetime: lifetime.get(m.id) ?? 0,
      };
    }),
  };
}

/** Every payment, newest first: what each member started and what was paid. */
export async function trainerPaymentList(f: { status?: string; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, f.pageSize ?? 50));
  const where: Prisma.TrainerPaymentWhereInput = f.status && ["PENDING", "PAID"].includes(f.status) ? { status: f.status } : {};
  const [total, rows] = await Promise.all([
    db.trainerPayment.count({ where }),
    db.trainerPayment.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { member: { select: { name: true, email: true, org: { select: { name: true } } } } } }),
  ]);
  return {
    total,
    page,
    pageSize,
    rows: rows.map((p) => ({
      id: p.id,
      ref: trainerPaymentRef(p.id),
      member: p.member.name || p.member.email,
      email: p.member.email,
      gym: p.member.org?.name ?? null,
      what: label(p.plan, p.cycle),
      kind: p.kind,
      base: p.base,
      gst: p.gst,
      total: p.total,
      couponCode: p.couponCode,
      mode: p.mode,
      status: p.status,
      createdAt: p.createdAt,
      paidAt: p.paidAt,
      periodStart: p.periodStart ? toIso(p.periodStart) : null,
      periodEnd: p.periodEnd ? toIso(p.periodEnd) : null,
    })),
  };
}

/** What FITRON owes each gym for a month under the Gym Partnership: PARTNER_SHARE of the price before GST of its linked members' confirmed payments. */
export async function partnerPayouts(month: string) {
  const { start, end } = monthRange(month);
  const [gyms, paid] = await Promise.all([
    db.organization.findMany({ where: { trainerMembers: { some: live } }, select: { id: true, name: true, trainerCode: true, _count: { select: { trainerMembers: { where: live } } } }, orderBy: { name: "asc" } }),
    db.trainerPayment.findMany({ where: { status: "PAID", paidAt: { gte: start, lt: end }, member: { orgId: { not: null } } }, select: { base: true, total: true, member: { select: { orgId: true } } } }),
  ]);
  const sums = new Map<string, { count: number; base: number; total: number }>();
  for (const p of paid) {
    const s = sums.get(p.member.orgId!) ?? { count: 0, base: 0, total: 0 };
    s.count++;
    s.base += p.base;
    s.total += p.total;
    sums.set(p.member.orgId!, s);
  }
  const rows = gyms.map((g) => {
    const s = sums.get(g.id) ?? { count: 0, base: 0, total: 0 };
    return { id: g.id, gym: g.name, code: g.trainerCode, members: g._count.trainerMembers, payments: s.count, base: s.base, total: s.total, share: Math.round(s.base * PARTNER_SHARE) };
  });
  return { month, rows, totals: rows.reduce((a, r) => ({ base: a.base + r.base, share: a.share + r.share, payments: a.payments + r.payments }), { base: 0, share: 0, payments: 0 }) };
}
