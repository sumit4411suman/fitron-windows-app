import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { DEFAULT_SUBSCRIPTION, type SubscriptionSettings } from "@/lib/domain/saas";
import { waNumber } from "@/lib/domain/whatsapp";
import type { BillingDetailsInput, RenewalInput } from "@/lib/validation/settings";
import { getSetting, putSetting } from "./settings";

export type { SubscriptionSettings };

/** Settings › Subscription: renewal reminders and billing details, with the defaults filled in. */
export async function getSubscriptionSettings(orgId: string): Promise<SubscriptionSettings> {
  return { ...DEFAULT_SUBSCRIPTION, ...((await getSetting<Partial<SubscriptionSettings>>(orgId, "subscription")) ?? {}) };
}

/** Saves only the reminder fields; the billing details on the same row stay as they are. */
export async function saveRenewalReminders(u: CurrentUser, v: RenewalInput) {
  await putSetting(u, "subscription", { remindDays: v.remindDays, whatsapp: v.whatsapp, email: v.email });
}

/** Saves only the billing details (blank clears a value); the reminder fields stay as they are. */
export async function saveBillingDetails(u: CurrentUser, v: BillingDetailsInput) {
  await putSetting(u, "subscription", { legalName: v.legalName ?? "", gstin: v.gstin ?? "", billingEmail: v.billingEmail ?? "", address: v.address ?? "" });
}

/**
 * "The gym number" renewal reminders go to on WhatsApp: the phone in Gym profile, else the oldest
 * branch that has one. Returns the number in WhatsApp form (91XXXXXXXXXX), or null when there is none.
 */
export async function gymWhatsAppNumber(orgId: string) {
  const gym = await getSetting<{ phone?: string }>(orgId, "gym");
  const fromProfile = waNumber(gym?.phone);
  if (fromProfile) return fromProfile;
  const branch = await db.branch.findFirst({ where: { orgId, phone: { not: "" } }, orderBy: { createdAt: "asc" }, select: { phone: true } });
  return waNumber(branch?.phone);
}

/** The emails renewal reminders go to: the billing email, else every active Super Admin's sign-in email. */
export async function renewalEmails(orgId: string, cfg: SubscriptionSettings) {
  if (cfg.billingEmail) return [cfg.billingEmail];
  const owners = await db.user.findMany({ where: { orgId, active: true, deletedAt: null, role: { name: "Super Admin" } }, select: { email: true } });
  return owners.map((o) => o.email);
}
