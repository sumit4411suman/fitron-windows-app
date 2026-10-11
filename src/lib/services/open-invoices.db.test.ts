import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { invoiceState } from "@/lib/domain/billing";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { cancelInvoice, listReceivables, openInvoiceIds, sellMembership } from "./billing";
import { todayIso, toIso } from "./time";

// Receivables read only invoices with something owed, picked in SQL (openInvoiceIds). The SQL must agree with
// invoiceState, the rule every screen shows, on each edge: nothing paid, part paid, paid to the paisa, a round-off of
// under a rupee left, a free invoice, a cancelled one.

describe.skipIf(!hasDb)("open invoices picked in SQL (database)", () => {
  it("agrees with the invoice rule on every edge", async () => {
    const gym = await makeGym();
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    // ₹2,167 + 18% GST: a total with paise, so a payment in whole rupees leaves a round-off.
    const gst = await createPlan(admin, { name: "GST plan", kind: "Membership", months: 1, price: 216_700, regFee: 0, discount: 0, gstApplicable: true, features: [] });
    const free = await createPlan(admin, { name: "Free trial", kind: "Membership", months: 1, price: 0, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    const sale = async (n: number, plan = gst, pay = 0) => {
      const m = await createMember(admin, { name: `Owes ${n}`, gender: "Male", phone: `98350000${String(n).padStart(2, "0")}`, source: "Walk-in", tags: [] });
      return (await sellMembership(admin, m.id, { planId: plan.id, startDate: todayIso(), discount: 0, includeRegFee: false, payAmount: pay, ...(pay ? { payMethod: "Cash" } : {}) })).invoice;
    };
    const unpaid = await sale(1);
    const total = unpaid.total;
    const part = await sale(2, gst, 100_000);
    const full = await sale(3, gst, total);
    expect(total % 100, "the GST total has paise").not.toBe(0);
    const roundOff = await sale(4, gst, Math.floor(total / 100) * 100);
    const zero = await sale(5, free);
    const cancelled = await sale(6);
    await cancelInvoice(admin, cancelled.id, "Entered by mistake");

    const today = todayIso();
    const rows = await db.invoice.findMany({ where: { orgId: gym.org.id }, include: { payments: true } });
    const byRule = rows.filter((i) => invoiceState({ total: i.total, cancelled: i.status === "CANCELLED", dueDate: toIso(i.dueDate) }, i.payments as never, today).balance > 0).map((i) => i.id);
    const bySql = await openInvoiceIds(admin);
    expect(new Set(bySql)).toEqual(new Set(byRule));
    expect(bySql).toEqual(expect.arrayContaining([unpaid.id, part.id]));
    for (const settled of [full.id, zero.id, cancelled.id]) expect(bySql).not.toContain(settled);
    // A whole-rupee payment on a total with paise leaves under a rupee: settled.
    const ro = rows.find((i) => i.id === roundOff.id)!;
    expect(ro.total - ro.payments.reduce((s, p) => s + p.amount, 0)).toBeLessThan(100);
    expect(bySql).not.toContain(roundOff.id);
    expect((await listReceivables(admin)).list.map((r) => r.id).sort()).toEqual([unpaid.id, part.id].sort());
  });
});
