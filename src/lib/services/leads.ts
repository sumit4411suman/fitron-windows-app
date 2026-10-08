import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { writeBranch } from "@/lib/auth/current";
import type { Prisma } from "@/generated/prisma/client";
import { addDays } from "@/lib/domain/dates";
import { LEAD_STAGES, type LeadInput, type LeadStage } from "@/lib/validation/frontdesk";
import { audit } from "./audit";
import { UserError } from "./errors";
import { fromIso, todayIso } from "./time";

const scope = (u: CurrentUser): Prisma.LeadWhereInput => ({ orgId: u.orgId, branchId: { in: u.branchIds } });

export async function listLeads(u: CurrentUser, f: { stage?: string; q?: string; due?: boolean }) {
  const q = f.q?.trim();
  const today = fromIso(todayIso());
  const where: Prisma.LeadWhereInput = {
    ...scope(u),
    ...(f.stage ? { stage: f.stage } : { stage: { notIn: ["Won", "Lost"] } }),
    ...(f.due ? { followUpOn: { lte: today } } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q.replace(/\D/g, "") || q } }] } : {}),
  };
  const [leads, byStage, owners] = await Promise.all([
    db.lead.findMany({ where, orderBy: [{ followUpOn: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }], take: 200 }),
    db.lead.groupBy({ by: ["stage"], where: scope(u), _count: { _all: true } }),
    db.user.findMany({ where: { orgId: u.orgId }, select: { id: true, name: true } }),
  ]);
  const names = new Map(owners.map((o) => [o.id, o.name]));
  const counts = Object.fromEntries(LEAD_STAGES.map((s) => [s, byStage.find((b) => b.stage === s)?._count._all ?? 0])) as Record<LeadStage, number>;
  const dueToday = await db.lead.count({ where: { ...scope(u), stage: { notIn: ["Won", "Lost"] }, followUpOn: { lte: today } } });
  return { leads: leads.map((l) => ({ ...l, ownerName: names.get(l.ownerId) ?? "—" })), counts, dueToday };
}

export const getLead = (u: CurrentUser, id: string) => db.lead.findFirst({ where: { ...scope(u), id }, include: { member: { select: { id: true, code: true, name: true } } } });

const toData = (i: LeadInput) => ({ ...i, followUpOn: i.followUpOn ? fromIso(i.followUpOn) : null, trialOn: i.trialOn ? fromIso(i.trialOn) : null, notes: i.notes ?? null });

export async function createLead(u: CurrentUser, input: LeadInput) {
  const branchId = writeBranch(u);
  if (!branchId) throw new UserError("Pick a branch first.");
  const open = await db.lead.findFirst({ where: { orgId: u.orgId, phone: input.phone, stage: { notIn: ["Won", "Lost"] } }, select: { name: true } });
  if (open) throw new UserError(`${open.name} is already an open lead with this number.`, "phone");
  const member = await db.member.findFirst({ where: { orgId: u.orgId, phone: input.phone, deletedAt: null, walkIn: false }, select: { name: true, code: true } });
  if (member) throw new UserError(`This number belongs to member ${member.name} (${member.code}).`, "phone");
  return db.$transaction(async (tx) => {
    const l = await tx.lead.create({ data: { ...toData(input), orgId: u.orgId, branchId, followUpOn: input.followUpOn ? fromIso(input.followUpOn) : fromIso(addDays(todayIso(), 1)) } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "lead.create", entity: "Lead", entityId: l.id, after: l });
    return l;
  });
}

export async function updateLead(u: CurrentUser, id: string, input: LeadInput) {
  const before = await db.lead.findFirst({ where: { ...scope(u), id } });
  if (!before) throw new UserError("Lead not found.");
  return db.$transaction(async (tx) => {
    const after = await tx.lead.update({ where: { id }, data: toData(input) });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "lead.update", entity: "Lead", entityId: id, before, after });
    return after;
  });
}

/** Moves a lead along New → Contacted → Trial booked → Trial done, with a sensible next follow-up. */
export async function setLeadStage(u: CurrentUser, id: string, stage: LeadStage, extra: { lostReason?: string; trialOn?: string } = {}) {
  const before = await db.lead.findFirst({ where: { ...scope(u), id } });
  if (!before) throw new UserError("Lead not found.");
  if (before.stage === "Won") throw new UserError("This lead already joined.");
  if (stage === "Won") throw new UserError("Convert the lead to a member to mark it won.");
  if (stage === "Lost" && !extra.lostReason?.trim()) throw new UserError("Say why the lead was lost.", "reason");
  const today = todayIso();
  const trialOn = stage === "Trial booked" ? (extra.trialOn ?? addDays(today, 1)) : null;
  const data: Prisma.LeadUpdateInput = {
    stage,
    ...(stage !== before.stage ? { stageAt: new Date() } : {}),
    lostReason: stage === "Lost" ? extra.lostReason!.trim() : null,
    followUpOn: stage === "Lost" ? null : fromIso(trialOn ? trialOn : addDays(today, 2)),
    ...(trialOn ? { trialOn: fromIso(trialOn) } : {}),
  };
  await db.$transaction(async (tx) => {
    const after = await tx.lead.update({ where: { id }, data });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "lead.stage", entity: "Lead", entityId: id, before, after });
  });
}

/**
 * Someone called or messaged the lead (prototype): a New lead becomes Contacted, and the next follow-up
 * is in two days (a call keeps a follow-up already planned for later).
 */
export async function touchLead(u: CurrentUser, id: string, how: "call" | "whatsapp") {
  const before = await db.lead.findFirst({ where: { ...scope(u), id } });
  if (!before) throw new UserError("Lead not found.");
  if (before.stage === "Won" || before.stage === "Lost") return;
  const today = todayIso();
  const later = before.followUpOn && before.followUpOn > fromIso(today) ? before.followUpOn : null;
  const contacted = before.stage === "New";
  await db.$transaction(async (tx) => {
    const after = await tx.lead.update({
      where: { id },
      data: {
        ...(contacted ? { stage: "Contacted", stageAt: new Date() } : {}),
        followUpOn: how === "call" && later ? later : fromIso(addDays(today, 2)),
      },
    });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: how === "call" ? "lead.call" : "lead.message", entity: "Lead", entityId: id, before, after });
  });
}

/** Called in the member-create transaction when a member is added from a lead. */
export async function markLeadWon(tx: Prisma.TransactionClient, u: CurrentUser, leadId: string, memberId: string) {
  const before = await tx.lead.findFirst({ where: { ...scope(u), id: leadId } });
  if (!before || before.stage === "Won") return;
  const after = await tx.lead.update({ where: { id: leadId }, data: { stage: "Won", stageAt: new Date(), memberId, followUpOn: null } });
  await audit(tx, { orgId: u.orgId, userId: u.id, action: "lead.won", entity: "Lead", entityId: leadId, before, after });
}
