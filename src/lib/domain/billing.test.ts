import { describe, expect, it } from "vitest";
import { balanceDue, formatInr, invoiceState, invoiceTotals, lineTaxes } from "./billing";

const plan = { qty: 1, rate: 300_000, discount: 20_000, taxRate: 18 };
const regFee = { qty: 1, rate: 50_000, discount: 0, taxRate: 18 };

describe("invoiceTotals", () => {
  it("applies GST after the line discount", () => {
    // (3000 − 200) + 500 = 3300 taxable; 18% = 594
    expect(invoiceTotals([plan, regFee])).toEqual({
      subtotal: 350_000,
      discount: 20_000,
      tax: 59_400,
      total: 389_400,
    });
  });

  it("rounds tax once for the whole invoice", () => {
    const line = { qty: 1, rate: 1, discount: 0, taxRate: 18 };
    expect(invoiceTotals([line, line, line]).tax).toBe(1); // 0.54 rounds to 1, not 3 × 0
  });
});

describe("lineTaxes", () => {
  const totalOf = (lines: Parameters<typeof invoiceTotals>[0]) => invoiceTotals(lines).tax;

  it("adds up to the invoice's tax", () => {
    const line = { qty: 1, rate: 1, discount: 0, taxRate: 18 };
    const lines = [line, line, line];
    expect(lineTaxes(lines, totalOf(lines))).toEqual([1, 0, 0]); // 1 paise shared out, not 0 + 0 + 0
  });

  it("does not hand out more than the invoice charged", () => {
    // 25 paise at 18% is 4.5 paise a line: 13.5 → 14 on the invoice, but 5 + 5 + 5 = 15 by line.
    const line = { qty: 1, rate: 25, discount: 0, taxRate: 18 };
    const lines = [line, line, line];
    const parts = lineTaxes(lines, totalOf(lines));
    expect(parts.reduce((s, x) => s + x, 0)).toBe(14);
    expect(parts).toEqual([5, 5, 4]);
  });

  it("leaves whole amounts alone", () => {
    const lines = [plan, regFee];
    expect(lineTaxes(lines, totalOf(lines))).toEqual([50_400, 9_000]);
  });

  it("gives the spare paise to the lines that lost the most", () => {
    const lines = [
      { qty: 1, rate: 10, discount: 0, taxRate: 18 }, // 1.8
      { qty: 1, rate: 10, discount: 0, taxRate: 5 }, // 0.5
    ];
    expect(lineTaxes(lines, totalOf(lines))).toEqual([2, 0]); // 2.3 → 2, and 0.8 beats 0.5
  });

  it("charges nothing when there is no tax", () => {
    const lines = [{ qty: 2, rate: 100, discount: 0, taxRate: 0 }];
    expect(lineTaxes(lines, totalOf(lines))).toEqual([0]);
  });
});

describe("invoiceState", () => {
  const invoice = { total: 389_400, cancelled: false, dueDate: "2026-09-20" };

  it("is UNPAID with no payments and counts overdue days", () => {
    expect(invoiceState(invoice, [], "2026-09-27")).toEqual({
      paid: 0,
      balance: 389_400,
      status: "UNPAID",
      overdueDays: 7,
    });
  });

  it("is PARTIALLY_PAID after a part payment", () => {
    const s = invoiceState(invoice, [{ amount: 100_000, status: "SUCCESS" }], "2026-09-10");
    expect(s).toMatchObject({ status: "PARTIALLY_PAID", balance: 289_400, overdueDays: 0 });
  });

  it("becomes PAID once the balance is collected", () => {
    const s = invoiceState(
      invoice,
      [
        { amount: 100_000, status: "SUCCESS" },
        { amount: 289_400, status: "SUCCESS" },
      ],
      "2026-09-27",
    );
    expect(s).toMatchObject({ status: "PAID", balance: 0, overdueDays: 0 });
  });

  it("ignores reversed payments", () => {
    const s = invoiceState(invoice, [{ amount: 389_400, status: "REVERSED" }], "2026-09-10");
    expect(s).toMatchObject({ status: "UNPAID", paid: 0, balance: 389_400 });
  });

  it("has no balance once cancelled", () => {
    const s = invoiceState({ ...invoice, cancelled: true }, [], "2026-09-27");
    expect(s).toEqual({ paid: 0, balance: 0, status: "CANCELLED", overdueDays: 0 });
  });
});

describe("formatInr", () => {
  it("uses Indian digit grouping", () => {
    expect(formatInr(123_456_789)).toBe("₹12,34,567.89");
  });
});

describe("round-off", () => {
  const gst = { total: 255_706, cancelled: false, dueDate: "2026-10-01" };
  it("settles an invoice when less than a rupee is left after a payment", () => {
    // ₹2,557.06 paid as ₹2,557: nobody can hand over six paise, so it is paid, not part paid.
    expect(invoiceState(gst, [{ amount: 255_700, status: "SUCCESS" }], "2026-10-10")).toMatchObject({ status: "PAID", balance: 0, overdueDays: 0 });
    expect(balanceDue(255_706, 255_700)).toBe(0);
  });
  it("still shows a rupee or more as owed, and an unpaid invoice of paise as unpaid", () => {
    expect(invoiceState(gst, [{ amount: 255_600, status: "SUCCESS" }], "2026-10-10")).toMatchObject({ status: "PARTIALLY_PAID", balance: 106 });
    expect(invoiceState({ ...gst, total: 50 }, [], "2026-10-10")).toMatchObject({ status: "UNPAID", balance: 50 });
    expect(invoiceState(gst, [{ amount: 255_700, status: "REVERSED" }], "2026-10-10")).toMatchObject({ status: "UNPAID", balance: 255_706 });
  });
});
