import "server-only";
import { after } from "next/server";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { systemUser } from "@/lib/auth/system";
import type { Prisma } from "@/generated/prisma/client";
import { DEFAULT_TEMPLATES, defaultTemplateRows, placeholders, REMINDER_KEYS, render, rupeesText, waNumber, type TemplateVars } from "@/lib/domain/whatsapp";
import { DEFAULT_REMINDERS, type ReminderSettings } from "@/lib/domain/reminders";
import { fromColumns, holdUntil, toColumns, validateRule, type Rule, type RuleInput } from "@/lib/domain/wa-rules";
import { connectorResults, sendWhatsApp, type WaMode } from "@/lib/integrations/whatsapp";
import { DOC_HEADER_KEYS, metaTemplateName } from "@/lib/domain/wa-meta";
import { getCloudCreds } from "./wa-cloud-store";
import { fmtDate } from "@/lib/format";
import { audit } from "./audit";
import { UserError } from "./errors";
import { invoicePdf } from "./invoice-pdf";
import { summarize } from "./members";
import { notify } from "./notifications";
import { getSetting, putSettingIn } from "./settings";
import { getTax } from "./tax";
import { todayIso } from "./time";
import { log } from "@/lib/log";

export type { ReminderSettings };
export { DEFAULT_REMINDERS };

/** The reminder schedule (Settings › Reminders). Values a gym saved on the old WhatsApp form still count until the new row exists. */
export async function getReminderSettings(orgId: string): Promise<ReminderSettings> {
  const [legacy, row] = await Promise.all([getSetting<Partial<ReminderSettings>>(orgId, "whatsapp"), getSetting<Partial<ReminderSettings>>(orgId, "reminders")]);
  const inherited: Partial<ReminderSettings> = {};
  for (const k of ["expiryDays", "dedupDays", "dueEveryDays", "birthdays"] as const) if (legacy?.[k] !== undefined) Object.assign(inherited, { [k]: legacy[k] });
  return { ...DEFAULT_REMINDERS, ...inherited, ...(row ?? {}) };
}

/** The gym's WhatsApp number paired through the connector . */
export type WaLinked = { number: string; device: string; at: string };
/**
 * Setting "whatsapp": how messages go out, the linked device and quiet hours. Reminder days and
 * birthday wishes are the templates' own rules; the repeat windows come from Settings › Reminders.
 */
export type WaSettings = { mode: WaMode; quietFrom: string; quietTo: string; linked: WaLinked | null } & Pick<ReminderSettings, "dedupDays" | "dueEveryDays">;
export const DEFAULT_WA: WaSettings = { mode: "demo", quietFrom: "21:00", quietTo: "08:00", linked: null, dedupDays: DEFAULT_REMINDERS.dedupDays, dueEveryDays: DEFAULT_REMINDERS.dueEveryDays };
const clock = (v: unknown, fallback: string) => (typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : fallback);
export async function getWaSettings(orgId: string): Promise<WaSettings> {
  const [row, reminders] = await Promise.all([getSetting<Partial<WaSettings>>(orgId, "whatsapp"), getReminderSettings(orgId)]);
  const linked = row?.linked && typeof row.linked === "object" && typeof row.linked.number === "string" ? { number: row.linked.number, device: String(row.linked.device ?? ""), at: String(row.linked.at ?? "") } : null;
  return { mode: row?.mode ?? "demo", quietFrom: clock(row?.quietFrom, DEFAULT_WA.quietFrom), quietTo: clock(row?.quietTo, DEFAULT_WA.quietTo), linked, dedupDays: reminders.dedupDays, dueEveryDays: reminders.dueEveryDays };
}

/** Links (or unlinks) the gym's WhatsApp and switches the sending mode with it. */
export async function setLinked(u: CurrentUser, linked: WaLinked | null, mode: WaMode) {
  await db.$transaction(async (tx) => {
    await putSettingIn(tx, u, "whatsapp", { linked, mode });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: linked ? "whatsapp.link" : "whatsapp.unlink", entity: "Setting", entityId: "whatsapp", after: linked });
  });
}

/** The gym's templates, creating the defaults the first time. */
export async function listTemplates(orgId: string) {
  const have = await db.whatsAppTemplate.findMany({ where: { orgId } });
  const missing = DEFAULT_TEMPLATES.filter((t) => !have.some((h) => h.key === t.key));
  if (missing.length) {
    const rows = defaultTemplateRows();
    await db.whatsAppTemplate.createMany({ data: missing.map((t) => ({ ...rows.find((r) => r.key === t.key)!, orgId })), skipDuplicates: true });
    return db.whatsAppTemplate.findMany({ where: { orgId } }).then(order);
  }
  return order(have);
}
const order = <T extends { key: string }>(ts: T[]) => [...ts].sort((a, b) => DEFAULT_TEMPLATES.findIndex((d) => d.key === a.key) - DEFAULT_TEMPLATES.findIndex((d) => d.key === b.key));

export async function updateTemplate(u: CurrentUser, key: string, t: { body: string; metaTemplateName?: string; language: string; autoSend: boolean }) {
  await listTemplates(u.orgId);
  const before = await db.whatsAppTemplate.findUnique({ where: { orgId_key: { orgId: u.orgId, key } } });
  if (!before) throw new UserError("Template not found.");
  await db.$transaction(async (tx) => {
    const after = await tx.whatsAppTemplate.update({ where: { id: before.id }, data: { body: t.body, metaTemplateName: t.metaTemplateName ?? null, language: t.language, autoSend: t.autoSend } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "whatsapp.template", entity: "WhatsAppTemplate", entityId: key, before, after });
  });
}

/** The Auto-send switch on a template (template card, Settings › Reminders). Audited like any template change. */
export async function setAutoSend(u: CurrentUser, key: string, on: boolean) {
  const t = (await listTemplates(u.orgId)).find((x) => x.key === key);
  if (!t) throw new UserError("Template not found.");
  if (t.autoSend === on) return;
  await updateTemplate(u, key, { body: t.body, metaTemplateName: t.metaTemplateName ?? undefined, language: t.language, autoSend: on });
}

/** The automation rule behind a template row. */
export const templateRule = (t: { ruleWhen: string; ruleDays: number; ruleTime: string; rulePlanId: string | null; ruleGender: string | null; ruleMinDue: number; ruleMaxPerWeek: number; ruleExcludeAutopay: boolean }): Rule => fromColumns(t);

/**
 * "Edit rule" on a template card: the trigger, timing and filters the automation uses, and, when
 * they changed, the gym's quiet hours. Messages already held for the template keep their time.
 */
export async function editRule(u: CurrentUser, key: string, input: RuleInput & { quietFrom?: string; quietTo?: string }) {
  const rule = validateRule(input);
  if (rule.planId && !(await db.membershipPlan.findFirst({ where: { id: rule.planId, orgId: u.orgId }, select: { id: true } }))) throw new UserError("Pick a plan from the list.", "planId");
  await listTemplates(u.orgId);
  const t = await db.whatsAppTemplate.findUnique({ where: { orgId_key: { orgId: u.orgId, key } } });
  if (!t) throw new UserError("Template not found.");
  const settings = await getWaSettings(u.orgId);
  const quietFrom = clock(input.quietFrom, settings.quietFrom);
  const quietTo = clock(input.quietTo, settings.quietTo);
  await db.$transaction(async (tx) => {
    const columns = toColumns(rule);
    await tx.whatsAppTemplate.update({ where: { id: t.id }, data: columns });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "whatsapp.rule", entity: "WhatsAppTemplate", entityId: key, before: toColumns(templateRule(t)), after: columns });
    if (quietFrom !== settings.quietFrom || quietTo !== settings.quietTo) await putSettingIn(tx, u, "whatsapp", { quietFrom, quietTo });
  });
  return rule;
}

/** Everything a template can mention about a member right now. */
export async function memberVars(orgId: string, memberId: string, extra: TemplateVars = {}): Promise<TemplateVars> {
  const [m, gym, tax, privacy] = await Promise.all([
    db.member.findUniqueOrThrow({ where: { id: memberId } }),
    getSetting<{ name?: string }>(orgId, "gym"),
    getTax(orgId),
    getSetting<{ officer?: string; email?: string; phone?: string }>(orgId, "privacy"),
  ]);
  const [s, current, org] = await Promise.all([
    summarize([memberId]).then((x) => x.get(memberId)!),
    db.membership.findFirst({ where: { memberId, status: "VALID" }, orderBy: { endDate: "desc" }, include: { plan: true } }),
    db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } }),
  ]);
  const plan = current?.plan;
  const renewal = plan ? plan.price - plan.discount + (tax.enabled && plan.gstApplicable ? Math.round(((plan.price - plan.discount) * tax.rate) / 100) : 0) : 0;
  return {
    member_name: m.name.split(" ")[0] ?? m.name,
    member_id: m.code,
    plan_name: plan?.name ?? "",
    start_date: current ? fmtDate(current.startDate) : "",
    expiry_date: s.latestEnd ? fmtDate(s.latestEnd) : "",
    amount: rupeesText(renewal),
    pending_amount: rupeesText(s.outstanding),
    gym_name: gym?.name ?? org.name,
    grievance_officer: privacy?.officer ?? "",
    grievance_email: privacy?.email ?? "",
    grievance_phone: privacy?.phone ?? "",
    ...extra,
  };
}

export type SendOpts = {
  orgId: string;
  memberId: string;
  key: string;
  /** Staff who sent it; null for automatic messages. */
  userId?: string | null;
  vars?: TemplateVars;
  /** Replaces the template body (custom message). */
  body?: string;
  /** Attach this invoice's PDF. */
  invoiceId?: string;
  /** Automatic trigger: respects the template's auto-send switch. */
  auto?: boolean;
  /** Skip the reminder de-dup check. */
  force?: boolean;
};

const FAILED_NUMBER = "No valid WhatsApp number on the member's profile.";

/**
 * Renders a template for a member and records the message as Queued (or Scheduled, to go out at
 * `holdUntil`). Returns null when nothing should be sent: auto-send off, duplicate reminder, walk-in.
 */
export async function prepareMessage(o: SendOpts & { holdUntil?: Date | null }) {
  const settings = await getWaSettings(o.orgId);
  const tpl = (await listTemplates(o.orgId)).find((t) => t.key === o.key);
  if (!tpl) throw new UserError("Template not found.");
  if (o.auto && !tpl.autoSend) return null;
  const member = await db.member.findUniqueOrThrow({ where: { id: o.memberId } });
  // Nothing is ever rendered for the walk-in counter or a member whose personal data was erased (DPDP).
  if (member.walkIn || member.erasedAt) return null;
  if (!o.force && REMINDER_KEYS.includes(o.key)) {
    const since = new Date(Date.now() - settings.dedupDays * 86_400_000);
    const recent = await db.whatsAppMessage.findFirst({ where: { memberId: o.memberId, templateKey: o.key, sentAt: { gte: since }, status: { not: "Failed" } } });
    if (recent) return null;
  }
  const to = waNumber(member.whatsapp ?? member.phone);
  const vars = await memberVars(o.orgId, o.memberId, o.vars);
  const body = render(o.body ?? tpl.body, vars);
  const held = o.holdUntil ?? null;
  return db.whatsAppMessage.create({
    data: {
      orgId: o.orgId,
      memberId: o.memberId,
      templateKey: o.key,
      toNumber: to ?? member.phone,
      body,
      attachment: o.invoiceId ? `invoice:${o.invoiceId}` : null,
      provider: settings.mode,
      status: held ? "Scheduled" : "Queued",
      scheduledFor: held,
      sentById: o.userId ?? null,
    },
  });
}

/**
 * Sends a prepared message through the provider and records the result. Never throws for provider
 * problems: a failure is stored with its error and raises an alert (rule 6).
 */
export async function deliverMessage(id: string) {
  const msg = await db.whatsAppMessage.findUniqueOrThrow({ where: { id }, include: { member: true } });
  const settings = await getWaSettings(msg.orgId);
  const tpl = (await listTemplates(msg.orgId)).find((t) => t.key === msg.templateKey);
  const to = waNumber(msg.toNumber);
  const cloud = settings.mode === "cloud" ? await getCloudCreds(msg.orgId) : null;
  const invoiceId = msg.attachment?.startsWith("invoice:") ? msg.attachment.slice(8) : null;
  const pdf = invoiceId ? await invoicePdf(await systemUser(msg.orgId), invoiceId) : null;
  // A Cloud API template only when the text is the template's own (not a custom message).
  let template: { name: string; language: string; params: string[]; docHeader?: boolean } | undefined;
  if (settings.mode === "cloud" && tpl?.metaTemplateName && msg.memberId) {
    const vars = await memberVars(msg.orgId, msg.memberId);
    if (render(tpl.body, vars) === msg.body) template = { name: tpl.metaTemplateName, language: tpl.language, params: placeholders(tpl.body).map((k) => vars[k as keyof TemplateVars] ?? ""), docHeader: DOC_HEADER_KEYS.includes(tpl.key) };
  }
  const result = to
    ? await sendWhatsApp(settings.mode, { orgId: msg.orgId, cloud, localId: msg.id, to, body: msg.body, template, pdf: pdf ? { bytes: pdf.bytes, filename: pdf.filename } : undefined })
    : { status: "Failed" as const, error: FAILED_NUMBER };
  const saved = await db.whatsAppMessage.update({
    where: { id: msg.id },
    data: { status: result.status, provider: settings.mode, providerMessageId: result.providerMessageId ?? null, error: result.error ?? null },
  });
  if (result.status === "Failed") {
    const who = msg.member?.name ?? msg.toNumber;
    await db.$transaction((tx) => notify(tx, { orgId: msg.orgId, branchId: msg.member?.branchId, type: "WA_FAILED", text: `WhatsApp "${tpl?.name ?? msg.templateKey}" to ${who} failed: ${result.error}`, link: `/whatsapp?status=Failed` }));
  }
  return saved;
}

/**
 * Renders and sends one template to one member straight away, and records the result.
 * Returns null when nothing was sent (auto-send off, duplicate reminder, walk-in).
 */
export async function sendTemplate(o: SendOpts) {
  const msg = await prepareMessage(o);
  return msg ? deliverMessage(msg.id) : null;
}

/**
 * The rule engine's send: goes out now when the rule's send time has passed and it isn't quiet
 * hours, else is recorded as Scheduled and sent by the dispatcher when the hold ends.
 */
export async function queueTemplate(o: SendOpts & { now: Date; today: string; rule: Rule; settings: WaSettings }) {
  const until = holdUntil(o.now, o.today, o.rule.time, o.settings.quietFrom, o.settings.quietTo);
  const msg = await prepareMessage({ ...o, holdUntil: until });
  if (!msg) return null;
  return until ? msg : deliverMessage(msg.id);
}

export const TEST_BODY = "Fitron test message. Your WhatsApp connector is working.";

/** "Send test" under Settings › WhatsApp: one message to the gym's own number through the current mode. */
export async function sendTest(u: CurrentUser) {
  const gym = await getSetting<{ phone?: string }>(u.orgId, "gym");
  const branch = gym?.phone ? null : await db.branch.findFirst({ where: { orgId: u.orgId, id: { in: u.branchIds } }, orderBy: { createdAt: "asc" }, select: { phone: true } });
  const to = waNumber(gym?.phone || branch?.phone);
  if (!to) throw new UserError("Add the gym phone in Gym profile first.");
  const settings = await getWaSettings(u.orgId);
  const msg = await db.whatsAppMessage.create({ data: { orgId: u.orgId, memberId: null, templateKey: "test", toNumber: to, body: TEST_BODY, provider: settings.mode, status: "Queued", sentById: u.id } });
  // Cloud API: a business may not start a conversation with free text, so the test is its own approved template.
  const cloud = settings.mode === "cloud" ? await getCloudCreds(u.orgId) : null;
  const template = settings.mode === "cloud" ? { name: metaTemplateName("test"), language: "en", params: [] } : undefined;
  const result = await sendWhatsApp(settings.mode, { orgId: u.orgId, cloud, localId: msg.id, to, body: TEST_BODY, template });
  return db.$transaction(async (tx) => {
    const saved = await tx.whatsAppMessage.update({ where: { id: msg.id }, data: { status: result.status, providerMessageId: result.providerMessageId ?? null, error: result.error ?? null } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "whatsapp.test", entity: "WhatsAppMessage", entityId: msg.id, after: { status: saved.status, error: saved.error } });
    return saved;
  });
}

/**
 * Sends one free-form text to the gym's own number (FITRON renewal reminders), not to a member: no
 * template row, no de-dup. Recorded like every other message, so it shows on the WhatsApp page with
 * "—" as the member; a failure raises the usual alert and never throws.
 */
export async function sendGymWhatsApp(o: { orgId: string; key: string; to: string; body: string }) {
  const mode = (await getSetting<{ mode?: WaMode }>(o.orgId, "whatsapp"))?.mode ?? "demo";
  const msg = await db.whatsAppMessage.create({ data: { orgId: o.orgId, memberId: null, templateKey: o.key, toNumber: o.to, body: o.body, provider: mode, status: "Queued", sentById: null } });
  const result = await sendWhatsApp(mode, { orgId: o.orgId, localId: msg.id, to: o.to, body: o.body });
  const saved = await db.whatsAppMessage.update({ where: { id: msg.id }, data: { status: result.status, providerMessageId: result.providerMessageId ?? null, error: result.error ?? null } });
  if (result.status === "Failed") {
    await db.$transaction((tx) => notify(tx, { orgId: o.orgId, type: "WA_FAILED", text: `WhatsApp renewal reminder to ${o.to} failed: ${result.error}`, link: "/whatsapp?status=Failed" }));
  }
  return saved;
}

/**
 * Runs an automatic message after the response is sent, so a slow provider never delays the desk.
 * Outside a request (jobs, tests) it runs in the background.
 */
export function sendLater(o: Omit<SendOpts, "auto">) {
  const run = () => sendTemplate({ ...o, auto: true }).catch((e) => log.error("whatsapp.auto_send_failed", e));
  try {
    after(run);
  } catch {
    void run();
  }
}

export async function listMessages(u: CurrentUser, f: { status?: string; key?: string; q?: string; memberId?: string; page?: number; pageSize?: number }) {
  const pageSize = f.pageSize ?? 50;
  const page = Math.max(1, f.page ?? 1);
  const where: Prisma.WhatsAppMessageWhereInput = {
    orgId: u.orgId,
    OR: [{ memberId: null }, { member: { branchId: { in: u.branchIds } } }],
    ...(f.status ? { status: f.status } : {}),
    ...(f.key ? { templateKey: f.key } : {}),
    ...(f.memberId ? { memberId: f.memberId } : {}),
    ...(f.q ? { AND: [{ OR: [{ member: { name: { contains: f.q, mode: "insensitive" } } }, { toNumber: { contains: f.q.replace(/\D/g, "") || f.q } }] }] } : {}),
  };
  const [rows, total, counts] = await Promise.all([
    db.whatsAppMessage.findMany({ where, orderBy: { sentAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { member: { select: { id: true, name: true, code: true } } } }),
    db.whatsAppMessage.count({ where }),
    db.whatsAppMessage.groupBy({ by: ["status"], where: { orgId: u.orgId, sentAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, _count: { _all: true } }),
  ]);
  return { rows, total, page, pageSize, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<string, number> };
}

/** Delivery updates from Meta's webhook. Status only moves forward. */
export async function applyDeliveryStatus(providerMessageId: string, status: string, at: Date, error?: string) {
  const msg = await db.whatsAppMessage.findFirst({ where: { providerMessageId } });
  if (!msg) return;
  const rank = { Scheduled: 0, Logged: 0, Queued: 1, Sent: 2, Delivered: 3, Read: 4, Failed: 5 } as Record<string, number>;
  const next = { sent: "Sent", delivered: "Delivered", read: "Read", failed: "Failed" }[status];
  if (!next || (rank[next] ?? 0) <= (rank[msg.status] ?? 0)) return;
  await db.whatsAppMessage.update({
    where: { id: msg.id },
    data: { status: next, ...(next === "Delivered" ? { deliveredAt: at } : {}), ...(next === "Read" ? { readAt: at, deliveredAt: msg.deliveredAt ?? at } : {}), ...(next === "Failed" ? { error: error ?? "Failed" } : {}) },
  });
  if (next === "Failed") {
    const member = msg.memberId ? await db.member.findUnique({ where: { id: msg.memberId }, select: { name: true, branchId: true } }) : null;
    await db.$transaction((tx) => notify(tx, { orgId: msg.orgId, branchId: member?.branchId, type: "WA_FAILED", text: `WhatsApp to ${member?.name ?? msg.toNumber} failed: ${error ?? "unknown error"}`, link: "/whatsapp?status=Failed" }));
  }
}

/** How long the connector may keep a message queued (250 a day, 8 to 15 s apart) before the app stops waiting for it. */
const QUEUE_GIVE_UP_MS = 6 * 3_600_000;

/**
 * Pulls statuses for messages the linked-phone connector queued: Sent, Delivered, Read or Failed. Status only moves forward.
 * A message the connector no longer knows (it was restarted while the message waited) is marked Failed after a while.
 */
export async function refreshQueued(orgId: string) {
  const since = new Date(Date.now() - 3 * 86_400_000);
  const open = await db.whatsAppMessage.findMany({ where: { orgId, provider: "connector", status: { in: ["Queued", "Sent", "Delivered"] }, sentAt: { gte: since } }, select: { id: true, status: true, sentAt: true, deliveredAt: true } });
  const res = await connectorResults(orgId, open.map((q) => q.id));
  if (!res) return 0;
  const rank: Record<string, number> = { Queued: 1, Sent: 2, Delivered: 3, Read: 4, Failed: 5 };
  let n = 0;
  for (const m of open) {
    const r = res[m.id];
    let status: string | null = null;
    let error: string | null = null;
    if (r) {
      status = /read/i.test(r.status) ? "Read" : /deliver/i.test(r.status) ? "Delivered" : /sent/i.test(r.status) ? "Sent" : /fail|error/i.test(r.status) ? "Failed" : null;
      error = r.error ?? null;
    } else if (m.status === "Queued" && Date.now() - m.sentAt.getTime() > QUEUE_GIVE_UP_MS) {
      status = "Failed";
      error = "The WhatsApp connector was restarted before this message was sent. Send it again.";
    }
    if (!status || (rank[status] ?? 0) <= (rank[m.status] ?? 0)) continue;
    const at = new Date();
    await db.whatsAppMessage.update({
      where: { id: m.id },
      data: { status, error, ...(status === "Delivered" ? { deliveredAt: at } : {}), ...(status === "Read" ? { readAt: at, deliveredAt: m.deliveredAt ?? at } : {}) },
    });
    n++;
  }
  return n;
}

/** Sends one custom message to many members (capped, since WhatsApp limits bulk sending). */
export async function sendCampaign(u: CurrentUser, memberIds: string[], body: string) {
  if (memberIds.length > 250) throw new UserError("Send to 250 members or fewer at a time.");
  if (!body.trim()) throw new UserError("Write the message first.", "body");
  const allowed = await db.member.findMany({ where: { id: { in: memberIds }, orgId: u.orgId, branchId: { in: u.branchIds }, deletedAt: null, walkIn: false }, select: { id: true } });
  let sent = 0;
  let failed = 0;
  for (const m of allowed) {
    const r = await sendTemplate({ orgId: u.orgId, memberId: m.id, key: "campaign", body, userId: u.id, force: true });
    if (r?.status === "Failed") failed++;
    else if (r) sent++;
  }
  await db.$transaction((tx) => audit(tx, { orgId: u.orgId, userId: u.id, action: "whatsapp.campaign", entity: "WhatsAppMessage", entityId: todayIso(), after: { recipients: allowed.length, sent, failed, body } }));
  return { sent, failed };
}
