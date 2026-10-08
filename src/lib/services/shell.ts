import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { formatInr } from "@/lib/domain/billing";
import { addDays } from "@/lib/domain/dates";
import { memberScope } from "./members";
import { unreadCount } from "./notifications";
import { aiOn } from "./ai-settings";
import { fromIso, todayIso, toIso } from "./time";

export type NavCounts = Partial<Record<"renewals" | "receivables" | "notifications" | "ai" | "leads", number>>;

/** The numbers on the sidebar, as in the prototype; each only for users who can open that section. */
export async function navCounts(u: CurrentUser): Promise<NavCounts> {
  const today = todayIso();
  const [renewals, receivables, notifications, ai, leads] = await Promise.all([
    u.can("memberships.renew") ? renewalsDue(u, today) : undefined,
    u.can("invoices.view") ? openInvoices(u) : undefined,
    unreadCount(u),
    u.can("ai.use") && (await aiOn(u.orgId))
      ? db.member.count({ where: { ...memberScope(u), walkIn: false, suspended: false, riskScore: { gte: 60 } } })
      : undefined,
    u.can("leads.manage")
      ? db.lead.count({ where: { orgId: u.orgId, branchId: { in: u.branchIds }, stage: { notIn: ["Won", "Lost"] }, followUpOn: { lte: fromIso(today) } } })
      : undefined,
  ]);
  return { renewals, receivables, notifications, ai, leads };
}

/** Members whose last membership ends between today and 7 days from now. */
async function renewalsDue(u: CurrentUser, today: string) {
  const ends = await db.membership.groupBy({
    by: ["memberId"],
    where: { status: "VALID", member: { ...memberScope(u), walkIn: false, suspended: false } },
    _max: { endDate: true },
  });
  const last = addDays(today, 7);
  return ends.filter((e) => {
    const end = e._max.endDate ? toIso(e._max.endDate) : null;
    return end !== null && end >= today && end <= last;
  }).length;
}

/** Issued invoices that still have a balance. */
async function openInvoices(u: CurrentUser) {
  const invoices = await db.invoice.findMany({ where: { orgId: u.orgId, branchId: { in: u.branchIds }, status: "ISSUED" }, select: { id: true, total: true } });
  if (!invoices.length) return 0;
  const paid = await db.payment.groupBy({ by: ["invoiceId"], where: { invoiceId: { in: invoices.map((i) => i.id) }, status: "SUCCESS" }, _sum: { amount: true } });
  const byInvoice = new Map(paid.map((p) => [p.invoiceId, p._sum.amount ?? 0]));
  return invoices.filter((i) => i.total - (byInvoice.get(i.id) ?? 0) > 0).length;
}

export type SearchHit = { kind: "member" | "invoice" | "payment"; title: string; sub: string; href: string };

/** The header search (prototype): members by name, ID, phone or email; invoices by number; payments by code or transaction ID. */
export async function globalSearch(u: CurrentUser, raw: string): Promise<SearchHit[]> {
  const q = raw.trim();
  if (q.length < 2) return [];
  const branch = { orgId: u.orgId, branchId: { in: u.branchIds } };
  const ci = { contains: q, mode: "insensitive" as const };
  const [members, invoices, payments] = await Promise.all([
    u.can("members.view")
      ? db.member.findMany({
          where: { ...memberScope(u), walkIn: false, OR: [{ name: ci }, { code: ci }, { phone: { contains: q } }, { email: ci }] },
          orderBy: { name: "asc" },
          take: 6,
          select: { id: true, name: true, code: true, phone: true },
        })
      : [],
    u.can("invoices.view")
      ? db.invoice.findMany({ where: { ...branch, number: ci }, orderBy: { date: "desc" }, take: 4, select: { id: true, number: true, total: true, status: true, member: { select: { name: true } } } })
      : [],
    u.can("invoices.view")
      ? db.payment.findMany({
          where: { ...branch, OR: [{ code: ci }, { txnRef: ci }] },
          orderBy: { date: "desc" },
          take: 4,
          select: { code: true, txnRef: true, amount: true, invoiceId: true, member: { select: { name: true } }, invoice: { select: { number: true } } },
        })
      : [],
  ]);
  return [
    ...members.map((m) => ({ kind: "member" as const, title: m.name, sub: `${m.code} · ${m.phone}`, href: `/members/${m.id}` })),
    ...invoices.map((i) => ({ kind: "invoice" as const, title: i.number, sub: `${i.member?.name ?? ""} · ${formatInr(i.total)} · ${i.status === "CANCELLED" ? "Cancelled" : "Issued"}`, href: `/invoices/${i.id}` })),
    ...payments.map((p) => ({ kind: "payment" as const, title: p.code + (p.txnRef ? ` · ${p.txnRef}` : ""), sub: `${p.member.name} · ${formatInr(p.amount)} · ${p.invoice.number}`, href: `/invoices/${p.invoiceId}` })),
  ];
}
