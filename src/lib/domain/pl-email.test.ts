import { describe, expect, it } from "vitest";
import { monthToReport, plEmail, plSheet, type MonthlyPl } from "./pl-email";

const pl: MonthlyPl = {
  revenue: [
    { key: "Renewal", amount: 90_000_00 },
    { key: "New", amount: 40_000_00 },
    { key: "PT", amount: 20_000_00 },
    { key: "Registration", amount: 5_000_00 },
    { key: "Products", amount: 1_000_00 },
  ],
  expenseGroups: [
    { key: "Salaries", amount: 60_000_00 },
    { key: "Rent", amount: 30_000_00 },
  ],
  totalRevenue: 156_000_00,
  totalExpenses: 90_000_00,
  depreciation: 11_627_25,
  disposalGain: 0,
  disposalLoss: 0,
  net: 54_372_75,
  gstCollected: 18_000_00,
  collected: 140_000_00,
};

describe("which month the email covers", () => {
  it("is last month, on the first three days of a month only", () => {
    expect(monthToReport("2026-10-01")).toBe("2026-09");
    expect(monthToReport("2026-10-03")).toBe("2026-09");
    expect(monthToReport("2026-10-04")).toBeNull();
    expect(monthToReport("2026-10-31")).toBeNull();
  });

  it("crosses the year", () => {
    expect(monthToReport("2027-01-02")).toBe("2026-12");
  });
});

describe("the email", () => {
  const mail = plEmail({ gym: "Power Haus Gym", month: "2026-09", name: "Asha Verma", pl, settingsUrl: "https://fitron.in/settings?tab=reminders" });

  it("names the gym and the month", () => {
    expect(mail.subject).toBe("Power Haus Gym: profit and loss for Sep 2026");
    expect(mail.text).toContain("Hello Asha,");
    expect(mail.text).toContain("how Power Haus Gym did in Sep 2026");
  });

  it("gives the figures in rupees with Indian grouping, and the margin", () => {
    expect(mail.text).toContain("Revenue: ₹1,56,000");
    expect(mail.text).toContain("Operating expenses: ₹90,000");
    expect(mail.text).toContain("Depreciation: ₹11,627.25");
    expect(mail.text).toContain("Net profit: ₹54,372.75  (35% of revenue)");
    expect(mail.text).toContain("Money received in the month: ₹1,40,000");
    expect(mail.text).toContain("GST on your sales: ₹18,000");
  });

  it("lists the biggest lines and folds the rest into Other", () => {
    expect(mail.text).toContain("- Renewal: ₹90,000");
    expect(mail.text).toContain("- Other: ₹6,000"); // Registration + Products
    expect(mail.text).not.toContain("- Registration");
  });

  it("says where to switch it off", () => {
    expect(mail.text).toContain("Settings › Reminders: https://fitron.in/settings?tab=reminders");
  });

  it("calls a negative result a loss, with a minus sign and no percentage", () => {
    const loss = plEmail({ gym: "G", month: "2026-09", name: "", pl: { ...pl, net: -40_000_00, gstCollected: 0, depreciation: 0 }, settingsUrl: "u" });
    expect(loss.text).toContain("Hello there,");
    expect(loss.text).toContain("Net loss: -₹40,000\n");
    expect(loss.text).not.toContain("of revenue");
    expect(loss.text).not.toContain("Depreciation");
    expect(loss.text).not.toContain("GST on your sales");
  });
});

describe("the statement sheet", () => {
  const sheet = plSheet("2026-09", pl);

  it("has a tab named for the month and money in the last column", () => {
    expect(sheet.name).toBe("P&L Sep 2026");
    expect(sheet.columns.map((c) => c.kind)).toEqual([undefined, undefined, "money"]);
  });

  it("lists revenue biggest first, then expenses, with the totals and the result", () => {
    const lines = sheet.rows.map((r) => `${r[0]} | ${r[1]} | ${r[2]}`);
    expect(lines.slice(0, 2)).toEqual(["Revenue | Renewal | 9000000", "Revenue | New | 4000000"]);
    expect(lines).toContain("Revenue | Total revenue | 15600000");
    expect(lines).toContain("Operating expenses | Salaries | 6000000");
    expect(lines).toContain("Operating expenses | Total operating expenses | 9000000");
    expect(sheet.totals).toEqual(["Net profit", null, 5437275]);
  });

  it("shows the adjustments only when there is one, and says which way they go", () => {
    const lines = sheet.rows.map((r) => `${r[0]} | ${r[1]} | ${r[2]}`);
    expect(lines).toContain("Adjustments | Less: depreciation | 1162725");
    expect(lines.join("\n")).not.toContain("asset sales");
    const sold = plSheet("2026-09", { ...pl, depreciation: 0, disposalGain: 500_00, disposalLoss: 200_00 }).rows.map((r) => `${r[1]}`);
    expect(sold).toEqual(expect.arrayContaining(["Add: gain on asset sales", "Less: loss on asset sales"]));
    expect(sold).not.toContain("Less: depreciation");
  });

  it("keeps GST and money received apart from the profit", () => {
    const lines = sheet.rows.map((r) => `${r[0]} | ${r[1]} | ${r[2]}`);
    expect(lines).toContain("Not part of the profit | GST collected on sales | 1800000");
    expect(lines).toContain("Not part of the profit | Money received in the month | 14000000");
  });

  it("revenue and expense lines add up to their totals", () => {
    const sum = (section: string) => sheet.rows.filter((r) => r[0] === section && !String(r[1]).startsWith("Total")).reduce((s, r) => s + Number(r[2]), 0);
    expect(sum("Revenue")).toBe(pl.totalRevenue);
    expect(sum("Operating expenses")).toBe(pl.totalExpenses);
  });
});
