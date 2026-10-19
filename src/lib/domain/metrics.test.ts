import { describe, expect, it } from "vitest";
import { METRICS, agingBucket, avgPaise, cac, ltvEstimate, metric, monthlyChurnPct, monthsBetween, pct, pctChange, percentile, percentileRank, recoveryRate } from "./metrics";

describe("metric registry", () => {
  it("gives every metric a definition, a version, sources and a kind", () => {
    for (const [id, d] of Object.entries(METRICS)) {
      expect(d.id).toBe(id);
      expect(d.definition.length).toBeGreaterThan(20);
      expect(d.version).toBeGreaterThanOrEqual(1);
      expect(d.sources.length).toBeGreaterThan(0);
      expect(["actual", "estimate", "forecast"]).toContain(d.kind);
    }
  });
  it("wraps a value with period, currency, timezone, version and definition", () => {
    const r = metric("fin.revenue", 123456, { from: "2026-10-01", to: "2026-10-31" }, { computedAt: new Date("2026-10-19T10:00:00Z") });
    expect(r).toMatchObject({ id: "fin.revenue", value: 123456, unit: "paise", kind: "actual", currency: "INR", timezone: "Asia/Kolkata", version: 1, computedAt: "2026-10-19T10:00:00.000Z", warnings: [] });
    expect(r.definition).toContain("before GST");
    expect(metric("ltv.estimate", null, { from: "a", to: "b" }).kind).toBe("estimate");
  });
});

describe("shared arithmetic", () => {
  it("percentages say null, never 0, when there is nothing to divide by", () => {
    expect(pct(1, 4)).toBe(25);
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(0, 0)).toBeNull();
    expect(pctChange(110, 100)).toBe(10);
    expect(pctChange(50, -100)).toBe(150);
    expect(pctChange(5, 0)).toBeNull();
  });
  it("averages paise to a whole paisa", () => {
    expect(avgPaise([100, 101])).toBe(101);
    expect(avgPaise([])).toBeNull();
  });
  it("puts overdue days in the fixed ageing buckets", () => {
    expect(agingBucket(0)).toBe("Not yet due");
    expect(agingBucket(1)).toBe("1–30 days");
    expect(agingBucket(30)).toBe("1–30 days");
    expect(agingBucket(31)).toBe("31–60 days");
    expect(agingBucket(90)).toBe("61–90 days");
    expect(agingBucket(91)).toBe("Over 90 days");
  });
  it("states the recovery rate's denominator and caps it at 100", () => {
    expect(recoveryRate(50_000, 100_000, 100_000)).toEqual({ rate: 25, denominator: 200_000 });
    expect(recoveryRate(0, 0, 0)).toEqual({ rate: null, denominator: 0 });
    expect(recoveryRate(300_000, 100_000, 100_000).rate).toBe(100);
  });
  it("counts months of 30.44 days, end inclusive", () => {
    expect(monthsBetween("2026-01-01", "2026-01-31")).toBe(1);
    expect(monthsBetween("2026-01-01", "2026-12-31")).toBe(12);
  });
});

describe("lifetime value estimate", () => {
  const good = { avgMonthlyRevenuePerActive: 150_000, monthlyChurnPct: 5, members: 50, monthsOfHistory: 12 };
  it("is revenue per month over monthly churn", () => {
    expect(ltvEstimate(good)).toEqual({ value: 3_000_000, warnings: [] });
  });
  it("refuses small, young or churn-less data and says why", () => {
    expect(ltvEstimate({ ...good, members: 5 }).value).toBeNull();
    expect(ltvEstimate({ ...good, members: 5 }).warnings[0]).toContain("at least 20 members");
    expect(ltvEstimate({ ...good, monthsOfHistory: 2 }).warnings[0]).toContain("6 months");
    expect(ltvEstimate({ ...good, monthlyChurnPct: 0 }).warnings[0]).toContain("unbounded");
    expect(ltvEstimate({ ...good, monthlyChurnPct: null }).warnings[0]).toContain("No churn");
    expect(ltvEstimate({ ...good, avgMonthlyRevenuePerActive: null }).value).toBeNull();
  });
});

describe("acquisition cost and churn", () => {
  it("needs both spend and joiners", () => {
    expect(cac(300_000, 10)).toEqual({ value: 30_000, warnings: [] });
    expect(cac(0, 10).value).toBeNull();
    expect(cac(300_000, 0).warnings[0]).toContain("No member joined");
  });
  it("turns a period's losses into a monthly churn rate", () => {
    expect(monthlyChurnPct(100, 0, 6)).toBe(0);
    expect(monthlyChurnPct(100, 100, 6)).toBe(100);
    expect(monthlyChurnPct(100, 10, 1)).toBe(10);
    // 10% over 2 months ≈ 5.1% a month
    expect(monthlyChurnPct(100, 10, 2)).toBe(5.1);
    expect(monthlyChurnPct(0, 5, 3)).toBeNull();
  });
});

describe("percentiles", () => {
  it("ranks a value among others with ties split", () => {
    expect(percentileRank(5, [1, 2, 3, 4, 6, 7, 8, 9, 10])).toBe(44);
    expect(percentileRank(5, [5, 5])).toBe(50);
    expect(percentileRank(5, [])).toBeNull();
  });
  it("takes the nearest-rank percentile", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4], 25)).toBe(1);
    expect(percentile([1, 2, 3, 4], 75)).toBe(3);
    expect(percentile([], 50)).toBeNull();
  });
});
