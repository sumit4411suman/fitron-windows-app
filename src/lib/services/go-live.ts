import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { upgradePath } from "@/lib/auth/current";
import { checklist, type CheckInput, type Standing } from "@/lib/domain/go-live";
import { planFor } from "@/lib/domain/features";
import { daysBetween } from "@/lib/domain/dates";
import { fmtDate } from "@/lib/format";
import { deleteObject, storageMode } from "@/lib/integrations/storage";
import { providerStatus } from "@/lib/integrations/whatsapp";
import { razorpayReady } from "@/lib/integrations/razorpay";
import { audit } from "./audit";
import { getAutopayMode } from "./autopay";
import { backupStatus } from "./backup";
import { isDeviceOnline } from "./biometric";
import { UserError } from "./errors";
import { gymPlan } from "./saas";
import { getGymProfile, getIdleMinutes, getPrivacy, getSetting } from "./settings";
import { getTax } from "./tax";
import { todayIso } from "./time";
import { getWaSettings } from "./whatsapp";
import pkg from "../../../package.json";
import { allowDelete } from "./db-guard";

/** Settings › Go live: every check reads the gym's real state. */
export async function goLiveChecklist(u: CurrentUser) {
  const orgId = u.orgId;
  const today = todayIso();
  const [gym, tax, numbering, branches, activePlans, staff, wa, autopayMode, devices, privacy, backup, idleMinutes, plan, org, demoMembers] = await Promise.all([
    getGymProfile(orgId),
    getTax(orgId),
    getSetting<{ invoicePrefix?: string }>(orgId, "numbering"),
    db.branch.findMany({ where: { orgId }, orderBy: { createdAt: "asc" }, select: { name: true, gstin: true } }),
    db.membershipPlan.count({ where: { orgId, status: "ACTIVE" } }),
    db.user.count({ where: { orgId, deletedAt: null, active: true, role: { name: { not: "Super Admin" } } } }),
    getWaSettings(orgId),
    getAutopayMode(orgId),
    db.device.findMany({ where: { orgId, approved: true }, select: { lastSeenAt: true } }),
    getPrivacy(orgId),
    backupStatus(orgId),
    getIdleMinutes(orgId),
    gymPlan(orgId, today),
    db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { demo: true } }),
    db.member.count({ where: { orgId, deletedAt: null, walkIn: false } }),
  ]);
  const waStatus = wa.mode === "demo" ? { ok: false, text: "" } : await providerStatus(wa.mode, orgId);
  const s = plan.standing;
  const standing: Standing =
    s.kind === "TRIAL"
      ? { kind: "TRIAL", daysLeft: daysBetween(s.until, today) + 1 }
      : s.kind === "PAID"
        ? { kind: "PAID", until: fmtDate(s.until) }
        : s.kind === "GRACE"
          ? { kind: "GRACE", readOnlyFrom: fmtDate(s.readOnlyFrom) }
          : { kind: s.kind };
  const lastBackup = [backup.lastDownloadedAt, backup.lastManualAt, backup.lastAutoAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const facts: CheckInput = {
    gym: { name: gym.name, address: gym.address, city: gym.state, phone: gym.phone, email: gym.email, logoKey: gym.logoKey },
    tax: { enabled: tax.enabled, rate: tax.rate },
    invoicePrefix: numbering?.invoicePrefix ?? "INV-",
    branches,
    activePlans,
    staff,
    staffHref: u.has("staff") ? "/staff" : upgradePath(u, "staff"),
    wa: { mode: wa.mode, ok: waStatus.ok, text: waStatus.text },
    autopay: { mode: autopayMode, ready: razorpayReady() === null },
    devices: u.has("biometric")
      ? { total: devices.length, online: devices.filter((d) => isDeviceOnline(d)).length, planName: null, href: "/settings/devices" }
      : { total: devices.length, online: 0, planName: planFor("biometric")?.name ?? "Professional", href: upgradePath(u, "biometric") },
    privacy,
    backupAgeDays: lastBackup ? Math.max(0, daysBetween(today, todayIso(lastBackup))) : null,
    backupHref: "/settings/backup",
    idleMinutes,
    plan: { name: plan.name, standing },
    demo: org.demo,
    demoMembers,
  };
  return checklist(facts);
}

/** "This installation" panel: version, what is on the server, where files live. */
export async function installationInfo(orgId: string) {
  const [members, invoices, payments] = await Promise.all([
    db.member.count({ where: { orgId, deletedAt: null, walkIn: false } }),
    db.invoice.count({ where: { orgId } }),
    db.payment.count({ where: { orgId } }),
  ]);
  return { version: pkg.version, members, invoices, payments, storage: storageMode() === "S3" ? "S3" : "local disk" };
}

/**
 * Go live: removes every demo record of the seeded demo gym and keeps its set-up (profile, plans,
 * branches, staff, templates, devices, settings). Rows are not marked individually, so this only ever
 * runs for an organisation the seed flagged `demo`; every delete is scoped to that organisation.
 * It is the one write that removes locked-month money, because none of it was real.
 */
export async function clearDemoData(u: CurrentUser) {
  const orgId = u.orgId;
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { demo: true } });
  if (!org.demo) throw new UserError("This gym isn't running on demo data; there is nothing to clear.");

  // Files first, best effort: a missing object must not stop the clear.
  const docs = await db.memberDocument.findMany({ where: { orgId }, select: { storageKey: true } });
  for (const d of docs) await deleteObject(d.storageKey).catch(() => {});

  return db.$transaction(
    async (tx) => {
      // The database refuses to delete money records unless told why, and then only for a gym flagged demo.
      await allowDelete(tx, "demo-clear");
      const removed: Record<string, number> = {};
      const count = (key: string, r: { count: number }) => (removed[key] = r.count);
      count("autopayEvents", await tx.autopayEvent.deleteMany({ where: { mandate: { orgId } } }));
      count("autopayMandates", await tx.autopayMandate.deleteMany({ where: { orgId } }));
      count("whatsAppMessages", await tx.whatsAppMessage.deleteMany({ where: { orgId } }));
      count("notifications", await tx.notification.deleteMany({ where: { orgId } }));
      count("aiProposals", await tx.aiProposal.deleteMany({ where: { orgId } }));
      count("bookings", await tx.booking.deleteMany({ where: { classSlot: { orgId } } }));
      count("classSlots", await tx.classSlot.deleteMany({ where: { orgId } }));
      count("attendance", await tx.attendance.deleteMany({ where: { branch: { orgId } } }));
      const deviceIds = (await tx.device.findMany({ where: { orgId }, select: { id: true } })).map((d) => d.id);
      const memberIds = (await tx.member.findMany({ where: { orgId }, select: { id: true } })).map((m) => m.id);
      count("accessLogs", await tx.accessLog.deleteMany({ where: { deviceId: { in: deviceIds } } }));
      count("biometricTemplates", await tx.biometricTemplate.deleteMany({ where: { memberId: { in: memberIds } } }));
      count("deviceUsers", await tx.deviceUser.deleteMany({ where: { memberId: { in: memberIds } } }));
      count("documents", await tx.memberDocument.deleteMany({ where: { orgId } }));
      count("progressLogs", await tx.progressLog.deleteMany({ where: { member: { orgId } } }));
      count("freezes", await tx.membershipFreeze.deleteMany({ where: { orgId } }));
      count("memberships", await tx.membership.deleteMany({ where: { member: { orgId } } }));
      count("payments", await tx.payment.deleteMany({ where: { orgId } }));
      count("invoiceItems", await tx.invoiceItem.deleteMany({ where: { invoice: { orgId } } }));
      count("invoices", await tx.invoice.deleteMany({ where: { orgId } }));
      count("leads", await tx.lead.deleteMany({ where: { orgId } }));
      count("vendorPayments", await tx.vendorPayment.deleteMany({ where: { purchase: { orgId } } }));
      count("purchaseLines", await tx.purchaseLine.deleteMany({ where: { purchase: { orgId } } }));
      count("stockMovements", await tx.stockMovement.deleteMany({ where: { product: { orgId } } }));
      count("expenses", await tx.expense.deleteMany({ where: { orgId } }));
      count("purchases", await tx.purchase.deleteMany({ where: { orgId } }));
      count("assets", await tx.asset.deleteMany({ where: { orgId } }));
      count("products", await tx.product.deleteMany({ where: { orgId } }));
      count("members", await tx.member.deleteMany({ where: { orgId } }));
      count("workoutPlans", await tx.workoutPlan.deleteMany({ where: { orgId } }));
      count("dietPlans", await tx.dietPlan.deleteMany({ where: { orgId } }));
      count("offers", await tx.offer.deleteMany({ where: { orgId } }));
      count("monthLocks", await tx.monthLock.deleteMany({ where: { branch: { orgId } } }));
      count("sequences", await tx.sequence.deleteMany({ where: { orgId } }));
      await tx.setting.deleteMany({ where: { orgId, key: "opening" } });
      await tx.organization.update({ where: { id: orgId }, data: { demo: false } });
      await audit(tx, { orgId, userId: u.id, action: "demo.clear", entity: "Organization", entityId: orgId, after: { removed } });
      return removed;
    },
    { timeout: 120_000 },
  );
}
