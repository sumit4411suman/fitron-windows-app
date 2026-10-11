import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { addDays } from "@/lib/domain/dates";
import { canUsePermission } from "@/lib/domain/features";
import type { Permission } from "@/lib/auth/permissions";
import { LINE_CATEGORIES, METHODS } from "@/lib/validation/billing";
import { listMembers } from "./members";
import { monthOverview, monthPeriod, moneyOnHand, profitAndLoss } from "./accounting";
import { atRisk } from "./insights";
import { audienceIds, AUDIENCES, type Audience } from "./audience";
import { listInvoices, listPayments, listReceivables } from "./billing";
import { listCategories, listExpenses } from "./expenses";
import { payables } from "./purchases";
import { listPlans } from "./plans";
import { listProducts } from "./pos";
import { REPORTS, reportGroups } from "./reports";
import { getTax } from "./tax";
import { isDraftTool, resolveInvoice, runDraftTool } from "./ai-actions";
import { fromIso, toIso, todayIso } from "./time";

// Tools the assistant can call, each limited to what the signed-in staff member may see and do.
// The read tools only read. The draft_* tools and propose_action never change the books: they store a draft that the
// person must confirm (src/lib/services/ai-actions.ts, ai.ts confirmProposal).

const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export const TOOL_DEFS = [
  { name: "get_overview", description: "Headline numbers for the gym today: members by status, dues, today's check-ins, this month's revenue and collections.", input_schema: { type: "object", properties: {} } },
  {
    name: "list_members",
    description: "List members in a group, most relevant first.",
    input_schema: {
      type: "object",
      properties: {
        filter: { type: "string", enum: ["active", "expiring", "expired", "upcoming", "dues", "payment_pending", "suspended", "at_risk"], description: "expiring = within 7 days; upcoming = plan starts later; dues = owes money; at_risk = high churn risk" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["filter"],
    },
  },
  { name: "find_member", description: "Look up one member by name, phone or member ID, with plan, expiry, dues and recent visits.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  {
    name: "revenue_breakdown",
    description: "Profit and loss for a period: revenue by category, expenses by group, depreciation, collections by payment method. Dates are YYYY-MM-DD.",
    input_schema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] },
  },
  { name: "class_and_attendance", description: "Check-ins per day and class bookings for the last N days (default 14).", input_schema: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 60 } } } },
  {
    name: "list_invoices",
    description: "Find invoices (bills). Filter by status, period or text (invoice number, member name or phone). Returns totals plus the first rows with id, number, balance and overdue days.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["all", "unpaid", "partial", "overdue", "paid", "cancelled"], description: "unpaid = nothing paid yet; partial = part paid; overdue = past due date with a balance" },
        from: { type: "string", description: "Invoice date from, YYYY-MM-DD" },
        to: { type: "string", description: "Invoice date to, YYYY-MM-DD" },
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 40 },
      },
    },
  },
  { name: "get_invoice", description: "One invoice in full: lines with GST, totals, payments, status and its web and PDF links. Use the invoice number (e.g. INV-1042) or id.", input_schema: { type: "object", properties: { invoice: { type: "string" } }, required: ["invoice"] } },
  {
    name: "list_payments",
    description: "Payments received, newest first, with totals by method. Reversed payments are shown as such and not counted in the totals.",
    input_schema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, method: { type: "string", enum: [...METHODS] }, query: { type: "string", description: "Payment code, invoice number, UTR/reference or member name" }, limit: { type: "integer", minimum: 1, maximum: 40 } } },
  },
  { name: "receivables", description: "Money members still owe: total, ageing buckets (not yet due, 1-30, 31-60, 61-90, 90+ days overdue) and the largest open invoices.", input_schema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 40 } } } },
  {
    name: "list_expenses",
    description: "Expenses for a period with totals by category. Capital purchases are flagged (they are depreciated, not expensed).",
    input_schema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, category: { type: "string", description: "Category name" }, query: { type: "string", description: "Description, vendor or bill number" }, limit: { type: "integer", minimum: 1, maximum: 40 } } },
  },
  { name: "gst_summary", description: "GST on sales for a period from the non-cancelled invoices: taxable value, CGST, SGST, IGST, total tax, and a split by rate. This is output tax; it does not include input tax credit.", input_schema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] } },
  { name: "payables", description: "Supplier bills not fully paid: vendor, bill, age in days, balance, and the total owed.", input_schema: { type: "object", properties: {} } },
  { name: "cash_position", description: "Money on hand today: closing balance of the cash and bank books by payment method (UPI, Cash, Card, Bank Transfer, Other) and in total.", input_schema: { type: "object", properties: {} } },
  { name: "month_overview", description: "Revenue, expenses, net profit and collections for each of the last N months (default 6), and whether each month is locked.", input_schema: { type: "object", properties: { months: { type: "integer", minimum: 1, maximum: 12 } } } },
  {
    name: "catalog",
    description: "Prices to bill with: active membership plans (id, price, months, GST), products (price before GST, stock) and expense categories (id, name, group). Use it when the user names a plan, product or expense type without a price.",
    input_schema: { type: "object", properties: { what: { type: "string", enum: ["plans", "products", "expense_categories", "all"] }, query: { type: "string", description: "Filter products by name or SKU" } } },
  },
  {
    name: "run_report",
    description: "Run any Report Center report for a period, e.g. pl, rev-plan, gst-invoices, exp-vendor, payables, dep-fy, m-renew, expiring, collections. Call with report \"list\" to see the reports this person may open.",
    input_schema: { type: "object", properties: { report: { type: "string" }, from: { type: "string" }, to: { type: "string" } }, required: ["report"] },
  },
  {
    name: "draft_invoice",
    description:
      "Prepare a GST invoice (bill) for a member for the user to confirm. Nothing is saved until they press the card's \"Create invoice\" button. Amounts are rupees BEFORE GST; GST is added from the gym's setting for each taxable line. For a membership use draft_membership_sale instead.",
    input_schema: {
      type: "object",
      properties: {
        member: { type: "string", description: "Member name, member code (e.g. PHG-1001), phone or id" },
        lines: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              category: { type: "string", enum: [...LINE_CATEGORIES] },
              qty: { type: "integer", minimum: 1 },
              rate: { type: "number", description: "Rupees per unit before GST" },
              discount: { type: "number", description: "Rupees off this whole line" },
              taxable: { type: "boolean", description: "Charge GST on this line (default true)" },
            },
            required: ["description", "category", "qty", "rate"],
          },
        },
        date: { type: "string", description: "YYYY-MM-DD, default today" },
        due_date: { type: "string", description: "YYYY-MM-DD, default the invoice date" },
        pay_amount: { type: "number", description: "Rupees received now, if any" },
        pay_method: { type: "string", enum: [...METHODS] },
        pay_ref: { type: "string", description: "UPI/UTR/cheque reference" },
      },
      required: ["member", "lines"],
    },
  },
  {
    name: "draft_membership_sale",
    description: "Prepare a new membership sale or a renewal (membership + invoice + optional payment) for the user to confirm. Whether it is new or a renewal is worked out from the member's history.",
    input_schema: {
      type: "object",
      properties: {
        member: { type: "string", description: "Member name, code, phone or id" },
        plan: { type: "string", description: "Plan name or id (see catalog)" },
        start_date: { type: "string", description: "YYYY-MM-DD, default: right after the current membership ends, or today" },
        discount: { type: "number", description: "Rupees off the plan price" },
        include_reg_fee: { type: "boolean" },
        offer_code: { type: "string" },
        pricing_category: { type: "string", description: "e.g. Student, Female; default Standard" },
        pay_amount: { type: "number", description: "Rupees received now" },
        pay_method: { type: "string", enum: [...METHODS] },
        pay_ref: { type: "string" },
      },
      required: ["member", "plan"],
    },
  },
  {
    name: "draft_payment",
    description: "Prepare a payment received against an unpaid or part-paid invoice, for the user to confirm. It cannot exceed the invoice's balance.",
    input_schema: {
      type: "object",
      properties: { invoice: { type: "string", description: "Invoice number or id" }, amount: { type: "number", description: "Rupees" }, method: { type: "string", enum: [...METHODS] }, date: { type: "string" }, txn_ref: { type: "string" }, notes: { type: "string" } },
      required: ["invoice", "amount", "method"],
    },
  },
  {
    name: "draft_expense",
    description: "Prepare an expense entry for the user to confirm. Equipment purchases belong in Fixed assets or a purchase bill, not here.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string" },
        amount: { type: "number", description: "Rupees paid, including any GST" },
        category: { type: "string", description: "Category name or id (see catalog)" },
        method: { type: "string", enum: [...METHODS] },
        date: { type: "string", description: "YYYY-MM-DD, default today" },
        vendor: { type: "string" },
        bill_no: { type: "string" },
        notes: { type: "string" },
      },
      required: ["description", "amount", "category", "method"],
    },
  },
  {
    name: "draft_cancel_invoice",
    description: "Prepare cancelling an invoice (its payments are reversed and its membership cancelled) for the user to confirm. Needs a real reason from the user; never invent one.",
    input_schema: { type: "object", properties: { invoice: { type: "string" }, reason: { type: "string" } }, required: ["invoice", "reason"] },
  },
  {
    name: "draft_reverse_payment",
    description: "Prepare reversing one payment (by its code, e.g. PAY-5003) for the user to confirm. Needs a real reason from the user.",
    input_schema: { type: "object", properties: { payment: { type: "string" }, reason: { type: "string" } }, required: ["payment", "reason"] },
  },
  {
    name: "propose_action",
    description:
      "Suggest sending a WhatsApp message to some members. Nothing is sent: the staff member sees the suggestion and must press Send. Use either member_ids (from list_members or find_member) or an audience. Write the message as the gym, in the language the user wrote in; {{member_name}} is replaced with each member's name.",
    input_schema: {
      type: "object",
      properties: {
        member_ids: { type: "array", items: { type: "string" }, maxItems: 250 },
        audience: { type: "string", enum: Object.keys(AUDIENCES) },
        message: { type: "string" },
        summary: { type: "string", description: "One line describing the action, e.g. 'Remind 6 members with dues'" },
      },
      required: ["message", "summary"],
    },
  },
] as const;

type Input = Record<string, unknown>;
const STATUS: Record<string, string> = { active: "ACTIVE", expiring: "EXPIRING_SOON", expired: "EXPIRED", upcoming: "UPCOMING", payment_pending: "PAYMENT_PENDING", suspended: "SUSPENDED" };
const INVOICE_STATUS: Record<string, string> = { unpaid: "UNPAID", partial: "PARTIALLY_PAID", overdue: "OVERDUE", paid: "PAID", cancelled: "CANCELLED" };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The tool's refusal when the person's role or plan doesn't open this area, or null when it does. Any one of the permissions is enough. */
const lacks = (u: CurrentUser, what: string, ...perms: Permission[]) => (perms.some((p) => canUsePermission(u, p)) ? null : { error: `This staff member can't see ${what}.` });

/** An optional YYYY-MM-DD range from the model's input; a bad date is reported rather than ignored. */
function range(i: Input): { from?: string; to?: string } | { error: string } {
  const from = text(i.from);
  const to = text(i.to);
  if ((from && !ISO.test(from)) || (to && !ISO.test(to))) return { error: "Dates must be YYYY-MM-DD." };
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}
const limitOf = (v: unknown, dflt: number) => Math.min(40, Math.max(1, Number(v) || dflt));
const iso = (d: Date) => toIso(d);

export async function runTool(u: CurrentUser, name: string, input: Input): Promise<unknown> {
  const today = todayIso();
  if (isDraftTool(name)) return runDraftTool(u, name, input);
  switch (name) {
    case "get_overview": {
      const out: Record<string, unknown> = { today, branch: u.branch === "ALL" ? "All branches" : u.branches.find((b) => b.id === u.branch)?.name };
      if (u.can("members.view")) {
        const m = await listMembers(u, { all: true });
        out.members = m.counts;
        out.totalDues = rupees(m.rows.reduce((s, r) => s + r.outstanding, 0));
      }
      out.checkInsToday = await db.attendance.count({ where: { branchId: { in: u.branchIds }, date: fromIso(today) } });
      if (u.can("accounting.view")) {
        const pl = await profitAndLoss(u, { from: `${today.slice(0, 7)}-01`, to: today });
        out.thisMonth = { revenue: rupees(pl.totalRevenue), expenses: rupees(pl.totalExpenses + pl.depreciation), net: rupees(pl.net), collected: rupees(pl.collected) };
      }
      return out;
    }
    case "list_members": {
      if (!u.can("members.view")) return { error: "This staff member can't see members." };
      const limit = Math.min(50, Number(input.limit) || 20);
      const f = String(input.filter);
      if (f === "at_risk") return (await atRisk(u, limit)).map((m) => ({ id: m.id, code: m.code, name: m.name, phone: m.phone, risk: m.riskScore, why: m.riskReasons }));
      const { rows } = await listMembers(u, { all: true, status: STATUS[f] });
      const picked = f === "dues" ? rows.filter((r) => r.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding) : f === "expiring" ? rows.sort((a, b) => (a.latestEnd ?? "").localeCompare(b.latestEnd ?? "")) : rows;
      return { count: picked.length, members: picked.slice(0, limit).map((r) => ({ id: r.id, code: r.code, name: r.name, phone: r.phone, plan: r.planName, ends: r.latestEnd, dues: rupees(r.outstanding), status: r.status })) };
    }
    case "find_member": {
      if (!u.can("members.view")) return { error: "This staff member can't see members." };
      const { rows } = await listMembers(u, { all: true, q: String(input.query ?? "") });
      const top = rows.slice(0, 5);
      const visits = await db.attendance.findMany({ where: { memberId: { in: top.map((r) => r.id) } }, orderBy: { date: "desc" }, select: { memberId: true, date: true }, take: 50 });
      const risk = await db.member.findMany({ where: { id: { in: top.map((r) => r.id) } }, select: { id: true, riskScore: true, riskReasons: true } });
      return {
        matches: rows.length,
        members: top.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          phone: r.phone,
          plan: r.planName,
          ends: r.latestEnd,
          dues: rupees(r.outstanding),
          status: r.status,
          lastVisits: visits.filter((v) => v.memberId === r.id).slice(0, 5).map((v) => toIso(v.date)),
          risk: risk.find((x) => x.id === r.id)?.riskScore ?? null,
        })),
      };
    }
    case "revenue_breakdown": {
      if (!u.can("accounting.view")) return { error: "This staff member can't see accounts." };
      const from = String(input.from);
      const to = String(input.to);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return { error: "Dates must be YYYY-MM-DD." };
      const pl = await profitAndLoss(u, { from, to });
      const money = (xs: { key: string; amount: number }[]) => Object.fromEntries(xs.map((x) => [x.key, rupees(x.amount)]));
      return {
        period: { from, to },
        revenue: money(pl.revenue),
        totalRevenue: rupees(pl.totalRevenue),
        expenses: money(pl.expenseGroups),
        totalExpenses: rupees(pl.totalExpenses),
        depreciation: rupees(pl.depreciation),
        disposalGain: rupees(pl.disposalGain),
        disposalLoss: rupees(pl.disposalLoss),
        net: rupees(pl.net),
        gstCollected: rupees(pl.gstCollected),
        collectedByMethod: money(pl.collectedByMethod),
      };
    }
    case "class_and_attendance": {
      const days = Math.min(60, Number(input.days) || 14);
      const from = fromIso(addDays(today, -(days - 1)));
      const [att, bookings] = await Promise.all([
        db.attendance.groupBy({ by: ["date"], where: { branchId: { in: u.branchIds }, date: { gte: from } }, _count: { _all: true }, orderBy: { date: "asc" } }),
        db.booking.findMany({ where: { date: { gte: from, lte: fromIso(today) }, classSlot: { branchId: { in: u.branchIds } } }, select: { status: true, classSlot: { select: { name: true, capacity: true } } } }),
      ]);
      const classes = new Map<string, { booked: number; attended: number; noShow: number; waitlist: number }>();
      for (const b of bookings) {
        const c = classes.get(b.classSlot.name) ?? { booked: 0, attended: 0, noShow: 0, waitlist: 0 };
        if (b.status === "Waitlist") c.waitlist++;
        else c.booked++;
        if (b.status === "Attended") c.attended++;
        if (b.status === "No-show") c.noShow++;
        classes.set(b.classSlot.name, c);
      }
      return { checkInsByDay: att.map((a) => ({ date: toIso(a.date), visits: a._count._all })), classes: Object.fromEntries(classes) };
    }
    case "propose_action": {
      if (!u.can("whatsapp.send")) return { error: "This staff member can't send WhatsApp messages." };
      const message = String(input.message ?? "").trim();
      if (!message) return { error: "Write the message." };
      let ids = Array.isArray(input.member_ids) ? input.member_ids.map(String) : [];
      if (!ids.length && input.audience && String(input.audience) in AUDIENCES) ids = await audienceIds(u, String(input.audience) as Audience);
      const allowed = await db.member.findMany({ where: { id: { in: ids }, orgId: u.orgId, branchId: { in: u.branchIds }, deletedAt: null, walkIn: false }, select: { id: true } });
      if (!allowed.length) return { error: "None of those members were found." };
      if (allowed.length > 250) return { error: "That's more than 250 members. Narrow the group." };
      const p = await db.aiProposal.create({ data: { orgId: u.orgId, userId: u.id, kind: "WHATSAPP", memberIds: allowed.map((m) => m.id), body: message, summary: String(input.summary ?? "Send a WhatsApp message").slice(0, 200) } });
      return { proposal_id: p.id, members: allowed.length, note: "Shown to the staff member with a Send button. Tell them to check the message and press Send." };
    }
    case "list_invoices": {
      const no = lacks(u, "invoices", "invoices.view");
      if (no) return no;
      const r = range(input);
      if ("error" in r) return r;
      const status = INVOICE_STATUS[text(input.status)];
      const { rows } = await listInvoices(u, { ...r, status, q: text(input.query) || undefined });
      const live = rows.filter((x) => x.status !== "CANCELLED");
      return {
        matching: rows.length,
        totalBilled: rupees(live.reduce((a, x) => a + x.total, 0)),
        totalBalance: rupees(live.reduce((a, x) => a + x.balance, 0)),
        invoices: rows.slice(0, limitOf(input.limit, 15)).map((x) => ({ id: x.id, number: x.number, date: iso(x.date), due: iso(x.dueDate), member: x.member.name, memberCode: x.member.code, total: rupees(x.total), paid: rupees(x.paid), balance: rupees(x.balance), status: x.status, overdueDays: x.overdueDays })),
        note: rows.length > 40 ? "Capped; narrow the dates or add a query for more." : undefined,
      };
    }
    case "get_invoice": {
      const no = lacks(u, "invoices", "invoices.view");
      if (no) return no;
      const inv = await resolveInvoice(u, text(input.invoice));
      return {
        id: inv.id,
        number: inv.number,
        date: iso(inv.date),
        due: iso(inv.dueDate),
        status: inv.status,
        member: { name: inv.member.name, code: inv.member.code, phone: inv.member.phone },
        branch: inv.branch.name,
        gst: inv.gstType ? `${inv.gstRate}% ${inv.gstType}` : "none",
        lines: inv.items.map((l) => ({ description: l.description, category: l.category, qty: l.qty, rate: rupees(l.rate), discount: rupees(l.discount), gstPercent: l.taxRate, gst: rupees(l.taxAmount), amountBeforeGst: rupees(l.amount) })),
        subtotal: rupees(inv.subtotal),
        discount: rupees(inv.discount),
        gstTotal: rupees(inv.tax),
        total: rupees(inv.total),
        paid: rupees(inv.paid),
        balance: rupees(inv.balance),
        overdueDays: inv.overdueDays,
        payments: inv.payments.map((p) => ({ code: p.code, date: iso(p.date), amount: rupees(p.amount), method: p.method, reference: p.txnRef, status: p.status })),
        cancelReason: inv.cancelReason,
        links: { page: `/invoices/${inv.id}`, pdf: `/invoices/${inv.id}/pdf` },
      };
    }
    case "list_payments": {
      const no = lacks(u, "payments", "invoices.view");
      if (no) return no;
      const r = range(input);
      if ("error" in r) return r;
      const method = text(input.method);
      const rows = await listPayments(u, { ...r, method: (METHODS as readonly string[]).includes(method) ? method : undefined, q: text(input.query) || undefined });
      const ok = rows.filter((x) => x.status === "SUCCESS");
      const byMethod = new Map<string, number>();
      for (const x of ok) byMethod.set(x.method, (byMethod.get(x.method) ?? 0) + x.amount);
      return {
        matching: rows.length,
        totalReceived: rupees(ok.reduce((a, x) => a + x.amount, 0)),
        byMethod: Object.fromEntries([...byMethod].map(([k, v]) => [k, rupees(v)])),
        payments: rows.slice(0, limitOf(input.limit, 15)).map((x) => ({ code: x.code, date: iso(x.date), member: x.member.name, invoice: x.invoice.number, amount: rupees(x.amount), method: x.method, reference: x.txnRef, status: x.status })),
      };
    }
    case "receivables": {
      const no = lacks(u, "receivables", "invoices.view");
      if (no) return no;
      const { list, total } = await listReceivables(u);
      const bucket = (lo: number, hi: number) => {
        const xs = list.filter((x) => x.overdueDays >= lo && x.overdueDays <= hi);
        return { invoices: xs.length, amount: rupees(xs.reduce((a, x) => a + x.balance, 0)) };
      };
      return {
        totalOutstanding: rupees(total),
        openInvoices: list.length,
        ageing: { notYetDue: bucket(0, 0), overdue1to30: bucket(1, 30), overdue31to60: bucket(31, 60), overdue61to90: bucket(61, 90), overdue90plus: bucket(91, 100_000) },
        largest: [...list].sort((a, b) => b.balance - a.balance).slice(0, limitOf(input.limit, 10)).map((x) => ({ id: x.id, number: x.number, member: x.member.name, phone: x.member.phone, balance: rupees(x.balance), due: iso(x.dueDate), overdueDays: x.overdueDays })),
      };
    }
    case "list_expenses": {
      const no = lacks(u, "expenses", "expenses.manage", "accounting.view");
      if (no) return no;
      const r = range(input);
      if ("error" in r) return r;
      const cat = text(input.category).toLowerCase();
      const all = await listExpenses(u, { ...r, q: text(input.query) || undefined });
      const rows = cat ? all.filter((e) => e.category.name.toLowerCase().includes(cat)) : all;
      const byCategory = new Map<string, number>();
      for (const e of rows.filter((x) => !x.capital)) byCategory.set(e.category.name, (byCategory.get(e.category.name) ?? 0) + e.amount);
      return {
        matching: rows.length,
        totalOperating: rupees(rows.filter((e) => !e.capital).reduce((a, e) => a + e.amount, 0)),
        totalCapital: rupees(rows.filter((e) => e.capital).reduce((a, e) => a + e.amount, 0)),
        byCategory: Object.fromEntries([...byCategory].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, rupees(v)])),
        expenses: rows.slice(0, limitOf(input.limit, 15)).map((e) => ({ code: e.code, date: iso(e.date), category: e.category.name, description: e.description, vendor: e.vendor, amount: rupees(e.amount), method: e.method, billNo: e.billNo, capital: e.capital })),
      };
    }
    case "gst_summary": {
      const no = lacks(u, "accounts and GST", "accounting.view");
      if (no) return no;
      const r = range(input);
      if ("error" in r || !r.from || !r.to) return { error: "Give from and to as YYYY-MM-DD." };
      const [invs, tax] = await Promise.all([
        db.invoice.findMany({ where: { orgId: u.orgId, branchId: { in: u.branchIds }, status: "ISSUED", date: { gte: fromIso(r.from), lte: fromIso(r.to) } }, select: { subtotal: true, discount: true, tax: true, total: true, gstType: true, gstRate: true } }),
        getTax(u.orgId),
      ]);
      let taxable = 0, cgst = 0, sgst = 0, igst = 0, total = 0;
      const byRate = new Map<string, { invoices: number; taxable: number; tax: number }>();
      for (const i of invs) {
        const t = i.subtotal - i.discount;
        taxable += t;
        total += i.total;
        // The same split the GST invoice register uses: half each, with the odd paisa on SGST.
        if (i.gstType === "IGST") igst += i.tax;
        else if (i.gstType) {
          cgst += Math.floor(i.tax / 2);
          sgst += i.tax - Math.floor(i.tax / 2);
        }
        const k = i.tax > 0 ? `${i.gstRate ?? "?"}%` : "0% / no GST";
        const b = byRate.get(k) ?? { invoices: 0, taxable: 0, tax: 0 };
        b.invoices++;
        b.taxable += t;
        b.tax += i.tax;
        byRate.set(k, b);
      }
      return {
        period: r,
        gymGstSetting: tax.enabled ? `${tax.rate}% ${tax.type}${tax.gstin ? `, GSTIN ${tax.gstin}` : ", GSTIN not set"}` : "GST off",
        invoices: invs.length,
        taxableValue: rupees(taxable),
        cgst: rupees(cgst),
        sgst: rupees(sgst),
        igst: rupees(igst),
        totalTax: rupees(cgst + sgst + igst),
        totalInvoiced: rupees(total),
        byRate: Object.fromEntries([...byRate].map(([k, v]) => [k, { invoices: v.invoices, taxableValue: rupees(v.taxable), tax: rupees(v.tax) }])),
        note: "Output tax on sales only. Input tax credit on purchases is not tracked separately; GST returns are filed outside Fitron.",
      };
    }
    case "payables": {
      const no = lacks(u, "supplier bills", "purchases.manage");
      if (no) return no;
      const rows = await payables(u);
      return {
        totalOwed: rupees(rows.reduce((a, x) => a + x.balance, 0)),
        bills: rows.length,
        oldestFirst: rows.slice(0, 20).map((x) => ({ vendor: x.vendor, code: x.code, billNo: x.billNo, date: iso(x.date), ageDays: x.ageDays, total: rupees(x.total), paid: rupees(x.paid), balance: rupees(x.balance) })),
      };
    }
    case "cash_position": {
      const no = lacks(u, "the cash and bank books", "accounting.view");
      if (no) return no;
      const by: Record<string, string> = {};
      let total = 0;
      for (const m of METHODS) {
        const v = await moneyOnHand(u, today, m);
        by[m] = rupees(v);
        total += v;
      }
      return { asOf: today, total: rupees(total), byMethod: by };
    }
    case "month_overview": {
      const no = lacks(u, "accounts", "accounting.view");
      if (no) return no;
      const rows = await monthOverview(u, Math.min(12, Math.max(1, Number(input.months) || 6)));
      return rows.map((m) => ({ month: m.month, revenue: rupees(m.revenue), expenses: rupees(m.expenses), net: rupees(m.net), collected: rupees(m.collected), locked: m.lockedBranches === m.branches ? "yes" : m.lockedBranches ? `${m.lockedBranches} of ${m.branches} branches` : "no" }));
    }
    case "catalog": {
      const what = text(input.what) || "all";
      const out: Record<string, unknown> = {};
      if ((what === "plans" || what === "all") && (canUsePermission(u, "memberships.renew") || canUsePermission(u, "plans.manage") || canUsePermission(u, "invoices.create"))) {
        out.plans = (await listPlans(u, { activeOnly: true })).map((p) => ({ id: p.id, name: p.name, months: p.months, price: rupees(p.price), registrationFee: rupees(p.regFee), gst: p.gstApplicable, categoryPrices: p.prices.map((x) => ({ category: x.category, price: rupees(x.price) })) }));
      }
      if ((what === "products" || what === "all") && (canUsePermission(u, "pos.sell") || canUsePermission(u, "products.manage") || canUsePermission(u, "invoices.create"))) {
        out.products = (await listProducts(u, { activeOnly: true, q: text(input.query) || undefined })).slice(0, 40).map((p) => ({ id: p.id, sku: p.sku, name: p.name, priceBeforeGst: rupees(p.price), gst: p.gstApplicable, stock: p.stock }));
      }
      if ((what === "expense_categories" || what === "all") && canUsePermission(u, "expenses.manage")) {
        out.expenseCategories = (await listCategories()).map((c) => ({ id: c.id, name: c.name, group: c.group }));
      }
      return Object.keys(out).length ? out : { error: "This staff member can't see plans, products or expense categories." };
    }
    case "run_report": {
      const key = text(input.report);
      if (!key || key === "list") return { reports: reportGroups(u) };
      const def = REPORTS[key];
      if (!def || !canUsePermission(u, def.perm) || (def.feature && !u.has(def.feature))) return { error: `No report "${key}" is open to this staff member. Call run_report with "list" to see theirs.` };
      const r = range(input);
      if ("error" in r) return r;
      const period = { from: r.from ?? monthPeriod(today.slice(0, 7)).from, to: r.to ?? today };
      const rep = await def.run(u, period);
      const fmt = (c: { key: string; money?: boolean }, v: unknown) => (c.money && typeof v === "number" ? rupees(v) : v);
      return {
        title: def.title,
        period: def.usesPeriod ? period : "as of today",
        rowCount: rep.rows.length,
        rows: rep.rows.slice(0, 40).map((row) => Object.fromEntries(rep.columns.map((c) => [c.label, fmt(c, row[c.key])]))),
        totals: rep.totals ? Object.fromEntries(rep.columns.filter((c) => rep.totals![c.key] != null).map((c) => [c.label, fmt(c, rep.totals![c.key])])) : undefined,
        note: rep.rows.length > 40 ? "Only the first 40 rows are shown; the totals cover all rows." : undefined,
      };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}
