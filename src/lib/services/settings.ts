import "server-only";
import { claimSlot, gymPlan } from "./saas";
import { fromIso, todayIso } from "./time";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "./audit";
import { UserError } from "./errors";
import type { GymInput, TaxInput } from "@/lib/validation/settings";
import { DEFAULT_IDLE_MINUTES } from "@/lib/domain/security";

type Tx = Prisma.TransactionClient;

export async function getSetting<T>(orgId: string, key: string): Promise<T | null> {
  const s = await db.setting.findUnique({ where: { orgId_key: { orgId, key } } });
  return (s?.value as T) ?? null;
}

/** Settings a Super Admin may change from the app. */
export const EDITABLE_SETTINGS = ["gym", "tax", "numbering", "access", "whatsapp", "reminders", "autopay", "ai", "migration", "opening", "subscription", "security", "privacy", "reports", "onboarding"] as const;
export type EditableSetting = (typeof EDITABLE_SETTINGS)[number];

/** Merges `value` into the setting and audits it, inside the caller's transaction. */
export async function putSettingIn(tx: Tx, u: CurrentUser, key: EditableSetting, value: Record<string, unknown>) {
  const row = await tx.setting.findUnique({ where: { orgId_key: { orgId: u.orgId, key } } });
  const before = (row?.value as Record<string, unknown> | null) ?? null;
  const merged = { ...(before ?? {}), ...value } as Prisma.InputJsonValue;
  await tx.setting.upsert({ where: { orgId_key: { orgId: u.orgId, key } }, create: { orgId: u.orgId, key, value: merged }, update: { value: merged } });
  await audit(tx, { orgId: u.orgId, userId: u.id, action: "setting.update", entity: "Setting", entityId: key, before, after: merged });
  return merged;
}

export async function putSetting(u: CurrentUser, key: EditableSetting, value: Record<string, unknown>) {
  await db.$transaction((tx) => putSettingIn(tx, u, key, value));
}

/** Settings › Gym profile. Shown in the sidebar, on invoices, in WhatsApp messages and Fitron AI. */
export type GymProfile = {
  name: string;
  tagline?: string;
  address?: string;
  state?: string;
  phone?: string;
  email?: string;
  website?: string;
  instagram?: string;
  /** Private storage key of the uploaded logo; the default FITRON logo shows when unset. */
  logoKey?: string | null;
};

/** The gym's profile; the name falls back to the organisation's, so it is never empty. */
export async function getGymProfile(orgId: string): Promise<GymProfile> {
  const s = (await getSetting<Partial<GymProfile>>(orgId, "gym")) ?? {};
  if (s.name?.trim()) return { ...s, name: s.name.trim() };
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } });
  return { ...s, name: org.name };
}

/**
 * Saves the profile fields (keeping the logo) and renames the organisation to match, so the
 * FITRON admin console and emails never show a different name from the invoices.
 */
export async function saveGymProfile(u: CurrentUser, v: GymInput) {
  const value: Record<string, unknown> = {
    name: v.name,
    tagline: v.tagline ?? "",
    address: v.address ?? "",
    state: v.state ?? "",
    phone: v.phone ?? "",
    email: v.email ?? "",
    website: v.website ?? "",
    instagram: v.instagram ?? "",
  };
  await db.$transaction(async (tx) => {
    await putSettingIn(tx, u, "gym", value);
    await tx.organization.update({ where: { id: u.orgId }, data: { name: v.name } });
  });
}

/**
 * Settings › Billing & GST. The invoice prefix has one home (numbering.invoicePrefix), shown here
 * and in the Numbering panel; it is only rewritten (and audited) when it changes.
 */
export async function saveTax(u: CurrentUser, v: TaxInput) {
  const { invoicePrefix, ...tax } = v;
  await db.$transaction(async (tx) => {
    await putSettingIn(tx, u, "tax", { enabled: tax.enabled, rate: tax.rate, type: tax.type, gstin: tax.gstin ?? "", sac: tax.sac ?? "" });
    const numbering = (await tx.setting.findUnique({ where: { orgId_key: { orgId: u.orgId, key: "numbering" } } }))?.value as { invoicePrefix?: string } | null;
    if ((numbering?.invoicePrefix ?? "INV-") !== invoicePrefix) await putSettingIn(tx, u, "numbering", { invoicePrefix });
  });
}

type BranchValues = { name: string; short?: string; address: string; phone: string; manager?: string; hours?: string; invoicePrefix?: string; gstin?: string };

export async function saveBranch(u: CurrentUser, id: string | null, v: BranchValues) {
  const data = { name: v.name, short: v.short ?? null, address: v.address, phone: v.phone, manager: v.manager ?? null, hours: v.hours ?? null, invoicePrefix: v.invoicePrefix || null, gstin: v.gstin ?? null };
  await db.$transaction(async (tx) => {
    const clash = !v.short ? null : await tx.branch.findFirst({ where: { orgId: u.orgId, short: { equals: v.short, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
    if (clash) throw new UserError("Another branch already uses this short name.", "short");
    if (id) {
      const before = await tx.branch.findFirst({ where: { orgId: u.orgId, id } });
      if (!before) throw new UserError("Branch not found.");
      const after = await tx.branch.update({ where: { id }, data });
      await audit(tx, { orgId: u.orgId, userId: u.id, action: "branch.update", entity: "Branch", entityId: id, before, after });
    } else {
      const after = await tx.branch.create({ data: { ...data, orgId: u.orgId } });
      await claimSlot(tx, u.orgId, after.id);
      await audit(tx, { orgId: u.orgId, userId: u.id, action: "branch.create", entity: "Branch", entityId: after.id, after });
    }
  });
}

/** Closes (read-only, hidden from the switcher) or reopens a branch. Nothing is deleted. */
export async function setBranchActive(u: CurrentUser, id: string, active: boolean) {
  await db.$transaction(async (tx) => {
    const before = await tx.branch.findFirst({ where: { orgId: u.orgId, id } });
    if (!before) throw new UserError("Branch not found.");
    if (before.active === active) return;
    if (!active) {
      const others = await tx.branch.count({ where: { orgId: u.orgId, active: true, id: { not: id } } });
      if (!others) throw new UserError("At least one branch must stay active.");
    } else {
      const { terms, name: planName } = await gymPlan(u.orgId, todayIso(), tx);
      const others = await tx.branch.count({ where: { orgId: u.orgId, active: true, id: { not: id } } });
      if (others >= terms.includedBranches) {
        const own = await tx.branchSubscription.findFirst({ where: { orgId: u.orgId, kind: "BRANCH", status: "PAID", branchId: id, periodEnd: { gte: fromIso(todayIso()) } }, select: { id: true } });
        if (!own) {
          if (!terms.extraBranches) throw new UserError(`The ${planName} plan is for one branch. Move to Enterprise in Settings › Plan & billing to add more.`);
          const slot = await tx.branchSubscription.findFirst({ where: { orgId: u.orgId, kind: "BRANCH", status: "PAID", branchId: null, periodEnd: { gte: fromIso(todayIso()) } }, orderBy: { periodEnd: "asc" } });
          const claimed = slot ? await tx.branchSubscription.updateMany({ where: { id: slot.id, branchId: null }, data: { branchId: id } }) : { count: 0 };
          if (!claimed.count) throw new UserError(`You already use ${terms.includedBranches} branches. Buy an extra branch to reopen this one.`);
        }
      }
    }
    const after = await tx.branch.update({ where: { id }, data: { active, deactivatedAt: active ? null : new Date() } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: active ? "branch.activate" : "branch.deactivate", entity: "Branch", entityId: id, before: { active: before.active, deactivatedAt: before.deactivatedAt }, after: { active: after.active, deactivatedAt: after.deactivatedAt } });
  });
}

/** Rows of each kind that point at a branch; any of them means the branch can only be closed. */
export async function branchRecordCounts(orgId: string, ids: string[], tx: Tx | typeof db = db) {
  const where = { branchId: { in: ids } };
  const by = async (rows: PromiseLike<unknown>) => new Map(((await rows) as { branchId: string | null; _count: number }[]).map((r) => [r.branchId, r._count]));
  const [members, memberships, invoices, payments, expenses, locks, attendance, leads, slots, products, assets, purchases, mandates, devices, access] = await Promise.all([
    by(tx.member.groupBy({ by: ["branchId"], where: { orgId, ...where }, _count: true })),
    by(tx.membership.groupBy({ by: ["branchId"], where, _count: true })),
    by(tx.invoice.groupBy({ by: ["branchId"], where: { orgId, ...where }, _count: true })),
    by(tx.payment.groupBy({ by: ["branchId"], where, _count: true })),
    by(tx.expense.groupBy({ by: ["branchId"], where: { orgId, ...where }, _count: true })),
    by(tx.monthLock.groupBy({ by: ["branchId"], where, _count: true })),
    by(tx.attendance.groupBy({ by: ["branchId"], where, _count: true })),
    by(tx.lead.groupBy({ by: ["branchId"], where, _count: true })),
    by(tx.classSlot.groupBy({ by: ["branchId"], where, _count: true })),
    by(tx.product.groupBy({ by: ["branchId"], where, _count: true })),
    by(tx.asset.groupBy({ by: ["branchId"], where, _count: true })),
    by(tx.purchase.groupBy({ by: ["branchId"], where, _count: true })),
    by(tx.autopayMandate.groupBy({ by: ["branchId"], where, _count: true })),
    by(tx.device.groupBy({ by: ["branchId"], where, _count: true })),
    by(tx.accessLog.groupBy({ by: ["branchId"], where, _count: true })),
  ]);
  const all = [members, memberships, invoices, payments, expenses, locks, attendance, leads, slots, products, assets, purchases, mandates, devices, access];
  return new Map(ids.map((id) => [id, { members: members.get(id) ?? 0, invoices: invoices.get(id) ?? 0, expenses: expenses.get(id) ?? 0, total: all.reduce((a, m) => a + (m.get(id) ?? 0), 0) }]));
}

export async function deleteBranch(u: CurrentUser, id: string, reason: string) {
  await db.$transaction(async (tx) => {
    const before = await tx.branch.findFirst({ where: { orgId: u.orgId, id } });
    if (!before) throw new UserError("Branch not found.");
    if ((await tx.branch.count({ where: { orgId: u.orgId } })) < 2) throw new UserError("You can’t delete your only branch.");
    const c = (await branchRecordCounts(u.orgId, [id], tx)).get(id)!;
    if (c.total > 0) throw new UserError(`${before.name} has records, so it can’t be deleted. Close it instead; its history stays in reports.`);
    await tx.userBranch.deleteMany({ where: { branchId: id } });
    await tx.device.updateMany({ where: { branchId: id }, data: { branchId: null } });
    await tx.branchSubscription.updateMany({ where: { orgId: u.orgId, branchId: id }, data: { branchId: null } });
    await tx.notification.updateMany({ where: { branchId: id }, data: { branchId: null } });
    await tx.branch.delete({ where: { id } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "branch.delete", entity: "Branch", entityId: id, before, after: { reason } });
  });
}

/** Minutes without activity before staff are signed out (Setting `security`; 0 = never). */
export async function getIdleMinutes(orgId: string) {
  const s = await getSetting<{ idleMinutes?: number }>(orgId, "security");
  const m = s?.idleMinutes;
  return typeof m === "number" && Number.isFinite(m) && m >= 0 ? Math.floor(m) : DEFAULT_IDLE_MINUTES;
}

/** Settings › Privacy & DPDP: the grievance officer and how long data is kept after a membership ends. */
export type PrivacySetting = { officer?: string; email?: string; phone?: string; retainMonths?: number };
export const getPrivacy = async (orgId: string): Promise<PrivacySetting> => (await getSetting<PrivacySetting>(orgId, "privacy")) ?? {};
