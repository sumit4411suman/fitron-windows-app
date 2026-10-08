import "server-only";
import { randomInt } from "node:crypto";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import type { Prisma, TrainerMember } from "@/generated/prisma/client";
import { PARTNER_SHARE } from "@/lib/domain/pricing";
import { progress, trainerAccess, type TrainerPlan } from "@/lib/domain/trainer";
import { isUniqueViolation, UserError } from "./errors";
import { getSetting } from "./settings";
import { fromIso, todayIso, toIso } from "./time";
import { dayLog, trainerPaymentRef } from "./trainer";

// The Gym Partnership: a member of the AI Trainer links to a gym on FITRON with the gym's trainer code.
// The gym then sees that member's training next to their dues, and earns PARTNER_SHARE of what the
// member pays FITRON for the AI Trainer while linked.

/** Letters and digits that are not confused for each other when read out or typed: no 0/O, 1/I. */
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

export const normaliseCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);

const makeCode = () => Array.from({ length: CODE_LENGTH }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");

/** The gym's trainer code, made the first time it is asked for. */
export async function ensureTrainerCode(orgId: string) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { trainerCode: true } });
  if (org.trainerCode) return org.trainerCode;
  for (let tries = 0; tries < 10; tries++) {
    const code = makeCode();
    try {
      // Only when still unset: two owners pressing the button together must get the same code.
      const r = await db.organization.updateMany({ where: { id: orgId, trainerCode: null }, data: { trainerCode: code } });
      if (!r.count) return (await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { trainerCode: true } })).trainerCode!;
      return code;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw new Error("Could not make a free trainer code");
}

async function gymName(orgId: string, fallback: string) {
  return (await getSetting<{ name?: string }>(orgId, "gym"))?.name?.trim() || fallback;
}

export type GymView = { name: string; code: string; linkedAt: string | null; member: { code: string; name: string } | null };

/** The gym a member is linked to, for the app. */
export async function gymView(m: Pick<TrainerMember, "orgId" | "gymMemberId" | "gymLinkedAt">): Promise<GymView | null> {
  if (!m.orgId) return null;
  const [org, gm] = await Promise.all([
    db.organization.findUnique({ where: { id: m.orgId }, select: { name: true, trainerCode: true } }),
    m.gymMemberId ? db.member.findUnique({ where: { id: m.gymMemberId }, select: { code: true, name: true } }) : null,
  ]);
  if (!org) return null;
  return { name: await gymName(m.orgId, org.name), code: org.trainerCode ?? "", linkedAt: m.gymLinkedAt?.toISOString() ?? null, member: gm };
}

const last10 = (phone: string) => phone.replace(/\D/g, "").slice(-10);

/**
 * Links the member to the gym whose trainer code this is. Their record at the gym is matched by the
 * email they signed in with, or else by the phone they gave the app; with no clear match the link is to
 * the gym alone, and the gym can still see them on its Partnership page.
 */
export async function linkTrainerGym(memberId: string, codeRaw: string) {
  const code = normaliseCode(codeRaw ?? "");
  if (!code) throw new UserError("Type the code your gym gave you.");
  const org = await db.organization.findUnique({ where: { trainerCode: code }, select: { id: true, name: true } });
  if (!org) throw new UserError("No gym has this code. Check it with your gym.");
  const m = await db.trainerMember.findUniqueOrThrow({ where: { id: memberId } });
  if (m.deletedEmailHash) throw new UserError("This account was deleted.");
  const profile = (m.profile ?? {}) as Record<string, unknown>;
  const ob = (profile.ob ?? {}) as Record<string, unknown>;
  const phone = typeof ob.phone === "string" ? last10(ob.phone) : "";

  const live = { orgId: org.id, deletedAt: null, walkIn: false, trainerMember: null } as const;
  let match = await db.member.findFirst({ where: { ...live, email: { equals: m.email, mode: "insensitive" } }, orderBy: { createdAt: "asc" } });
  if (!match && phone.length === 10) {
    const byPhone = await db.member.findMany({ where: { ...live, phone: { endsWith: phone } }, take: 2 });
    if (byPhone.length === 1) match = byPhone[0]!;
  }
  const name = await gymName(org.id, org.name);
  const data: Prisma.TrainerMemberUpdateInput = {
    org: { connect: { id: org.id } },
    gymMember: match ? { connect: { id: match.id } } : { disconnect: true },
    gymLinkedAt: new Date(),
    profile: { ...profile, ob: { ...ob, gymName: name } } as Prisma.InputJsonValue,
  };
  try {
    await db.trainerMember.update({ where: { id: memberId }, data });
  } catch (e) {
    // The gym record was linked to another AI Trainer account a moment ago: link to the gym alone.
    if (!isUniqueViolation(e)) throw e;
    await db.trainerMember.update({ where: { id: memberId }, data: { ...data, gymMember: { disconnect: true } } });
  }
  return (await gymView({ orgId: org.id, gymMemberId: match?.id ?? null, gymLinkedAt: new Date() }))!;
}

/** Leaves the gym. Payments already made stay counted for the months they were paid in. */
export async function unlinkTrainerGym(memberId: string) {
  await db.trainerMember.update({ where: { id: memberId }, data: { org: { disconnect: true }, gymMember: { disconnect: true }, gymLinkedAt: null } });
}

// ── The gym's side ──────────────────────────────────────────────────────────

export type TrainerStatus = {
  id: string;
  name: string;
  email: string;
  plan: TrainerPlan;
  access: ReturnType<typeof trainerAccess>["status"];
  paidUntil: string | null;
  trialEndsAt: string | null;
  linkedAt: Date | null;
  lastSeenAt: Date | null;
  streak: number;
  weekWorkouts: number;
  weekPlanned: number;
  totalWorkouts: number;
};

function statusOf(m: TrainerMember & { days: Parameters<typeof dayLog>[0][] }, today: string): TrainerStatus {
  const logs = m.days.map(dayLog);
  const profile = (m.profile ?? {}) as Record<string, unknown>;
  const planned = Object.values((profile.plan as Record<string, string>) ?? {}).filter((f) => f && f !== "Rest").length || 4;
  const p = progress(logs, today, planned);
  const access = trainerAccess({ paidUntil: m.paidUntil ? toIso(m.paidUntil) : null, trialEndsAt: m.trialEndsAt }, today);
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    plan: m.plan as TrainerPlan,
    access: access.status,
    paidUntil: m.paidUntil ? toIso(m.paidUntil) : null,
    trialEndsAt: m.trialEndsAt ? toIso(m.trialEndsAt) : null,
    linkedAt: m.gymLinkedAt,
    lastSeenAt: m.lastSeenAt,
    streak: p.streak,
    weekWorkouts: p.week.workouts,
    weekPlanned: p.week.planned,
    totalWorkouts: p.totalWorkouts,
  };
}

const daysInclude = (today: string) => ({ days: { where: { date: { gte: fromIso(addDaysIso(today, -42)) } }, orderBy: { date: "asc" as const } } });
const addDaysIso = (iso: string, n: number) => toIso(new Date(fromIso(iso).getTime() + n * 86_400_000));

/** The AI Trainer account linked to a gym member, for their profile page; null when none is. */
export async function trainerStatusFor(u: CurrentUser, gymMemberId: string, today = todayIso()) {
  const m = await db.trainerMember.findFirst({ where: { gymMemberId, orgId: u.orgId }, include: daysInclude(today) });
  return m ? statusOf(m, today) : null;
}

export type PartnershipRow = TrainerStatus & { gymMember: { id: string; code: string; name: string } | null };

/**
 * The gym's Partnership page: every AI Trainer member linked to it, and what FITRON owes the gym for a
 * month (PARTNER_SHARE of the price before GST of each AI Trainer payment confirmed that month while linked).
 */
export async function partnership(u: CurrentUser, month: string, today = todayIso()) {
  const start = fromIso(`${month}-01`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const members = await db.trainerMember.findMany({
    where: { orgId: u.orgId, deletedEmailHash: null },
    include: { ...daysInclude(today), gymMember: { select: { id: true, code: true, name: true } } },
    orderBy: { gymLinkedAt: "desc" },
  });
  const rows: PartnershipRow[] = members.map((m) => ({ ...statusOf(m, today), gymMember: m.gymMember }));
  const payments = await db.trainerPayment.findMany({
    where: { status: "PAID", paidAt: { gte: start, lt: end }, member: { orgId: u.orgId } },
    include: { member: { select: { name: true, email: true } } },
    orderBy: { paidAt: "asc" },
  });
  const paid = payments.map((p) => ({
    id: p.id,
    ref: trainerPaymentRef(p.id),
    member: p.member.name || p.member.email,
    plan: p.plan,
    cycle: p.cycle,
    base: p.base,
    total: p.total,
    share: Math.round(p.base * PARTNER_SHARE),
    paidAt: p.paidAt!,
    periodEnd: p.periodEnd ? toIso(p.periodEnd) : null,
  }));
  const base = paid.reduce((a, p) => a + p.base, 0);
  return {
    month,
    rows,
    paid,
    totals: { members: rows.length, active: rows.filter((r) => r.access === "ACTIVE").length, trial: rows.filter((r) => r.access === "TRIAL").length, base, share: Math.round(base * PARTNER_SHARE) },
  };
}
