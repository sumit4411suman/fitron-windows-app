import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { addDays } from "@/lib/domain/dates";
import { autoMap, parseCsv, type ImportKind } from "@/lib/domain/import";
import { commitImport, getMigration, previewImport, setMigrationSource, setOpening } from "./importer";
import { ledger } from "./accounting";
import { todayIso } from "./time";

async function getMemberBalance(memberId: string) {
  const invs = await db.invoice.findMany({ where: { memberId }, include: { payments: true } });
  return invs.reduce((s, i) => s + i.total - i.payments.filter((p) => p.status === "SUCCESS").reduce((t, p) => t + p.amount, 0), 0);
}

const csv = (kind: ImportKind, text: string) => {
  const [headers, ...rows] = parseCsv(text);
  return { rows, map: autoMap(kind, headers!) };
};

describe.skipIf(!hasDb)("migration import (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  const today = todayIso();
  const start = addDays(today, -40);
  const d = (iso: string) => iso.split("-").reverse().join("-");

  beforeAll(async () => {
    gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    await setMigrationSource(admin, "Old Gym App");
  });

  it("members: creates members, missing plans, a membership, an opening invoice and payment; skips duplicates", async () => {
    const { rows, map } = csv(
      "members",
      `Member ID,Name,Mobile,Gender,Plan,Duration,Start Date,Fees,Paid\nM-1,Ravi Kumar,9876500001,Male,Gold Quarterly,3,${d(start)},4500,4000\nM-2,Sita Devi,9876500002,F,Gold Quarterly,3,${d(start)},4500,\nM-3,Bad Phone,12345,Male,,,,,\nM-4,Ravi Again,9876500001,Male,,,,,`,
    );
    const preview = await previewImport(admin, "members", rows, map);
    expect(preview.map((r) => r.errors.length === 0)).toEqual([true, true, false, false]);
    const r = await commitImport(admin, "members", rows, map, "members.csv");
    expect(r).toEqual({ made: 2, skipped: 2, plansCreated: 1 });

    const ravi = await db.member.findFirstOrThrow({ where: { orgId: gym.org.id, phone: "9876500001" }, include: { memberships: true } });
    expect(ravi).toMatchObject({ oldId: "M-1", branchId: gym.a.id, gender: "Male" });
    expect(ravi.notes).toMatch(/Migrated from Old Gym App \(ID M-1\)/);
    expect(ravi.memberships[0]).toMatchObject({ type: "IMPORT", price: 450000 });
    expect(await getMemberBalance(ravi.id)).toBe(50000);
    expect(await db.membershipPlan.count({ where: { orgId: gym.org.id, name: "Gold Quarterly" } })).toBe(1);

    // Running the same file again imports nothing new.
    await expect(commitImport(admin, "members", rows, map, "members.csv")).rejects.toThrow(/No valid rows/);
    expect((await getMigration(gym.org.id)).done?.members?.n).toBe(2);
  });

  it("payments match imported members by old ID; expenses, products and assets land in the picked branch", async () => {
    const pay = csv("payments", `Receipt No,Member ID,Date,Amount,Mode\nR-1,M-2,${d(today)},1000,PhonePe`);
    expect((await commitImport(admin, "payments", pay.rows, pay.map, "p.csv")).made).toBe(1);
    const p = await db.payment.findFirstOrThrow({ where: { orgId: gym.org.id, txnRef: "R-1" } });
    expect(p).toMatchObject({ amount: 100000, method: "UPI" });

    const ex = csv("expenses", `Date,Head,Paid To,Amount,Mode\n${d(today)},Bijli,JBVNL,8200,NEFT`);
    await commitImport(admin, "expenses", ex.rows, ex.map, "e.csv");
    expect(await db.expense.findFirstOrThrow({ where: { orgId: gym.org.id, vendor: "JBVNL" } })).toMatchObject({ categoryId: "electricity", amount: 820000, method: "Bank Transfer", branchId: gym.a.id });

    const pr = csv("products", "Item,Category,MRP,Cost,Closing Stock\nWhey 1kg,Supplements,2800,2100,12");
    await commitImport(admin, "products", pr.rows, pr.map, "s.csv");
    const whey = await db.product.findFirstOrThrow({ where: { branchId: gym.a.id, name: "Whey 1kg" }, include: { movements: true } });
    expect(whey).toMatchObject({ stock: 12, price: 280000, sku: "WHEY-1KG" });
    expect(whey.movements[0]!.qty).toBe(12);

    const as = csv("assets", "Asset,Purchase Date,Cost,Accumulated Depreciation\nCommercial treadmill,10-05-2024,320000,86000");
    await commitImport(admin, "assets", as.rows, as.map, "a.csv");
    const t = await db.asset.findFirstOrThrow({ where: { orgId: gym.org.id, name: "Commercial treadmill" } });
    expect(t).toMatchObject({ category: "Cardio equipment", accDepCarried: 8_600_000, depFrom: today.slice(0, 7), expenseId: null });
  });

  it("the cash and bank books start from the opening balances", async () => {
    await setOpening(admin, { cash: 500000, bank: 2000000, asOf: addDays(today, -1) });
    const bank = await ledger(admin, "Bank Transfer", { from: today, to: today });
    expect(bank.broughtForward).toBe(2000000);
    expect(bank.closing).toBe(2000000 - 820000);
    const cash = await ledger(admin, "Cash", { from: addDays(today, -1), to: today });
    expect(cash.rows[0]).toMatchObject({ ref: "OPENING", in: 500000 });
  });
});
