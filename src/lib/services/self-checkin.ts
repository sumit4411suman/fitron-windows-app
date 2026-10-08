import "server-only";
import { db } from "@/lib/db";
import { entryBlock } from "@/lib/domain/access";
import { planHas } from "@/lib/domain/features";
import { gymTerms } from "@/lib/domain/saas";
import { fmtTime } from "@/lib/format";
import { indianPhone } from "@/lib/validation/common";
import { getAccessRules } from "./attendance";
import { UserError } from "./errors";
import { frozenBlocks } from "./freeze";
import { summarize } from "./members";
import { gymPlan } from "./saas";
import { getSetting } from "./settings";
import { fromIso, nowHHMM, todayIso } from "./time";

// Members checking themselves in from the poster QR at the front desk (Attendance › QR). The page is public, so it
// answers as little as it can: a member is welcomed by first name, and every refusal (no such member here, expired,
// frozen, dues, outside hours, suspended) gets the same "ask at the front desk", so nobody learns from it whether a
// number belongs to a member or why one is turned away. The desk sees the visit in Attendance like any other.

export type CheckInPoint = { branchId: string; orgId: string; branchName: string; gymName: string; open: boolean };

/**
 * The branch a poster points at, or null when there is no such branch. `open` is false when its gym can't take
 * self check-ins: attendance isn't in the gym's plan, or the plan has ended.
 */
export async function checkInPoint(branchId: string): Promise<CheckInPoint | null> {
  const b = await db.branch.findFirst({ where: { id: branchId, active: true }, select: { id: true, name: true, orgId: true, org: { select: { name: true, plan: true, trialEndsAt: true } } } });
  if (!b) return null;
  const [plan, gym] = await Promise.all([gymPlan(b.orgId), getSetting<{ name?: string }>(b.orgId, "gym")]);
  const view = { key: b.org.plan, name: plan.name, custom: gymTerms(b.org).custom };
  const lapsed = plan.standing.kind === "LAPSED";
  return { branchId: b.id, orgId: b.orgId, branchName: b.name, gymName: gym?.name || b.org.name, open: planHas(view, "attendance") && !lapsed };
}

export type SelfCheckIn = { status: "in"; firstName: string; at: string } | { status: "inside" } | { status: "desk" };

/** Checks in the member of this branch whose mobile number it is, under the gym's entry rules. */
export async function selfCheckIn(branchId: string, rawPhone: string): Promise<SelfCheckIn> {
  const phone = indianPhone.safeParse(rawPhone);
  if (!phone.success) throw new UserError("Enter your 10-digit mobile number.");
  const point = await checkInPoint(branchId);
  if (!point?.open) return { status: "desk" };

  const m = await db.member.findFirst({ where: { orgId: point.orgId, branchId, phone: phone.data, deletedAt: null, erasedAt: null, walkIn: false } });
  if (!m) return { status: "desk" };

  const today = todayIso();
  const [sum, frozen, rules] = await Promise.all([summarize([m.id], today).then((s) => s.get(m.id)!), frozenBlocks([m.id], today), getAccessRules(point.orgId)]);
  if (frozen.has(m.id) || entryBlock({ suspended: m.suspended, ...sum }, rules, today, nowHHMM())) return { status: "desk" };

  const at = new Date();
  const entered = await db.$transaction(async (tx) => {
    // Two scans of the same number at once must not both get in.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`self-checkin:${m.id}`}))`;
    if (await tx.attendance.findFirst({ where: { memberId: m.id, date: fromIso(today), checkOut: null }, select: { id: true } })) return false;
    await tx.attendance.create({ data: { branchId, memberId: m.id, type: "MEMBER", date: fromIso(today), checkIn: at, method: "QR", createdById: null } });
    return true;
  });
  return entered ? { status: "in", firstName: m.name.trim().split(/\s+/)[0] ?? m.name, at: fmtTime(at) } : { status: "inside" };
}
