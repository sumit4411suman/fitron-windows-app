import { describe, expect, it } from "vitest";
import { commissionFor, netPay, outstanding, payrollMonths, recoverAdvances, salaryCategory, salaryLabel } from "./payroll";

describe("payroll", () => {
  it("netPay", () => {
    expect(netPay({ base: 1800000, commission: 120000, bonus: 50000, deductions: 30000, advance: 200000 })).toBe(1740000);
    expect(netPay({ base: 100, commission: 0, bonus: 0, deductions: 500, advance: 0 })).toBe(-400);
  });
  it("commission rounds to the paisa", () => expect(commissionFor(123456, 40)).toBe(49382));
  it("recovers oldest first", () => {
    const a = [{ id: "1", amount: 1000, recovered: 0 }, { id: "2", amount: 500, recovered: 100 }, { id: "3", amount: 700, recovered: 0 }];
    expect(recoverAdvances(a, 1200)).toEqual([{ id: "1", recover: 1000, settled: true }, { id: "2", recover: 200, settled: false }]);
    expect(recoverAdvances(a, 99999).reduce((s, r) => s + r.recover, 0)).toBe(2100);
    expect(recoverAdvances(a, 0)).toEqual([]);
  });
  it("months newest first", () => {
    expect(payrollMonths("2026-10-04")).toEqual(["2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05"]);
    expect(payrollMonths("2026-01-15")[0]).toBe("2026-01");
    expect(payrollMonths("2026-01-15")[2]).toBe("2025-11");
  });
  it("category and label", () => {
    expect(salaryCategory("Trainer")).toBe("trainer-salary");
    expect(salaryCategory("Admin")).toBe("staff-salary");
    expect(salaryLabel("Super Admin", 5)).toBe("Owner");
    expect(salaryLabel("Trainer", 0)).toBe("Not set");
    expect(salaryLabel("Trainer", 1800000)).toBe("₹18,000/month");
  });
  it("outstanding", () => expect(outstanding([{ id: "a", amount: 1000, recovered: 400 }, { id: "b", amount: 500, recovered: 500 }])).toBe(600));
});
