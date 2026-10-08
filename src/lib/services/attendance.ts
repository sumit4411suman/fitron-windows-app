import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { DEFAULT_ACCESS, entryBlock, type AccessRules } from "@/lib/domain/access";
import { membershipStatus } from "@/lib/domain/membership";
import { audit } from "./audit";
import { frozenBlocks } from "./freeze";
import { UserError } from "./errors";
import { memberScope, summarize } from "./members";
import { notify } from "./notifications";
import { getSetting } from "./settings";
import { fromIso, istInstant, nowHHMM, toIso, todayIso } from "./time";
import { addDays } from "@/lib/domain/dates";
import { fmtTime } from "@/lib/format";

export const getAccessRules = async (orgId: string): Promise<AccessRules> => ({ ...DEFAULT_ACCESS, ...((await getSetting<Partial<AccessRules>>(orgId, "access")) ?? {}) });

/** Members matching what the desk typed: exact ID, phone digits, or part of the name. */
export async function findForCheckIn(u: CurrentUser, q: string) {
  const t = q.trim();
  if (!t) return [];
  const digits = t.replace(/\D/g, "");
  const members = await db.member.findMany({
    where: {
      ...memberScope(u),
      walkIn: false,
      OR: [{ code: { equals: t, mode: "insensitive" } }, ...(digits.length >= 4 ? [{ cardNo: digits }] : []), ...(digits.length >= 4 ? [{ phone: { contains: digits.slice(-10) } }] : []), { name: { contains: t, mode: "insensitive" } }],
    },
    take: 8,
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true, phone: true, suspended: true },
  });
  // An exact ID match wins outright.
  const exact = members.find((m) => m.code.toLowerCase() === t.toLowerCase());
  const list = exact ? [exact] : members;
  const today = todayIso();
  const sums = await summarize(list.map((m) => m.id), today);
  return list.map((m) => {
    const s = sums.get(m.id)!;
    return { ...m, ...s, status: membershipStatus({ suspended: m.suspended, latestEnd: s.latestEnd, outstanding: s.outstanding, today }) };
  });
}

/** Where a check-in is recorded: the branch the desk is working in, else the member's home branch. */
const deskBranch = (u: CurrentUser, fallback: string) => (u.branch !== "ALL" ? u.branch : fallback);

export type BlockKind = "expired" | "dues" | "frozen" | "hours" | "inside";
export type CheckInResult =
  | { ok: true; name: string; memberId: string; daysLeft: number | null; outstanding: number }
  | { ok: false; blocked: string; kind: BlockKind; memberId: string; name: string; attendanceId?: string };

/** Which quick fix the desk is offered for a block (prototype: Renew now, Collect dues, Unfreeze, Check out instead). */
const kindOf = (block: string): BlockKind =>
  /frozen/i.test(block) ? "frozen" : /outstanding/i.test(block) ? "dues" : /hours/i.test(block) ? "hours" : "expired";

/** Only an Admin or Super Admin can let a blocked member in anyway (prototype). */
export const canOverrideEntry = (u: CurrentUser) => u.role === "Super Admin" || u.role === "Admin";

/**
 * Checks a member in, applying the gym's entry rules. A blocked member comes back with the reason and its kind;
 * an Admin can let them in anyway, which is audited and raises a notification. Someone already inside comes back
 * as an "inside" block so the desk can check them out instead.
 */
export async function checkIn(u: CurrentUser, memberId: string, opts: { method?: string; override?: string } = {}): Promise<CheckInResult> {
  const m = await db.member.findFirst({ where: { ...memberScope(u), id: memberId, walkIn: false } });
  if (!m) throw new UserError("Member not found.");
  const today = todayIso();
  const open = await db.attendance.findFirst({ where: { memberId: m.id, date: fromIso(today), checkOut: null } });
  if (open) return { ok: false, blocked: `Already inside since ${fmtTime(open.checkIn)}`, kind: "inside", memberId: m.id, name: m.name, attendanceId: open.id };
  const s = (await summarize([m.id], today)).get(m.id)!;
  const block = (await frozenBlocks([m.id], today)).get(m.id) ?? entryBlock({ suspended: m.suspended, ...s }, await getAccessRules(u.orgId), today, nowHHMM()) ?? null;
  const override = opts.override?.trim();
  if (block && !override) return { ok: false, blocked: block, kind: kindOf(block), memberId: m.id, name: m.name };
  if (block && !canOverrideEntry(u)) throw new UserError("Only an Admin can let someone in anyway.");

  const branchId = deskBranch(u, m.branchId);
  await db.$transaction(async (tx) => {
    const again = await tx.attendance.findFirst({ where: { memberId: m.id, date: fromIso(today), checkOut: null } });
    if (again) throw new UserError(`${m.name} is already inside.`);
    const a = await tx.attendance.create({
      data: { branchId, memberId: m.id, type: "MEMBER", date: fromIso(today), checkIn: new Date(), method: opts.method ?? "Manual", override: block ? `${block}: ${override}` : null, createdById: u.id },
    });
    if (block) {
      await audit(tx, { orgId: u.orgId, userId: u.id, action: "attendance.override", entity: "Attendance", entityId: a.id, after: { member: m.code, block, reason: override } });
      await notify(tx, { orgId: u.orgId, branchId, type: "CHECKIN_OVERRIDE", text: `${u.name} let ${m.name} in despite "${block}": ${override}`, link: `/members/${m.id}` });
    }
  });
  const daysLeft = s.latestEnd ? Math.round((fromIso(s.latestEnd).getTime() - fromIso(today).getTime()) / 86_400_000) : null;
  return { ok: true, name: m.name, memberId: m.id, daysLeft, outstanding: s.outstanding };
}

export const VISIT_TYPES = { Trial: "TRIAL", Guest: "GUEST", "Day pass": "DAY_PASS" } as const;

/** Logs a trial, guest or day-pass visit. Trial visitors with a phone become a lead to follow up tomorrow (prototype). */
export async function checkInGuest(u: CurrentUser, name: string, phone: string | undefined, visit: keyof typeof VISIT_TYPES = "Guest") {
  const branchId = u.branch !== "ALL" ? u.branch : u.branches[0]?.id;
  if (!branchId) throw new UserError("Pick a branch first.");
  const today = todayIso();
  let lead = false;
  await db.$transaction(async (tx) => {
    await tx.attendance.create({ data: { branchId, type: VISIT_TYPES[visit] ?? "GUEST", guestName: name, guestPhone: phone ?? null, date: fromIso(today), checkIn: new Date(), method: "Manual", createdById: u.id } });
    if (visit === "Trial" && phone) {
      const known = await tx.lead.findFirst({ where: { orgId: u.orgId, phone } });
      const member = await tx.member.findFirst({ where: { orgId: u.orgId, phone, deletedAt: null, walkIn: false }, select: { id: true } });
      if (!known && !member) {
        const l = await tx.lead.create({
          data: { orgId: u.orgId, branchId, name, phone, source: "Walk-in", interest: "Monthly", stage: "Trial done", trialOn: fromIso(today), followUpOn: fromIso(addDays(today, 1)), ownerId: u.id, notes: "Trial session today" },
        });
        await audit(tx, { orgId: u.orgId, userId: u.id, action: "lead.create", entity: "Lead", entityId: l.id, after: l });
        lead = true;
      }
    }
  });
  return { lead };
}

const attScope = (u: CurrentUser) => ({ branchId: { in: u.branchIds } });

export async function checkOut(u: CurrentUser, id: string) {
  const a = await db.attendance.findFirst({ where: { ...attScope(u), id } });
  if (!a) throw new UserError("Check-in not found.");
  if (a.checkOut) return;
  await db.attendance.update({ where: { id }, data: { checkOut: new Date() } });
}

/** Removes a wrong check-in made by mistake. Audited. */
export async function removeCheckIn(u: CurrentUser, id: string) {
  const before = await db.attendance.findFirst({ where: { ...attScope(u), id } });
  if (!before) throw new UserError("Check-in not found.");
  await db.$transaction(async (tx) => {
    await tx.attendance.delete({ where: { id } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "attendance.remove", entity: "Attendance", entityId: id, before });
  });
}

/** Checks out everyone still inside, now. Earlier days are closed at the gym's closing time. */
export async function closeDay(u: CurrentUser, closingTime = "22:00") {
  const today = todayIso();
  const stale = await db.attendance.findMany({ where: { ...attScope(u), checkOut: null, date: { lt: fromIso(today) } }, select: { id: true, date: true } });
  await db.$transaction(async (tx) => {
    for (const a of stale) await tx.attendance.update({ where: { id: a.id }, data: { checkOut: istInstant(toIso(a.date), closingTime), autoOut: true } });
    await tx.attendance.updateMany({ where: { ...attScope(u), checkOut: null, date: fromIso(today) }, data: { checkOut: new Date(), autoOut: true } });
  });
}

export async function listDay(u: CurrentUser, date: string) {
  const rows = await db.attendance.findMany({
    where: { ...attScope(u), date: fromIso(date) },
    orderBy: { checkIn: "desc" },
    include: { member: { select: { id: true, code: true, name: true } }, branch: { select: { name: true } } },
  });
  return { rows, inside: rows.filter((r) => !r.checkOut).length, members: new Set(rows.filter((r) => r.memberId).map((r) => r.memberId)).size, guests: rows.filter((r) => r.type !== "MEMBER").length };
}

/** Daily check-ins for the last `days` days, for the trend strip. */
export async function dailyCounts(u: CurrentUser, days = 14) {
  const today = todayIso();
  const from = new Date(fromIso(today).getTime() - (days - 1) * 86_400_000);
  const g = await db.attendance.groupBy({ by: ["date"], where: { ...attScope(u), date: { gte: from } }, _count: { _all: true } });
  const map = new Map(g.map((x) => [toIso(x.date), x._count._all]));
  return Array.from({ length: days }, (_, i) => {
    const d = toIso(new Date(from.getTime() + i * 86_400_000));
    return { date: d, count: map.get(d) ?? 0 };
  });
}

/** A member's own check-ins, limited like every other query to the branches the user may see. */
export const memberVisits = (u: CurrentUser, memberId: string, take = 30) =>
  db.attendance.findMany({ where: { ...attScope(u), memberId }, orderBy: { checkIn: "desc" }, take });

/** Check-ins per hour (5 am – 10 pm, IST) over the last 30 days, for "Busy hours". */
export async function busyHours(u: CurrentUser) {
  const today = todayIso();
  const rows = await db.attendance.findMany({ where: { ...attScope(u), date: { gte: fromIso(addDays(today, -29)) } }, select: { checkIn: true } });
  const by = new Map<number, number>();
  for (const r of rows) {
    const h = Number(nowHHMM(r.checkIn).slice(0, 2));
    by.set(h, (by.get(h) ?? 0) + 1);
  }
  return Array.from({ length: 18 }, (_, i) => ({ hour: i + 5, count: by.get(i + 5) ?? 0 }));
}

/** Active members who haven't come in for 14 days or more, longest gap first (prototype: "Haven't visited"). */
export async function idleMembers(u: CurrentUser, take = 5) {
  const today = todayIso();
  const members = await db.member.findMany({ where: { ...memberScope(u), walkIn: false, suspended: false }, select: { id: true, name: true, phone: true } });
  const sums = await summarize(members.map((m) => m.id), today);
  const active = members.filter((m) => (sums.get(m.id)?.latestEnd ?? "") >= today);
  const last = await db.attendance.groupBy({ by: ["memberId"], where: { memberId: { in: active.map((m) => m.id) } }, _max: { date: true } });
  const lastOf = new Map(last.map((l) => [l.memberId!, l._max.date ? toIso(l._max.date) : null]));
  return active
    .map((m) => ({ ...m, lastVisit: lastOf.get(m.id) ?? null }))
    .filter((m) => !m.lastVisit || addDays(m.lastVisit, 14) <= today)
    .sort((a, b) => (a.lastVisit ?? "0").localeCompare(b.lastVisit ?? "0"))
    .slice(0, take);
}

export type DeskHit = { id: string; code: string; name: string; phone: string; planName: string | null; status: string; tone: "inside" | "blocked" | "plain" };

/** The check-in box's suggestions, each with what would happen (prototype: inside since…, the block, or days left). */
export async function deskSearch(u: CurrentUser, q: string): Promise<DeskHit[]> {
  if (q.trim().length < 2) return [];
  const hits = await findForCheckIn(u, q);
  const today = todayIso();
  const ids = hits.map((h) => h.id);
  const [open, frozen, rules] = await Promise.all([
    db.attendance.findMany({ where: { memberId: { in: ids }, date: fromIso(today), checkOut: null }, select: { memberId: true, checkIn: true } }),
    frozenBlocks(ids, today),
    getAccessRules(u.orgId),
  ]);
  const now = nowHHMM();
  return hits.map((h) => {
    const inside = open.find((o) => o.memberId === h.id);
    const block = frozen.get(h.id) ?? entryBlock(h, rules, today, now);
    const left = h.latestEnd ? Math.round((fromIso(h.latestEnd).getTime() - fromIso(today).getTime()) / 86_400_000) : null;
    return {
      id: h.id,
      code: h.code,
      name: h.name,
      phone: h.phone,
      planName: h.planName,
      status: inside ? `Inside since ${fmtTime(inside.checkIn)}` : block ? block : left !== null && left >= 0 ? `Active · ${left} days left` : "Expired",
      tone: inside ? "inside" : block ? "blocked" : "plain",
    };
  });
}
