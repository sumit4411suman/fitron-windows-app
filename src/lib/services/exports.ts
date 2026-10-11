import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import type { Permission } from "@/lib/auth/permissions";
import { INVOICE_STATUS_TAG, invoiceState } from "@/lib/domain/billing";
import { membershipStatus } from "@/lib/domain/membership";
import { audit } from "./audit";
import { memberScope, summarize } from "./members";
import { toCsv, type Report } from "./reports";
import { todayIso, toIso } from "./time";

/** Settings → Migrate & import → Export all data: the prototype's four CSV files. */
export const EXPORT_KINDS = ["members", "invoices", "payments", "expenses"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];
export const isExportKind = (s: string): s is ExportKind => (EXPORT_KINDS as readonly string[]).includes(s);

export const EXPORTS: Record<ExportKind, { label: string; perm: Permission; entity: "Member" | "Invoice" | "Payment" | "Expense" }> = {
  members: { label: "Members (CSV)", perm: "members.view", entity: "Member" },
  invoices: { label: "Invoices (CSV)", perm: "invoices.view", entity: "Invoice" },
  payments: { label: "Payments (CSV)", perm: "invoices.view", entity: "Payment" },
  expenses: { label: "Expenses (CSV)", perm: "expenses.manage", entity: "Expense" },
};

const col = (key: string, label: string, money = false) => ({ key, label, ...(money ? { money: true } : {}) });
const words = (s: string) => s.replace(/_/g, " ");
const branchScope = (u: CurrentUser) => ({ orgId: u.orgId, branchId: { in: u.branchIds } });

/** Every record of the branches the user can see, with the prototype's columns. No cap, no date or search filter, no side effects. */
export async function buildExport(u: CurrentUser, kind: ExportKind): Promise<Report> {
  const today = todayIso();
  if (kind === "members") {
    const members = await db.member.findMany({
      where: { ...memberScope(u), walkIn: false },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true, phone: true, email: true, gender: true, suspended: true },
    });
    const sums = await summarize(members.map((m) => m.id), today);
    return {
      columns: [col("id", "ID"), col("name", "Name"), col("phone", "Phone"), col("email", "Email"), col("gender", "Gender"), col("plan", "Plan"), col("start", "Start"), col("end", "End"), col("status", "Status"), col("outstanding", "Outstanding", true)],
      rows: members.map((m) => {
        const s = sums.get(m.id)!;
        const status = membershipStatus({ suspended: m.suspended, latestEnd: s.latestEnd, outstanding: s.outstanding, today });
        return { id: m.code, name: m.name, phone: m.phone, email: m.email ?? "", gender: m.gender, plan: s.planName ?? "—", start: s.planStart ?? "", end: s.latestEnd ?? "", status: words(status), outstanding: s.outstanding };
      }),
    };
  }
  if (kind === "invoices") {
    const invoices = await db.invoice.findMany({
      where: branchScope(u),
      orderBy: [{ date: "asc" }, { number: "asc" }],
      select: { number: true, date: true, dueDate: true, total: true, status: true, member: { select: { name: true } }, payments: { select: { amount: true, status: true } } },
    });
    return {
      columns: [col("invoice", "Invoice"), col("date", "Date"), col("member", "Member"), col("total", "Total", true), col("paid", "Paid", true), col("balance", "Balance", true), col("status", "Status")],
      rows: invoices.map((i) => {
        const st = invoiceState({ total: i.total, cancelled: i.status === "CANCELLED", dueDate: toIso(i.dueDate) }, i.payments as { amount: number; status: "SUCCESS" | "REVERSED" }[], today);
        return { invoice: i.number, date: toIso(i.date), member: i.member.name, total: i.total, paid: st.paid, balance: st.balance, status: INVOICE_STATUS_TAG[st.status] };
      }),
    };
  }
  if (kind === "payments") {
    const payments = await db.payment.findMany({
      where: branchScope(u),
      orderBy: [{ date: "asc" }, { code: "asc" }],
      select: { code: true, date: true, amount: true, method: true, txnRef: true, status: true, receivedById: true, member: { select: { name: true } }, invoice: { select: { number: true } } },
    });
    const ids = [...new Set(payments.map((p) => p.receivedById))];
    const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const byId = new Map(users.map((x) => [x.id, x.name]));
    return {
      columns: [col("id", "Payment ID"), col("date", "Date"), col("member", "Member"), col("invoice", "Invoice"), col("method", "Method"), col("txn", "Transaction ID"), col("amount", "Amount", true), col("status", "Status"), col("by", "Received by")],
      rows: payments.map((p) => ({ id: p.code, date: toIso(p.date), member: p.member.name, invoice: p.invoice.number, method: p.method, txn: p.txnRef ?? "", amount: p.amount, status: p.status === "REVERSED" ? "Reversed" : "Success", by: byId.get(p.receivedById) ?? "" })),
    };
  }
  const expenses = await db.expense.findMany({
    where: { ...branchScope(u), status: "ACTIVE" },
    orderBy: [{ date: "asc" }, { code: "asc" }],
    select: { code: true, date: true, description: true, vendor: true, amount: true, method: true, category: { select: { name: true } } },
  });
  return {
    columns: [col("id", "Expense"), col("date", "Date"), col("category", "Category"), col("desc", "Description"), col("vendor", "Vendor"), col("amount", "Amount", true), col("method", "Method")],
    rows: expenses.map((e) => ({ id: e.code, date: toIso(e.date), category: e.category.name, desc: e.description, vendor: e.vendor ?? "", amount: e.amount, method: e.method })),
  };
}

/** Builds the file, notes the download in the audit log (as the prototype does) and returns the CSV text. */
export async function exportAll(u: CurrentUser, kind: ExportKind): Promise<{ fileName: string; csv: string; rows: number }> {
  const report = await buildExport(u, kind);
  const fileName = `fitron-${kind}-${todayIso()}.csv`;
  const csv = toCsv(report);
  await db.$transaction((tx) =>
    audit(tx, { orgId: u.orgId, userId: u.id, action: `export.${kind}`, entity: EXPORTS[kind].entity, entityId: fileName, after: { rows: report.rows.length, branch: u.branch, columns: report.columns.map((c) => c.label) } }),
  );
  return { fileName, csv, rows: report.rows.length };
}
