import { beforeAll, describe, expect, it } from "vitest";
import { hasDb, makeGym, pick } from "@/test/db";
import { createMember } from "./members";
import { createInvoice } from "./billing";
import { createExpense } from "./expenses";
import { unzip } from "@/test/xlsx";
import { REPORTS, reportGroups, toXlsx } from "./reports";
import { CENTER } from "./reports-more";
import { monthPeriod } from "./accounting";
import { todayIso } from "./time";

describe.skipIf(!hasDb)("report centre (database)", () => {
  let admin: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  const today = todayIso();

  beforeAll(async () => {
    const gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    const m = await createMember(admin, { name: "Report Member", gender: "Female", phone: "9866600001", source: "Instagram", tags: [] });
    await createInvoice(admin, { memberId: m.id, date: today, dueDate: today, lines: [{ description: "PT", category: "Personal Training", qty: 1, rate: 100000, discount: 0, taxable: true }], payAmount: 50000, payMethod: "UPI" });
    await createExpense(admin, { date: today, categoryId: "rent", description: "Rent", amount: 30000, method: "Cash" });
  });

  it("every report in the centre exists and runs", async () => {
    for (const g of CENTER) for (const k of g.items) {
      const def = REPORTS[k];
      expect(def, k).toBeDefined();
      const r = await def!.run(admin, monthPeriod(today.slice(0, 7)));
      expect(Array.isArray(r.rows), k).toBe(true);
      for (const row of r.rows) for (const c of r.columns) expect(row, `${k}.${c.key}`).toHaveProperty(c.key);
    }
    expect(reportGroups(admin).map((g) => g.group)).toEqual(["Financial", "Expenses", "Purchases", "Fixed assets", "Membership", "Operations"]);
  });

  it("figures come from the invoices, payments and expenses", async () => {
    const p = monthPeriod(today.slice(0, 7));
    const month = (await REPORTS["rev-month"]!.run(admin, p)).rows.at(-1)!;
    expect(month).toMatchObject({ pt: 100000, total: 100000 });
    const method = (await REPORTS["rev-method"]!.run(admin, p)).rows;
    expect(method).toEqual([{ method: "UPI", payments: 1, amount: 50000, share: 100 }]);
    const recv = (await REPORTS.recv!.run(admin, p)).rows;
    expect(recv[0]).toMatchObject({ member: "Report Member", total: 118000, paid: 50000, pending: 68000 });
    const cash = (await REPORTS.cashflow!.run(admin, p)).rows.at(-1)!;
    expect(cash).toMatchObject({ collections: 50000, expenses: 30000, net: 20000 });
    const src = (await REPORTS["m-source"]!.run(admin, p)).rows;
    expect(src).toEqual([{ source: "Instagram", members: 1, share: 100 }]);
    const pl = (await REPORTS.pl!.run(admin, p)).rows.at(-1)!;
    expect(pl).toMatchObject({ revenue: 100000, expenses: 30000, net: 70000, margin: 70 });
  });

  it("the Excel download is a workbook with real numbers, rupees from paise", async () => {
    const r = await REPORTS.cashflow!.run(admin, monthPeriod(today.slice(0, 7)));
    const parts = unzip(toXlsx("Cash flow", r));
    const sheet = parts["xl/worksheets/sheet1.xml"]!;
    expect(parts["xl/workbook.xml"]).toContain('name="Cash flow"');
    expect(sheet).toContain("Collections"); // the column heading
    expect(sheet).toMatch(/<c r="[A-Z]+\d+" s="2"><v>500<\/v><\/c>/); // 50000 paise, as a money number
    expect(sheet).not.toContain("<f>");
  });
});

describe("report titles", () => {
  it("names the depreciation report", () => {
    expect(REPORTS["dep-fy"]!.title).toBe("Depreciation this FY");
    expect(REPORTS["dep-fy"]!.group).toBe("Fixed assets");
  });
});
