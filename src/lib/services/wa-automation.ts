import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import type { Prisma } from "@/generated/prisma/client";
import { daysBetween } from "@/lib/domain/dates";
import { invoiceState } from "@/lib/domain/billing";
import { render, rupeesText, waNumber, type TemplateVars } from "@/lib/domain/whatsapp";
import { inQuietHours, isScheduled, matchRule, ruleText, skipReason, type MemberFacts } from "@/lib/domain/wa-rules";
import { fmtClock } from "@/lib/format";
import { audit } from "./audit";
import { UserError } from "./errors";
import { summarize } from "./members";
import { getSetting } from "./settings";
import { istClock, todayIso, toIso } from "./time";
import { deliverMessage, getWaSettings, listTemplates, memberVars, queueTemplate, templateRule, type WaSettings } from "./whatsapp";

/**
 * The WhatsApp rule engine (prototype A.autoMatch / A.autoRun): which members each scheduled
 * template reaches today, who is skipped and why, and the runs that send them. The same code
 * serves "Today's automation", Preview & run, Send due now and the daily jobs.
 */

type Template = Awaited<ReturnType<typeof listTemplates>>[number];
export type Cand = { memberId: string; name: string; code: string; planName: string; phone: string; vars: TemplateVars };
export type Skip = { cand: Cand; why: string };
export type Match = { send: Cand[]; skipped: Skip[] };
export type PreviewRow = { key: string; name: string; time: string; send: Cand[]; skipped: Skip[] };
export type Run = { ts: string; key: string; name: string; matched: number; sent: number; skipped: number; held: number; by: string | null };

/** The reminder jobs whose finish counts as an automation run. */
export const REMINDER_JOBS = ["reminders.expiry", "reminders.dues", "reminders.birthday", "reminders.winback", "reminders.autopay"];

/** The rule in words for a template card; plan names come from the gym's plans. */
export function ruleSentence(t: Template, settings: WaSettings, plans: Map<string, string>) {
  const text = ruleText(templateRule(t), t.trigger, t.rulePlanId ? plans.get(t.rulePlanId) : undefined);
  return t.key === "due" && !settings.dueEveryDays ? `${text} · off (payment reminder interval is 0 under Settings › Reminders)` : text;
}

type Facts = { member: { id: string; name: string; code: string; phone: string; whatsapp: string | null; gender: string }; facts: MemberFacts; vars: TemplateVars };
type Ctx = { settings: WaSettings; templates: Template[]; plans: Map<string, string>; members: Facts[]; recent: { memberId: string | null; templateKey: string; sentAt: Date; sentById: string | null }[]; now: Date };

/** Everything the rules look at, loaded once for the gym (or the user's branches). */
async function loadFacts(orgId: string, branchIds: string[] | null, today: string, now: Date): Promise<Ctx> {
  const [settings, templates, plans, members] = await Promise.all([
    getWaSettings(orgId),
    listTemplates(orgId),
    db.membershipPlan.findMany({ where: { orgId }, select: { id: true, name: true } }),
    db.member.findMany({
      where: { orgId, ...(branchIds ? { branchId: { in: branchIds } } : {}), deletedAt: null, walkIn: false, suspended: false },
      select: { id: true, name: true, code: true, phone: true, whatsapp: true, gender: true, dob: true, createdAt: true },
    }),
  ]);
  const ids = members.map((m) => m.id);
  const [sums, current, mandates, invoices, visits, recent] = await Promise.all([
    summarize(ids, today),
    db.membership.findMany({ where: { memberId: { in: ids }, status: "VALID" }, orderBy: { endDate: "desc" }, distinct: ["memberId"], select: { memberId: true, planId: true } }),
    db.autopayMandate.findMany({ where: { memberId: { in: ids }, status: "Active" }, select: { memberId: true, nextDebitOn: true, amount: true, planId: true } }),
    db.invoice.findMany({ where: { memberId: { in: ids }, status: "ISSUED" }, orderBy: { dueDate: "asc" }, select: { memberId: true, number: true, total: true, dueDate: true, payments: { select: { amount: true, status: true } } } }),
    db.attendance.findMany({ where: { memberId: { in: ids } }, orderBy: { date: "desc" }, distinct: ["memberId"], select: { memberId: true, date: true } }),
    db.whatsAppMessage.findMany({
      where: { orgId, memberId: { in: ids }, status: { not: "Failed" }, sentAt: { gte: new Date(now.getTime() - Math.max(settings.dedupDays, settings.dueEveryDays, 30) * 86_400_000) } },
      select: { memberId: true, templateKey: true, sentAt: true, sentById: true },
    }),
  ]);
  const planOf = new Map(current.map((c) => [c.memberId, c.planId]));
  const planName = new Map(plans.map((p) => [p.id, p.name]));
  const mandate = new Map(mandates.map((m) => [m.memberId, m]));
  const oldest = new Map<string, { number: string; dueDate: string }>();
  for (const inv of invoices) {
    const st = invoiceState({ total: inv.total, cancelled: false, dueDate: toIso(inv.dueDate) }, inv.payments as { amount: number; status: "SUCCESS" | "REVERSED" }[], today);
    if (st.balance > 0 && !oldest.has(inv.memberId)) oldest.set(inv.memberId, { number: inv.number, dueDate: toIso(inv.dueDate) });
  }
  const lastVisit = new Map(visits.map((v) => [v.memberId!, toIso(v.date)]));
  const facts: Facts[] = members.map((m) => {
    const s = sums.get(m.id)!;
    const md = mandate.get(m.id);
    const inv = oldest.get(m.id);
    const vars: TemplateVars = {};
    if (inv) Object.assign(vars, { invoice_number: inv.number, pending_amount: rupeesText(s.outstanding) });
    if (md) Object.assign(vars, { amount: rupeesText(md.amount), plan_name: planName.get(md.planId) ?? "" });
    return {
      member: { id: m.id, name: m.name, code: m.code, phone: m.phone, whatsapp: m.whatsapp, gender: m.gender },
      facts: {
        daysLeft: s.latestEnd ? daysBetween(s.latestEnd, today) : null,
        planId: planOf.get(m.id) ?? null,
        gender: m.gender,
        outstanding: s.outstanding,
        onAutopay: !!md,
        oldestOverdueDays: inv ? daysBetween(today, inv.dueDate) : null,
        lastVisitDaysAgo: daysBetween(today, lastVisit.get(m.id) ?? todayIso(m.createdAt)),
        birthdayToday: !!m.dob && toIso(m.dob).slice(5) === today.slice(5),
        nextDebitInDays: md?.nextDebitOn ? daysBetween(toIso(md.nextDebitOn), today) : null,
      },
      vars: { ...vars, plan_name: vars.plan_name ?? s.planName ?? "" },
    };
  });
  return { settings, templates, plans: planName, members: facts, recent, now };
}

/** The no-repeat window for a template: the dues interval for payment reminders, a month for win-back, else the de-dup days. */
export const windowDays = (key: string, s: WaSettings) => (key === "due" ? s.dueEveryDays : key === "winback" ? Math.max(s.dedupDays, 30) : s.dedupDays);

function matchIn(ctx: Ctx, t: Template): Match {
  const rule = templateRule(t);
  const out: Match = { send: [], skipped: [] };
  if (!isScheduled(rule.when)) return out;
  if (t.key === "due" && !ctx.settings.dueEveryDays) return out;
  const window = windowDays(t.key, ctx.settings);
  const scheduled = new Set(ctx.templates.filter((x) => isScheduled(x.ruleWhen)).map((x) => x.key));
  const weekAgo = ctx.now.getTime() - 7 * 86_400_000;
  const windowStart = ctx.now.getTime() - window * 86_400_000;
  for (const { member, facts, vars } of ctx.members) {
    if (!matchRule({ ...rule, excludeAutopay: false }, facts)) continue;
    const mine = ctx.recent.filter((r) => r.memberId === member.id);
    const cand: Cand = { memberId: member.id, name: member.name, code: member.code, planName: vars.plan_name ?? "", phone: member.phone, vars };
    const why = skipReason(facts, {
      validNumber: !!waNumber(member.whatsapp ?? member.phone),
      sentWithinWindow: mine.some((r) => r.templateKey === t.key && r.sentAt.getTime() >= windowStart),
      autoThisWeek: mine.filter((r) => r.sentById === null && scheduled.has(r.templateKey) && r.sentAt.getTime() >= weekAgo).length,
      windowDays: window,
      rule,
    });
    if (why) out.skipped.push({ cand, why });
    else out.send.push(cand);
  }
  return out;
}

/** Who one template's rule reaches today, and who it skips and why. */
export async function matchTemplate(orgId: string, branchIds: string[] | null, t: Template, today = todayIso(), now = new Date()) {
  return matchIn(await loadFacts(orgId, branchIds, today, now), t);
}

/** "Today's automation": every scheduled template that is on and has someone to send to or skip. */
export async function automationPreview(u: CurrentUser, today = todayIso(), now = new Date()): Promise<PreviewRow[]> {
  const ctx = await loadFacts(u.orgId, u.branchIds, today, now);
  return ctx.templates
    .filter((t) => t.autoSend && isScheduled(t.ruleWhen))
    .map((t) => ({ key: t.key, name: t.name, time: fmtClock(t.ruleTime), ...matchIn(ctx, t) }))
    .filter((r) => r.send.length || r.skipped.length);
}

/** Preview & run: the match for one template, with the message as its first recipient would get it. */
export async function previewTemplate(u: CurrentUser, key: string, today = todayIso(), now = new Date()) {
  const ctx = await loadFacts(u.orgId, u.branchIds, today, now);
  const t = ctx.templates.find((x) => x.key === key);
  if (!t) throw new UserError("Template not found.");
  const match = matchIn(ctx, t);
  const first = match.send[0];
  const sample = first ? render(t.body, await memberVars(u.orgId, first.memberId, first.vars)) : "";
  return { template: t, rule: templateRule(t), ...match, sample };
}

export type RunResult = { sent: number; skipped: number; held: number; failed: number; heldUntil: Date | null; runs: Run[] };

/**
 * Runs the rules of the given templates: matches, sends (or holds for quiet hours and the rule's
 * send time), records a run per template with matches, and audits the call. Jobs pass `by` null.
 */
export async function runRules(orgId: string, branchIds: string[] | null, keys: string[], today = todayIso(), now = new Date(), by: { userId: string } | null = null): Promise<RunResult> {
  const ctx = await loadFacts(orgId, branchIds, today, now);
  const result: RunResult = { sent: 0, skipped: 0, held: 0, failed: 0, heldUntil: null, runs: [] };
  for (const t of ctx.templates.filter((x) => keys.includes(x.key))) {
    const { send, skipped } = matchIn(ctx, t);
    const run: Run = { ts: now.toISOString(), key: t.key, name: t.name, matched: send.length + skipped.length, sent: 0, skipped: skipped.length, held: 0, by: by?.userId ?? null };
    for (const c of send) {
      const r = await queueTemplate({ orgId, memberId: c.memberId, key: t.key, vars: c.vars, userId: by?.userId ?? null, force: true, now, today, rule: templateRule(t), settings: ctx.settings });
      if (!r) run.skipped++;
      else if (r.status === "Scheduled") {
        run.held++;
        if (r.scheduledFor && (!result.heldUntil || r.scheduledFor < result.heldUntil)) result.heldUntil = r.scheduledFor;
      } else if (r.status === "Failed") result.failed++;
      else run.sent++;
      // The next template sees this send in its weekly count.
      ctx.recent.push({ memberId: c.memberId, templateKey: t.key, sentAt: now, sentById: by?.userId ?? null });
    }
    result.sent += run.sent;
    result.skipped += run.skipped;
    result.held += run.held;
    if (run.matched) result.runs.push(run);
  }
  if (result.runs.length) {
    const previous = ((await getSetting<Run[]>(orgId, "wa_auto_runs")) ?? []).slice(0, 40 - result.runs.length);
    const value = [...result.runs, ...previous] as unknown as Prisma.InputJsonValue;
    await db.$transaction(async (tx) => {
      await tx.setting.upsert({ where: { orgId_key: { orgId, key: "wa_auto_runs" } }, create: { orgId, key: "wa_auto_runs", value }, update: { value } });
      await audit(tx, { orgId, userId: by?.userId ?? null, action: "whatsapp.automation.run", entity: "Setting", entityId: "wa_auto_runs", after: result.runs });
    });
  }
  return result;
}

/** The quiet-hours refusal for runs started by hand (prototype A.autoRun). */
export function assertNotQuiet(s: WaSettings, now: Date) {
  if (inQuietHours(istClock(now), s.quietFrom, s.quietTo)) throw new UserError(`Quiet hours (${fmtClock(s.quietFrom)} – ${fmtClock(s.quietTo)}). Messages will go out at ${fmtClock(s.quietTo)}.`);
}

/** "Send N due now": every scheduled template that is on, for the user's branches. */
export async function runAutomationNow(u: CurrentUser, today = todayIso(), now = new Date()) {
  assertNotQuiet(await getWaSettings(u.orgId), now);
  const keys = (await listTemplates(u.orgId)).filter((t) => t.autoSend && isScheduled(t.ruleWhen)).map((t) => t.key);
  return runRules(u.orgId, u.branchIds, keys, today, now, { userId: u.id });
}

/** "Send to N now" in Preview & run: one template, whether or not its Auto-send is on. */
export async function runOne(u: CurrentUser, key: string, today = todayIso(), now = new Date()) {
  assertNotQuiet(await getWaSettings(u.orgId), now);
  if (!(await listTemplates(u.orgId)).some((t) => t.key === key)) throw new UserError("Template not found.");
  return runRules(u.orgId, u.branchIds, [key], today, now, { userId: u.id });
}

/** When the reminders last ran: the daily job, or someone pressing Send due now / Preview & run. */
export async function lastAutomationRun(orgId: string) {
  const [job, manual] = await Promise.all([
    db.jobRun.findFirst({ where: { orgId, name: { in: REMINDER_JOBS }, finishedAt: { not: null } }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } }),
    getSetting<Run[]>(orgId, "wa_auto_runs"),
  ]);
  const runs = (manual ?? []).filter((r) => r && typeof r.ts === "string");
  const at = Math.max(job?.finishedAt?.getTime() ?? 0, runs[0] ? Date.parse(runs[0].ts) : 0);
  return { at: at ? new Date(at) : null, runs };
}

/**
 * Sends the messages held by quiet hours or a rule's send time once their time has come, unless it
 * is quiet hours again. Called every 15 minutes (/api/jobs/dispatch) and when the WhatsApp page opens.
 */
export async function dispatchScheduled(orgId: string, now = new Date()) {
  const held = await db.whatsAppMessage.findMany({ where: { orgId, status: "Scheduled" }, orderBy: { scheduledFor: "asc" }, select: { id: true, scheduledFor: true } });
  const out = { sent: 0, failed: 0, stillHeld: held.length };
  if (!held.length) return out;
  const s = await getWaSettings(orgId);
  if (inQuietHours(istClock(now), s.quietFrom, s.quietTo)) return out;
  for (const m of held.filter((x) => x.scheduledFor && x.scheduledFor <= now)) {
    // Claim it first so two dispatchers never send the same message.
    const claimed = await db.whatsAppMessage.updateMany({ where: { id: m.id, status: "Scheduled" }, data: { status: "Queued", sentAt: now } });
    if (!claimed.count) continue;
    out.stillHeld--;
    const r = await deliverMessage(m.id);
    if (r.status === "Failed") out.failed++;
    else out.sent++;
  }
  return out;
}
