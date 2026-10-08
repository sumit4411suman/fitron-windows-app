import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { addMonths } from "@/lib/domain/dates";
import { assetInput, disposeInput, purchaseInput } from "@/lib/validation/assets";
import { createAsset, disposeAsset, getAsset, removeAsset, updateAsset } from "./assets";
import { cancelPurchase, createPurchase, getPurchase, payables, payVendor } from "./purchases";
import { ledger, monthPeriod, profitAndLoss } from "./accounting";
import { saveProduct } from "./pos";
import { voidExpense } from "./expenses";
import { todayIso } from "./time";

describe.skipIf(!hasDb)("fixed assets and purchases (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  const thisMonth = todayIso().slice(0, 7);
  const lastMonth = addMonths(`${thisMonth}-01`, -1).slice(0, 7);
  const day = `${lastMonth}-05`;
  const asset = (over: Record<string, string> = {}) =>
    assetInput.parse({ name: "Treadmill", category: "Cardio equipment", qty: "1", purchaseDate: day, cost: "120000", salvage: "", method: "WDV", rate: "15", life: "", payMethod: "Bank Transfer", ...over });

  beforeAll(async () => {
    gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
  });

  it("an asset bought from the cash book is in the ledger, not the P&L, which carries depreciation instead", async () => {
    const a = await createAsset(admin, asset());
    expect(a.code).toMatch(/^AST-\d+$/);
    const pl = await profitAndLoss(admin, monthPeriod(lastMonth));
    expect(pl.totalExpenses).toBe(0);
    expect(pl.depreciation).toBe(150_000);
    expect(pl.net).toBe(-150_000);
    const bank = await ledger(admin, "Bank Transfer", monthPeriod(lastMonth));
    expect(bank.totalOut).toBe(12_000_000);
    // The capital expense can't be voided on its own.
    await expect(voidExpense(admin, a.expenseId!, "x")).rejects.toThrow(/Remove the asset/);
  });

  it("a corrected cost reflows the schedule and the cash-book expense", async () => {
    const a = await createAsset(admin, asset({ name: "Bike", cost: "60000" }));
    await updateAsset(admin, a.id, asset({ name: "Bike", cost: "48000" }));
    const e = await db.expense.findUniqueOrThrow({ where: { id: a.expenseId! } });
    expect(e.amount).toBe(4_800_000);
    const got = await getAsset(admin, a.id);
    expect(got!.info.sch[0]!.dep).toBe(60_000);
    expect(got!.info.monthDep).toBeGreaterThan(0);
    expect(got!.info.monthDep).toBe(got!.info.sch[got!.info.sch.length - 1]!.dep);
    await removeAsset(admin, a.id, "Duplicate");
    expect((await db.expense.findUniqueOrThrow({ where: { id: a.expenseId! } })).status).toBe("VOID");
  });

  it("selling below book value posts a loss in the disposal month and money into the ledger", async () => {
    const a = await createAsset(admin, asset({ name: "Rower", cost: "50000", payMethod: "none" }));
    expect(a.expenseId).toBeNull();
    await disposeAsset(admin, a.id, disposeInput.parse({ date: `${thisMonth}-01`, type: "SOLD", amount: "40000", method: "Cash" }));
    const pl = await profitAndLoss(admin, monthPeriod(thisMonth));
    // Two months at 15% WDV on 50,000 = 625 × 2; book value 48,750; sold for 40,000.
    expect(pl.disposalLoss).toBe(875_000);
    const cash = await ledger(admin, "Cash", monthPeriod(thisMonth));
    expect(cash.totalIn).toBe(4_000_000);
    await expect(disposeAsset(admin, a.id, disposeInput.parse({ date: `${thisMonth}-01`, type: "SCRAPPED" }))).rejects.toThrow(/Already/);
  });

  it("a part-paid bill adds stock, an asset and an expense; the balance is payable until settled", async () => {
    const prod = await saveProduct(admin, null, { sku: "WHEY1", name: "Whey 1kg", category: "Supplements", price: 250000, cost: 130000, trackStock: true, reorderLevel: 2, gstApplicable: true });
    const input = purchaseInput.parse({
      date: day,
      vendor: "Fit Supplies",
      method: "UPI",
      paid: "part",
      paidAmount: "1000",
      lines: [
        { type: "STOCK", description: "Whey 1kg", ref: prod.id, qty: "10", rate: "1500", gstPct: "0" },
        { type: "STOCK", description: "Shaker", ref: "new", newSku: "SHK", newPrice: "300", qty: "20", rate: "100", gstPct: "18" },
        { type: "ASSET", description: "Dumbbell rack", ref: "Strength equipment", qty: "1", rate: "20000", gstPct: "18" },
        { type: "EXPENSE", description: "Delivery", ref: "miscellaneous", qty: "1", rate: "500", gstPct: "0" },
      ],
    });
    const p = await createPurchase(admin, input);
    const total = 1_500_000 + 236_000 + 2_360_000 + 50_000;
    expect(p.total).toBe(total);

    const whey = await db.product.findUniqueOrThrow({ where: { id: prod.id } });
    expect(whey.stock).toBe(10);
    expect(whey.cost).toBe(150_000);
    const shaker = await db.product.findFirstOrThrow({ where: { branchId: gym.a.id, sku: "SHK" } });
    expect(shaker).toMatchObject({ stock: 20, cost: 11_800, price: 30_000 });

    const full = await getPurchase(admin, p.id);
    expect(full!.balance).toBe(total - 100_000);
    expect(full!.expenses.every((e) => e.method === "Credit")).toBe(true);
    const expLine = full!.lines.find((l) => l.type === "EXPENSE")!;
    const cat = await db.expenseCategory.findUniqueOrThrow({ where: { id: expLine.category! } });
    expect(full!.categories.find((c) => c.id === expLine.category)?.name).toBe(cat.name);
    expect(full!.products.map((x) => x.sku)).toContain("WHEY1");
    expect(full!.assets.map((x) => x.code)).toContain((await db.asset.findFirstOrThrow({ where: { purchaseId: p.id } })).code);
    expect(full!.expenses.filter((e) => e.capital)).toHaveLength(1);
    expect((await payables(admin)).map((x) => x.id)).toContain(p.id);

    // P&L gets stock and delivery (not the rack); the cash book gets only what was paid.
    const pl = await profitAndLoss(admin, monthPeriod(lastMonth));
    expect(pl.totalExpenses).toBe(1_500_000 + 236_000 + 50_000);
    expect((await ledger(admin, "UPI", monthPeriod(lastMonth))).totalOut).toBe(100_000);

    await expect(payVendor(admin, p.id, { date: todayIso(), amount: total, method: "UPI" })).rejects.toThrow(/more than the balance/);
    await payVendor(admin, p.id, { date: todayIso(), amount: total - 100_000, method: "Bank Transfer" });
    const settled = await getPurchase(admin, p.id);
    expect(settled!.balance).toBe(0);
    expect(settled!.expenses.every((e) => e.method === "Bank Transfer")).toBe(true);
    expect((await payables(admin)).map((x) => x.id)).not.toContain(p.id);
  });

  it("cancelling a bill voids its expenses, takes the stock back out and removes its assets", async () => {
    const prod = await saveProduct(admin, null, { sku: "BAR1", name: "Protein bar", category: "Supplements", price: 10000, cost: 6000, trackStock: true, reorderLevel: 0, gstApplicable: true });
    const p = await createPurchase(
      admin,
      purchaseInput.parse({
        date: todayIso(),
        vendor: "Bars Co",
        method: "Cash",
        paid: "full",
        lines: [
          { type: "STOCK", description: "Protein bar", ref: prod.id, qty: "30", rate: "60", gstPct: "0" },
          { type: "ASSET", description: "Bench", ref: "Strength equipment", qty: "1", rate: "8000", gstPct: "0" },
        ],
      }),
    );
    const assetId = (await getPurchase(admin, p.id))!.lines.find((l) => l.type === "ASSET")!.assetId!;
    await cancelPurchase(admin, p.id, "Returned");
    expect((await db.product.findUniqueOrThrow({ where: { id: prod.id } })).stock).toBe(0);
    expect((await db.asset.findUniqueOrThrow({ where: { id: assetId } })).deletedAt).not.toBeNull();
    expect(await db.expense.count({ where: { purchaseId: p.id, status: "ACTIVE" } })).toBe(0);
    expect((await ledger(admin, "Cash", monthPeriod(thisMonth))).rows.some((r) => r.link === `/purchases/${p.id}`)).toBe(false);
  });

  it("a locked month blocks an Accountant's asset and bill", async () => {
    const { lockMonth, unlockMonth } = await import("./accounting");
    await lockMonth(admin, lastMonth);
    const acc = pick(await gym.user("Accountant"), gym.a.id);
    await expect(createAsset(acc, asset({ name: "Locked" }))).rejects.toThrow(/locked/);
    await unlockMonth(admin, lastMonth);
  });
});
