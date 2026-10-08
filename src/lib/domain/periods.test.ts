import { describe, expect, it } from "vitest";
import { monthEnd, monthsBack, periodRange, weekStart } from "./periods";

describe("dashboard periods", () => {
  const today = "2026-10-02"; // a Friday

  it("matches the prototype's ranges", () => {
    expect(periodRange("today", today)).toEqual({ from: today, to: today, label: "today" });
    expect(periodRange("week", today)).toEqual({ from: "2026-09-28", to: today, label: "this week" });
    expect(periodRange("month", today)).toEqual({ from: "2026-10-01", to: today, label: "Oct 2026" });
    expect(periodRange("last", today)).toEqual({ from: "2026-09-01", to: "2026-09-30", label: "Sep 2026" });
    expect(periodRange("quarter", today)).toEqual({ from: "2026-10-01", to: today, label: "this quarter" });
    expect(periodRange("year", today)).toEqual({ from: "2026-04-01", to: today, label: "FY 2026–27" });
    expect(periodRange("year", "2027-02-10").from).toBe("2026-04-01");
    expect(periodRange("last", "2026-01-15")).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("orders and validates custom dates", () => {
    expect(periodRange("custom", today, "2026-09-10", "2026-09-01")).toEqual({ from: "2026-09-01", to: "2026-09-10", label: "1 Sep – 10 Sep" });
    expect(periodRange("custom", today, "nonsense", "")).toMatchObject({ from: today, to: today });
  });

  it("weeks start on Monday", () => {
    expect(weekStart("2026-09-28")).toBe("2026-09-28");
    expect(weekStart("2026-10-04")).toBe("2026-09-28");
  });

  it("lists 12 months ending this month", () => {
    const m = monthsBack(today);
    expect(m).toHaveLength(12);
    expect([m[0], m[11]]).toEqual(["2025-11", "2026-10"]);
    expect(monthEnd("2026-02")).toBe("2026-02-28");
  });
});
