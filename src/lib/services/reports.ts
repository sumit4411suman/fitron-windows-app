import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import type { Permission } from "@/lib/auth/permissions";
import type { Feature } from "@/lib/domain/features";
import { daysBetween } from "@/lib/domain/dates";
import { listMembers } from "./members";
import { listReceivables } from "./billing";
import { fromIso, toIso, todayIso } from "./time";
import type { Period } from "./accounting";
import { addMonths } from "@/lib/domain/dates";
import { assetInfo, depreciationIn, fyLabel, fyOf, scheduleByFy, ymOf } from "@/lib/domain/assets";
import { assetsFor, toLike } from "./assets";
import { CENTER, MORE } from "./reports-more";
import { buildXlsx, type XKind } from "@/lib/xlsx";

export type Cell = string | number | null;
/** money: paise shown as rupees; num / pct: right-aligned counts and percentages. */
export type Column = { key: string; label: string; money?: boolean; kind?: "num" | "pct" };
export type Report = { columns: Column[]; rows: Record<string, Cell>[]; totals?: Record<string, Cell> };

export type Def = { title: string; group: string; perm: Permission; feature?: Feature; usesPeriod: boolean; note?: string; run: (u: CurrentUser, p: Period) => Promise<Report> };

const inPeriod = (p: Period) => ({ gte: fromIso(p.from), lte: fromIso(p.to) });
const sumCol = (rows: Record<string, Cell>[], k: string) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
const branchScope = (u: CurrentUser) => ({ orgId: u.orgId, branchId: { in: u.branchIds } });

const BASE: Record<string, Def> = {
  collections: {
    title: "Collections",
    group: "Billing",
    perm: "invoices.view",
    usesPeriod: true,
    async run(u, p) {
      const pays = await db.payment.findMany({
        where: { ...branchScope(u), status: "SUCCESS", date: inPeriod(p) },
        orderBy: [{ date: "asc" }, { code: "asc" }],
        include: { member: { select: { name: true, code: true } }, invoice: { select: { number: true } } },
      });
      const rows = pays.map((x) => ({ date: toIso(x.date), payment: x.code, invoice: x.invoice.number, member: `${x.member.name} (${x.member.code})`, method: x.method, ref: x.txnRef, amount: x.amount }));
      return {
        columns: [{ key: "date", label: "Date" }, { key: "payment", label: "Payment" }, { key: "invoice", label: "Invoice" }, { key: "member", label: "Member" }, { key: "method", label: "Method" }, { key: "ref", label: "Reference" }, { key: "amount", label: "Amount", money: true }],
        rows,
        totals: { amount: sumCol(rows, "amount") },
      };
    },
  },
  "revenue-category": {
    title: "Revenue by category",
    group: "Billing",
    perm: "accounting.view",
    usesPeriod: true,
    async run(u, p) {
      const items = await db.invoiceItem.findMany({ where: { invoice: { ...branchScope(u), status: "ISSUED", date: inPeriod(p) } }, select: { category: true, amount: true, taxAmount: true } });
      const m = new Map<string, { n: number; net: number; tax: number }>();
      for (const i of items) {
        const r = m.get(i.category) ?? { n: 0, net: 0, tax: 0 };
        r.n++;
        r.net += i.amount;
        r.tax += i.taxAmount;
        m.set(i.category, r);
      }
      const rows = [...m.entries()].map(([category, r]) => ({ category, lines: r.n, net: r.net, gst: r.tax, gross: r.net + r.tax })).sort((a, b) => b.net - a.net);
      return {
        columns: [{ key: "category", label: "Category" }, { key: "lines", label: "Lines" }, { key: "net", label: "Net", money: true }, { key: "gst", label: "GST", money: true }, { key: "gross", label: "Gross", money: true }],
        rows,
        totals: { net: sumCol(rows, "net"), gst: sumCol(rows, "gst"), gross: sumCol(rows, "gross") },
      };
    },
  },
  "revenue-plan": {
    title: "Sales by plan",
    group: "Billing",
    perm: "accounting.view",
    usesPeriod: true,
    async run(u, p) {
      const ms = await db.membership.findMany({
        where: { branchId: { in: u.branchIds }, status: "VALID", invoice: { status: "ISSUED", date: inPeriod(p) } },
        include: { plan: { select: { name: true } } },
      });
      const m = new Map<string, { n: number; renewals: number; amount: number }>();
      for (const x of ms) {
        const r = m.get(x.plan.name) ?? { n: 0, renewals: 0, amount: 0 };
        r.n++;
        if (x.type === "RENEWAL") r.renewals++;
        r.amount += x.price - x.discount;
        m.set(x.plan.name, r);
      }
      const rows = [...m.entries()].map(([plan, r]) => ({ plan, sold: r.n, renewals: r.renewals, amount: r.amount })).sort((a, b) => b.amount - a.amount);
      return { columns: [{ key: "plan", label: "Plan" }, { key: "sold", label: "Sold" }, { key: "renewals", label: "Of which renewals" }, { key: "amount", label: "Net amount", money: true }], rows, totals: { sold: sumCol(rows, "sold"), amount: sumCol(rows, "amount") } };
    },
  },
  "gst-invoices": {
    title: "GST invoice register",
    group: "Accounts",
    perm: "accounting.view",
    usesPeriod: true,
    async run(u, p) {
      const invs = await db.invoice.findMany({ where: { ...branchScope(u), status: "ISSUED", date: inPeriod(p) }, orderBy: [{ date: "asc" }, { number: "asc" }], include: { member: { select: { name: true } } } });
      const rows = invs.map((i) => {
        const cgst = i.gstType === "CGST+SGST" ? Math.floor(i.tax / 2) : 0;
        return { date: toIso(i.date), invoice: i.number, member: i.member.name, taxable: i.subtotal - i.discount, cgst, sgst: i.gstType === "CGST+SGST" ? i.tax - cgst : 0, igst: i.gstType === "IGST" ? i.tax : 0, total: i.total };
      });
      return {
        columns: [{ key: "date", label: "Date" }, { key: "invoice", label: "Invoice" }, { key: "member", label: "Member" }, { key: "taxable", label: "Taxable value", money: true }, { key: "cgst", label: "CGST", money: true }, { key: "sgst", label: "SGST", money: true }, { key: "igst", label: "IGST", money: true }, { key: "total", label: "Invoice total", money: true }],
        rows,
        totals: Object.fromEntries(["taxable", "cgst", "sgst", "igst", "total"].map((k) => [k, sumCol(rows, k)])),
      };
    },
  },
  expenses: {
    title: "Expense list",
    group: "Accounts",
    perm: "accounting.view",
    usesPeriod: true,
    async run(u, p) {
      const ex = await db.expense.findMany({ where: { ...branchScope(u), status: "ACTIVE", capital: false, date: inPeriod(p) }, orderBy: [{ date: "asc" }], include: { category: true } });
      const rows = ex.map((e) => ({ date: toIso(e.date), code: e.code, category: e.category.name, group: e.category.group, description: e.description, vendor: e.vendor, method: e.method, bill: e.billNo, amount: e.amount }));
      return {
        columns: [{ key: "date", label: "Date" }, { key: "code", label: "No." }, { key: "category", label: "Category" }, { key: "group", label: "Group" }, { key: "description", label: "Description" }, { key: "vendor", label: "Vendor" }, { key: "method", label: "Paid by" }, { key: "bill", label: "Bill no." }, { key: "amount", label: "Amount", money: true }],
        rows,
        totals: { amount: sumCol(rows, "amount") },
      };
    },
  },
  dues: {
    title: "Outstanding dues",
    group: "Billing",
    perm: "invoices.view",
    usesPeriod: false,
    async run(u) {
      const { list } = await listReceivables(u);
      const rows = list.map((r) => ({ invoice: r.number, date: toIso(r.date), due: toIso(r.dueDate), member: r.member.name, phone: r.member.phone, total: r.total, paid: r.paid, balance: r.balance, overdue: r.overdueDays }));
      return {
        columns: [{ key: "invoice", label: "Invoice" }, { key: "date", label: "Date" }, { key: "due", label: "Due" }, { key: "member", label: "Member" }, { key: "phone", label: "Phone" }, { key: "total", label: "Total", money: true }, { key: "paid", label: "Paid", money: true }, { key: "balance", label: "Balance", money: true }, { key: "overdue", label: "Days overdue" }],
        rows,
        totals: { total: sumCol(rows, "total"), paid: sumCol(rows, "paid"), balance: sumCol(rows, "balance") },
      };
    },
  },
  expiring: {
    title: "Expiring in 15 days",
    group: "Members",
    perm: "members.view",
    usesPeriod: false,
    async run(u) {
      const today = todayIso();
      const { rows: ms } = await listMembers(u, { all: true });
      const rows = ms
        .filter((m) => m.latestEnd && daysBetween(m.latestEnd, today) >= 0 && daysBetween(m.latestEnd, today) <= 15)
        .sort((a, b) => a.latestEnd!.localeCompare(b.latestEnd!))
        .map((m) => ({ code: m.code, name: m.name, phone: m.phone, plan: m.planName, ends: m.latestEnd, days: daysBetween(m.latestEnd!, today), due: m.outstanding }));
      return { columns: [{ key: "code", label: "ID" }, { key: "name", label: "Name" }, { key: "phone", label: "Phone" }, { key: "plan", label: "Plan" }, { key: "ends", label: "Ends" }, { key: "days", label: "Days left" }, { key: "due", label: "Dues", money: true }], rows };
    },
  },
  members: {
    title: "Member list",
    group: "Members",
    perm: "members.view",
    usesPeriod: false,
    async run(u) {
      const { rows: ms } = await listMembers(u, { all: true });
      const rows = ms.map((m) => ({ code: m.code, name: m.name, phone: m.phone, gender: m.gender, area: m.area, plan: m.planName, ends: m.latestEnd, status: m.status.replace("_", " ").toLowerCase(), due: m.outstanding }));
      return { columns: [{ key: "code", label: "ID" }, { key: "name", label: "Name" }, { key: "phone", label: "Phone" }, { key: "gender", label: "Gender" }, { key: "area", label: "Area" }, { key: "plan", label: "Plan" }, { key: "ends", label: "Ends" }, { key: "status", label: "Status" }, { key: "due", label: "Dues", money: true }], rows, totals: { due: sumCol(rows, "due") } };
    },
  },
  joins: {
    title: "New members by source",
    group: "Members",
    perm: "members.view",
    usesPeriod: true,
    async run(u, p) {
      const g = await db.member.groupBy({ by: ["source"], where: { ...branchScope(u), deletedAt: null, walkIn: false, createdAt: { gte: fromIso(p.from), lt: new Date(fromIso(p.to).getTime() + 86_400_000) } }, _count: { _all: true } });
      const rows = g.map((x) => ({ source: x.source, members: x._count._all })).sort((a, b) => b.members - a.members);
      return { columns: [{ key: "source", label: "Source" }, { key: "members", label: "New members" }], rows, totals: { members: sumCol(rows, "members") } };
    },
  },
  leads: {
    title: "All leads",
    group: "Members",
    perm: "leads.manage",
    usesPeriod: false,
    async run(u) {
      const leads = await db.lead.findMany({ where: branchScope(u), orderBy: { createdAt: "desc" } });
      const d = (x: Date | null) => (x ? toIso(x) : null);
      const rows = leads.map((l) => ({ name: l.name, phone: l.phone, source: l.source, interest: l.interest, stage: l.stage, followUp: d(l.followUpOn), trial: d(l.trialOn), lost: l.lostReason, notes: l.notes, added: todayIso(l.createdAt) }));
      return {
        columns: [
          { key: "name", label: "Name" }, { key: "phone", label: "Phone" }, { key: "source", label: "Source" }, { key: "interest", label: "Interested in" },
          { key: "stage", label: "Stage" }, { key: "followUp", label: "Follow up" }, { key: "trial", label: "Trial" }, { key: "lost", label: "Lost reason" },
          { key: "notes", label: "Notes" }, { key: "added", label: "Added" },
        ],
        rows,
      };
    },
  },
  assets: {
    title: "Fixed asset register",
    group: "Fixed assets",
    perm: "assets.manage",
    usesPeriod: false,
    async run(u) {
      const now = ymOf(todayIso());
      const list = (await assetsFor(u.orgId, u.branchIds)).sort((a, b) => a.purchaseDate.getTime() - b.purchaseDate.getTime());
      const rows = list.map((a) => {
        const i = assetInfo(toLike(a), now);
        return { code: a.code, name: a.name + (a.qty > 1 ? ` ×${a.qty}` : ""), category: a.category, purchased: toIso(a.purchaseDate), cost: a.cost, method: a.method === "SLM" ? `SLM ${a.life} yrs` : `WDV ${Number(a.rate)}%`, acc: i.acc, nbv: a.status === "IN_USE" ? i.nbv : 0, status: { IN_USE: "In use", SOLD: "Sold", SCRAPPED: "Scrapped" }[a.status] ?? a.status };
      });
      return {
        columns: [{ key: "code", label: "ID" }, { key: "name", label: "Asset" }, { key: "category", label: "Category" }, { key: "purchased", label: "Purchased" }, { key: "cost", label: "Cost", money: true }, { key: "method", label: "Method" }, { key: "acc", label: "Accumulated dep.", money: true }, { key: "nbv", label: "Book value", money: true }, { key: "status", label: "Status" }],
        rows,
        totals: { cost: sumCol(rows, "cost"), acc: sumCol(rows, "acc"), nbv: sumCol(rows, "nbv") },
      };
    },
  },
  "dep-fy": {
    title: "Depreciation this FY",
    group: "Fixed assets",
    perm: "assets.manage",
    usesPeriod: false,
    async run(u) {
      const now = ymOf(todayIso());
      const fy = fyOf(now);
      const list = await assetsFor(u.orgId, u.branchIds);
      const rows = list
        .filter((a) => a.status === "IN_USE" || (a.disposedOn && fyOf(ymOf(toIso(a.disposedOn))) === fy))
        .map((a) => {
          const r = scheduleByFy(toLike(a), now).find((x) => x.fy === fy);
          const added = fyOf(ymOf(toIso(a.purchaseDate))) === fy;
          return { name: a.name, category: a.category, opening: added ? 0 : (r?.opening ?? 0), additions: added ? a.cost : 0, dep: r?.dep ?? 0, closing: a.status === "IN_USE" ? (r?.closing ?? 0) : 0 };
        });
      return {
        columns: [{ key: "name", label: fyLabel(fy) }, { key: "category", label: "Category" }, { key: "opening", label: "Opening WDV", money: true }, { key: "additions", label: "Additions", money: true }, { key: "dep", label: "Depreciation", money: true }, { key: "closing", label: "Closing WDV", money: true }],
        rows,
        totals: { opening: sumCol(rows, "opening"), additions: sumCol(rows, "additions"), dep: sumCol(rows, "dep"), closing: sumCol(rows, "closing") },
      };
    },
  },
  "dep-month": {
    title: "Monthly depreciation · 12 months",
    group: "Fixed assets",
    perm: "assets.manage",
    usesPeriod: false,
    async run(u) {
      const like = (await assetsFor(u.orgId, u.branchIds)).map(toLike);
      const now = ymOf(todayIso());
      const rows = [];
      for (let i = 11; i >= 0; i--) {
        const ym = addMonths(`${now}-01`, -i).slice(0, 7);
        rows.push({ month: ym, dep: depreciationIn(like, ym, ym), assets: like.filter((a) => ymOf(a.purchaseDate) <= ym && (!a.disposedOn || ymOf(a.disposedOn) >= ym)).length });
      }
      return { columns: [{ key: "month", label: "Month" }, { key: "dep", label: "Depreciation", money: true }, { key: "assets", label: "Assets in use" }], rows, totals: { dep: sumCol(rows, "dep") } };
    },
  },
  disposals: {
    title: "Asset disposals",
    group: "Fixed assets",
    perm: "assets.manage",
    usesPeriod: true,
    async run(u, p) {
      const list = await db.asset.findMany({ where: { ...branchScope(u), deletedAt: null, disposedOn: inPeriod(p) }, orderBy: { disposedOn: "asc" } });
      const rows = list.map((a) => {
        const i = assetInfo(toLike(a), ymOf(toIso(a.disposedOn!)));
        return { date: toIso(a.disposedOn!), code: a.code, name: a.name, how: a.status === "SOLD" ? "Sold" : "Scrapped", cost: a.cost, nbv: i.nbv, received: a.disposedFor ?? 0, gain: i.gain };
      });
      return {
        columns: [{ key: "date", label: "Date" }, { key: "code", label: "ID" }, { key: "name", label: "Asset" }, { key: "how", label: "How" }, { key: "cost", label: "Cost", money: true }, { key: "nbv", label: "Book value", money: true }, { key: "received", label: "Received", money: true }, { key: "gain", label: "Gain / (loss)", money: true }],
        rows,
        totals: { received: sumCol(rows, "received"), gain: sumCol(rows, "gain") },
      };
    },
  },
  "pur-month": {
    title: "Purchases by month",
    group: "Purchases",
    perm: "purchases.manage",
    usesPeriod: true,
    async run(u, p) {
      const lines = await db.purchaseLine.findMany({ where: { purchase: { ...branchScope(u), status: "ACTIVE", date: inPeriod(p) } }, select: { type: true, amount: true, purchase: { select: { date: true } } } });
      const m = new Map<string, { stock: number; asset: number; expense: number }>();
      for (const l of lines) {
        const k = ymOf(toIso(l.purchase.date));
        const r = m.get(k) ?? { stock: 0, asset: 0, expense: 0 };
        r[l.type === "STOCK" ? "stock" : l.type === "ASSET" ? "asset" : "expense"] += l.amount;
        m.set(k, r);
      }
      const rows = [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, r]) => ({ month, ...r, total: r.stock + r.asset + r.expense }));
      return {
        columns: [{ key: "month", label: "Month" }, { key: "stock", label: "Stock", money: true }, { key: "asset", label: "Equipment", money: true }, { key: "expense", label: "Expenses", money: true }, { key: "total", label: "Total", money: true }],
        rows,
        totals: { stock: sumCol(rows, "stock"), asset: sumCol(rows, "asset"), expense: sumCol(rows, "expense"), total: sumCol(rows, "total") },
      };
    },
  },
  "pur-vendor": {
    title: "Purchases by vendor",
    group: "Purchases",
    perm: "purchases.manage",
    usesPeriod: true,
    async run(u, p) {
      const list = await db.purchase.findMany({ where: { ...branchScope(u), status: "ACTIVE", date: inPeriod(p) }, include: { payments: { select: { amount: true } } } });
      const m = new Map<string, { bills: number; total: number; paid: number }>();
      for (const x of list) {
        const r = m.get(x.vendor) ?? { bills: 0, total: 0, paid: 0 };
        r.bills++;
        r.total += x.total;
        r.paid += x.payments.reduce((s, y) => s + y.amount, 0);
        m.set(x.vendor, r);
      }
      const rows = [...m.entries()].map(([vendor, r]) => ({ vendor, ...r, balance: r.total - r.paid })).sort((a, b) => b.total - a.total);
      return {
        columns: [{ key: "vendor", label: "Supplier" }, { key: "bills", label: "Bills" }, { key: "total", label: "Total", money: true }, { key: "paid", label: "Paid", money: true }, { key: "balance", label: "Balance", money: true }],
        rows,
        totals: { bills: sumCol(rows, "bills"), total: sumCol(rows, "total"), paid: sumCol(rows, "paid"), balance: sumCol(rows, "balance") },
      };
    },
  },
  payables: {
    title: "Vendor payables",
    group: "Purchases",
    perm: "purchases.manage",
    usesPeriod: false,
    async run(u) {
      const list = await db.purchase.findMany({ where: { ...branchScope(u), status: "ACTIVE" }, orderBy: { date: "asc" }, include: { payments: { select: { amount: true } } } });
      const today = todayIso();
      const rows = list
        .map((x) => ({ date: toIso(x.date), code: x.code, vendor: x.vendor, bill: x.billNo, total: x.total, paid: x.payments.reduce((s, y) => s + y.amount, 0), days: daysBetween(today, toIso(x.date)) }))
        .map((r) => ({ ...r, balance: r.total - r.paid }))
        .filter((r) => r.balance > 0);
      return {
        columns: [{ key: "date", label: "Bill date" }, { key: "code", label: "No." }, { key: "vendor", label: "Supplier" }, { key: "bill", label: "Bill no." }, { key: "total", label: "Total", money: true }, { key: "paid", label: "Paid", money: true }, { key: "balance", label: "Balance", money: true }, { key: "days", label: "Days" }],
        rows,
        totals: { total: sumCol(rows, "total"), paid: sumCol(rows, "paid"), balance: sumCol(rows, "balance") },
      };
    },
  },
};

export const REPORTS: Record<string, Def> = { ...BASE, ...MORE };
for (const g of CENTER) for (const k of g.items) if (REPORTS[k]) REPORTS[k] = { ...REPORTS[k]!, group: g.group };
// Which plan opens each report (src/lib/domain/features.ts). Starter keeps the basics: collections, revenue by
// plan, GST, expenses, dues, expiring and the membership lists.
const REPORT_FEATURE: Record<string, Feature> = {
  pl: "accounting", "rev-month": "accounting", "rev-daily": "accounting", "rev-method": "accounting", "rev-staff": "accounting", "rev-type": "accounting", recv: "accounting", cashflow: "accounting",
  "exp-cat": "accounting", "exp-month": "accounting", "exp-vendor": "accounting",
  "pur-month": "accounting", "pur-vendor": "accounting", payables: "accounting",
  assets: "accounting", "dep-fy": "accounting", "dep-month": "accounting", disposals: "accounting",
  attendance: "attendance", classes: "classes", pt: "staff", pos: "pos", "lead-conv": "leads", leads: "leads", risk: "ai",
};
for (const [k, feature] of Object.entries(REPORT_FEATURE)) if (REPORTS[k]) REPORTS[k] = { ...REPORTS[k]!, feature };

/** Where each person's favourite reports are kept (a per-user setting). */
export const favKey = (userId: string) => `favReports:${userId}`;

/** The report centre's groups with the reports this user may open. */
export const reportGroups = (u: CurrentUser) =>
  CENTER.map((g) => ({ group: g.group, items: g.items.filter((k) => REPORTS[k] && u.can(REPORTS[k]!.perm) && (!REPORTS[k]!.feature || u.has(REPORTS[k]!.feature!))).map((k) => ({ key: k, title: REPORTS[k]!.title })) })).filter((g) => g.items.length);

export function toCsv(r: Report): string {
  const esc = (v: Cell) => {
    const s = v == null ? "" : String(v);
    // Neutralise spreadsheet formulas (CSV injection).
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const cell = (c: Column, v: Cell) => (c.money && typeof v === "number" ? (v / 100).toFixed(2) : v);
  const lines = [r.columns.map((c) => esc(c.label)).join(",")];
  for (const row of r.rows) lines.push(r.columns.map((c) => esc(cell(c, row[c.key] ?? null))).join(","));
  if (r.totals) lines.push(r.columns.map((c, i) => esc(i === 0 ? "Total" : cell(c, r.totals![c.key] ?? null))).join(","));
  return lines.join("\n") + "\n";
}

/** The "Excel" download: a real .xlsx workbook (see src/lib/xlsx.ts): amounts in rupees as numbers, dates as dates, a bold frozen header and a totals row. */
export function toXlsx(title: string, r: Report): Uint8Array {
  const kind = (c: Column): XKind | undefined => (c.money ? "money" : c.kind === "pct" ? "pct" : c.kind === "num" ? "int" : undefined);
  return buildXlsx(
    {
      name: title,
      columns: r.columns.map((c) => ({ label: c.label, kind: kind(c) })),
      rows: r.rows.map((row) => r.columns.map((c) => row[c.key] ?? null)),
      totals: r.totals ? r.columns.map((c, i) => (i === 0 ? "Total" : (r.totals![c.key] ?? null))) : undefined,
    },
    { title },
  );
}
