import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { writeBranch } from "@/lib/auth/current";
import { membershipStatus, type MembershipStatus } from "@/lib/domain/membership";
import { invoiceState } from "@/lib/domain/billing";
import type { MemberInput } from "@/lib/validation/member";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "./audit";
import { nextNumber } from "./sequence";
import { isUniqueViolation, UserError } from "./errors";
import { todayIso, toIso, fromIso } from "./time";
import { getSetting } from "./settings";
import { markLeadWon } from "./leads";
import { eraseBiometrics } from "./biometric";
import { randomUUID } from "node:crypto";
import { deleteObject, getObject, putObject, sniffType } from "@/lib/integrations/storage";
import { formatRupees } from "@/lib/format";
import { assertBranchWritable, assertMemberRoom } from "./saas";

/** Members a user may see: their branches, and only assigned members for trainers. */
export function memberScope(u: CurrentUser): Prisma.MemberWhereInput {
  return {
    orgId: u.orgId,
    branchId: { in: u.branchIds },
    deletedAt: null,
    ...(u.can("members.all") ? {} : { trainerId: u.id }),
  };
}

export type MemberRow = {
  id: string;
  code: string;
  name: string;
  phone: string;
  gender: string;
  area: string | null;
  branchId: string;
  planName: string | null;
  /** Start of the membership planName was taken from. */
  planStart: string | null;
  latestEnd: string | null;
  outstanding: number;
  status: MembershipStatus;
};

/** Latest end date, current plan and outstanding balance for each member, computed (rules 3, 4, 11). */
export async function summarize(memberIds: string[], today = todayIso()) {
  const [memberships, invoices] = await Promise.all([
    db.membership.findMany({
      where: { memberId: { in: memberIds }, status: "VALID" },
      select: { memberId: true, startDate: true, endDate: true, plan: { select: { name: true } } },
      orderBy: { startDate: "asc" },
    }),
    db.invoice.findMany({
      where: { memberId: { in: memberIds }, status: "ISSUED" },
      select: { memberId: true, total: true, dueDate: true, payments: { select: { amount: true, status: true } } },
    }),
  ]);
  const out = new Map<string, { latestEnd: string | null; planName: string | null; planStart: string | null; outstanding: number }>();
  for (const id of memberIds) out.set(id, { latestEnd: null, planName: null, planStart: null, outstanding: 0 });
  const covering = new Set<string>();
  for (const m of memberships) {
    const s = out.get(m.memberId)!;
    const start = toIso(m.startDate);
    const end = toIso(m.endDate);
    // Current plan: the membership covering today; otherwise the one ending last.
    if (start <= today && end >= today) {
      s.planName = m.plan.name;
      s.planStart = start;
      covering.add(m.memberId);
    } else if (!covering.has(m.memberId) && (!s.latestEnd || end >= s.latestEnd)) {
      s.planName = m.plan.name;
      s.planStart = start;
    }
    if (!s.latestEnd || end > s.latestEnd) s.latestEnd = end;
  }
  for (const inv of invoices) {
    const st = invoiceState(
      { total: inv.total, cancelled: false, dueDate: toIso(inv.dueDate) },
      inv.payments as { amount: number; status: "SUCCESS" | "REVERSED" }[],
      today,
    );
    out.get(inv.memberId)!.outstanding += st.balance;
  }
  return out;
}

export async function listMembers(
  u: CurrentUser,
  f: { q?: string; status?: string; gender?: string; plan?: string; area?: string; page?: number; pageSize?: number; all?: boolean },
) {
  const q = f.q?.trim();
  const where: Prisma.MemberWhereInput = {
    ...memberScope(u),
    walkIn: false,
    ...(f.gender ? { gender: f.gender } : {}),
    ...(f.area ? { area: f.area } : {}),
    ...(f.status === "RISK" ? { riskScore: { gte: 40 } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { phone: { contains: q.replace(/\s/g, "") } },
            { code: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const members = await db.member.findMany({
    where,
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true, phone: true, gender: true, area: true, branchId: true, suspended: true },
  });
  const today = todayIso();
  const sums = await summarize(members.map((m) => m.id), today);
  let rows: MemberRow[] = members.map((m) => {
    const s = sums.get(m.id)!;
    return {
      ...m,
      ...s,
      status: membershipStatus({ suspended: m.suspended, latestEnd: s.latestEnd, outstanding: s.outstanding, today }),
    };
  });
  // DUE: any balance owed; RISK (Fitron AI score) is filtered in the query.
  if (f.status === "DUE") rows = rows.filter((r) => r.outstanding > 0);
  else if (f.status && f.status !== "RISK") rows = rows.filter((r) => r.status === f.status);
  if (f.plan) rows = rows.filter((r) => r.planName === f.plan);
  const counts = rows.reduce<Record<string, number>>((c, r) => ((c[r.status] = (c[r.status] ?? 0) + 1), c), {});
  const pageSize = f.all ? Math.max(1, rows.length) : (f.pageSize ?? 50);
  const page = Math.max(1, f.page ?? 1);
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, counts };
}

export async function getMember(u: CurrentUser, id: string) {
  const m = await db.member.findFirst({ where: { ...memberScope(u), id }, include: { branch: true } });
  if (!m) return null;
  const today = todayIso();
  const s = (await summarize([m.id], today)).get(m.id)!;
  const trainer = m.trainerId ? await db.user.findUnique({ where: { id: m.trainerId }, select: { name: true } }) : null;
  return {
    ...m,
    ...s,
    trainerName: trainer?.name ?? null,
    status: membershipStatus({ suspended: m.suspended, latestEnd: s.latestEnd, outstanding: s.outstanding, today }),
  };
}

const toData = (i: MemberInput) => ({
  ...i,
  dob: i.dob ? fromIso(i.dob) : null,
  whatsapp: i.whatsapp ?? null,
  email: i.email ?? null,
  trainerId: i.trainerId ?? null,
});

async function assertPhoneFree(tx: Prisma.TransactionClient, orgId: string, phone: string, exceptId?: string) {
  const clash = await tx.member.findFirst({
    where: { orgId, phone, deletedAt: null, walkIn: false, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { code: true, name: true },
  });
  if (clash) throw new UserError(`This phone number already belongs to ${clash.name} (${clash.code}).`, "phone");
}

export async function createMember(u: CurrentUser, input: MemberInput, opts: { leadId?: string } = {}) {
  const branchId = writeBranch(u);
  if (!branchId) throw new UserError("Pick a branch first.");
  const prefix = (await getSetting<{ memberPrefix?: string }>(u.orgId, "numbering"))?.memberPrefix ?? "FT-";
  try {
    return await db.$transaction(async (tx) => {
      await assertPhoneFree(tx, u.orgId, input.phone);
      await assertBranchWritable(tx, u.orgId, branchId);
      await assertMemberRoom(tx, u.orgId);
      const n = await nextNumber(tx, u.orgId, "member");
      const m = await tx.member.create({
        data: { ...toData(input), code: `${prefix}${n}`, orgId: u.orgId, branchId, createdById: u.id },
      });
      await audit(tx, { orgId: u.orgId, userId: u.id, action: "member.create", entity: "Member", entityId: m.id, after: m });
      if (opts.leadId) await markLeadWon(tx, u, opts.leadId, m.id);
      return m;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserError("This phone number is already registered.", "phone");
    throw e;
  }
}

export async function updateMember(u: CurrentUser, id: string, input: MemberInput) {
  const before = await db.member.findFirst({ where: { ...memberScope(u), id } });
  if (!before) throw new UserError("Member not found.");
  try {
    return await db.$transaction(async (tx) => {
      await assertPhoneFree(tx, u.orgId, input.phone, id);
      const after = await tx.member.update({ where: { id }, data: toData(input) });
      await audit(tx, { orgId: u.orgId, userId: u.id, action: "member.update", entity: "Member", entityId: id, before, after });
      return after;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserError("This phone number is already registered.", "phone");
    throw e;
  }
}

export async function setSuspended(u: CurrentUser, id: string, suspended: boolean) {
  const before = await db.member.findFirst({ where: { ...memberScope(u), id } });
  if (!before) throw new UserError("Member not found.");
  await db.$transaction(async (tx) => {
    const after = await tx.member.update({ where: { id }, data: { suspended } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: suspended ? "member.suspend" : "member.resume", entity: "Member", entityId: id, before, after });
  });
}

/** Rule 9: members are soft-deleted; their financial history stays. Needs a reason and a settled balance. */
export async function deleteMember(u: CurrentUser, id: string, reason: string) {
  const before = await db.member.findFirst({ where: { ...memberScope(u), id, walkIn: false } });
  if (!before) throw new UserError("Member not found.");
  const why = reason.trim();
  if (why.length < 3) throw new UserError("Give a reason.", "reason");
  if (why.length > 300) throw new UserError("Keep the reason under 300 characters.", "reason");
  const { outstanding } = (await summarize([id])).get(id)!;
  if (outstanding > 0) throw new UserError(`${before.name} still owes ${formatRupees(outstanding)}. Collect it or cancel the invoice before deleting.`);
  await db.$transaction(async (tx) => {
    // Biometric data doesn't outlive the member (DPDP).
    await eraseBiometrics(u, id, tx);
    const mandates = await tx.autopayMandate.findMany({ where: { memberId: id, status: { in: ["Pending", "Active", "Paused", "Failed", "Halted"] } }, select: { id: true } });
    if (mandates.length) {
      await tx.autopayMandate.updateMany({ where: { id: { in: mandates.map((x) => x.id) } }, data: { status: "Cancelled", lastResult: "Member deleted" } });
      for (const x of mandates) await audit(tx, { orgId: u.orgId, userId: u.id, action: "mandate.cancel", entity: "AutopayMandate", entityId: x.id, after: { reason: "Member deleted" } });
    }
    await tx.attendance.updateMany({ where: { memberId: id, checkOut: null }, data: { checkOut: new Date() } });
    const after = await tx.member.update({ where: { id }, data: { deletedAt: new Date(), deletedById: u.id, deleteReason: why } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "member.delete", entity: "Member", entityId: id, before, after: { ...after, deleteReason: why } });
  });
}

/** Members deleted in the picked branch(es), newest first, with who deleted them and why (for "Recently deleted"). */
export async function listDeleted(u: CurrentUser) {
  const gone = await db.member.findMany({
    where: { orgId: u.orgId, branchId: { in: u.branchIds }, walkIn: false, deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    take: 50,
    select: { id: true, code: true, name: true, deletedAt: true, erasedAt: true, deletedById: true, deleteReason: true },
  });
  // Members deleted before the reason was recorded: the audit log knows who.
  const legacy = gone.filter((m) => !m.deletedById).map((m) => m.id);
  const logs = legacy.length ? await db.auditLog.findMany({ where: { orgId: u.orgId, entity: "Member", action: "member.delete", entityId: { in: legacy } }, orderBy: { id: "desc" }, select: { entityId: true, userId: true } }) : [];
  const ids = [...new Set([...gone.map((m) => m.deletedById), ...logs.map((l) => l.userId)].filter((x): x is string => !!x))];
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return gone.map((m) => {
    const by = m.deletedById ?? logs.find((l) => l.entityId === m.id)?.userId;
    return { ...m, deletedBy: users.find((x) => x.id === by)?.name ?? "—", deleteReason: m.deleteReason };
  });
}

/** Brings a deleted member back, unless their phone now belongs to someone else. */
export async function restoreMember(u: CurrentUser, id: string) {
  const before = await db.member.findFirst({ where: { orgId: u.orgId, branchId: { in: u.branchIds }, id, deletedAt: { not: null } } });
  if (!before) throw new UserError("Member not found.");
  if (before.erasedAt) throw new UserError("This member's personal data was erased and can't be restored.");
  const clash = await db.member.findFirst({ where: { orgId: u.orgId, phone: before.phone, deletedAt: null, walkIn: false }, select: { code: true, name: true } });
  if (clash) throw new UserError(`${before.phone} now belongs to ${clash.name} (${clash.code}). Change one of the numbers first.`);
  await db.$transaction(async (tx) => {
    const after = await tx.member.update({ where: { id }, data: { deletedAt: null, deletedById: null, deleteReason: null } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "member.restore", entity: "Member", entityId: id, before, after });
  });
}

/** Options for a member picker: "PHG-1001 · Asha Verma". */
export async function memberOptions(u: CurrentUser) {
  const ms = await db.member.findMany({ where: { ...memberScope(u), walkIn: false }, select: { id: true, code: true, name: true, phone: true }, orderBy: { name: "asc" } });
  return ms.map((m) => ({ id: m.id, label: `${m.code} · ${m.name} · ${m.phone}` }));
}

/** Resolves what was typed in a member picker (the option label, or just the member ID). */
export async function resolveMemberRef(u: CurrentUser, text: string) {
  const code = text.trim().split(/\s+/)[0] ?? "";
  if (!code) return null;
  return db.member.findFirst({ where: { ...memberScope(u), walkIn: false, code: { equals: code, mode: "insensitive" } }, select: { id: true, name: true } });
}

// ---- Member photo (private, like staff photos) ----
export const MAX_MEMBER_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function checkPhoto(file: File) {
  if (!file || typeof file.arrayBuffer !== "function" || file.size === 0) throw new UserError("Choose a photo.", "photo");
  if (file.size > MAX_MEMBER_PHOTO_BYTES) throw new UserError("That photo is over 5 MB. Pick a smaller one.", "photo");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffType(bytes);
  if (!type || !PHOTO_TYPES.includes(type.mime)) throw new UserError("Use a JPG, PNG or WebP photo.", "photo");
  return { bytes, type };
}

/** The old file goes unless a document in the member's history still points at it. */
async function dropPhotoFile(key: string | null) {
  if (!key) return;
  if (await db.memberDocument.findFirst({ where: { storageKey: key }, select: { id: true } })) return;
  await deleteObject(key).catch(() => {});
}

export async function setMemberPhoto(u: CurrentUser, memberId: string, file: File) {
  const m = await db.member.findFirst({ where: { ...memberScope(u), id: memberId, walkIn: false }, select: { id: true } });
  if (!m) throw new UserError("Member not found.");
  const { bytes, type } = await checkPhoto(file);
  const key = `${u.orgId}/members/${memberId}/photo/${randomUUID()}.${type.ext}`;
  await putObject(key, bytes, type.mime);
  let old: string | null;
  try {
    old = await db.$transaction(async (tx) => {
      const { photoKey } = await tx.member.findUniqueOrThrow({ where: { id: memberId }, select: { photoKey: true } });
      await tx.member.update({ where: { id: memberId }, data: { photoKey: key } });
      await audit(tx, { orgId: u.orgId, userId: u.id, action: "member.photo", entity: "Member", entityId: memberId, before: { photoKey }, after: { photoKey: key } });
      return photoKey;
    });
  } catch (e) {
    await deleteObject(key).catch(() => {});
    throw e;
  }
  await dropPhotoFile(old);
}

export async function removeMemberPhoto(u: CurrentUser, memberId: string) {
  const m = await db.member.findFirst({ where: { ...memberScope(u), id: memberId, walkIn: false }, select: { id: true } });
  if (!m) throw new UserError("Member not found.");
  const old = await db.$transaction(async (tx) => {
    const { photoKey } = await tx.member.findUniqueOrThrow({ where: { id: memberId }, select: { photoKey: true } });
    if (!photoKey) return null;
    await tx.member.update({ where: { id: memberId }, data: { photoKey: null } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "member.photo.remove", entity: "Member", entityId: memberId, before: { photoKey }, after: { photoKey: null } });
    return photoKey;
  });
  await dropPhotoFile(old);
}

export async function readMemberPhoto(u: CurrentUser, memberId: string) {
  const m = await db.member.findFirst({ where: { ...memberScope(u), id: memberId }, select: { photoKey: true } });
  if (!m?.photoKey) return null;
  const ext = m.photoKey.split(".").pop();
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return { body: await getObject(m.photoKey), mime };
}
