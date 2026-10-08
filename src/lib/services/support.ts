import "server-only";
import { db } from "@/lib/db";
import { writeBranch, type CurrentUser } from "@/lib/auth/current";
import { audit } from "./audit";
import { nextNumber } from "./sequence";
import { getSetting } from "./settings";
import { UserError } from "./errors";
import { recentRuns } from "./jobs";
import { sendEmail, emailReady } from "@/lib/integrations/email";
import { storageMode } from "@/lib/integrations/storage";
import { ackText, appVersion, deviceLabel, ticketEmail } from "@/lib/domain/support";
import { hasPrioritySupport } from "@/lib/domain/features";
import type { TicketInput } from "@/lib/validation/support";
import { fmtDate, fmtTime } from "@/lib/format";
import { log } from "@/lib/log";

// Settings › Help & support: tickets are saved first, then emailed to support. A mail failure never loses the ticket.

export const supportTo = () => process.env.SUPPORT_TO?.trim() || "support@fitron.in";

const tenDigits = (s: string | undefined) => (s && /^[6-9]\d{9}$/.test(s.trim()) ? s.trim() : null);
export const supportEnv = () => ({ whatsapp: tenDigits(process.env.SUPPORT_WHATSAPP), phone: tenDigits(process.env.SUPPORT_PHONE) });

export const gymNameOf = async (u: CurrentUser) => (await getSetting<{ name?: string }>(u.orgId, "gym"))?.name || u.orgName;

export async function raiseTicket(u: CurrentUser, v: TicketInput, ctx: { userAgent?: string | null; ip?: string | null }) {
  const branchId = writeBranch(u) ?? null;
  const browser = deviceLabel(ctx.userAgent);
  const version = appVersion();
  const ip = ctx.ip ?? null;
  const prioritySupport = hasPrioritySupport(u.plan);
  const ticket = await db.$transaction(async (tx) => {
    const number = "TKT-" + (await nextNumber(tx, u.orgId, "ticket", 1001));
    const t = await tx.supportTicket.create({
      data: { orgId: u.orgId, number, userId: u.id, branchId, topic: v.topic, priority: v.priority, subject: v.subject, message: v.message, status: "Open", appVersion: version, browser, ip },
    });
    await tx.supportTicketReply.create({ data: { ticketId: t.id, by: "Fitron Support", kind: "AUTO", text: ackText(number, v.priority, prioritySupport) } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "support.ticket.create", entity: "SupportTicket", entityId: number, after: { number, topic: v.topic, priority: v.priority, subject: v.subject, branchId } });
    return t;
  });
  try {
    const mail = ticketEmail({
      number: ticket.number,
      priority: v.priority,
      subject: v.subject,
      gymName: await gymNameOf(u),
      orgId: u.orgId,
      plan: { name: u.plan.name, prioritySupport },
      by: { name: u.name, email: u.email, role: u.role },
      branch: branchId ? (u.branches.find((b) => b.id === branchId)?.name ?? null) : null,
      topic: v.topic,
      appVersion: version,
      browser,
      ip,
      message: v.message,
    });
    const r = await sendEmail({ to: supportTo(), subject: mail.subject, text: mail.text, replyTo: u.email });
    if (r.sent) await db.supportTicket.update({ where: { id: ticket.id }, data: { emailedAt: new Date() } });
  } catch (e) {
    log.error("support.notify_failed", e);
  }
  return ticket;
}

export async function listTickets(orgId: string, take = 50) {
  const rows = await db.supportTicket.findMany({ where: { orgId }, orderBy: { createdAt: "desc" }, take, include: { replies: { orderBy: { createdAt: "desc" }, take: 1 } } });
  const users = await db.user.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true } });
  const name = new Map(users.map((x) => [x.id, x.name]));
  return rows.map((r) => ({ ...r, raisedBy: name.get(r.userId) ?? "Staff", latestReply: r.replies[0]?.text ?? null }));
}

export async function resolveTicket(u: CurrentUser, id: string) {
  await db.$transaction(async (tx) => {
    const t = await tx.supportTicket.findFirst({ where: { id, orgId: u.orgId } });
    if (!t) throw new UserError("Ticket not found.");
    if (t.status === "Resolved") return;
    await tx.supportTicket.update({ where: { id }, data: { status: "Resolved", resolvedAt: new Date(), resolvedById: u.id } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "support.ticket.resolve", entity: "SupportTicket", entityId: t.number, before: { status: "Open" }, after: { status: "Resolved" } });
  });
}

const WA_MODE = { demo: "Demo: log only", cloud: "Cloud API", connector: "Linked phone (connector)" } as Record<string, string>;

export async function systemDetails(u: CurrentUser, o: { userAgent?: string | null; ip?: string | null; waStatusText: string; waMode: string }) {
  const orgId = u.orgId;
  let database = "Connected";
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    database = "Unreachable";
  }
  const [gym, branches, members, runs] = await Promise.all([gymNameOf(u), db.branch.count({ where: { orgId } }), db.member.count({ where: { orgId, deletedAt: null, walkIn: false } }), recentRuns(orgId)]);
  let jobs = "Never run";
  if (runs.length) {
    const day = runs[0]!.day;
    const ofDay = runs.filter((r) => r.day === day);
    const failed = ofDay.filter((r) => r.error).length;
    const running = ofDay.filter((r) => !r.finishedAt && !r.error).length;
    const done = ofDay.length - failed - running;
    jobs = `Last run ${fmtDate(day)} ${fmtTime(runs[0]!.startedAt)} · ${done} done${failed ? `, ${failed} failed` : ""}${running ? `, ${running} running` : ""}`;
  }
  const waText = o.waStatusText.length > 80 ? o.waStatusText.slice(0, 79) + "…" : o.waStatusText;
  return [
    { k: "App version", v: appVersion() },
    { k: "Gym", v: gym },
    { k: "Signed in as", v: `${u.name} · ${u.role}` },
    { k: "Plan", v: u.plan.name },
    { k: "Branches", v: String(branches) },
    { k: "Members", v: members.toLocaleString("en-IN") },
    { k: "Browser", v: deviceLabel(o.userAgent) + (o.ip ? ` · ${o.ip}` : "") },
    { k: "File storage", v: storageMode() === "S3" ? "S3 bucket" : "Server disk (STORAGE_DIR)" },
    { k: "WhatsApp", v: `${WA_MODE[o.waMode] ?? o.waMode} · ${waText}` },
    { k: "Email", v: emailReady() ? `SMTP configured: tickets are emailed to ${supportTo()}` : "SMTP not set: tickets are saved here and only logged" },
    { k: "Database", v: database },
    { k: "Daily jobs", v: jobs, href: "/settings/jobs" },
  ] as { k: string; v: string; href?: string }[];
}
