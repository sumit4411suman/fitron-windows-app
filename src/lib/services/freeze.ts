import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { addDays, daysBetween } from "@/lib/domain/dates";
import { freezeCovers, freezeLastDay, freezeOpen, unusedFreezeDays, type FreezeLike } from "@/lib/domain/freeze";
import { fmtDate } from "@/lib/format";
import { audit } from "./audit";
import { UserError } from "./errors";
import { memberScope } from "./members";
import { assertMonthOpen } from "./locks";
import { fromIso, todayIso, toIso } from "./time";

const like = (f: { fromDate: Date; days: number; endedOn: Date | null }): FreezeLike => ({ fromDate: toIso(f.fromDate), days: f.days, endedOn: f.endedOn ? toIso(f.endedOn) : null });

/** The member's freeze that is still on hold (today or later), if any. `running` is false while it is only scheduled. */
export async function openFreeze(memberId: string, today = todayIso()) {
  const all = await db.membershipFreeze.findMany({ where: { memberId, endedOn: null }, orderBy: { fromDate: "desc" } });
  const f = all.find((x) => freezeOpen(like(x), today));
  return f ? { ...f, lastDay: freezeLastDay(like(f)), running: freezeCovers(like(f), today) } : null;
}

/** Entry blocks for members frozen today ("Membership frozen till 14 Oct"), for check-in and door devices. */
export async function frozenBlocks(memberIds: string[], today = todayIso()) {
  const fs = await db.membershipFreeze.findMany({ where: { memberId: { in: memberIds }, endedOn: null, fromDate: { lte: fromIso(today) } } });
  const out = new Map<string, string>();
  for (const f of fs) if (freezeCovers(like(f), today)) out.set(f.memberId, `Membership frozen till ${fmtDate(freezeLastDay(like(f)))}`);
  return out;
}

/** Members whose freeze is still on hold (running now or scheduled to start later). */
export async function frozenMemberIds(memberIds: string[], today = todayIso()): Promise<Set<string>> {
  if (memberIds.length === 0) return new Set();
  const fs = await db.membershipFreeze.findMany({
    where: { memberId: { in: memberIds }, endedOn: null, fromDate: { gte: fromIso(addDays(today, -89)) } },
    select: { memberId: true, fromDate: true, days: true, endedOn: true },
  });
  return new Set(fs.filter((f) => freezeOpen(like(f), today)).map((f) => f.memberId));
}

/** Members frozen today (a freeze scheduled to start later doesn't count), for the dashboard's "Frozen" card. */
export async function frozenTodayIds(memberIds: string[], today = todayIso()): Promise<Set<string>> {
  if (memberIds.length === 0) return new Set();
  return new Set([...(await frozenBlocks(memberIds, today)).keys()]);
}

async function ownMember(u: CurrentUser, memberId: string) {
  const m = await db.member.findFirst({ where: { ...memberScope(u), id: memberId, walkIn: false } });
  if (!m) throw new UserError("Member not found.");
  return m;
}

/** Puts the current membership on hold for `days` from `from`: its end date moves out by those days. */
export async function freezeMembership(u: CurrentUser, memberId: string, input: { days: number; from: string; reason: string }) {
  const m = await ownMember(u, memberId);
  if (!(input.days >= 1 && input.days <= 90)) throw new UserError("Freeze for 1 to 90 days.", "days");
  const today = todayIso();
  if (input.from < today) throw new UserError("A freeze can't start in the past.", "from");
  if (await openFreeze(m.id, today)) throw new UserError("Already frozen.");
  const ms = await db.membership.findFirst({ where: { memberId: m.id, status: "VALID", endDate: { gte: fromIso(today) } }, orderBy: { endDate: "desc" } });
  if (!ms || toIso(ms.endDate) < input.from) throw new UserError("No active membership to freeze.");
  const newEnd = addDays(toIso(ms.endDate), input.days);
  return db.$transaction(async (tx) => {
    await assertMonthOpen(tx, u, m.branchId, today);
    await tx.membership.update({ where: { id: ms.id }, data: { endDate: fromIso(newEnd) } });
    const f = await tx.membershipFreeze.create({ data: { orgId: u.orgId, memberId: m.id, membershipId: ms.id, fromDate: fromIso(input.from), days: input.days, reason: input.reason, createdById: u.id } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "membership.freeze", entity: "Membership", entityId: ms.id, before: { endDate: toIso(ms.endDate) }, after: { endDate: newEnd, freeze: f } });
    return { freeze: f, newEnd };
  });
}

/** Ends a freeze now; the days not yet used come off the membership again. */
export async function unfreezeMembership(u: CurrentUser, memberId: string) {
  const m = await ownMember(u, memberId);
  const today = todayIso();
  const f = await openFreeze(m.id, today);
  if (!f) throw new UserError("This membership isn't frozen.");
  const back = unusedFreezeDays(like(f), today);
  const ms = await db.membership.findUniqueOrThrow({ where: { id: f.membershipId } });
  const newEnd = addDays(toIso(ms.endDate), -back);
  await db.$transaction(async (tx) => {
    await assertMonthOpen(tx, u, m.branchId, today);
    await tx.membership.update({ where: { id: ms.id }, data: { endDate: fromIso(newEnd) } });
    await tx.membershipFreeze.update({ where: { id: f.id }, data: { endedOn: fromIso(today) } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "membership.unfreeze", entity: "Membership", entityId: ms.id, before: { endDate: toIso(ms.endDate) }, after: { endDate: newEnd, used: Math.max(0, daysBetween(today, toIso(f.fromDate))), returned: back } });
  });
  return { returned: back, newEnd };
}

/** Moves a member to another branch; their memberships and balance go with them, past invoices stay where they were raised. */
export async function transferMember(u: CurrentUser, memberId: string, toBranchId: string, reason?: string) {
  const m = await ownMember(u, memberId);
  if (toBranchId === m.branchId) throw new UserError("Choose a different branch.", "to");
  if (!u.branches.some((b) => b.id === toBranchId && b.active)) throw new UserError("Choose one of your branches.", "to");
  await db.$transaction(async (tx) => {
    const after = await tx.member.update({ where: { id: m.id }, data: { branchId: toBranchId } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "member.transfer", entity: "Member", entityId: m.id, before: { branchId: m.branchId }, after: { branchId: after.branchId, reason: reason ?? null } });
  });
}
