import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { balanceDue } from "@/lib/domain/billing";
import { addDays, daysBetween } from "@/lib/domain/dates";
import { riskScore } from "@/lib/domain/risk";
import { summarize } from "./members";
import { isLow } from "./pos";
import { fromIso, toIso, todayIso } from "./time";

/** Nightly: recompute every member's churn risk from visits, expiry and dues. */
export async function computeRisk(orgId: string, today = todayIso()) {
  const members = await db.member.findMany({ where: { orgId, deletedAt: null, walkIn: false }, select: { id: true } });
  const ids = members.map((m) => m.id);
  const [sums, visits] = await Promise.all([
    summarize(ids, today),
    db.attendance.findMany({ where: { memberId: { in: ids }, date: { gte: fromIso(addDays(today, -60)) } }, select: { memberId: true, date: true } }),
    // Last visit ever, for members who haven't come in the last 60 days.
  ]);
  const last = await db.attendance.groupBy({ by: ["memberId"], where: { memberId: { in: ids } }, _max: { date: true } });
  const lastBy = new Map(last.map((l) => [l.memberId!, l._max.date ? toIso(l._max.date) : null]));
  const cut = addDays(today, -30);
  const v30 = new Map<string, number>();
  const vPrev = new Map<string, number>();
  for (const v of visits) {
    const m = v.memberId!;
    if (toIso(v.date) > cut) v30.set(m, (v30.get(m) ?? 0) + 1);
    else vPrev.set(m, (vPrev.get(m) ?? 0) + 1);
  }
  let high = 0;
  for (const id of ids) {
    const s = sums.get(id)!;
    const lv = lastBy.get(id) ?? null;
    const r = riskScore({
      daysSinceVisit: lv ? daysBetween(today, lv) : null,
      visits30: v30.get(id) ?? 0,
      visitsPrev30: vPrev.get(id) ?? 0,
      daysToExpiry: s.latestEnd ? daysBetween(s.latestEnd, today) : null,
      outstanding: s.outstanding,
    });
    // Long-gone members (expired over a month ago) aren't "at risk"; they've left.
    const gone = s.latestEnd && daysBetween(today, s.latestEnd) > 30;
    const score = gone ? null : r.score;
    if (score !== null && score >= 60) high++;
    await db.member.update({ where: { id }, data: { riskScore: score, riskReasons: gone ? [] : r.reasons } });
  }
  return { members: ids.length, highRisk: high };
}

export async function atRisk(u: CurrentUser, take = 10) {
  return db.member.findMany({
    where: { orgId: u.orgId, branchId: { in: u.branchIds }, deletedAt: null, walkIn: false, suspended: false, riskScore: { gte: 35 } },
    orderBy: { riskScore: "desc" },
    take,
    select: { id: true, code: true, name: true, phone: true, riskScore: true, riskReasons: true },
  });
}

export type Alert = { tone: "alert" | "accent" | "neutral"; title: string; detail: string; href?: string };

/** The morning brief: things that need someone's attention today, limited to what the user may see. */
export async function dailyBrief(u: CurrentUser, today = todayIso()): Promise<Alert[]> {
  const out: Alert[] = [];
  const scope = { orgId: u.orgId, branchId: { in: u.branchIds } };

  if (u.can("invoices.view")) {
    const invs = await db.invoice.findMany({ where: { ...scope, status: "ISSUED", dueDate: { lt: fromIso(today) } }, select: { total: true, payments: { where: { status: "SUCCESS" }, select: { amount: true } } } });
    const overdue = invs.map((i) => balanceDue(i.total, i.payments.reduce((s, p) => s + p.amount, 0))).filter((b) => b > 0);
    const total = overdue.reduce((s, b) => s + b, 0);
    if (total >= 1_000_000) out.push({ tone: "alert", title: `₹${Math.round(total / 100).toLocaleString("en-IN")} overdue`, detail: `${overdue.length} unpaid invoices are past their due date.`, href: "/receivables" });
  }

  if (u.can("accounting.view")) {
    const since = fromIso(addDays(today, -180));
    const ex = await db.expense.findMany({ where: { ...scope, status: "ACTIVE", capital: false, date: { gte: since } }, select: { amount: true, date: true, description: true, category: { select: { name: true } } } });
    const byCat = new Map<string, number[]>();
    for (const e of ex) byCat.set(e.category.name, [...(byCat.get(e.category.name) ?? []), e.amount]);
    const recent = ex.filter((e) => toIso(e.date) >= addDays(today, -7));
    for (const e of recent) {
      const xs = byCat.get(e.category.name)!;
      if (xs.length < 4) continue;
      const avg = xs.reduce((s, x) => s + x, 0) / xs.length;
      if (e.amount > 2.5 * avg) out.push({ tone: "accent", title: `Unusual ${e.category.name.toLowerCase()} expense`, detail: `${e.description}: ₹${Math.round(e.amount / 100).toLocaleString("en-IN")}, ${(e.amount / avg).toFixed(1)}× the usual.`, href: "/expenses" });
    }
  }

  if (u.can("whatsapp.send")) {
    const failed = await db.whatsAppMessage.count({ where: { orgId: u.orgId, status: "Failed", sentAt: { gte: new Date(Date.now() - 2 * 86_400_000) } } });
    if (failed) out.push({ tone: "alert", title: `${failed} WhatsApp message${failed === 1 ? "" : "s"} failed`, detail: "In the last two days. Check the numbers or the WhatsApp connection.", href: "/whatsapp?status=Failed" });
  }

  if (u.can("members.view")) {
    // Renewal pace: of the memberships that ended in the last 30 days, how many were followed by a new one.
    const ended = await db.membership.findMany({ where: { branchId: { in: u.branchIds }, status: "VALID", endDate: { gte: fromIso(addDays(today, -30)), lt: fromIso(today) } }, select: { memberId: true, endDate: true } });
    if (ended.length >= 5) {
      const renewed = await db.membership.count({ where: { memberId: { in: ended.map((e) => e.memberId) }, status: "VALID", endDate: { gte: fromIso(today) } } });
      const rate = renewed / ended.length;
      if (rate < 0.6) out.push({ tone: "accent", title: `Renewals at ${Math.round(rate * 100)}%`, detail: `${renewed} of ${ended.length} members whose plan ended in the last 30 days have renewed.`, href: "/renewals" });
    }
    const risky = await db.member.count({ where: { ...scope, deletedAt: null, walkIn: false, suspended: false, riskScore: { gte: 60 } } });
    if (risky) out.push({ tone: "accent", title: `${risky} member${risky === 1 ? "" : "s"} at high risk of leaving`, detail: "Not visiting, expiring soon or owing money. See the list below.", href: "/ai" });
  }

  if (u.can("products.manage") || u.can("pos.sell")) {
    const products = await db.product.findMany({ where: { ...scope, active: true, stock: { not: null } }, select: { name: true, stock: true, reorderLevel: true } });
    const low = products.filter(isLow);
    if (low.length) out.push({ tone: "neutral", title: `${low.length} product${low.length === 1 ? "" : "s"} to reorder`, detail: low.slice(0, 4).map((p) => `${p.name} (${p.stock})`).join(", "), href: u.can("products.manage") ? "/products" : "/pos" });
  }
  return out;
}
