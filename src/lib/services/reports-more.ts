import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { balanceDue } from "@/lib/domain/billing";
import { addDays, ageOn, daysBetween } from "@/lib/domain/dates";
import { monthLabel, monthsBack } from "@/lib/domain/periods";
import { summarize } from "./members";
import { profitAndLoss, monthPeriod } from "./accounting";
import { fromIso, toIso, todayIso } from "./time";
import type { Cell, Column, Def, Report } from "./reports";

/**
 * The prototype's report centre (fitron-core.js `report`), computed from the database.
 * Most run over fixed windows like the prototype: the last 12 months or this financial year.
 */

const scope = (u: CurrentUser) => ({ orgId: u.orgId, branchId: { in: u.branchIds } });
const sum = (rows: Record<string, Cell>[], k: string) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
const col = (key: string, label: string, kind?: "money" | "num" | "pct"): Column => ({ key, label, ...(kind === "money" ? { money: true } : kind ? { kind } : {}) });
const share = (v: number, total: number) => (total ? Math.round((v / total) * 1000) / 10 : 0);
const months12 = () => monthsBack(todayIso(), 12);
/** First day of the Indian financial year (1 April) containing today. */
const fyStart = () => {
  const t = todayIso();
  const y = Number(t.slice(0, 4));
  return `${Number(t.slice(5, 7)) >= 4 ? y : y - 1}-04-01`;
};
const sinceFy = () => ({ gte: fromIso(fyStart()) });
const FY_NOTE = "This financial year";
function group<T>(xs: T[], key: (x: T) => string | null | undefined, val: (x: T) => number = () => 0) {
  const m = new Map<string, { n: number; v: number }>();
  for (const x of xs) {
    const k = key(x);
    if (k == null) continue;
    const r = m.get(k) ?? { n: 0, v: 0 };
    r.n++;
    r.v += val(x);
    m.set(k, r);
  }
  return [...m.entries()].sort((a, b) => b[1].v - a[1].v || b[1].n - a[1].n);
}

/** Invoice lines on issued invoices with the invoice date (net of discount, before GST). */
const lines = (u: CurrentUser, date: { gte?: Date; lte?: Date }) =>
  db.invoiceItem.findMany({ where: { invoice: { ...scope(u), status: "ISSUED", date } }, select: { category: true, amount: true, qty: true, planId: true, productId: true, trainerId: true, invoice: { select: { date: true } } } });

/** Members with what the membership reports need: plan, expiry, dues, join date, source, gender and age. */
async function members(u: CurrentUser) {
  const ms = await db.member.findMany({
    where: { ...scope(u), deletedAt: null, walkIn: false },
    select: { id: true, code: true, name: true, phone: true, gender: true, source: true, dob: true, createdAt: true, suspended: true, riskScore: true, riskReasons: true },
    orderBy: { name: "asc" },
  });
  const today = todayIso();
  const sums = await summarize(ms.map((m) => m.id), today);
  return ms.map((m) => {
    const s = sums.get(m.id)!;
    return { ...m, ...s, daysLeft: s.latestEnd ? daysBetween(s.latestEnd, today) : null };
  });
}

const monthly = (title: string, perm: Def["perm"], run: (u: CurrentUser) => Promise<Report>, note?: string): Def => ({ title, group: "", perm, usesPeriod: false, note, run });

export const MORE: Record<string, Def> = {
  pl: monthly(
    "Profit & loss by month",
    "accounting.view",
    async (u) => {
      const rows = [];
      for (const m of months12()) {
        const pl = await profitAndLoss(u, monthPeriod(m));
        rows.push({ month: monthLabel(m), revenue: pl.totalRevenue, expenses: pl.totalExpenses, dep: pl.depreciation, net: pl.net, margin: pl.totalRevenue ? share(pl.net, pl.totalRevenue) : 0 });
      }
      return { columns: [col("month", "Month"), col("revenue", "Revenue", "money"), col("expenses", "Operating expenses", "money"), col("dep", "Depreciation", "money"), col("net", "Net profit (invoiced)", "money"), col("margin", "Margin", "pct")], rows, totals: { revenue: sum(rows, "revenue"), expenses: sum(rows, "expenses"), dep: sum(rows, "dep"), net: sum(rows, "net") } };
    },
    "Based on invoices: revenue is counted on the invoice date, not when paid, so an annual plan counts in full in the month sold · minus operating expenses and depreciation; asset purchases are capitalised",
  ),
  "rev-month": monthly("Revenue by month", "accounting.view", async (u) => {
    const ms = months12();
    const ls = await lines(u, { gte: fromIso(`${ms[0]}-01`) });
    const rows = ms.map((m) => {
      const f = (cats: string[]) => ls.filter((l) => toIso(l.invoice.date).startsWith(m) && cats.includes(l.category)).reduce((s, l) => s + l.amount, 0);
      const r = { month: monthLabel(m), nw: f(["New Membership"]), ren: f(["Renewal"]), pt: f(["Personal Training"]), reg: f(["Registration"]), prod: ls.filter((l) => toIso(l.invoice.date).startsWith(m) && !["New Membership", "Renewal", "Personal Training", "Registration"].includes(l.category)).reduce((s, l) => s + l.amount, 0) };
      return { ...r, total: r.nw + r.ren + r.pt + r.reg + r.prod };
    });
    return { columns: [col("month", "Month"), col("nw", "New", "money"), col("ren", "Renewal", "money"), col("pt", "PT", "money"), col("reg", "Registration", "money"), col("prod", "Products", "money"), col("total", "Total", "money")], rows, totals: Object.fromEntries(["nw", "ren", "pt", "reg", "prod", "total"].map((k) => [k, sum(rows, k)])) };
  }),
  "rev-daily": monthly("Daily revenue · 30 days", "accounting.view", async (u) => {
    const today = todayIso();
    const from = addDays(today, -29);
    const [ls, pays] = await Promise.all([lines(u, { gte: fromIso(from) }), db.payment.findMany({ where: { ...scope(u), status: "SUCCESS", date: { gte: fromIso(from) } }, select: { date: true, amount: true } })]);
    const rows = Array.from({ length: 30 }, (_, i) => {
      const d = addDays(from, i);
      const p = pays.filter((x) => toIso(x.date) === d);
      return { date: d, invoiced: ls.filter((l) => toIso(l.invoice.date) === d).reduce((s, l) => s + l.amount, 0), collected: p.reduce((s, x) => s + x.amount, 0), payments: p.length };
    }).reverse();
    return { columns: [col("date", "Date"), col("invoiced", "Invoiced", "money"), col("collected", "Collected", "money"), col("payments", "Payments", "num")], rows, totals: { invoiced: sum(rows, "invoiced"), collected: sum(rows, "collected"), payments: sum(rows, "payments") } };
  }),
  "rev-plan": monthly(
    "Revenue by plan",
    "accounting.view",
    async (u) => {
      const [ls, plans] = await Promise.all([lines(u, sinceFy()), db.membershipPlan.findMany({ where: { orgId: u.orgId }, select: { id: true, name: true } })]);
      const names = new Map(plans.map((p) => [p.id, p.name]));
      const g = group(ls.filter((l) => l.planId), (l) => names.get(l.planId!) ?? "—", (l) => l.amount);
      const total = g.reduce((s, [, v]) => s + v.v, 0);
      const rows = g.map(([plan, v]) => ({ plan, sold: v.n, revenue: v.v, share: share(v.v, total) }));
      return { columns: [col("plan", "Plan"), col("sold", "Memberships sold", "num"), col("revenue", "Revenue", "money"), col("share", "Share", "pct")], rows, totals: { sold: sum(rows, "sold"), revenue: total } };
    },
    FY_NOTE,
  ),
  "rev-method": monthly(
    "Revenue by payment method",
    "invoices.view",
    async (u) => {
      const pays = await db.payment.findMany({ where: { ...scope(u), status: "SUCCESS", date: sinceFy() }, select: { method: true, amount: true } });
      const g = group(pays, (p) => p.method, (p) => p.amount);
      const total = g.reduce((s, [, v]) => s + v.v, 0);
      const rows = g.map(([method, v]) => ({ method, payments: v.n, amount: v.v, share: share(v.v, total) }));
      return { columns: [col("method", "Method"), col("payments", "Payments", "num"), col("amount", "Amount", "money"), col("share", "Share", "pct")], rows, totals: { payments: sum(rows, "payments"), amount: total } };
    },
    FY_NOTE,
  ),
  "rev-staff": monthly(
    "Collections by staff",
    "accounting.view",
    async (u) => {
      const [pays, users] = await Promise.all([db.payment.findMany({ where: { ...scope(u), status: "SUCCESS", date: sinceFy() }, select: { receivedById: true, amount: true } }), db.user.findMany({ where: { orgId: u.orgId }, select: { id: true, name: true } })]);
      const names = new Map(users.map((x) => [x.id, x.name]));
      const rows = group(pays, (p) => names.get(p.receivedById) ?? "Automatic", (p) => p.amount).map(([staff, v]) => ({ staff, payments: v.n, collected: v.v }));
      return { columns: [col("staff", "Staff"), col("payments", "Payments", "num"), col("collected", "Collected", "money")], rows, totals: { payments: sum(rows, "payments"), collected: sum(rows, "collected") } };
    },
    FY_NOTE,
  ),
  "rev-type": monthly(
    "Revenue by membership type",
    "accounting.view",
    async (u) => {
      const rows = group(await lines(u, sinceFy()), (l) => l.category, (l) => l.amount).map(([type, v]) => ({ type, items: v.n, revenue: v.v }));
      return { columns: [col("type", "Type"), col("items", "Line items", "num"), col("revenue", "Revenue", "money")], rows, totals: { items: sum(rows, "items"), revenue: sum(rows, "revenue") } };
    },
    FY_NOTE,
  ),
  recv: monthly("Receivables", "invoices.view", async (u) => {
    const today = todayIso();
    const invs = await db.invoice.findMany({ where: { ...scope(u), status: "ISSUED" }, orderBy: { dueDate: "asc" }, include: { member: { select: { name: true } }, payments: { where: { status: "SUCCESS" }, select: { amount: true } } } });
    const rows = invs
      .map((i) => ({ i, paid: i.payments.reduce((s, p) => s + p.amount, 0) }))
      .filter((x) => balanceDue(x.i.total, x.paid) > 0)
      .map(({ i, paid }) => ({ member: i.member.name, invoice: i.number, total: i.total, paid, pending: balanceDue(i.total, paid), due: toIso(i.dueDate), overdue: Math.max(0, daysBetween(today, toIso(i.dueDate))) }));
    return { columns: [col("member", "Member"), col("invoice", "Invoice"), col("total", "Total", "money"), col("paid", "Paid", "money"), col("pending", "Pending", "money"), col("due", "Due"), col("overdue", "Days overdue", "num")], rows, totals: { total: sum(rows, "total"), paid: sum(rows, "paid"), pending: sum(rows, "pending") } };
  }),
  cashflow: monthly("Cash flow", "accounting.view", async (u) => {
    const ms = months12();
    const since = fromIso(`${ms[0]}-01`);
    const [pays, ex] = await Promise.all([db.payment.findMany({ where: { ...scope(u), status: "SUCCESS", date: { gte: since } }, select: { date: true, amount: true } }), db.expense.findMany({ where: { ...scope(u), status: "ACTIVE", date: { gte: since } }, select: { date: true, amount: true } })]);
    const rows = ms.map((m) => {
      const c = pays.filter((p) => toIso(p.date).startsWith(m)).reduce((s, p) => s + p.amount, 0);
      const e = ex.filter((p) => toIso(p.date).startsWith(m)).reduce((s, p) => s + p.amount, 0);
      return { month: monthLabel(m), collections: c, expenses: e, net: c - e };
    });
    return { columns: [col("month", "Month"), col("collections", "Collections", "money"), col("expenses", "Expenses", "money"), col("net", "Net cash", "money")], rows, totals: { collections: sum(rows, "collections"), expenses: sum(rows, "expenses"), net: sum(rows, "net") } };
  }),
  gst: monthly("GST summary", "accounting.view", async (u) => {
    const ms = months12();
    const invs = await db.invoice.findMany({ where: { ...scope(u), status: "ISSUED", date: { gte: fromIso(`${ms[0]}-01`) } }, select: { date: true, subtotal: true, discount: true, tax: true, gstType: true } });
    const rows = ms.map((m) => {
      const inv = invs.filter((i) => toIso(i.date).startsWith(m));
      const igst = inv.filter((i) => i.gstType === "IGST").reduce((s, i) => s + i.tax, 0);
      const split = inv.filter((i) => i.gstType !== "IGST").reduce((s, i) => s + i.tax, 0);
      return { month: monthLabel(m), taxable: inv.reduce((s, i) => s + i.subtotal - i.discount, 0), cgst: Math.floor(split / 2), sgst: split - Math.floor(split / 2), igst, tax: split + igst };
    });
    return { columns: [col("month", "Month"), col("taxable", "Taxable value", "money"), col("cgst", "CGST", "money"), col("sgst", "SGST", "money"), col("igst", "IGST", "money"), col("tax", "Total tax", "money")], rows, totals: Object.fromEntries(["taxable", "cgst", "sgst", "igst", "tax"].map((k) => [k, sum(rows, k)])) };
  }),
  "exp-cat": monthly(
    "Expense by category",
    "accounting.view",
    async (u) => {
      const ex = await db.expense.findMany({ where: { ...scope(u), status: "ACTIVE", date: sinceFy() }, select: { amount: true, category: { select: { name: true } } } });
      const g = group(ex, (e) => e.category.name, (e) => e.amount);
      const total = g.reduce((s, [, v]) => s + v.v, 0);
      const rows = g.map(([category, v]) => ({ category, entries: v.n, amount: v.v, share: share(v.v, total) }));
      return { columns: [col("category", "Category"), col("entries", "Entries", "num"), col("amount", "Amount", "money"), col("share", "Share", "pct")], rows, totals: { entries: sum(rows, "entries"), amount: total } };
    },
    FY_NOTE,
  ),
  "exp-month": monthly("Monthly expenses", "accounting.view", async (u) => {
    const G = ["Salaries", "Rent", "Utilities", "Marketing", "Maintenance", "Equipment", "Inventory", "Operating", "Other"];
    const ms = months12();
    const ex = await db.expense.findMany({ where: { ...scope(u), status: "ACTIVE", date: { gte: fromIso(`${ms[0]}-01`) } }, select: { date: true, amount: true, category: { select: { group: true } } } });
    const rows = ms.map((m) => {
      const r: Record<string, Cell> = { month: monthLabel(m) };
      let t = 0;
      for (const g of G) {
        const v = ex.filter((e) => toIso(e.date).startsWith(m) && (G.includes(e.category.group) ? e.category.group : "Other") === g).reduce((s, e) => s + e.amount, 0);
        r[g] = v;
        t += v;
      }
      r.total = t;
      return r;
    });
    return { columns: [col("month", "Month"), ...G.map((g) => col(g, g, "money")), col("total", "Total", "money")], rows, totals: Object.fromEntries([...G, "total"].map((k) => [k, sum(rows, k)])) };
  }),
  "exp-vendor": monthly(
    "Vendor expenses",
    "accounting.view",
    async (u) => {
      const ex = await db.expense.findMany({ where: { ...scope(u), status: "ACTIVE", date: sinceFy() }, select: { vendor: true, amount: true } });
      const rows = group(ex, (e) => e.vendor || "—", (e) => e.amount).map(([vendor, v]) => ({ vendor, bills: v.n, amount: v.v }));
      return { columns: [col("vendor", "Vendor"), col("bills", "Bills", "num"), col("amount", "Amount", "money")], rows, totals: { bills: sum(rows, "bills"), amount: sum(rows, "amount") } };
    },
    FY_NOTE,
  ),
  "m-active": monthly("Active members", "members.view", async (u) => {
    const rows = (await members(u)).filter((m) => m.daysLeft != null && m.daysLeft >= 0 && !m.suspended).map((m) => ({ code: m.code, name: m.name, phone: m.phone, plan: m.planName, expiry: m.latestEnd, outstanding: m.outstanding }));
    return { columns: [col("code", "ID"), col("name", "Name"), col("phone", "Phone"), col("plan", "Plan"), col("expiry", "Expiry"), col("outstanding", "Outstanding", "money")], rows, totals: { outstanding: sum(rows, "outstanding") } };
  }),
  "m-expired": monthly("Expired members", "members.view", async (u) => {
    const rows = (await members(u)).filter((m) => m.daysLeft != null && m.daysLeft < 0).sort((a, b) => b.daysLeft! - a.daysLeft!).map((m) => ({ code: m.code, name: m.name, phone: m.phone, plan: m.planName, ended: m.latestEnd, since: -m.daysLeft! }));
    return { columns: [col("code", "ID"), col("name", "Name"), col("phone", "Phone"), col("plan", "Last plan"), col("ended", "Expired on"), col("since", "Days since", "num")], rows };
  }),
  "m-new": monthly(
    "New members",
    "members.view",
    async (u) => {
      const from = fyStart();
      const rows = (await members(u)).filter((m) => todayIso(m.createdAt) >= from).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((m) => ({ code: m.code, name: m.name, joined: todayIso(m.createdAt), plan: m.planName, source: m.source }));
      return { columns: [col("code", "ID"), col("name", "Name"), col("joined", "Joined"), col("plan", "Plan"), col("source", "Source")], rows };
    },
    FY_NOTE,
  ),
  "m-renew": monthly(
    "Renewals",
    "members.view",
    async (u) => {
      const ms = await db.membership.findMany({ where: { branchId: { in: u.branchIds }, status: "VALID", type: { in: ["RENEWAL", "AUTOPAY"] }, startDate: sinceFy() }, orderBy: { startDate: "desc" }, include: { member: { select: { name: true } }, plan: { select: { name: true } } } });
      const rows = ms.map((x) => ({ code: x.code, member: x.member.name, plan: x.plan.name, start: toIso(x.startDate), end: toIso(x.endDate), amount: x.price - x.discount }));
      return { columns: [col("code", "Membership"), col("member", "Member"), col("plan", "Plan"), col("start", "Start"), col("end", "End"), col("amount", "Amount", "money")], rows, totals: { amount: sum(rows, "amount") } };
    },
    FY_NOTE,
  ),
  "m-plan": monthly("Plan-wise members", "members.view", async (u) => {
    const act = (await members(u)).filter((m) => m.current);
    const rows = group(act, (m) => m.planName ?? "—", () => 1).map(([plan, v]) => ({ plan, members: v.n, share: share(v.n, act.length) }));
    return { columns: [col("plan", "Plan"), col("members", "Active members", "num"), col("share", "Share", "pct")], rows, totals: { members: act.length } };
  }),
  "m-gender": monthly("Gender-wise", "members.view", async (u) => {
    const ms = await members(u);
    const rows = group(ms, (m) => m.gender, () => 1).map(([gender, v]) => ({ gender, members: v.n, active: ms.filter((m) => m.gender === gender && m.current).length }));
    return { columns: [col("gender", "Gender"), col("members", "Members", "num"), col("active", "Active", "num")], rows, totals: { members: sum(rows, "members"), active: sum(rows, "active") } };
  }),
  "m-age": monthly(
    "Age groups",
    "members.view",
    async (u) => {
      const today = todayIso();
      const ms = (await members(u)).filter((m) => m.dob);
      const B = ["Under 18", "18–24", "25–34", "35–44", "45+"];
      const band = (dob: Date) => {
        const a = ageOn(toIso(dob), today);
        return a < 18 ? B[0] : a < 25 ? B[1] : a < 35 ? B[2] : a < 45 ? B[3] : B[4];
      };
      const g = new Map(group(ms, (m) => band(m.dob!), () => 1));
      const rows = B.filter((b) => g.get(b)).map((b) => ({ band: b, members: g.get(b)!.n, share: share(g.get(b)!.n, ms.length) }));
      return { columns: [col("band", "Age group"), col("members", "Members", "num"), col("share", "Share", "pct")], rows, totals: { members: ms.length } };
    },
    "Members with a date of birth on file",
  ),
  "m-source": monthly("Lead source", "members.view", async (u) => {
    const ms = await members(u);
    const rows = group(ms, (m) => m.source, () => 1).map(([source, v]) => ({ source, members: v.n, share: share(v.n, ms.length) }));
    return { columns: [col("source", "Lead source"), col("members", "Members", "num"), col("share", "Share", "pct")], rows, totals: { members: ms.length } };
  }),
  "m-retention": monthly(
    "Member retention",
    "members.view",
    async (u) => {
      const ms = months12().slice(0, -1);
      const all = await db.membership.findMany({ where: { branchId: { in: u.branchIds }, status: "VALID" }, select: { memberId: true, startDate: true, endDate: true } });
      const rows = ms.map((m) => {
        const ending = all.filter((x) => toIso(x.endDate).startsWith(m));
        const renewed = ending.filter((x) => all.some((y) => y.memberId === x.memberId && y.startDate > x.endDate && daysBetween(toIso(y.startDate), toIso(x.endDate)) <= 20));
        return { month: monthLabel(m), ending: ending.length, renewed: renewed.length, retention: share(renewed.length, ending.length) };
      });
      return { columns: [col("month", "Month"), col("ending", "Memberships ending", "num"), col("renewed", "Renewed", "num"), col("retention", "Retention", "pct")], rows };
    },
    "Renewed within 20 days of expiry",
  ),
  attendance: monthly("Daily attendance", "attendance.manage", async (u) => {
    const today = todayIso();
    const from = addDays(today, -13);
    const visits = await db.attendance.findMany({ where: { branchId: { in: u.branchIds }, date: { gte: fromIso(from) } }, select: { date: true, memberId: true } });
    const rows = Array.from({ length: 14 }, (_, i) => {
      const d = addDays(from, i);
      const a = visits.filter((v) => toIso(v.date) === d);
      return { date: d, checkins: a.length, unique: new Set(a.filter((v) => v.memberId).map((v) => v.memberId)).size, guests: a.filter((v) => !v.memberId).length };
    }).reverse();
    return { columns: [col("date", "Date"), col("checkins", "Check-ins", "num"), col("unique", "Unique members", "num"), col("guests", "Trials & guests", "num")], rows, totals: { checkins: sum(rows, "checkins"), guests: sum(rows, "guests") } };
  }),
  classes: monthly(
    "Class utilisation",
    "classes.manage",
    async (u) => {
      const today = todayIso();
      const monday = addDays(today, -((fromIso(today).getUTCDay() + 6) % 7));
      const from = addDays(monday, -7);
      const [slots, users] = await Promise.all([
        db.classSlot.findMany({ where: { ...scope(u), active: true }, orderBy: [{ weekday: "asc" }, { startTime: "asc" }], include: { bookings: { where: { date: { gte: fromIso(from), lte: fromIso(addDays(monday, 6)) }, status: { notIn: ["Waitlist", "Cancelled"] } }, select: { status: true } } } }),
        db.user.findMany({ where: { orgId: u.orgId }, select: { id: true, name: true } }),
      ]);
      const names = new Map(users.map((x) => [x.id, x.name]));
      const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const rows = slots.map((c) => ({ name: c.name, trainer: names.get(c.trainerId) ?? "—", slot: `${WD[c.weekday]} ${c.startTime}`, capacity: c.capacity * 2, booked: c.bookings.length, attended: c.bookings.filter((b) => b.status === "Attended").length, noshow: c.bookings.filter((b) => b.status === "No-show").length, fill: share(c.bookings.length, c.capacity * 2) }));
      return { columns: [col("name", "Class"), col("trainer", "Trainer"), col("slot", "Slot"), col("capacity", "Capacity", "num"), col("booked", "Booked", "num"), col("attended", "Attended", "num"), col("noshow", "No-shows", "num"), col("fill", "Fill rate", "pct")], rows, totals: { capacity: sum(rows, "capacity"), booked: sum(rows, "booked"), attended: sum(rows, "attended"), noshow: sum(rows, "noshow") } };
    },
    "Last week and this week",
  ),
  pt: monthly(
    "Trainer PT commission",
    "accounting.view",
    async (u) => {
      const month = todayIso().slice(0, 7);
      const [ls, trainers] = await Promise.all([
        lines(u, { gte: fromIso(`${month}-01`) }),
        db.user.findMany({ where: { orgId: u.orgId, deletedAt: null, role: { name: "Trainer" }, branches: { some: { branchId: { in: u.branchIds } } } }, select: { id: true, name: true, ptRate: true }, orderBy: { name: "asc" } }),
      ]);
      const rows = trainers.map((t) => {
        const l = ls.filter((x) => x.category === "Personal Training" && x.trainerId === t.id);
        const rev = l.reduce((s, x) => s + x.amount, 0);
        return { trainer: t.name, invoices: l.length, revenue: rev, rate: t.ptRate, commission: Math.round((rev * t.ptRate) / 100) };
      });
      return { columns: [col("trainer", "Trainer"), col("invoices", "PT invoices", "num"), col("revenue", "PT revenue", "money"), col("rate", "Commission rate", "pct"), col("commission", "Commission", "money")], rows, totals: { invoices: sum(rows, "invoices"), revenue: sum(rows, "revenue"), commission: sum(rows, "commission") } };
    },
    "This month · rate set per trainer in Staff",
  ),
  pos: monthly(
    "Product sales",
    "products.manage",
    async (u) => {
      const [ls, products] = await Promise.all([lines(u, sinceFy()), db.product.findMany({ where: scope(u), orderBy: { name: "asc" } })]);
      const rows = products.map((p) => {
        const l = ls.filter((x) => x.productId === p.id);
        const units = l.reduce((s, x) => s + x.qty, 0);
        const rev = l.reduce((s, x) => s + x.amount, 0);
        return { product: p.name, units, revenue: rev, margin: rev - units * p.cost, stock: p.stock ?? "—" };
      });
      return { columns: [col("product", "Product"), col("units", "Units sold", "num"), col("revenue", "Revenue", "money"), col("margin", "Gross margin", "money"), col("stock", "In stock", "num")], rows, totals: { units: sum(rows, "units"), revenue: sum(rows, "revenue"), margin: sum(rows, "margin") } };
    },
    FY_NOTE,
  ),
  "lead-conv": monthly("Lead conversion", "leads.manage", async (u) => {
    const leads = await db.lead.findMany({ where: scope(u), select: { source: true, stage: true } });
    const rows = group(leads, (l) => l.source, () => 1).map(([source, v]) => {
      const won = leads.filter((l) => l.source === source && l.stage === "Won").length;
      return { source, leads: v.n, won, lost: leads.filter((l) => l.source === source && l.stage === "Lost").length, conversion: share(won, v.n) };
    });
    return { columns: [col("source", "Source"), col("leads", "Leads", "num"), col("won", "Won", "num"), col("lost", "Lost", "num"), col("conversion", "Conversion", "pct")], rows, totals: { leads: sum(rows, "leads"), won: sum(rows, "won"), lost: sum(rows, "lost") } };
  }),
  risk: monthly(
    "Members at risk (AI)",
    "members.view",
    async (u) => {
      const ms = (await members(u)).filter((m) => (m.riskScore ?? 0) >= 35).sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0));
      const rows = ms.map((m) => ({ code: m.code, name: m.name, phone: m.phone, risk: m.riskScore, why: m.riskReasons.join("; "), expiry: m.latestEnd }));
      return { columns: [col("code", "ID"), col("name", "Name"), col("phone", "Phone"), col("risk", "Risk", "num"), col("why", "Why"), col("expiry", "Expiry")], rows };
    },
    "Scored daily from visits, expiry and dues",
  ),
};

/** The report centre's left-hand list, in the prototype's groups and order. */
export const CENTER: { group: string; items: string[] }[] = [
  { group: "Financial", items: ["pl", "rev-month", "rev-daily", "rev-plan", "rev-method", "rev-staff", "rev-type", "recv", "cashflow", "gst", "gst-invoices", "collections"] },
  { group: "Expenses", items: ["exp-cat", "exp-month", "exp-vendor", "expenses"] },
  { group: "Purchases", items: ["pur-month", "pur-vendor", "payables"] },
  { group: "Fixed assets", items: ["assets", "dep-fy", "dep-month", "disposals"] },
  { group: "Membership", items: ["m-active", "m-expired", "m-new", "m-renew", "expiring", "m-plan", "m-gender", "m-age", "m-source", "m-retention", "members"] },
  { group: "Operations", items: ["attendance", "classes", "pt", "pos", "lead-conv", "leads", "risk"] },
];

