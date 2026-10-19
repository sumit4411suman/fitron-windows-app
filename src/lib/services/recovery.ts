import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import type { Prisma } from "@/generated/prisma/client";
import { balanceDue, invoiceState } from "@/lib/domain/billing";
import { addDays, daysBetween } from "@/lib/domain/dates";
import { aging, duesEligible, duesNextAction, duesPriority, renewalNextAction, renewalPriority, withRecoveryDefaults, type RecoveryRules, type RecoveryStatus } from "@/lib/domain/recovery";
import { metric, recoveryRate, type MetricResult, type Period } from "@/lib/domain/metrics";
import type { PaymentInput } from "@/lib/validation/billing";
import { audit } from "./audit";
import { collectPayment, listReceivables } from "./billing";
import { UserError } from "./errors";
import { remindDue, remindRenewal } from "./reminders";
import { getSetting, putSetting } from "./settings";
import { fromIso, todayIso, toIso } from "./time";

// Membership Revenue Recovery (docs/BUSINESS-INTELLIGENCE.md, Module 1). The queue is derived from the books: an open
// case per invoice still owed and per lapsed membership worth a call. Every change to the money itself goes through
// the same functions the pages use (collectPayment, remindDue), so locked months, permissions, de-duplication and the
// audit log apply as they do at the front desk. A case never changes an invoice; it records what was done about it.

export type { RecoveryRules };

export const getRecoveryRules = async (orgId: string) => withRecoveryDefaults(await getSetting<Partial<RecoveryRules>>(orgId, "recovery"));
export async function saveRecoveryRules(u: CurrentUser, rules: RecoveryRules) {
  if (!u.can("settings.manage")) throw new UserError("Only a Super Admin can change the recovery rules.");
  await putSetting(u, "recovery", withRecoveryDefaults(rules));
}

const scope = (u: CurrentUser): Prisma.RecoveryCaseWhereInput => ({ orgId: u.orgId, branchId: { in: u.branchIds } });
const OPEN: RecoveryStatus[] = ["OPEN", "IN_PROGRESS"];

/** Successful payments on an invoice dated on or after the case opened: what the case recovered. */
const recoveredSince = (payments: { amount: number; status: string; date: Date }[], openedAt: Date) => {
  const from = todayIso(openedAt);
  return payments.filter((p) => p.status === "SUCCESS" && toIso(p.date) >= from).reduce((s, p) => s + p.amount, 0);
};

/**
 * Brings the queue up to date with the books for the branches in scope: opens cases for invoices that became eligible,
 * re-prioritises open ones, closes those paid or cancelled, and does the same for renewal opportunities. Safe to run
 * any number of times a day; the unique keys (one case per invoice, one per lapsed membership) make a second run a
 * no-op. Run by the daily job and before the queue is shown.
 */
export async function refreshQueue(u: CurrentUser, today = todayIso()) {
  const rules = await getRecoveryRules(u.orgId);
  const out = { opened: 0, updated: 0, recovered: 0, closed: 0, renewalsOpened: 0, renewed: 0 };
  const [invoices, cases, mandates] = await Promise.all([
    db.invoice.findMany({
      where: { orgId: u.orgId, branchId: { in: u.branchIds }, status: { in: ["ISSUED", "CANCELLED"] }, OR: [{ status: "ISSUED" }, { recoveryCase: { status: { in: OPEN } } }] },
      select: { id: true, branchId: true, memberId: true, total: true, dueDate: true, status: true, payments: { select: { amount: true, status: true, date: true } }, member: { select: { suspended: true, walkIn: true, erasedAt: true, deletedAt: true, memberships: { where: { status: "VALID" }, select: { startDate: true, endDate: true } } } }, recoveryCase: true },
    }),
    db.recoveryCase.findMany({ where: { ...scope(u), kind: "DUES", status: { in: OPEN } }, select: { id: true, invoiceId: true } }),
    db.autopayMandate.findMany({ where: { orgId: u.orgId, branchId: { in: u.branchIds }, status: "Active" }, select: { memberId: true } }),
  ]);
  const autopay = new Set(mandates.map((m) => m.memberId));
  const seen = new Set<string>();
  for (const inv of invoices) {
    const st = invoiceState({ total: inv.total, cancelled: inv.status === "CANCELLED", dueDate: toIso(inv.dueDate) }, inv.payments as { amount: number; status: "SUCCESS" | "REVERSED" }[], today);
    const c = inv.recoveryCase;
    if (c && OPEN.includes(c.status as RecoveryStatus)) {
      seen.add(c.id);
      if (inv.status === "CANCELLED") {
        await db.recoveryCase.update({ where: { id: c.id }, data: { status: "CLOSED", closedAt: new Date(), closeReason: "Invoice cancelled", recoveredAmount: recoveredSince(inv.payments, c.openedAt) } });
        out.closed++;
        continue;
      }
      if (st.balance <= 0) {
        await db.recoveryCase.update({ where: { id: c.id }, data: { status: "RECOVERED", closedAt: new Date(), recoveredAmount: recoveredSince(inv.payments, c.openedAt), nextAction: "Recovered", nextActionOn: null } });
        out.recovered++;
        continue;
      }
      const facts = { balance: st.balance, overdueDays: st.overdueDays, memberActive: inv.member.memberships.some((m) => toIso(m.startDate) <= today && toIso(m.endDate) >= today), hasAutopay: autopay.has(inv.memberId), attempts: c.attempts, promisedOn: c.promisedOn ? toIso(c.promisedOn) : null, today };
      const next = duesNextAction(facts, rules, c.lastAttemptAt ? todayIso(c.lastAttemptAt) : null);
      await db.recoveryCase.update({ where: { id: c.id }, data: { priority: duesPriority(facts), nextAction: next.action, nextActionOn: fromIso(next.on), recoveredAmount: recoveredSince(inv.payments, c.openedAt) } });
      out.updated++;
      continue;
    }
    if (inv.status !== "ISSUED" || inv.member.walkIn || inv.member.erasedAt || inv.member.deletedAt) continue;
    if (!duesEligible({ balance: st.balance, overdueDays: st.overdueDays, partPaid: st.paid > 0 }, rules)) continue;
    const facts = { balance: st.balance, overdueDays: st.overdueDays, memberActive: inv.member.memberships.some((m) => toIso(m.startDate) <= today && toIso(m.endDate) >= today), hasAutopay: autopay.has(inv.memberId), attempts: 0, promisedOn: null, today };
    const next = duesNextAction(facts, rules, null);
    try {
      // A closed case on this invoice stays closed (written off); a new balance would need the owner to reopen it.
      if (c) continue;
      await db.recoveryCase.create({ data: { orgId: u.orgId, branchId: inv.branchId, memberId: inv.memberId, kind: "DUES", invoiceId: inv.id, openingAmount: st.balance, priority: duesPriority(facts), nextAction: next.action, nextActionOn: fromIso(next.on) } });
      out.opened++;
    } catch (e) {
      // Two refreshes at once: the other one made it.
      if (!(e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002")) throw e;
    }
  }
  // Open dues cases whose invoice moved out of the branches in view, or disappeared, are left alone.
  void cases;
  void seen;

  // Renewal opportunities: the latest valid membership ended within the window, nothing newer, member not suspended.
  const members = await db.member.findMany({
    where: { orgId: u.orgId, branchId: { in: u.branchIds }, deletedAt: null, walkIn: false, erasedAt: null },
    select: { id: true, branchId: true, suspended: true, memberships: { where: { status: "VALID" }, select: { id: true, startDate: true, endDate: true, price: true, discount: true }, orderBy: { endDate: "desc" } } },
  });
  const ids = members.map((m) => m.id);
  const [openRenewals, visits, dues] = await Promise.all([
    db.recoveryCase.findMany({ where: { ...scope(u), kind: "RENEWAL", status: { in: OPEN } } }),
    db.attendance.groupBy({ by: ["memberId"], where: { memberId: { in: ids }, date: { gte: fromIso(addDays(today, -(rules.renewalWindowDays + 30))) } }, _count: true }),
    db.recoveryCase.findMany({ where: { ...scope(u), kind: "DUES", status: { in: OPEN } }, select: { memberId: true } }),
  ]);
  const visitsBy = new Map(visits.map((v) => [v.memberId!, v._count]));
  const hasDues = new Set(dues.map((d) => d.memberId));
  const openBy = new Map(openRenewals.map((c) => [c.membershipId!, c]));
  const windowStart = addDays(today, -rules.renewalWindowDays);
  for (const m of members) {
    const latest = m.memberships[0];
    const open = latest ? openBy.get(latest.id) : undefined;
    // Any open renewal case on an older membership of this member: the member bought again or the case is stale.
    for (const c of openRenewals.filter((c) => c.memberId === m.id && c.membershipId !== latest?.id)) {
      await db.recoveryCase.update({ where: { id: c.id }, data: { status: "RENEWED", closedAt: new Date(), nextAction: "Renewed", nextActionOn: null } });
      out.renewed++;
    }
    if (!latest) continue;
    const end = toIso(latest.endDate);
    const lapsed = end < today && !m.suspended && end >= windowStart;
    if (open) {
      if (end >= today) {
        // The membership was extended (a freeze or a backdated renewal on the same row): nothing to chase.
        await db.recoveryCase.update({ where: { id: open.id }, data: { status: "RENEWED", closedAt: new Date(), nextAction: "Renewed", nextActionOn: null } });
        out.renewed++;
      } else if (end < windowStart) {
        await db.recoveryCase.update({ where: { id: open.id }, data: { status: "CLOSED", closedAt: new Date(), closeReason: `No renewal within ${rules.renewalWindowDays} days` } });
        out.closed++;
      } else {
        const facts = { lastPrice: latest.price - latest.discount, daysSinceEnd: daysBetween(today, end), recentVisits: visitsBy.get(m.id) ?? 0, tenureMemberships: m.memberships.length, hasDues: hasDues.has(m.id) };
        const next = renewalNextAction(facts, open.attempts, open.lastAttemptAt ? todayIso(open.lastAttemptAt) : null, today, rules);
        await db.recoveryCase.update({ where: { id: open.id }, data: { priority: renewalPriority(facts), nextAction: next.action, nextActionOn: fromIso(next.on) } });
        out.updated++;
      }
      continue;
    }
    if (!lapsed) continue;
    const facts = { lastPrice: latest.price - latest.discount, daysSinceEnd: daysBetween(today, end), recentVisits: visitsBy.get(m.id) ?? 0, tenureMemberships: m.memberships.length, hasDues: hasDues.has(m.id) };
    const next = renewalNextAction(facts, 0, null, today, rules);
    try {
      await db.recoveryCase.create({ data: { orgId: u.orgId, branchId: m.branchId, memberId: m.id, kind: "RENEWAL", membershipId: latest.id, openingAmount: latest.price - latest.discount, priority: renewalPriority(facts), nextAction: next.action, nextActionOn: fromIso(next.on) } });
      out.renewalsOpened++;
    } catch (e) {
      // Closed before (the member was asked and said no), or made by a parallel refresh.
      if (!(e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002")) throw e;
    }
  }
  return out;
}

export type CaseRow = Awaited<ReturnType<typeof listCases>>["rows"][number];

export async function listCases(u: CurrentUser, f: { kind?: string; status?: "open" | "closed" | "all"; branchId?: string; q?: string; page?: number; pageSize?: number } = {}) {
  const pageSize = f.pageSize ?? 50;
  const page = Math.max(1, f.page ?? 1);
  const where: Prisma.RecoveryCaseWhereInput = {
    ...scope(u),
    ...(f.kind === "DUES" || f.kind === "RENEWAL" ? { kind: f.kind } : {}),
    ...(f.status === "closed" ? { status: { notIn: OPEN } } : f.status === "all" ? {} : { status: { in: OPEN } }),
    ...(f.branchId && u.branchIds.includes(f.branchId) ? { branchId: f.branchId } : {}),
    ...(f.q ? { member: { OR: [{ name: { contains: f.q } }, { phone: { contains: f.q } }, { code: { contains: f.q } }] } } : {}),
  };
  const [total, rows] = await Promise.all([
    db.recoveryCase.count({ where }),
    db.recoveryCase.findMany({
      where,
      orderBy: [{ priority: "desc" }, { openedAt: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { member: { select: { id: true, name: true, phone: true, code: true } }, invoice: { select: { id: true, number: true, total: true, dueDate: true, payments: { select: { amount: true, status: true } } } } },
    }),
  ]);
  const today = todayIso();
  return {
    total,
    page,
    pageSize,
    rows: rows.map((c) => {
      const st = c.invoice ? invoiceState({ total: c.invoice.total, cancelled: false, dueDate: toIso(c.invoice.dueDate) }, c.invoice.payments as { amount: number; status: "SUCCESS" | "REVERSED" }[], today) : null;
      return { ...c, balance: st?.balance ?? 0, overdueDays: st?.overdueDays ?? 0, dueToday: !!c.nextActionOn && toIso(c.nextActionOn) <= today };
    }),
  };
}

export async function getCase(u: CurrentUser, id: string) {
  const c = await db.recoveryCase.findFirst({
    where: { ...scope(u), id },
    include: {
      member: { select: { id: true, name: true, phone: true, code: true, suspended: true } },
      invoice: { select: { id: true, number: true, total: true, date: true, dueDate: true, status: true, payments: { select: { id: true, code: true, amount: true, status: true, date: true, method: true } } } },
      attemptsLog: { orderBy: { at: "desc" } },
    },
  });
  if (!c) throw new UserError("Case not found.");
  const today = todayIso();
  const st = c.invoice ? invoiceState({ total: c.invoice.total, cancelled: c.invoice.status === "CANCELLED", dueDate: toIso(c.invoice.dueDate) }, c.invoice.payments as { amount: number; status: "SUCCESS" | "REVERSED" }[], today) : null;
  const membership = c.membershipId ? await db.membership.findUnique({ where: { id: c.membershipId }, select: { startDate: true, endDate: true, price: true, discount: true, plan: { select: { name: true } } } }) : null;
  const users = await db.user.findMany({ where: { id: { in: [...new Set(c.attemptsLog.map((a) => a.byId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  return { ...c, balance: st?.balance ?? 0, overdueDays: st?.overdueDays ?? 0, membership, byName: new Map(users.map((x) => [x.id, x.name])) };
}

export type AttemptInput = { kind: "CALL" | "VISIT" | "NOTE"; outcome: "NO_ANSWER" | "PROMISED" | "REFUSED" | "NOTED"; note?: string; promisedOn?: string; promisedAmount?: number };

/** Records a call, a visit or a note on a case and moves its next step along. */
export async function logAttempt(u: CurrentUser, caseId: string, a: AttemptInput) {
  const c = await db.recoveryCase.findFirst({ where: { ...scope(u), id: caseId } });
  if (!c) throw new UserError("Case not found.");
  if (!OPEN.includes(c.status as RecoveryStatus)) throw new UserError("This case is closed.");
  if (a.outcome === "PROMISED" && !a.promisedOn) throw new UserError("Enter the date they promised.", "promisedOn");
  const rules = await getRecoveryRules(u.orgId);
  const today = todayIso();
  await db.$transaction(async (tx) => {
    const attempt = await tx.recoveryAttempt.create({ data: { caseId, orgId: u.orgId, kind: a.kind, outcome: a.outcome, note: a.note?.slice(0, 1000) ?? null, promisedOn: a.promisedOn ? fromIso(a.promisedOn) : null, promisedAmount: a.promisedAmount ?? null, byId: u.id } });
    const attempts = c.attempts + 1;
    const next = c.kind === "DUES"
      ? duesNextAction({ balance: c.openingAmount, overdueDays: 0, memberActive: true, hasAutopay: false, attempts, promisedOn: a.promisedOn ?? (c.promisedOn ? toIso(c.promisedOn) : null), today }, rules, today)
      : renewalNextAction({ lastPrice: c.openingAmount, daysSinceEnd: 0, recentVisits: 0, tenureMemberships: 1, hasDues: false }, attempts, today, today, rules);
    await tx.recoveryCase.update({ where: { id: caseId }, data: { attempts, lastAttemptAt: new Date(), status: "IN_PROGRESS", nextAction: next.action, nextActionOn: fromIso(next.on), ...(a.outcome === "PROMISED" ? { promisedOn: fromIso(a.promisedOn!), promisedAmount: a.promisedAmount ?? null } : {}) } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "bi.recovery.attempt", entity: "RecoveryAttempt", entityId: attempt.id, after: { caseId, kind: a.kind, outcome: a.outcome, promisedOn: a.promisedOn ?? null, promisedAmount: a.promisedAmount ?? null }, branchId: c.branchId });
  });
}

/**
 * Sends the case's WhatsApp reminder through the normal reminder path (the gym's template, de-duplication, demo mode,
 * quiet hours) and records how it went. Nothing is sent unless the person's role may send WhatsApp messages.
 */
export async function sendCaseReminder(u: CurrentUser, caseId: string) {
  if (!u.can("whatsapp.send")) throw new UserError("Your role can't send WhatsApp messages.");
  const c = await db.recoveryCase.findFirst({ where: { ...scope(u), id: caseId }, include: { invoice: { select: { number: true } } } });
  if (!c) throw new UserError("Case not found.");
  if (!OPEN.includes(c.status as RecoveryStatus)) throw new UserError("This case is closed.");
  const msg = c.kind === "DUES" ? await remindDue(u, c.memberId, c.invoice?.number) : await remindRenewal(u, c.memberId);
  const outcome = !msg ? "SKIPPED" : msg.status === "Failed" ? "FAILED" : msg.status === "Logged" ? "LOGGED" : msg.status === "Scheduled" || msg.status === "Queued" ? "QUEUED" : "SENT";
  const rules = await getRecoveryRules(u.orgId);
  const today = todayIso();
  await db.$transaction(async (tx) => {
    const attempt = await tx.recoveryAttempt.create({ data: { caseId, orgId: u.orgId, kind: "WHATSAPP", outcome, note: !msg ? "Not sent: this member was reminded recently (Settings › Reminders sets how often)." : msg.status === "Logged" ? "WhatsApp is in demo mode: the message was saved, not sent." : msg.error ?? null, whatsAppMessageId: msg?.id ?? null, byId: u.id } });
    if (msg && outcome !== "FAILED") {
      const attempts = c.attempts + 1;
      const next = c.kind === "DUES"
        ? duesNextAction({ balance: c.openingAmount, overdueDays: 0, memberActive: true, hasAutopay: false, attempts, promisedOn: c.promisedOn ? toIso(c.promisedOn) : null, today }, rules, today)
        : renewalNextAction({ lastPrice: c.openingAmount, daysSinceEnd: 0, recentVisits: 0, tenureMemberships: 1, hasDues: false }, attempts, today, today, rules);
      await tx.recoveryCase.update({ where: { id: caseId }, data: { attempts, lastAttemptAt: new Date(), status: "IN_PROGRESS", nextAction: next.action, nextActionOn: fromIso(next.on) } });
    }
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "bi.recovery.remind", entity: "RecoveryAttempt", entityId: attempt.id, after: { caseId, outcome, messageId: msg?.id ?? null }, branchId: c.branchId });
  });
  return { outcome, message: msg };
}

/** Window in which the same amount on the same case is taken as a double click, not a second payment. */
const DUPLICATE_WINDOW_MS = 2 * 60_000;

/**
 * Records a payment the member made against the case's invoice. The money goes through Collect payment exactly as at
 * the front desk (balance check, locked months, gap-free numbering, audit); the case only remembers which payment it
 * was, once. The same amount twice within two minutes is refused as a repeat.
 */
export async function recordCasePayment(u: CurrentUser, caseId: string, input: PaymentInput) {
  if (!u.can("payments.collect")) throw new UserError("Your role can't collect payments.");
  const c = await db.recoveryCase.findFirst({ where: { ...scope(u), id: caseId } });
  if (!c) throw new UserError("Case not found.");
  if (c.kind !== "DUES" || !c.invoiceId) throw new UserError("A renewal opportunity has no invoice to pay: sell the renewal from the member's page.");
  if (!OPEN.includes(c.status as RecoveryStatus)) throw new UserError("This case is closed.");
  const repeat = await db.recoveryAttempt.findFirst({ where: { caseId, kind: "PAYMENT", promisedAmount: input.amount, at: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) } } });
  if (repeat) throw new UserError("The same amount was recorded on this case a moment ago. Refresh to see it before recording another.");
  const payment = await collectPayment(u, c.invoiceId, input);
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: c.invoiceId }, select: { total: true, payments: { select: { amount: true, status: true, date: true } } } });
  const paid = inv.payments.filter((p) => p.status === "SUCCESS").reduce((s, p) => s + p.amount, 0);
  const left = balanceDue(inv.total, paid);
  await db.$transaction(async (tx) => {
    await tx.recoveryAttempt.create({ data: { caseId, orgId: u.orgId, kind: "PAYMENT", outcome: "PAID", paymentId: payment.id, promisedAmount: input.amount, note: input.notes?.slice(0, 500) ?? null, byId: u.id } });
    await tx.recoveryCase.update({
      where: { id: caseId },
      data: left <= 0
        ? { status: "RECOVERED", closedAt: new Date(), closedById: u.id, recoveredAmount: recoveredSince(inv.payments, c.openedAt), nextAction: "Recovered", nextActionOn: null, attempts: c.attempts + 1, lastAttemptAt: new Date() }
        : { status: "IN_PROGRESS", recoveredAmount: recoveredSince(inv.payments, c.openedAt), attempts: c.attempts + 1, lastAttemptAt: new Date(), promisedOn: null, promisedAmount: null },
    });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "bi.recovery.payment", entity: "RecoveryCase", entityId: caseId, after: { paymentId: payment.id, amount: input.amount, balanceLeft: left }, branchId: c.branchId });
  });
  return { payment, balanceLeft: left };
}

/** Closes a case without recovery (written off, disputed, member left) or a renewal opportunity (declined). */
export async function closeCase(u: CurrentUser, caseId: string, reason: string) {
  const c = await db.recoveryCase.findFirst({ where: { ...scope(u), id: caseId } });
  if (!c) throw new UserError("Case not found.");
  if (!OPEN.includes(c.status as RecoveryStatus)) throw new UserError("This case is already closed.");
  if (!reason.trim()) throw new UserError("Say why it is closed.", "reason");
  await db.$transaction(async (tx) => {
    await tx.recoveryAttempt.create({ data: { caseId, orgId: u.orgId, kind: "CLOSE", outcome: "NOTED", note: reason.slice(0, 500), byId: u.id } });
    await tx.recoveryCase.update({ where: { id: caseId }, data: { status: "CLOSED", closedAt: new Date(), closedById: u.id, closeReason: reason.slice(0, 200), nextAction: "Closed", nextActionOn: null } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "bi.recovery.close", entity: "RecoveryCase", entityId: caseId, before: { status: c.status }, after: { status: "CLOSED", reason }, branchId: c.branchId });
  });
}

/** Reopens a closed case (a written-off balance the member came back for). */
export async function reopenCase(u: CurrentUser, caseId: string) {
  const c = await db.recoveryCase.findFirst({ where: { ...scope(u), id: caseId } });
  if (!c) throw new UserError("Case not found.");
  if (c.status !== "CLOSED") throw new UserError("Only a closed case can be reopened.");
  await db.$transaction(async (tx) => {
    await tx.recoveryCase.update({ where: { id: caseId }, data: { status: "OPEN", closedAt: null, closedById: null, closeReason: null, nextAction: "Review", nextActionOn: fromIso(todayIso()) } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "bi.recovery.reopen", entity: "RecoveryCase", entityId: caseId, branchId: c.branchId });
  });
}

export type RecoveryDashboard = Awaited<ReturnType<typeof recoveryDashboard>>;

/** The recovery report for a period: the headline metrics with their definitions, ageing, and performance by branch and plan. */
export async function recoveryDashboard(u: CurrentUser, period: Period, today = todayIso()) {
  const [recv, cases, paymentsInPeriod] = await Promise.all([
    listReceivables(u),
    db.recoveryCase.findMany({
      where: { ...scope(u), kind: "DUES" },
      include: { invoice: { select: { total: true, dueDate: true, status: true, payments: { select: { amount: true, status: true, date: true } }, membership: { select: { plan: { select: { name: true } } } } } } },
    }),
    db.payment.findMany({ where: { orgId: u.orgId, branchId: { in: u.branchIds }, status: "SUCCESS", date: { gte: fromIso(period.from), lte: fromIso(period.to) }, invoice: { recoveryCase: { isNot: null } } }, select: { amount: true, date: true, invoiceId: true, branchId: true } }),
  ]);
  const caseByInvoice = new Map(cases.map((c) => [c.invoiceId!, c]));
  const open = cases.filter((c) => OPEN.includes(c.status as RecoveryStatus) && c.invoice);
  const balanceOf = (c: (typeof cases)[number]) => (c.invoice ? invoiceState({ total: c.invoice.total, cancelled: c.invoice.status === "CANCELLED", dueDate: toIso(c.invoice.dueDate) }, c.invoice.payments as { amount: number; status: "SUCCESS" | "REVERSED" }[], today) : null);
  const openRows = open.map((c) => ({ c, st: balanceOf(c)! }));
  const eligible = openRows.reduce((s, r) => s + r.st.balance, 0);
  const pending = open.filter((c) => c.nextActionOn && toIso(c.nextActionOn) <= today).length;
  // Recovered: payments in the period on invoices whose case had opened by the payment's day.
  const recoveredRows = paymentsInPeriod.filter((p) => {
    const c = caseByInvoice.get(p.invoiceId);
    return c && todayIso(c.openedAt) <= toIso(p.date);
  });
  const recovered = recoveredRows.reduce((s, p) => s + p.amount, 0);
  // Denominator: what open cases owed at the start of the period, plus what cases opened in the period owed when opened.
  const openedBefore = cases.filter((c) => todayIso(c.openedAt) < period.from && (!c.closedAt || todayIso(c.closedAt) >= period.from) && c.invoice);
  const openingEligible = openedBefore.reduce((s, c) => {
    const paidBefore = c.invoice!.payments.filter((p) => p.status === "SUCCESS" && toIso(p.date) < period.from).reduce((t, p) => t + p.amount, 0);
    return s + balanceDue(c.invoice!.total, paidBefore);
  }, 0);
  const newlyEligible = cases.filter((c) => todayIso(c.openedAt) >= period.from && todayIso(c.openedAt) <= period.to).reduce((s, c) => s + c.openingAmount, 0);
  const rate = recoveryRate(recovered, openingEligible, newlyEligible);
  const byBranch = u.branches.filter((b) => u.branchIds.includes(b.id)).map((b) => ({
    id: b.id,
    name: b.name,
    open: openRows.filter((r) => r.c.branchId === b.id).length,
    outstanding: openRows.filter((r) => r.c.branchId === b.id).reduce((s, r) => s + r.st.balance, 0),
    recovered: recoveredRows.filter((p) => p.branchId === b.id).reduce((s, p) => s + p.amount, 0),
  }));
  const planOf = (c: (typeof cases)[number]) => c.invoice?.membership?.plan.name ?? "Other invoices";
  const plans = new Map<string, { open: number; outstanding: number; recovered: number }>();
  for (const r of openRows) {
    const k = planOf(r.c);
    const x = plans.get(k) ?? { open: 0, outstanding: 0, recovered: 0 };
    x.open++;
    x.outstanding += r.st.balance;
    plans.set(k, x);
  }
  for (const p of recoveredRows) {
    const k = planOf(caseByInvoice.get(p.invoiceId)!);
    const x = plans.get(k) ?? { open: 0, outstanding: 0, recovered: 0 };
    x.recovered += p.amount;
    plans.set(k, x);
  }
  const renewals = await db.recoveryCase.count({ where: { ...scope(u), kind: "RENEWAL", status: { in: OPEN } } });
  const metrics: MetricResult[] = [
    metric("recovery.outstanding", recv.total, period),
    metric("recovery.eligible", eligible, period),
    metric("recovery.pending", pending, period),
    metric("recovery.recovered", recovered, period),
    metric("recovery.rate", rate.rate, period, { warnings: rate.denominator === 0 ? ["Nothing was eligible for recovery in this period."] : [] }),
  ];
  return {
    period,
    metrics,
    outstanding: recv.total,
    eligible,
    pending,
    recovered,
    rate: rate.rate,
    denominator: rate.denominator,
    openCases: open.length,
    renewalOpportunities: renewals,
    over90: openRows.filter((r) => r.st.overdueDays > 90).length,
    aging: aging(openRows.map((r) => ({ balance: r.st.balance, overdueDays: r.st.overdueDays }))),
    byBranch,
    byPlan: [...plans.entries()].map(([plan, v]) => ({ plan, ...v })).sort((a, b) => b.outstanding - a.outstanding),
  };
}
