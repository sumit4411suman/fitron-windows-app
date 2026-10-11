import Database from "better-sqlite3";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { invoiceState } from "@/lib/domain/billing";
import { isLocal } from "@/lib/runtime/edition";
import { localDatabaseUrl } from "@/lib/runtime/paths";
import { hasDb, makeGym, pick } from "@/test/db";
import { verifyAuditChain } from "./audit";
import { collectPayment, getInvoice, memberHistory, sellMembership } from "./billing";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { toIso, todayIso } from "./time";

// Phase 6 of the Local Windows Edition: the first workflow end to end on SQLite, through the same services the console
// uses. Create member → create membership → record payment (partial, then the rest) → generate invoice → member history.
// Run with FITRON_EDITION=local and DATABASE_URL=file:… (docs/local-windows/DATABASE-MIGRATION.md §7).
describe.skipIf(!hasDb || !isLocal())("Local Edition vertical slice (SQLite)", () => {
  let admin: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  let orgId: string;
  let planId: string;
  const today = todayIso();

  beforeAll(async () => {
    const gym = await makeGym();
    orgId = gym.org.id;
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    // GST 18% split CGST+SGST, as a gym in the same state as its members bills.
    await db.setting.upsert({ where: { orgId_key: { orgId, key: "tax" } }, create: { orgId, key: "tax", value: { enabled: true, rate: 18, type: "CGST+SGST", gstin: "27ABCDE1234F1Z5" } }, update: {} });
    // ₹999 a month and a ₹500 registration fee: 99900 and 50000 paise.
    planId = (await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 99900, regFee: 50000, discount: 0, gstApplicable: true, features: ["Gym floor", "Locker"] })).id;
  });

  it("sells a membership with a partial payment, takes the rest, and shows it all in the member's history", async () => {
    const member = await createMember(admin, { name: "Asha Verma", gender: "Female", phone: "9811100001", source: "Walk-in", tags: ["morning", "student"] });
    expect(member.code).toMatch(/\d+$/);
    // The list column round-trips as a list on SQLite.
    expect((await db.member.findUniqueOrThrow({ where: { id: member.id } })).tags).toEqual(["morning", "student"]);
    expect((await db.membershipPlan.findUniqueOrThrow({ where: { id: planId } })).features).toEqual(["Gym floor", "Locker"]);

    const sale = await sellMembership(admin, member.id, { planId, startDate: today, discount: 0, includeRegFee: true, payAmount: 100000, payMethod: "UPI", payRef: "UTR0001" });
    // (99900 + 50000) × 18% = 26982 paise of GST; 149900 + 26982 = 176882 paise = ₹1,768.82. Integer paise throughout.
    expect(sale.invoice).toMatchObject({ subtotal: 149900, discount: 0, tax: 26982, total: 176882, status: "ISSUED", gstType: "CGST+SGST" });
    expect(Number(sale.invoice.gstRate)).toBe(18);
    expect(sale.invoice.items.map((i) => i.taxAmount).reduce((a, b) => a + b, 0)).toBe(26982);
    expect(sale.payment).toMatchObject({ amount: 100000, method: "UPI", status: "SUCCESS" });
    expect(toIso(sale.membership.startDate)).toBe(today);

    let inv = (await getInvoice(admin, sale.invoice.id))!;
    expect(invoiceState({ total: inv.total, cancelled: false, dueDate: toIso(inv.dueDate) }, inv.payments.map((p) => ({ amount: p.amount, status: p.status as "SUCCESS" })), today)).toMatchObject({ paid: 100000, balance: 76882, status: "PARTIALLY_PAID" });

    await collectPayment(admin, sale.invoice.id, { amount: 76882, method: "Cash", date: today });
    inv = (await getInvoice(admin, sale.invoice.id))!;
    expect(invoiceState({ total: inv.total, cancelled: false, dueDate: toIso(inv.dueDate) }, inv.payments.map((p) => ({ amount: p.amount, status: p.status as "SUCCESS" })), today)).toMatchObject({ paid: 176882, balance: 0, status: "PAID" });

    const h = await memberHistory(admin, member.id);
    expect(h.memberships).toHaveLength(1);
    expect(h.memberships[0]!.invoice.number).toBe(sale.invoice.number);
    expect(h.invoices.map((i) => i.id)).toEqual([sale.invoice.id]);
    expect(h.payments.map((p) => p.amount).sort((a, b) => a - b)).toEqual([76882, 100000]);

    // Every write left a chained audit row in its own transaction.
    expect(await verifyAuditChain(orgId)).toMatchObject({ bad: 0 });
  });

  it("refuses an overpayment before writing anything: no invoice, no membership, no invoice number used", async () => {
    const member = await createMember(admin, { name: "Ravi Kumar", gender: "Male", phone: "9811100002", source: "Walk-in", tags: [] });
    const seqBefore = await db.sequence.findUnique({ where: { orgId_name: { orgId, name: "invoice" } } });
    await expect(sellMembership(admin, member.id, { planId, startDate: today, discount: 0, includeRegFee: false, payAmount: 999_999_00, payMethod: "Cash" })).rejects.toThrow(/more than the invoice total/);
    expect(await db.invoice.count({ where: { memberId: member.id } })).toBe(0);
    expect(await db.membership.count({ where: { memberId: member.id } })).toBe(0);
    expect((await db.sequence.findUnique({ where: { orgId_name: { orgId, name: "invoice" } } }))?.next).toBe(seqBefore?.next);
  });

  it("rolls the whole sale back when the database refuses part of it: the invoice number is not burned", async () => {
    const member = await createMember(admin, { name: "Meena Shah", gender: "Female", phone: "9811100003", source: "Walk-in", tags: [] });
    const seqBefore = (await db.sequence.findUniqueOrThrow({ where: { orgId_name: { orgId, name: "invoice" } } })).next;
    // A payment method the schema accepts but a deliberately broken foreign key makes the insert fail mid-transaction.
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRaw`UPDATE "Sequence" SET "next" = "next" + 1 WHERE "orgId" = ${orgId} AND "name" = 'invoice'`;
        await tx.payment.create({ data: { orgId, branchId: member.branchId, memberId: member.id, invoiceId: "no-such-invoice", code: "PAY-X", date: new Date(), amount: 100, method: "Cash", receivedById: admin.id } });
      }),
    ).rejects.toThrow();
    expect((await db.sequence.findUniqueOrThrow({ where: { orgId_name: { orgId, name: "invoice" } } })).next).toBe(seqBefore);
    expect(await db.payment.count({ where: { memberId: member.id } })).toBe(0);
  });

  it("is on disk: another connection to the file sees the committed invoice", async () => {
    const file = localDatabaseUrl().replace(/^file:/, "");
    const raw = new Database(file, { readonly: true });
    try {
      const row = raw.prepare(`SELECT COUNT(*) AS n, SUM("total") AS t FROM "Invoice" WHERE "orgId" = ?`).get(orgId) as { n: number; t: number };
      expect(row.n).toBeGreaterThanOrEqual(1);
      expect(row.t).toBe(176882);
      expect((raw.pragma("journal_mode", { simple: true }) as string).toLowerCase()).toBe("wal");
    } finally {
      raw.close();
    }
  });
});
