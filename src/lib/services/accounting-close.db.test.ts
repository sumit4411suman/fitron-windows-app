import { beforeAll, describe, expect, it } from "vitest";
import { hasDb, makeGym, pick } from "@/test/db";
import { addMonths } from "@/lib/domain/dates";
import { createMember } from "./members";
import { createInvoice } from "./billing";
import { createExpense } from "./expenses";
import { setOpening } from "./importer";
import { ledgerTable, monthClose, reconciliation, monthPeriod } from "./accounting";
import { todayIso } from "./time";

describe.skipIf(!hasDb)("reconciliation, month-end and ledgers (database)", () => {
  let admin: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  const thisMonth = `${todayIso().slice(0, 7)}-01`;
  const lastMonth = addMonths(thisMonth, -1).slice(0, 7);
  const day = `${lastMonth}-10`;

  beforeAll(async () => {
    const gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    // ₹1,000 cash and ₹5,000 in the bank before last month.
    await setOpening(admin, { cash: 100000, bank: 500000, asOf: addMonths(thisMonth, -2) });
    const m = await createMember(admin, { name: "Close Member", gender: "Male", phone: "9844400001", source: "Walk-in", tags: [] });
    // 2 × ₹1,000 + 18% GST = ₹2,360, ₹1,000 paid in cash.
    await createInvoice(admin, { memberId: m.id, date: day, dueDate: day, lines: [{ description: "PT", category: "Personal Training", qty: 2, rate: 100000, discount: 0, taxable: true }], payAmount: 100000, payMethod: "Cash" });
    await createExpense(admin, { date: day, categoryId: "rent", description: "Rent", amount: 30000, method: "Bank Transfer" });
  });

  it("month-end: opening and closing balances, collections, receivables and net", async () => {
    const c = await monthClose(admin, lastMonth);
    const v = (k: string) => c.rows.find((r) => r[0] === k)![1];
    expect(v("Opening balance")).toBe(600000);
    expect(v("Total revenue (invoiced)")).toBe(200000);
    expect(v("Cash collection")).toBe(100000);
    expect(v("Outstanding receivables at month end")).toBe(136000);
    expect(v("Operating expenses")).toBe(30000);
    expect(v("Net profit")).toBe(170000);
    expect(v("Closing balance")).toBe(670000);
    expect(c.locked).toBe(false);
  });

  it("the P&L reconciliation and the ledgers agree with the same entries", async () => {
    const { rows } = await reconciliation(admin, monthPeriod(lastMonth));
    const v = (k: string) => rows.find((r) => r[0] === k)![1];
    expect(v("Tax collected")).toBe(36000);
    expect(v("Outstanding on these invoices")).toBe(136000);
    expect(v("Cash in hand (est.)")).toBe(200000);
    expect((await ledgerTable(admin, "income")).rows).toEqual([[expect.any(Date), expect.any(String), "Close Member", "Personal Training", 200000]]);
    expect((await ledgerTable(admin, "receivable")).rows[0]!.slice(4)).toEqual([236000, 100000, 136000]);
    expect((await ledgerTable(admin, "payment")).rows[0]!.slice(4)).toEqual(["Cash", "Success", 100000]);
  });
});
