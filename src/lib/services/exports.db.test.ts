import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { cancelInvoice, collectPayment, createInvoice, reversePayment, sellMembership } from "./billing";
import { createExpense, voidExpense } from "./expenses";
import { buildExport, EXPORTS, exportAll, isExportKind } from "./exports";
import { todayIso } from "./time";

describe.skipIf(!hasDb)("export all data (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  let a: { id: string; code: string; name: string };
  let b: { id: string; code: string };
  let other: { code: string };
  let sold: Awaited<ReturnType<typeof sellMembership>>;
  let partInvoice: Awaited<ReturnType<typeof createInvoice>>;
  let cancelled: Awaited<ReturnType<typeof createInvoice>>;
  let reversedCode = "";
  let expenseCode = "";
  let voidedCode = "";
  const today = todayIso();
  const line = { description: "PT", category: "Personal Training" as const, qty: 1, rate: 200000, discount: 0, taxable: false };

  beforeAll(async () => {
    gym = await makeGym();
    admin = await gym.user("Super Admin");
    const inA = pick(admin, gym.a.id);
    const plan = await createPlan(inA, { name: "Monthly Export", kind: "Membership", months: 1, price: 100000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    a = await createMember(inA, { name: "Export Alpha", gender: "Female", phone: "9822200001", email: "alpha@test.local", source: "Walk-in", tags: [] });
    sold = await sellMembership(inA, a.id, { planId: plan.id, startDate: today, discount: 0, includeRegFee: false, payAmount: 100000, payMethod: "Cash" });
    partInvoice = await createInvoice(inA, { memberId: a.id, date: today, dueDate: today, lines: [line], payAmount: 50000, payMethod: "UPI", payRef: "UTR-EXP-1" });
    const second = await collectPayment(inA, partInvoice.id, { amount: 10000, method: "Cash", date: today });
    reversedCode = second.code;
    await reversePayment(inA, second.id, "Bounced");
    cancelled = await createInvoice(inA, { memberId: a.id, date: today, dueDate: today, lines: [line], payAmount: 0 });
    await cancelInvoice(inA, cancelled.id, "Mistake");
    expenseCode = (await createExpense(inA, { date: today, categoryId: "rent", description: "Rent for export", vendor: "Landlord", amount: 30000, method: "Cash" })).code;
    const v = await createExpense(inA, { date: today, categoryId: "rent", description: "Voided", amount: 500, method: "Cash" });
    voidedCode = v.code;
    await voidExpense(inA, v.id, "Wrong entry");
    b = await createMember(pick(admin, gym.b.id), { name: "Export Beta", gender: "Male", phone: "9822200002", source: "Walk-in", tags: [] });
    const g2 = await makeGym();
    other = await createMember(pick(await g2.user("Super Admin"), g2.a.id), { name: "Foreign", gender: "Male", phone: "9822200003", source: "Walk-in", tags: [] });
  });

  it("knows its kinds and labels", () => {
    expect(isExportKind("members")).toBe(true);
    expect(isExportKind("audit")).toBe(false);
    expect(Object.values(EXPORTS).map((e) => e.label)).toEqual(["Members (CSV)", "Invoices (CSV)", "Payments (CSV)", "Expenses (CSV)"]);
  });

  it("exports members with plan, dates, status and outstanding, scoped to org and branch", async () => {
    const r = await buildExport(admin, "members");
    expect(r.columns.map((c) => c.label)).toEqual(["ID", "Name", "Phone", "Email", "Gender", "Plan", "Start", "End", "Status", "Outstanding"]);
    const row = r.rows.find((x) => x.id === a.code)!;
    expect(row).toMatchObject({ name: "Export Alpha", email: "alpha@test.local", plan: "Monthly Export", start: today, end: sold.membership.endDate.toISOString().slice(0, 10), outstanding: 150000 });
    expect(["ACTIVE", "EXPIRING SOON", "PAYMENT PENDING", "EXPIRED", "SUSPENDED"]).toContain(row.status);
    expect(String(row.status)).not.toContain("_");
    expect(r.rows.some((x) => x.id === b.code)).toBe(true);
    expect(r.rows.some((x) => x.name === "Foreign")).toBe(false);
    expect(other.code).toBeTruthy();
    const onlyA = await buildExport(pick(admin, gym.a.id), "members");
    expect(onlyA.rows.some((x) => x.id === a.code)).toBe(true);
    expect(onlyA.rows.some((x) => x.id === b.code)).toBe(false);
  });

  it("exports invoices with computed paid, balance and status", async () => {
    const r = await buildExport(admin, "invoices");
    expect(r.columns.map((c) => c.label)).toEqual(["Invoice", "Date", "Member", "Total", "Paid", "Balance", "Status"]);
    const part = r.rows.find((x) => x.invoice === partInvoice.number)!;
    expect(part).toMatchObject({ member: "Export Alpha", total: 200000, paid: 50000, balance: 150000, status: "PARTIALLY PAID" });
    expect(part.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.rows.find((x) => x.invoice === cancelled.number)).toMatchObject({ status: "CANCELLED", balance: 0 });
  });

  it("exports every payment, reversed ones included, with who collected it", async () => {
    const r = await buildExport(admin, "payments");
    expect(r.columns.map((c) => c.label)).toEqual(["Payment ID", "Date", "Member", "Invoice", "Method", "Transaction ID", "Amount", "Status", "Received by"]);
    expect(r.rows.find((x) => x.id === reversedCode)).toMatchObject({ status: "Reversed", amount: 10000, invoice: partInvoice.number, by: admin.name });
    const first = r.rows.find((x) => x.invoice === partInvoice.number && x.status === "Success")!;
    expect(first).toMatchObject({ amount: 50000, method: "UPI", txn: "UTR-EXP-1", member: "Export Alpha", by: admin.name });
  });

  it("exports active expenses only, scoped to the branch", async () => {
    const r = await buildExport(admin, "expenses");
    expect(r.columns.map((c) => c.label)).toEqual(["Expense", "Date", "Category", "Description", "Vendor", "Amount", "Method"]);
    expect(r.rows.find((x) => x.id === expenseCode)).toMatchObject({ category: "Rent", desc: "Rent for export", vendor: "Landlord", amount: 30000, method: "Cash", date: today });
    expect(r.rows.some((x) => x.id === voidedCode)).toBe(false);
    const inB = await buildExport(pick(admin, gym.b.id), "expenses");
    expect(inB.rows.some((x) => x.id === expenseCode)).toBe(false);
    expect((await buildExport(pick(admin, gym.b.id), "invoices")).rows.some((x) => x.invoice === partInvoice.number)).toBe(false);
    expect((await buildExport(pick(admin, gym.b.id), "payments")).rows.some((x) => x.id === reversedCode)).toBe(false);
  });

  it("writes the CSV and notes the download in the audit log", async () => {
    const { fileName, csv, rows } = await exportAll(admin, "members");
    expect(fileName).toMatch(/^fitron-members-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe("ID,Name,Phone,Email,Gender,Plan,Start,End,Status,Outstanding");
    expect(lines.length).toBe(rows + 1);
    expect(lines.find((l) => l.startsWith(a.code + ","))).toMatch(/,1500\.00$/);
    const log = await db.auditLog.findFirst({ where: { orgId: gym.org.id, action: "export.members" } });
    expect(log).toMatchObject({ entity: "Member", entityId: fileName, userId: admin.id });
    expect((log?.after as { rows: number }).rows).toBe(rows);
    const e = await exportAll(admin, "expenses");
    expect(await db.auditLog.findFirst({ where: { orgId: gym.org.id, action: "export.expenses" } })).toMatchObject({ entity: "Expense", entityId: e.fileName });
  });
});
