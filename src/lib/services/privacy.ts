import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/auth/current";
import { deleteObject } from "@/lib/integrations/storage";
import { audit } from "./audit";
import { UserError } from "./errors";
import { getGymProfile, getSetting, putSetting } from "./settings";
import { summarize } from "./members";
import { eraseBiometrics } from "./biometric";
import { fromIso, todayIso, toIso } from "./time";
import { formatRupees, fmtDate } from "@/lib/format";
import { DEFAULT_PRIVACY, anonymisedMember, editedSections, filledPersonalFields, retentionCutoff, type NoticeKey, type PrivacySettings } from "@/lib/domain/privacy";
import { log } from "@/lib/log";

const OPEN_MANDATE = ["Pending", "Active", "Paused"];

/** The `privacy` Setting merged over the defaults (officer, retention, notice, cookie text). */
export async function getPrivacySettings(orgId: string): Promise<PrivacySettings & typeof DEFAULT_PRIVACY> {
  const s = (await getSetting<PrivacySettings>(orgId, "privacy")) ?? {};
  return { ...DEFAULT_PRIVACY, ...s, notice: s.notice ?? {}, retainMonths: typeof s.retainMonths === "number" && s.retainMonths >= 0 ? Math.floor(s.retainMonths) : DEFAULT_PRIVACY.retainMonths };
}

/** Saves the edited notice sections (only those that differ from the template) or resets to the template. */
export async function savePrivacyNotice(u: CurrentUser, posted: Partial<Record<NoticeKey, string>> | null) {
  const notice = posted ? editedSections(posted, (await getGymProfile(u.orgId)).name) : {};
  await putSetting(u, "privacy", { notice, noticeUpdatedAt: todayIso() });
  return notice;
}

export const assertCanErase = (u: CurrentUser) => {
  if (!u.can("settings.manage") || !u.can("members.delete")) throw new UserError("Only someone who can delete members may erase data.");
};

/** A member by ID, in the user's gym and branches — including members who were deleted (they may still ask). */
export async function findMemberByCode(u: CurrentUser, code: string) {
  const c = code.trim().split(/\s+/)[0] ?? "";
  if (!c) return null;
  return db.member.findFirst({ where: { orgId: u.orgId, branchId: { in: u.branchIds }, walkIn: false, code: { equals: c, mode: "insensitive" } } });
}

/** "{n} of {n} members have given consent": registration consent is taken on the member form, so every member counts. */
export async function countConsented(u: CurrentUser) {
  const total = await db.member.count({ where: { orgId: u.orgId, deletedAt: null, walkIn: false } });
  return { consented: total, total };
}

/** Everything the gym holds about one member, as a file (biometric templates and device PINs never leave the system). */
export async function exportMemberData(u: CurrentUser, memberId: string) {
  const m = await db.member.findFirst({ where: { orgId: u.orgId, branchId: { in: u.branchIds }, walkIn: false, id: memberId }, include: { branch: { select: { name: true } } } });
  if (!m) throw new UserError("Member not found.");
  const [gym, trainer, memberships, invoices, payments, freezes, attendance, bookings, progress, messages, documents, mandates] = await Promise.all([
    getGymProfile(u.orgId),
    m.trainerId ? db.user.findUnique({ where: { id: m.trainerId }, select: { name: true } }) : null,
    db.membership.findMany({ where: { memberId }, orderBy: { startDate: "asc" }, include: { plan: { select: { name: true } } } }),
    db.invoice.findMany({ where: { memberId }, orderBy: { date: "asc" }, include: { items: true } }),
    db.payment.findMany({ where: { memberId }, orderBy: { date: "asc" } }),
    db.membershipFreeze.findMany({ where: { memberId }, orderBy: { fromDate: "asc" } }),
    db.attendance.findMany({ where: { memberId }, orderBy: { checkIn: "asc" } }),
    db.booking.findMany({ where: { memberId }, orderBy: { date: "asc" }, include: { classSlot: { select: { name: true, startTime: true } } } }),
    db.progressLog.findMany({ where: { memberId }, orderBy: { date: "asc" } }),
    db.whatsAppMessage.findMany({ where: { memberId }, orderBy: { sentAt: "asc" } }),
    db.memberDocument.findMany({ where: { memberId }, orderBy: { createdAt: "asc" } }),
    db.autopayMandate.findMany({ where: { memberId }, orderBy: { createdAt: "asc" } }),
  ]);
  const json = {
    exportedAt: new Date().toISOString(),
    gym: gym.name,
    amountsIn: "paise",
    member: {
      code: m.code,
      name: m.name,
      gender: m.gender,
      dob: m.dob ? toIso(m.dob) : null,
      phone: m.phone,
      whatsapp: m.whatsapp,
      email: m.email,
      occupation: m.occupation,
      address: { house: m.house, area: m.area, city: m.city, state: m.state, pin: m.pin },
      emergency: { name: m.emergencyName, relation: m.emergencyRelation, phone: m.emergencyPhone },
      source: m.source,
      tags: m.tags,
      notes: m.notes,
      joinedAt: m.createdAt.toISOString(),
      branch: m.branch.name,
      trainer: trainer?.name ?? null,
      biometricConsentAt: m.biometricConsentAt?.toISOString() ?? null,
      devicePin: null,
    },
    memberships: memberships.map((x) => ({ code: x.code, plan: x.plan.name, type: x.type, startDate: toIso(x.startDate), endDate: toIso(x.endDate), price: x.price, discount: x.discount, status: x.status })),
    invoices: invoices.map((i) => ({
      number: i.number,
      date: toIso(i.date),
      dueDate: toIso(i.dueDate),
      subtotal: i.subtotal,
      discount: i.discount,
      tax: i.tax,
      total: i.total,
      status: i.status,
      items: i.items.map((it) => ({ description: it.description, qty: it.qty, rate: it.rate, discount: it.discount, taxAmount: it.taxAmount, amount: it.amount })),
    })),
    payments: payments.map((p) => ({ code: p.code, date: toIso(p.date), amount: p.amount, method: p.method, txnRef: p.txnRef, status: p.status })),
    freezes: freezes.map((f) => ({ fromDate: toIso(f.fromDate), days: f.days, reason: f.reason, endedOn: f.endedOn ? toIso(f.endedOn) : null })),
    attendance: attendance.map((a) => ({ date: toIso(a.date), checkIn: a.checkIn.toISOString(), checkOut: a.checkOut?.toISOString() ?? null, method: a.method })),
    bookings: bookings.map((b) => ({ date: toIso(b.date), class: b.classSlot.name, time: b.classSlot.startTime, status: b.status })),
    progress: progress.map((p) => ({ date: toIso(p.date), weightKg: p.weightKg?.toString() ?? null, bodyFat: p.bodyFat?.toString() ?? null, waistCm: p.waistCm?.toString() ?? null, notes: p.notes })),
    messages: messages.map((w) => ({ sentAt: w.sentAt.toISOString(), templateKey: w.templateKey, toNumber: w.toNumber, body: w.body, status: w.status })),
    documents: documents.map((d) => ({ kind: d.kind, title: d.title, fileName: d.fileName, size: d.size, createdAt: d.createdAt.toISOString(), status: d.status })),
    autopayMandates: mandates.map((x) => ({ code: x.code, status: x.status, amount: x.amount, months: x.months, nextDebitOn: x.nextDebitOn ? toIso(x.nextDebitOn) : null, vpa: x.vpa })),
  };
  await db.$transaction((tx) =>
    audit(tx, {
      orgId: u.orgId,
      userId: u.id,
      action: "member.export",
      entity: "Member",
      entityId: m.id,
      after: { code: m.code, name: m.name, counts: { invoices: invoices.length, payments: payments.length, messages: messages.length, documents: documents.length } },
    }),
  );
  return { filename: `${m.code}-personal-data.json`, json };
}

/** What stands in the way of an erasure, if anything. */
export async function eraseCheck(memberId: string, today = todayIso()) {
  const [m, s, mandate] = await Promise.all([
    db.member.findUniqueOrThrow({ where: { id: memberId }, select: { erasedAt: true } }),
    summarize([memberId], today).then((x) => x.get(memberId)!),
    db.autopayMandate.findFirst({ where: { memberId, status: { in: OPEN_MANDATE } }, select: { id: true } }),
  ]);
  const activeTill = s.latestEnd && s.latestEnd >= today ? s.latestEnd : null;
  return { outstanding: s.outstanding, activeTill, mandateOpen: !!mandate, erasedAt: m.erasedAt };
}

type Erased = { code: string; documents: number; messages: number };

/**
 * Strips a member's personal data (DPDP erasure). Invoices, payments, memberships and attendance keep
 * only the member ID: tax law requires financial records to be kept. Audits `member.erase` with no values.
 */
export async function eraseMember(u: CurrentUser, memberId: string, reason: string, opts: { today?: string; now?: Date; system?: boolean } = {}): Promise<Erased> {
  const today = opts.today ?? todayIso();
  const now = opts.now ?? new Date();
  const m = await db.member.findFirst({ where: { orgId: u.orgId, branchId: { in: u.branchIds }, walkIn: false, id: memberId } });
  if (!m) throw new UserError("Member not found.");
  if (m.erasedAt) throw new UserError("This member's personal data was already erased.");
  const c = await eraseCheck(m.id, today);
  if (c.outstanding > 0) throw new UserError(`Settle the ${formatRupees(c.outstanding)} balance before erasing.`);
  if (c.activeTill || c.mandateOpen) throw new UserError(`${m.name} is still a member till ${fmtDate(c.activeTill ?? today)}. End the membership (and any autopay mandate) before erasing.`);
  if (!reason.trim()) throw new UserError("Give a reason.", "reason");

  const docs = await db.memberDocument.findMany({ where: { orgId: u.orgId, memberId: m.id }, select: { storageKey: true } });
  const userId = opts.system ? null : u.id;
  const out = await db.$transaction(async (tx) => {
    const hadBiometrics = !!(m.devicePin || m.biometricConsentAt);
    await eraseBiometrics(u, m.id, tx);
    const removedDocs = (await tx.memberDocument.deleteMany({ where: { orgId: u.orgId, memberId: m.id } })).count;
    const removedMsgs = (await tx.whatsAppMessage.deleteMany({ where: { memberId: m.id } })).count;
    await tx.progressLog.updateMany({ where: { memberId: m.id }, data: { notes: null } });
    await tx.lead.updateMany({ where: { memberId: m.id }, data: { name: "Erased member", phone: "", notes: null } });
    await tx.autopayMandate.updateMany({ where: { memberId: m.id }, data: { vpa: null, shortUrl: null } });
    await tx.trainerMember.updateMany({ where: { gymMemberId: m.id }, data: { gymMemberId: null, gymLinkedAt: null } });
    await tx.member.update({ where: { id: m.id }, data: anonymisedMember(now, m.deletedAt) });
    await audit(tx, {
      orgId: u.orgId,
      userId,
      action: "member.erase",
      entity: "Member",
      entityId: m.id,
      before: { code: m.code, fields: filledPersonalFields(m as unknown as Record<string, unknown>) },
      after: { code: m.code, reason: reason.trim(), documents: removedDocs, messages: removedMsgs, biometrics: hadBiometrics },
    });
    return { code: m.code, documents: removedDocs, messages: removedMsgs };
  });
  // Storage objects go after the rows are gone; a failed delete is logged, not fatal (as in documents.ts).
  for (const key of [...docs.map((d) => d.storageKey), ...(m.photoKey ? [m.photoKey] : [])]) {
    try {
      await deleteObject(key);
    } catch (e) {
      log.error("privacy.delete_object_failed", e, { key });
    }
  }
  return out;
}

/** The latest member-rights requests, from the audit log (exports and erasures are the record). */
export async function listPrivacyRequests(u: CurrentUser) {
  const rows = await db.auditLog.findMany({ where: { orgId: u.orgId, entity: "Member", action: { in: ["member.export", "member.erase"] } }, orderBy: { id: "desc" }, take: 8 });
  return rows.map((r) => {
    const after = (r.after ?? {}) as { code?: string; name?: string };
    const code = after.code ?? r.entityId;
    return { id: r.id, at: r.createdAt, type: r.action === "member.export" ? "Access (data export)" : "Erasure", who: r.action === "member.export" && after.name ? `${after.name} (${code})` : code, status: "Completed" as const };
  });
}

/** Daily job: erase members whose retention period after their last membership is over. */
export async function runRetention(u: CurrentUser, today = todayIso(), now = new Date()): Promise<Record<string, number | string>> {
  const { retainMonths } = await getPrivacySettings(u.orgId);
  const cutoff = retentionCutoff(today, retainMonths);
  if (!cutoff) return { erased: 0, note: "off" };
  const cutoffDate = fromIso(cutoff);
  const where: Prisma.MemberWhereInput = {
    orgId: u.orgId,
    walkIn: false,
    erasedAt: null,
    createdAt: { lt: cutoffDate },
    memberships: { none: { status: "VALID", endDate: { gte: cutoffDate } } },
    mandates: { none: { status: { in: OPEN_MANDATE } } },
  };
  const candidates = await db.member.findMany({ where, select: { id: true } });
  let erased = 0;
  for (const c of candidates) {
    const check = await eraseCheck(c.id, today);
    if (check.outstanding > 0 || check.activeTill || check.mandateOpen || check.erasedAt) continue;
    await eraseMember(u, c.id, `Retention period of ${retainMonths} months ended`, { today, now, system: true });
    erased++;
  }
  return { erased, retainMonths };
}
