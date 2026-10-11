import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { daysBetween } from "@/lib/domain/dates";
import { memberScope, summarize } from "./members";
import { getInvoice, listReceivables } from "./billing";
import { assertCanSend, listTemplates, sendTemplate, setAutoSend } from "./whatsapp";
import { count, emptyTally } from "@/lib/domain/wa-outcome";
import { rupeesText } from "@/lib/domain/whatsapp";
import { UserError } from "./errors";
import { getAccessRules } from "./attendance";
import { putSetting } from "./settings";
import { todayIso } from "./time";
import type { ReminderInput } from "@/lib/validation/settings";

/** The expiry template behind each pill on Settings › Reminders. */
const EXPIRY_TEMPLATE: Record<number, string> = { 15: "exp15", 7: "exp7", 3: "exp3", 1: "exp1", 0: "expired" };

/**
 * Which reminder days and birthday wishes are on, read from the templates' Auto-send switches and
 * rules (the one source the rule engine uses): days before expiry of the expiry templates that are
 * on, 0 for the on-the-day message.
 */
export async function reminderSchedule(orgId: string) {
  const templates = await listTemplates(orgId);
  const expiryDays = templates
    .filter((t) => t.autoSend && (t.ruleWhen === "before_expiry" || (t.ruleWhen === "after_expiry" && t.ruleDays === 0)))
    .map((t) => (t.ruleWhen === "after_expiry" ? 0 : t.ruleDays));
  return { expiryDays: [...new Set(expiryDays)].sort((a, b) => b - a), birthdays: templates.some((t) => t.key === "birthday" && t.autoSend) };
}

/**
 * Settings › Reminders. The schedule goes to Setting "reminders"; the expiry pills and birthday
 * wishes also switch the matching templates' Auto-send (what the rule engine reads); the grace period
 * is the door rule in Setting "access" (one value, edited here and under Check-in devices) and is
 * only rewritten when it changes. Each write is its own audited row.
 */
export async function saveReminderSettings(u: CurrentUser, v: ReminderInput) {
  const { graceDays, ...reminders } = v;
  await putSetting(u, "reminders", reminders);
  for (const [day, key] of Object.entries(EXPIRY_TEMPLATE)) await setAutoSend(u, key, reminders.expiryDays.includes(Number(day)));
  await setAutoSend(u, "birthday", reminders.birthdays);
  if (graceDays !== (await getAccessRules(u.orgId)).graceDays) await putSetting(u, "access", { graceDays });
}

/** The expiry template for how many days are left (the prototype's renewal reminders). */
export const expiryKey = (daysLeft: number) => (daysLeft <= 0 ? "expired" : daysLeft === 1 ? "exp1" : daysLeft <= 3 ? "exp3" : daysLeft <= 7 ? "exp7" : "exp15");

async function ownMember(u: CurrentUser, memberId: string) {
  const m = await db.member.findFirst({ where: { ...memberScope(u), id: memberId, walkIn: false }, select: { id: true, name: true } });
  if (!m) throw new UserError("Member not found.");
  return m;
}

/**
 * One member's balance reminder: the message with how it went (Sent, Queued, Logged in demo mode, Failed), or null when
 * they were reminded recently (no repeat within the de-dup window).
 */
export async function remindDue(u: CurrentUser, memberId: string, invoiceNumber?: string) {
  await ownMember(u, memberId);
  return sendTemplate({ orgId: u.orgId, memberId, key: "due", userId: u.id, vars: invoiceNumber ? { invoice_number: invoiceNumber } : undefined });
}

/** A second press within this window is taken as a double click, not a new send. */
const RESEND_GUARD_MS = 2 * 60_000;

/**
 * "Send on WhatsApp" on an invoice: the invoice message with its PDF attached, to the invoice's own member. The invoice is
 * read through the user's own scope, so another gym's (or branch's) invoice is "not found". The message with how it went
 * (as for remindDue), or null when the same invoice already went out moments ago.
 */
export async function sendInvoiceWhatsApp(u: CurrentUser, invoiceId: string) {
  const inv = await getInvoice(u, invoiceId);
  if (!inv) throw new UserError("Invoice not found.");
  if (inv.status === "CANCELLED") throw new UserError("This invoice is cancelled, so it is not sent.");
  if (inv.member.walkIn || inv.member.erasedAt) throw new UserError("This invoice has no member to send it to.");
  const attachment = `invoice:${inv.id}`;
  const recent = await db.whatsAppMessage.findFirst({ where: { orgId: u.orgId, attachment, sentAt: { gte: new Date(Date.now() - RESEND_GUARD_MS) }, status: { notIn: ["Failed", "Logged"] } }, select: { id: true } });
  if (recent) return null;
  return sendTemplate({ orgId: u.orgId, memberId: inv.memberId, key: "invoice", userId: u.id, vars: { invoice_number: inv.number, amount: rupeesText(inv.total) }, invoiceId: inv.id, force: true });
}

/** "Remind all overdue": one reminder per member with an overdue invoice, oldest first, counted by how each went. */
export async function remindAllOverdue(u: CurrentUser) {
  const { list } = await listReceivables(u, "overdue");
  const tally = emptyTally();
  if (!list.length) return tally;
  await assertCanSend(u.orgId);
  const seen = new Set<string>();
  for (const inv of [...list].sort((a, b) => b.overdueDays - a.overdueDays)) {
    if (seen.has(inv.member.id)) continue;
    seen.add(inv.member.id);
    count(tally, await sendTemplate({ orgId: u.orgId, memberId: inv.member.id, key: "due", userId: u.id, vars: { invoice_number: inv.number } }));
  }
  return tally;
}

/** One member's renewal reminder, with the template for how soon the membership ends. The message, or null as for remindDue. */
export async function remindRenewal(u: CurrentUser, memberId: string) {
  await ownMember(u, memberId);
  const end = (await summarize([memberId])).get(memberId)?.latestEnd;
  if (!end) throw new UserError("This member has no membership to renew.");
  return sendTemplate({ orgId: u.orgId, memberId, key: expiryKey(daysBetween(end, todayIso())), userId: u.id });
}

/** "Remind all": renewal reminders for everyone in the shown list, counted by how each went. */
export async function remindRenewals(u: CurrentUser, memberIds: string[]) {
  const tally = emptyTally();
  if (!memberIds.length) return tally;
  await assertCanSend(u.orgId);
  for (const id of memberIds) {
    try {
      count(tally, await remindRenewal(u, id));
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      tally.skipped++;
    }
  }
  return tally;
}

/** Each member's last renewal reminder (which one, when, and how it went), for the Renewals table. */
export async function lastRenewalReminders(memberIds: string[]) {
  const msgs = await db.whatsAppMessage.findMany({
    where: { memberId: { in: memberIds }, templateKey: { in: ["exp15", "exp7", "exp3", "exp1", "expired"] } },
    orderBy: { sentAt: "desc" },
    distinct: ["memberId"],
    select: { memberId: true, templateKey: true, sentAt: true, status: true },
  });
  return new Map(msgs.map((m) => [m.memberId!, m]));
}

/** The renewal price for each member: their latest membership's price after discount. */
export async function renewalAmounts(memberIds: string[]) {
  const ms = await db.membership.findMany({
    where: { memberId: { in: memberIds }, status: "VALID" },
    orderBy: { endDate: "desc" },
    distinct: ["memberId"],
    select: { memberId: true, price: true, discount: true },
  });
  return new Map(ms.map((m) => [m.memberId, m.price - m.discount]));
}
