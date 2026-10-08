import { describe, expect, it } from "vitest";
import { autoMap, checkRows, IMPORTS, matchAssetCategory, parseCsv, parseDate, parseMethod, parsePaise, planMonths, type Ctx } from "./import";

const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  today: "2026-09-28",
  phones: new Set(["9000000001"]),
  memberByPhone: new Map([["9000000001", "m1"]]),
  memberByOldId: new Map([["M-7", "m1"]]),
  memberByName: new Map([["asha verma", ["m1"]]]),
  plans: [{ id: "p1", name: "Monthly", months: 1, price: 150000 }],
  productNames: new Set(["whey 1kg"]),
  productSkus: new Set(),
  expenseCats: [
    { id: "rent", name: "Rent" },
    { id: "electricity", name: "Electricity" },
    { id: "staff-salary", name: "Staff Salary" },
    { id: "miscellaneous", name: "Miscellaneous" },
  ],
  lockedMonths: new Set(),
  oldIds: new Set(),
  ...over,
});

describe("CSV and column mapping", () => {
  it("parses quotes, embedded commas and newlines, CRLF and a BOM", () => {
    expect(parseCsv('﻿Name,Address\r\n"Ravi, Jr",\"Qr 12\nSector 4\"\r\nSita,"She said ""hi"""\r\n\r\n')).toEqual([
      ["Name", "Address"],
      ["Ravi, Jr", "Qr 12\nSector 4"],
      ["Sita", 'She said "hi"'],
    ]);
  });

  it("maps the sample headers of every step", () => {
    for (const k of Object.keys(IMPORTS) as (keyof typeof IMPORTS)[]) {
      const headers = parseCsv(IMPORTS[k].sample)[0]!;
      const map = autoMap(k, headers);
      for (const [key, , required] of IMPORTS[k].fields) if (required) expect(map[key], `${k}.${key}`).toBeGreaterThanOrEqual(0);
    }
    const m = autoMap("members", ["Member ID", "Name", "Mobile", "Expiry Date", "Fees"]);
    expect(m).toMatchObject({ oldId: 0, name: 1, phone: 2, end: 3, amount: 4, start: -1 });
  });
});

describe("value parsing", () => {
  it("reads Indian and ISO dates, month names and Excel serials, and rejects impossible dates", () => {
    expect(parseDate("05-08-2026")).toBe("2026-08-05");
    expect(parseDate("5/8/26")).toBe("2026-08-05");
    expect(parseDate("2026-08-05")).toBe("2026-08-05");
    expect(parseDate("12 Aug 2026")).toBe("2026-08-12");
    expect(parseDate("12-Sept-2026")).toBe("2026-09-12");
    expect(parseDate("46000")).toBe("2025-12-09");
    expect(parseDate("31-02-2026")).toBe("");
    expect(parseDate("soon")).toBe("");
  });

  it("reads money, payment modes and plan lengths", () => {
    expect(parsePaise("₹1,499.50")).toBe(149950);
    expect(parsePaise("Rs. 800")).toBe(80000);
    expect(parsePaise("")).toBeNull();
    expect(parseMethod("PhonePe")).toBe("UPI");
    expect(parseMethod("NEFT")).toBe("Bank Transfer");
    expect(parseMethod("")).toBe("Cash");
    expect(planMonths("Gold Quarterly", "")).toBe(3);
    expect(planMonths("Annual", "")).toBe(12);
    expect(planMonths("", "6 months")).toBe(6);
    expect(planMonths("Special", "")).toBe(0);
    expect(matchAssetCategory("", "Commercial treadmill")).toBe("Cardio equipment");
    expect(matchAssetCategory("", "Split AC 2 ton")).toBe("Air conditioning");
  });
});

describe("row checks", () => {
  it("members: duplicates are skipped, missing dates are derived, and new plans are flagged", () => {
    const rows = checkRows(
      "members",
      [
        { name: "Ravi Kumar", phone: "+91 98765 43210", plan: "Gold Quarterly", start: "01-07-2026", end: "", amount: "4500", paid: "", due: "500" },
        { name: "Asha", phone: "9000000001" },
        { name: "Dup", phone: "9876543210" },
        { name: "Sita", phone: "9123456780", plan: "Monthly", end: "14-10-2026" },
      ],
      ctx(),
    );
    expect(rows[0]!.errors).toEqual([]);
    expect(rows[0]!.data).toMatchObject({ phone: "9876543210", months: 3, start: "2026-07-01", end: "2026-09-30", amount: 450000, paid: 400000, planId: null, planName: "Gold Quarterly" });
    expect(rows[0]!.warnings[0]).toMatch(/will be created/);
    expect(rows[1]!.errors).toEqual(["Already a member (skipped)"]);
    expect(rows[2]!.errors).toEqual(["Repeated in this file"]);
    expect(rows[3]!.data).toMatchObject({ planId: "p1", start: "2026-09-15", end: "2026-10-14", amount: 150000, paid: 150000 });
    expect(rows[3]!.n).toBe(5);
  });

  it("members with neither expiry nor duration get the gym's default membership duration", () => {
    const row = { name: "Ravi", phone: "9123456781", start: "01-07-2026" };
    const three = checkRows("members", [row], ctx({ defaultMonths: 3 }))[0]!;
    expect(three.warnings).toContain("No expiry or duration; 3 months assumed");
    expect(three.data).toMatchObject({ months: 3, start: "2026-07-01", end: "2026-09-30", planName: "Quarterly" });
    const one = checkRows("members", [row], ctx({ defaultMonths: 1 }))[0]!;
    expect(one.warnings).toContain("No expiry or duration; 1 month assumed");
    expect(one.data).toMatchObject({ months: 1, end: "2026-07-31" });
    expect(checkRows("members", [row], ctx())[0]!.warnings).toContain("No expiry or duration; 1 month assumed");
  });

  it("payments match a member by phone, old ID or a unique name; locked months are refused", () => {
    const rows = checkRows(
      "payments",
      [
        { phone: "9000000001", date: "01-08-2026", amount: "1500", method: "gpay" },
        { oldId: "M-7", date: "02-08-2026", amount: "500" },
        { name: "Asha Verma", date: "03-08-2026", amount: "500" },
        { phone: "9999999999", date: "2026-08-04", amount: "500" },
        { phone: "9000000001", date: "05-07-2026", amount: "500" },
      ],
      ctx({ lockedMonths: new Set(["2026-07"]) }),
    );
    expect(rows.slice(0, 3).map((r) => r.data.memberId)).toEqual(["m1", "m1", "m1"]);
    expect(rows[0]!.data.method).toBe("UPI");
    expect(rows[3]!.errors[0]).toMatch(/not found/);
    expect(rows[4]!.errors).toEqual(["Jul 2026 is locked"]);
  });

  it("expenses file unknown heads by keyword, products refuse duplicates, assets carry old depreciation", () => {
    const [e1, e2] = checkRows("expenses", [{ date: "05-08-2026", category: "Bijli bill", amount: "8,200" }, { date: "06-08-2026", category: "Tea", amount: "50" }], ctx());
    expect(e1!.data).toMatchObject({ categoryId: "electricity", amount: 820000, method: "Cash" });
    expect(e2!.data.categoryId).toBe("miscellaneous");
    const [p1, p2] = checkRows("products", [{ name: "Whey 1kg", price: "2800" }, { name: "Energy Drink", price: "80", stock: "48" }], ctx());
    expect(p1!.errors).toEqual(["Product already exists"]);
    expect(p2!.data).toMatchObject({ sku: "ENERGY-DRINK", category: "Drinks", stock: 48, reorder: 10 });
    const [a] = checkRows("assets", [{ name: "Commercial treadmill", purchaseDate: "10-05-2024", cost: "320000", accDep: "86000" }], ctx());
    expect(a!.data).toMatchObject({ category: "Cardio equipment", method: "WDV", rate: 15, cost: 32_000_000, accDep: 8_600_000 });
  });
});
