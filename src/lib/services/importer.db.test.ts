import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { jsonPath } from "@/lib/db-dialect";
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
    expect(preview[0]!.warnings[0]).toMatch(/Gold Quarterly.*created as inactive at ₹4,500/);
    const r = await commitImport(admin, "members", rows, map, "members.csv");
    expect(r).toEqual({ made: 2, skipped: 2, plansCreated: 1, plansInactive: ["Gold Quarterly"] });

    const ravi = await db.member.findFirstOrThrow({ where: { orgId: gym.org.id, phone: "9876500001" }, include: { memberships: true } });
    expect(ravi).toMatchObject({ oldId: "M-1", branchId: gym.a.id, gender: "Male" });
    expect(ravi.notes).toMatch(/Migrated from Old Gym App \(ID M-1\)/);
    expect(ravi.memberships[0]).toMatchObject({ type: "IMPORT", price: 450000 });
    expect(await getMemberBalance(ravi.id)).toBe(50000);
    // The plan the file named is created inactive at the row's amount, to be priced and activated by an admin (bug 10).
    expect(await db.membershipPlan.findMany({ where: { orgId: gym.org.id, name: "Gold Quarterly" } })).toMatchObject([{ status: "INACTIVE", price: 450000, months: 3 }]);

    // Running the same file again imports nothing new.
    await expect(commitImport(admin, "members", rows, map, "members.csv")).rejects.toThrow(/No valid rows/);
    expect((await getMigration(gym.org.id)).done?.members?.n).toBe(2);
  });

  it("imports a file in parts, and a repeated or resumed part skips what an earlier one imported", async () => {
    const lines = Array.from({ length: 5 }, (_, i) => `P-${i},Part Member ${i},987651000${i},Female,Platinum Yearly,12,${d(start)},0,0`);
    const { rows, map } = csv("members", `Member ID,Name,Mobile,Gender,Plan,Duration,Start Date,Fees,Paid
${lines.join("\n")}`);
    const before = (await getMigration(gym.org.id)).done?.members?.n ?? 0;
    const p1 = await commitImport(admin, "members", rows.slice(0, 2), map, "parts.csv", { index: 1, of: 3 });
    expect(p1).toEqual({ made: 2, skipped: 0, plansCreated: 1, plansInactive: ["Platinum Yearly"] });
    // The second part overlaps the first (a retry after a dropped connection): the row already in is skipped, not duplicated.
    const p2 = await commitImport(admin, "members", rows.slice(1, 4), map, "parts.csv", { index: 2, of: 3 });
    expect(p2).toEqual({ made: 2, skipped: 1, plansCreated: 0, plansInactive: [] });
    const p3 = await commitImport(admin, "members", rows.slice(4), map, "parts.csv", { index: 3, of: 3 });
    expect(p3.made).toBe(1);
    // A part made only of rows already imported is a no-op rather than an error.
    expect(await commitImport(admin, "members", rows.slice(0, 2), map, "parts.csv", { index: 1, of: 3 })).toEqual({ made: 0, skipped: 2, plansCreated: 0, plansInactive: [] });
    expect(await db.member.count({ where: { orgId: gym.org.id, name: { startsWith: "Part Member" } } })).toBe(5);
    const plans = await db.membershipPlan.findMany({ where: { orgId: gym.org.id, name: "Platinum Yearly" } });
    expect(plans).toMatchObject([{ status: "INACTIVE", price: 0 }]);
    expect(await db.membership.count({ where: { planId: plans[0]!.id } })).toBe(5);
    expect((await getMigration(gym.org.id)).done?.members?.n).toBe(before + 5);
    const parts = await db.auditLog.findMany({ where: { orgId: gym.org.id, action: "import.members", after: { path: jsonPath(["file"]), equals: "parts.csv" } } });
    expect(parts.map((a) => (a.after as { part: string }).part).sort()).toEqual(["1/3", "2/3", "3/3"]);
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

  it("an imported payment settles the member's unpaid invoice instead of becoming a sale of its own", async () => {
    const m = csv("members", `Name,Mobile,Plan,Duration,Start Date,Fees,Paid\nDue Member,9876520001,Gold Quarterly,3,${d(start)},3000,0\nNo Paid Column,9876520002,Gold Quarterly,3,${d(start)},2000,`);
    expect((await commitImport(admin, "members", m.rows, m.map, "dues.csv")).made).toBe(2);
    const due = await db.member.findFirstOrThrow({ where: { orgId: gym.org.id, phone: "9876520001" } });
    const blank = await db.member.findFirstOrThrow({ where: { orgId: gym.org.id, phone: "9876520002" } });
    // A blank "Amount paid" is not "paid in full": the due stays visible.
    expect(await getMemberBalance(blank.id)).toBe(200000);
    // The join date is the plan's start, not the day of the import.
    expect(due.createdAt.toISOString().slice(0, 10)).toBe(start);

    const invoicesBefore = await db.invoice.count({ where: { memberId: due.id } });
    const pay = csv("payments", `Mobile,Date,Amount,Mode\n9876520001,${d(today)},2000,Cash\n9876520001,${d(today)},1500,UPI`);
    const preview = await previewImport(admin, "payments", pay.rows, pay.map);
    expect(preview.map((r) => r.warnings)).toEqual([["Settles ₹2,000 of unpaid invoices"], ["Settles ₹1,000 of unpaid invoices; ₹500 recorded as a separate receipt"]]);
    expect((await commitImport(admin, "payments", pay.rows, pay.map, "history.csv")).made).toBe(2);
    // ₹3,000 of the ₹3,500 cleared the plan invoice; only the extra ₹500 is a new invoice.
    expect(await db.invoice.count({ where: { memberId: due.id } })).toBe(invoicesBefore + 1);
    expect(await getMemberBalance(due.id)).toBe(0);
    const extra = await db.invoice.findFirstOrThrow({ where: { memberId: due.id }, orderBy: { createdAt: "desc" } });
    expect(extra.total).toBe(50000);
    const audit = await db.auditLog.findFirstOrThrow({ where: { orgId: gym.org.id, action: "import.payments", after: { path: jsonPath(["file"]), equals: "history.csv" } } });
    expect(audit.after).toMatchObject({ imported: 2, total: 2 });
  });

  it("a file sent in parts ends with an audit entry giving the whole file's count", async () => {
    const lines = Array.from({ length: 4 }, (_, i) => `Total Member ${i},987653000${i},Monthly,1,${d(start)},1000,1000`);
    const { rows, map } = csv("members", `Name,Mobile,Plan,Duration,Start Date,Fees,Paid\n${lines.join("\n")}`);
    await commitImport(admin, "members", rows.slice(0, 2), map, "total.csv", { index: 1, of: 2, fileRows: 4 });
    await commitImport(admin, "members", rows.slice(2), map, "total.csv", { index: 2, of: 2, fileRows: 4 });
    const last = await db.auditLog.findFirstOrThrow({ where: { orgId: gym.org.id, action: "import.members", after: { path: jsonPath(["part"]), equals: "2/2" }, AND: { after: { path: jsonPath(["file"]), equals: "total.csv" } } } });
    expect(last.after).toMatchObject({ imported: 2, total: 4, rows: 4 });
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
