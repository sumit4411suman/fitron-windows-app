import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { addDays } from "@/lib/domain/dates";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { sellMembership } from "./billing";
import { createExpense } from "./expenses";
import { lockMonth, unlockMonth } from "./accounting";
import { runTool } from "./ai-tools";
import { chat, confirmProposal, dismissProposal, type ChatEvent } from "./ai";
import { todayIso } from "./time";

type Draft = { proposal_id: string; preview: string };
const isDraft = (x: unknown): x is Draft => !!x && typeof x === "object" && "proposal_id" in x;

describe.skipIf(!hasDb)("Fitron AI accounting (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  let accountant: typeof admin;
  let desk: typeof admin;
  let trainer: typeof admin;
  let planId: string;
  const today = todayIso();
  const lastMonth = `${addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)}`;
  const monthStart = `${today.slice(0, 7)}-01`;

  const draft = async (u: typeof admin, tool: string, input: Record<string, unknown>) => runTool(u, tool, input);
  const must = (x: unknown): Draft => {
    if (!isDraft(x)) throw new Error(`Expected a draft, got ${JSON.stringify(x)}`);
    return x;
  };

  beforeAll(async () => {
    gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    accountant = pick(await gym.user("Accountant"), gym.a.id);
    desk = pick(await gym.user("Receptionist"), gym.a.id);
    trainer = pick(await gym.user("Trainer"), gym.a.id);
    await db.setting.upsert({ where: { orgId_key: { orgId: gym.org.id, key: "tax" } }, create: { orgId: gym.org.id, key: "tax", value: { enabled: true, rate: 18, type: "CGST+SGST", gstin: "27ABCDE1234F1Z5" } }, update: {} });
    planId = (await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 100000, regFee: 0, discount: 0, gstApplicable: true, features: [] })).id;
    await createMember(admin, { name: "Asha Verma", gender: "Female", phone: "9855500001", source: "Walk-in", tags: [] });
    await createMember(admin, { name: "Ravi Kumar", gender: "Male", phone: "9855500002", source: "Walk-in", tags: [] });
    await createMember(admin, { name: "Ravi Shah", gender: "Male", phone: "9855500003", source: "Walk-in", tags: [] });
  });

  afterEach(() => vi.unstubAllGlobals());

  const invoiceInput = (extra: Record<string, unknown> = {}) => ({ member: "Asha Verma", lines: [{ description: "Personal training, 4 sessions", category: "Personal Training", qty: 4, rate: 1500 }], ...extra });

  it("prepares an invoice without booking anything, then books it exactly once when confirmed", async () => {
    const before = await db.invoice.count({ where: { orgId: gym.org.id } });
    const d = must(await draft(desk, "draft_invoice", invoiceInput({ pay_amount: 3000, pay_method: "UPI", pay_ref: "UTR123" })));
    expect(d.preview).toContain("Total ₹7,080.00");
    expect(d.preview).toContain("GST 18% ₹1,080.00");
    expect(d.preview).toContain("Received now: ₹3,000.00 by UPI; balance ₹4,080.00");
    expect(await db.invoice.count({ where: { orgId: gym.org.id } })).toBe(before);

    const done = await confirmProposal(desk, d.proposal_id);
    if (done.kind !== "ACTION") throw new Error("expected an action");
    expect(done.message).toMatch(/^Invoice .+ created, total ₹7,080\.00/);
    expect(done.href).toMatch(/^\/invoices\//);
    expect(done.pdf).toMatch(/\/pdf$/);

    const inv = await db.invoice.findFirstOrThrow({ where: { orgId: gym.org.id }, orderBy: { createdAt: "desc" }, include: { payments: true, items: true } });
    expect(inv.total).toBe(708000);
    expect(inv.tax).toBe(108000);
    expect(inv.gstType).toBe("CGST+SGST");
    expect(inv.items[0]!.taxAmount).toBe(108000);
    expect(inv.payments.map((p) => [p.amount, p.method, p.txnRef])).toEqual([[300000, "UPI", "UTR123"]]);
    expect(inv.createdById).toBe(desk.id);

    // Pressing Confirm twice, or from someone else's chat, books nothing more.
    await expect(confirmProposal(desk, d.proposal_id)).rejects.toThrow(/Already handled/);
    await expect(confirmProposal(admin, d.proposal_id)).rejects.toThrow(/not found/);
    expect(await db.invoice.count({ where: { orgId: gym.org.id } })).toBe(before + 1);
    expect((await db.aiProposal.findUniqueOrThrow({ where: { id: d.proposal_id } })).status).toBe("DONE");
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: "ai.proposal.confirm", entityId: d.proposal_id } })).toBe(1);
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: "invoice.create", entityId: inv.id } })).toBe(1);
  });

  it("charges no GST on a line the user says is not taxable, and when the gym has GST off", async () => {
    const d = must(await draft(desk, "draft_invoice", invoiceInput({ lines: [{ description: "Towel", category: "Product", qty: 2, rate: 250, taxable: false }] })));
    expect(d.preview).toContain("no GST");
    expect(d.preview).toContain("Total ₹500.00");
  });

  it("explains what is wrong instead of drafting", async () => {
    expect(await draft(desk, "draft_invoice", invoiceInput({ member: "Ravi" }))).toEqual({ error: expect.stringMatching(/Several members match "Ravi": .*Ravi Kumar.*Ravi Shah.*Ask which one/) });
    expect(await draft(desk, "draft_invoice", invoiceInput({ member: "Nobody Here" }))).toEqual({ error: 'No member matches "Nobody Here".' });
    expect(await draft(desk, "draft_invoice", invoiceInput({ lines: [{ description: "x", category: "Gold", qty: 1, rate: 100 }] }))).toEqual({ error: expect.stringContaining("Line categories:") });
    expect(await draft(desk, "draft_invoice", invoiceInput({ lines: [{ description: "x", category: "Other", qty: 1, rate: 100, discount: 200 }] }))).toEqual({ error: expect.stringContaining("discount") });
    expect(await draft(desk, "draft_invoice", invoiceInput({ pay_amount: 99999, pay_method: "Cash" }))).toEqual({ error: "The payment is more than the invoice total." });
    expect(await draft(desk, "draft_invoice", invoiceInput({ pay_amount: 100 }))).toEqual({ error: expect.stringContaining("how it was paid") });
    expect(await draft(desk, "draft_invoice", invoiceInput({ lines: [{ description: "x", category: "Other", qty: 1, rate: "lots" }] }))).toHaveProperty("error");
    expect(await draft(desk, "draft_invoice", invoiceInput({ date: "2026-10-10", due_date: "2026-10-01" }))).toEqual({ error: "The due date is before the invoice date." });
    // Members can be found by code or phone as well as by name.
    const byPhone = must(await draft(desk, "draft_invoice", invoiceInput({ member: "9855500001" })));
    expect(byPhone.preview).toContain("Asha Verma");
  });

  it("only drafts what the person's role allows", async () => {
    expect(await draft(trainer, "draft_invoice", invoiceInput())).toEqual({ error: "This staff member's role can't create invoices." });
    expect(await draft(trainer, "draft_expense", { description: "x", amount: 1, category: "Electricity", method: "Cash" })).toEqual({ error: "This staff member's role can't record expenses." });
    expect(await draft(desk, "draft_expense", { description: "x", amount: 1, category: "Electricity", method: "Cash" })).toEqual({ error: "This staff member's role can't record expenses." });
    expect(await draft(desk, "draft_cancel_invoice", { invoice: "INV-1", reason: "x" })).toEqual({ error: "This staff member's role can't cancel invoices." });
    expect(await draft(accountant, "draft_membership_sale", { member: "Asha Verma", plan: "Monthly" })).toEqual({ error: "This staff member's role can't sell or renew memberships." });
  });

  it("re-checks the role when Confirm is pressed", async () => {
    const d = must(await draft(desk, "draft_invoice", invoiceInput()));
    const stripped = { ...desk, can: () => false };
    await expect(confirmProposal(stripped, d.proposal_id)).rejects.toThrow(/Your role can't do this/);
    expect((await db.aiProposal.findUniqueOrThrow({ where: { id: d.proposal_id } })).status).toBe("PENDING");
  });

  it("sells a membership with the same price, GST and offer maths as the sale page", async () => {
    const d = must(await draft(desk, "draft_membership_sale", { member: "Ravi Kumar", plan: "Monthly", discount: 100, pay_amount: 500, pay_method: "Cash" }));
    // (1000 - 100) = 900 + 18% = 162 → 1062.
    expect(d.preview).toContain("Sell Monthly (1 month) for Ravi Kumar");
    expect(d.preview).toContain("Invoice total ₹1,062.00");
    const done = await confirmProposal(desk, d.proposal_id);
    if (done.kind !== "ACTION") throw new Error("expected an action");
    expect(done.message).toMatch(/^Sold: invoice .+, total ₹1,062\.00/);
    const m = await db.member.findFirstOrThrow({ where: { orgId: gym.org.id, name: "Ravi Kumar" }, include: { memberships: true } });
    expect(m.memberships).toHaveLength(1);
    // Selling again is a renewal, drafted as one.
    const again = must(await draft(desk, "draft_membership_sale", { member: "Ravi Kumar", plan: "Monthly" }));
    expect(again.preview).toContain("Renew Monthly");
    expect(await draft(desk, "draft_membership_sale", { member: "Ravi Kumar", plan: "Platinum" })).toEqual({ error: expect.stringContaining('No active plan "Platinum"') });
  });

  it("records a payment against an invoice, never more than the balance", async () => {
    const inv = await db.invoice.findFirstOrThrow({ where: { orgId: gym.org.id, total: 708000 } });
    expect(await draft(desk, "draft_payment", { invoice: inv.number, amount: 5000, method: "UPI" })).toEqual({ error: expect.stringContaining("only ₹4,080.00 left") });
    const d = must(await draft(desk, "draft_payment", { invoice: inv.number.toLowerCase(), amount: 4080, method: "Cash" }));
    expect(d.preview).toContain("Balance before ₹4,080.00, after ₹0.00 (fully paid)");
    const done = await confirmProposal(desk, d.proposal_id);
    if (done.kind !== "ACTION") throw new Error("expected an action");
    expect(done.message).toMatch(/^Payment PAY-\d+ of ₹4,080\.00 recorded/);
    expect(await draft(desk, "draft_payment", { invoice: inv.number, amount: 1, method: "Cash" })).toEqual({ error: expect.stringContaining("left to pay") });
  });

  it("records an expense by category name, on one branch", async () => {
    const d = must(await draft(accountant, "draft_expense", { description: "September electricity", amount: 8400, category: "electric", method: "UPI", vendor: "MSEB", bill_no: "B-77" }));
    expect(d.preview).toContain("₹8,400.00");
    expect(d.preview).toContain("September electricity");
    // With "All branches" selected the app books to the first branch, and the preview says which.
    expect(must(await draft({ ...accountant, branch: "ALL", branchIds: [gym.a.id, gym.b.id] }, "draft_expense", { description: "Mat cleaning", amount: 100, category: "Electricity", method: "Cash" })).preview).toMatch(/· A$/);
    expect(await draft(accountant, "draft_expense", { description: "Mat cleaning", amount: 1, category: "Moonshine", method: "Cash" })).toEqual({ error: expect.stringContaining("No expense category") });
    const done = await confirmProposal(accountant, d.proposal_id);
    if (done.kind !== "ACTION") throw new Error("expected an action");
    expect(done.message).toMatch(/^Expense EXP-\d+ of ₹8,400\.00 recorded/);
    expect(await db.expense.count({ where: { orgId: gym.org.id, vendor: "MSEB", billNo: "B-77", amount: 840000 } })).toBe(1);
  });

  it("cancels an invoice and reverses a payment only with a reason from the user", async () => {
    const inv = await db.invoice.findFirstOrThrow({ where: { orgId: gym.org.id, total: 106200 }, include: { payments: true } });
    expect(await draft(admin, "draft_cancel_invoice", { invoice: inv.number, reason: "" })).toEqual({ error: expect.stringContaining("real reason") });
    const rev = must(await draft(admin, "draft_reverse_payment", { payment: inv.payments[0]!.code, reason: "Cheque bounced" }));
    expect(rev.preview).toContain("Reverse payment");
    await confirmProposal(admin, rev.proposal_id);
    expect((await db.payment.findUniqueOrThrow({ where: { id: inv.payments[0]!.id } })).status).toBe("REVERSED");
    expect(await draft(admin, "draft_reverse_payment", { payment: inv.payments[0]!.code, reason: "again" })).toEqual({ error: expect.stringContaining("already reversed") });

    const c = must(await draft(admin, "draft_cancel_invoice", { invoice: inv.number, reason: "Wrong plan chosen" }));
    expect(c.preview).toContain("cannot be undone");
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("ISSUED");
    await confirmProposal(admin, c.proposal_id);
    const after = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.status).toBe("CANCELLED");
    expect(after.cancelReason).toBe("Wrong plan chosen");
    expect(await draft(admin, "draft_cancel_invoice", { invoice: inv.number, reason: "again" })).toEqual({ error: expect.stringContaining("already cancelled") });
  });

  it("stops at a locked month when drafting, and keeps the draft to retry when the lock appears before Confirm", async () => {
    await lockMonth(admin, lastMonth);
    const old = `${lastMonth}-15`;
    expect(await draft(accountant, "draft_expense", { description: "Late", amount: 100, category: "Electricity", method: "Cash", date: old })).toEqual({ error: expect.stringContaining("locked") });
    // A Super Admin may still post into it.
    must(await draft(admin, "draft_expense", { description: "Late", amount: 100, category: "Electricity", method: "Cash", date: old }));

    // A draft dated today passes; then it is re-pointed at the locked month, as if the month had been locked after drafting.
    const d = must(await draft(accountant, "draft_expense", { description: "Booked later", amount: 100, category: "Electricity", method: "Cash" }));
    await db.aiProposal.update({ where: { id: d.proposal_id }, data: { payload: { input: { date: old, categoryId: (await db.expenseCategory.findFirstOrThrow()).id, description: "Booked later", amount: 10000, method: "Cash" } } } });
    await expect(confirmProposal(accountant, d.proposal_id)).rejects.toThrow(/locked/);
    const row = await db.aiProposal.findUniqueOrThrow({ where: { id: d.proposal_id } });
    expect(row.status).toBe("PENDING");
    await unlockMonth(admin, lastMonth);
    await confirmProposal(accountant, d.proposal_id);
    expect((await db.aiProposal.findUniqueOrThrow({ where: { id: d.proposal_id } })).status).toBe("DONE");
  });

  it("will not confirm a draft that is over two hours old", async () => {
    const d = must(await draft(desk, "draft_invoice", invoiceInput()));
    await db.aiProposal.update({ where: { id: d.proposal_id }, data: { createdAt: new Date(Date.now() - 3 * 3600_000) } });
    const before = await db.invoice.count({ where: { orgId: gym.org.id } });
    await expect(confirmProposal(desk, d.proposal_id)).rejects.toThrow(/over two hours old/);
    expect(await db.invoice.count({ where: { orgId: gym.org.id } })).toBe(before);
    expect((await db.aiProposal.findUniqueOrThrow({ where: { id: d.proposal_id } })).status).toBe("DISMISSED");
  });

  it("a discarded draft books nothing", async () => {
    const d = must(await draft(desk, "draft_invoice", invoiceInput()));
    const before = await db.invoice.count({ where: { orgId: gym.org.id } });
    await dismissProposal(desk, d.proposal_id);
    await expect(confirmProposal(desk, d.proposal_id)).rejects.toThrow(/Already handled/);
    expect(await db.invoice.count({ where: { orgId: gym.org.id } })).toBe(before);
  });

  describe("reading the books", () => {
    beforeAll(async () => {
      // One unpaid invoice from last month's date range is covered above; add a clear overdue one.
      const m = await db.member.findFirstOrThrow({ where: { orgId: gym.org.id, name: "Ravi Shah" } });
      await sellMembership(admin, m.id, { planId, startDate: addDays(today, -20), discount: 0, includeRegFee: false, payAmount: 0 });
      await createExpense(admin, { date: monthStart, categoryId: (await db.expenseCategory.findFirstOrThrow()).id, description: "Mat repair", amount: 120000, method: "Cash" });
    });

    it("lists invoices, one invoice in full, and who owes what", async () => {
      const list = (await runTool(desk, "list_invoices", { status: "unpaid" })) as { matching: number; invoices: { number: string; balance: string }[] };
      expect(list.matching).toBeGreaterThan(0);
      expect(list.invoices.every((i) => i.balance !== "₹0")).toBe(true);
      const one = (await runTool(desk, "get_invoice", { invoice: list.invoices[0]!.number })) as { lines: unknown[]; links: { pdf: string }; gstTotal: string };
      expect(one.lines.length).toBeGreaterThan(0);
      expect(one.links.pdf).toMatch(/^\/invoices\/.+\/pdf$/);
      await expect(runTool(desk, "get_invoice", { invoice: "NOPE-1" })).rejects.toThrow("No invoice NOPE-1 that you can see.");
      expect(await runTool(desk, "list_invoices", { from: "10/2026" })).toEqual({ error: "Dates must be YYYY-MM-DD." });
      const r = (await runTool(desk, "receivables", {})) as { totalOutstanding: string; ageing: Record<string, { invoices: number }> };
      expect(r.totalOutstanding).not.toBe("₹0");
      expect(Object.values(r.ageing).reduce((a, b) => a + b.invoices, 0)).toBeGreaterThan(0);
    });

    it("sums GST for a period from the invoices", async () => {
      const g = (await runTool(accountant, "gst_summary", { from: monthStart, to: today })) as Record<string, string | number | Record<string, unknown>>;
      expect(g.gymGstSetting).toBe("18% CGST+SGST, GSTIN 27ABCDE1234F1Z5");
      expect(Number(g.invoices)).toBeGreaterThan(0);
      expect(g.igst).toBe("₹0");
      expect(g.cgst).toBe(g.sgst);
      expect(await runTool(accountant, "gst_summary", { from: monthStart })).toEqual({ error: "Give from and to as YYYY-MM-DD." });
    });

    it("lists payments, expenses, cash, months, the catalog and any report", async () => {
      const pay = (await runTool(desk, "list_payments", {})) as { totalReceived: string; byMethod: Record<string, string> };
      expect(pay.byMethod).toHaveProperty("UPI");
      const ex = (await runTool(accountant, "list_expenses", { from: monthStart, to: today })) as { totalOperating: string; byCategory: Record<string, string> };
      expect(ex.totalOperating).not.toBe("₹0");
      const cash = (await runTool(accountant, "cash_position", {})) as { total: string; byMethod: Record<string, string> };
      expect(Object.keys(cash.byMethod)).toEqual(["UPI", "Cash", "Card", "Bank Transfer", "Other"]);
      const months = (await runTool(accountant, "month_overview", { months: 3 })) as { month: string }[];
      expect(months).toHaveLength(3);
      const cat = (await runTool(desk, "catalog", { what: "plans" })) as { plans: { name: string; price: string }[] };
      expect(cat.plans.map((p) => [p.name, p.price])).toContainEqual(["Monthly", "₹1,000"]);
      expect(await runTool(desk, "catalog", { what: "expense_categories" })).toEqual({ error: expect.stringContaining("can't see") });
      const list = (await runTool(accountant, "run_report", { report: "list" })) as { reports: { group: string }[] };
      expect(list.reports.length).toBeGreaterThan(0);
      const rep = (await runTool(accountant, "run_report", { report: "gst-invoices", from: monthStart, to: today })) as { title: string; rowCount: number; totals: Record<string, string> };
      expect(rep.title).toBe("GST invoice register");
      expect(rep.rowCount).toBeGreaterThan(0);
      expect(rep.totals).toHaveProperty("Taxable value");
      expect(await runTool(accountant, "run_report", { report: "does-not-exist" })).toEqual({ error: expect.stringContaining("No report") });
    });

    it("keeps each tool to what the person's role may see", async () => {
      for (const [tool, input] of [["list_invoices", {}], ["get_invoice", { invoice: "X" }], ["list_payments", {}], ["receivables", {}], ["list_expenses", {}], ["gst_summary", { from: monthStart, to: today }], ["payables", {}], ["cash_position", {}], ["month_overview", {}]] as const) {
        expect(await runTool(trainer, tool, input), tool).toEqual({ error: expect.stringContaining("can't see") });
      }
      expect(await runTool(desk, "gst_summary", { from: monthStart, to: today })).toEqual({ error: expect.stringContaining("can't see") });
      expect(await runTool(desk, "list_expenses", {})).toEqual({ error: expect.stringContaining("can't see") });
      expect(await runTool(trainer, "run_report", { report: "gst-invoices" })).toEqual({ error: expect.stringContaining("No report") });
    });
  });

  it("in a chat, the model drafts an invoice, the user sees it with a Confirm button, and nothing is booked until then", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const replies = [
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "draft_invoice", input: invoiceInput({ lines: [{ description: "Personal training", category: "Personal Training", qty: 2, rate: 1000 }] }) }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Ready: ₹2,360 including GST. Check it and press Confirm." }] },
    ];
    const bodies: { system: string; tools: { name: string }[]; messages: unknown[] }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify(replies.shift()), { status: 200 });
      }),
    );
    const before = await db.invoice.count({ where: { orgId: gym.org.id } });
    const events: ChatEvent[] = [];
    for await (const e of chat(desk, [{ role: "user", content: "Make a bill for Asha, 2 PT sessions at 1000" }])) events.push(e);
    expect(events.map((e) => e.type)).toEqual(["tool", "proposal", "text", "done"]);
    const p = events.find((e) => e.type === "proposal") as Extract<ChatEvent, { type: "proposal" }>;
    expect(p).toMatchObject({ kind: "INVOICE", confirm: "Create invoice" });
    expect(p.body).toContain("Total ₹2,360.00");
    expect(await db.invoice.count({ where: { orgId: gym.org.id } })).toBe(before);

    // The model was told it is an accounting assistant, who it is talking to, and was given the whole toolbox.
    expect(bodies[0]!.system).toContain("accounting and operations assistant");
    expect(bodies[0]!.system).toContain("Receptionist");
    expect(bodies[0]!.system).toContain("18% CGST+SGST");
    const names = bodies[0]!.tools.map((t) => t.name);
    for (const n of ["list_invoices", "get_invoice", "gst_summary", "receivables", "list_expenses", "run_report", "draft_invoice", "draft_membership_sale", "draft_payment", "draft_expense", "draft_cancel_invoice", "draft_reverse_payment", "propose_action"]) expect(names, n).toContain(n);
    // What came back to the model is the validated preview, so it can quote real numbers.
    expect(JSON.stringify(bodies[1]!.messages)).toContain("Total ₹2,360.00");
  });
});
