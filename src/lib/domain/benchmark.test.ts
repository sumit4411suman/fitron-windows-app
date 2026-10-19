import { describe, expect, it } from "vitest";
import { BENCH_METRICS, MIN_COHORT_GYMS, MIN_PERCENTILE_SAMPLE, branchChange, cohortLargeEnough, comparePeers, rankBranches, sizeBand, type BenchMetricKey } from "./benchmark";

const m = (over: Partial<Record<BenchMetricKey, number | null>>): Record<BenchMetricKey, number | null> => ({ revenue: null, activeMembers: null, revenuePerActive: null, renewalRate: null, expenseRatio: null, operatingMargin: null, cac: null, newMembers: null, ...over });

describe("branch ranking", () => {
  it("ranks by each metric's own direction and leaves missing figures unranked", () => {
    const rows = rankBranches([
      { id: "a", name: "A", metrics: m({ revenue: 100, expenseRatio: 50, cac: null }) },
      { id: "b", name: "B", metrics: m({ revenue: 300, expenseRatio: 70, cac: 10 }) },
      { id: "c", name: "C", metrics: m({ revenue: 200, expenseRatio: 60, cac: 20 }) },
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.id, r.rank]));
    expect([by.a!.revenue, by.b!.revenue, by.c!.revenue]).toEqual([3, 1, 2]);
    expect([by.a!.expenseRatio, by.b!.expenseRatio, by.c!.expenseRatio]).toEqual([1, 3, 2]);
    expect([by.a!.cac, by.b!.cac, by.c!.cac]).toEqual([null, 1, 2]);
    expect(by.a!.renewalRate).toBeNull();
  });
  it("reports the change between two periods per metric", () => {
    const c = branchChange(m({ revenue: 120, renewalRate: 50, activeMembers: 0 }), m({ revenue: 100, renewalRate: null, activeMembers: 0 }));
    expect(c.revenue).toBe(20);
    expect(c.renewalRate).toBeNull();
    expect(c.activeMembers).toBeNull();
  });
  it("defines every metric", () => {
    for (const b of BENCH_METRICS) expect(b.definition.length).toBeGreaterThan(10);
  });
});

describe("external benchmarking safeguards", () => {
  const peers = Array.from({ length: 12 }, (_, i) => ({ orgId: `g${i}`, metrics: { revenuePerActive: (i + 1) * 1000, expenseRatio: 40 + i, renewalRate: i < 5 ? 50 + i : null } }));
  it("needs a large enough cohort and sample", () => {
    expect(cohortLargeEnough(MIN_COHORT_GYMS - 1)).toBe(false);
    expect(cohortLargeEnough(MIN_COHORT_GYMS)).toBe(true);
    expect(MIN_PERCENTILE_SAMPLE).toBeGreaterThanOrEqual(10);
  });
  it("compares the gym with its peers, never counting the gym itself, and suppresses thin metrics", () => {
    const out = comparePeers({ revenuePerActive: 6500, expenseRatio: 45, renewalRate: 55 }, [...peers, { orgId: "me", metrics: { revenuePerActive: 1 } }], "me");
    const rpa = out.find((o) => o.key === "revenuePerActive")!;
    expect(rpa).toMatchObject({ sample: 12, p25: 3000, median: 6000, p75: 9000, percentile: 50, unavailable: null });
    const er = out.find((o) => o.key === "expenseRatio")!;
    // Lower is better: 45 sits above 5 of 12 peers (40–44) and ties one, so the "good" percentile is 100 − rank.
    expect(er.percentile).toBe(100 - Math.round((5.5 / 12) * 100));
    const rr = out.find((o) => o.key === "renewalRate")!;
    expect(rr.percentile).toBeNull();
    expect(rr.unavailable).toContain("at least 10 other gyms");
    const none = out.find((o) => o.key === "cac")!;
    expect(none.sample).toBe(0);
  });
  it("says when the gym's own figure is missing", () => {
    const out = comparePeers({}, peers, "me");
    expect(out.find((o) => o.key === "revenuePerActive")!.unavailable).toContain("Your own figure");
  });
  it("puts gyms in size bands", () => {
    expect(sizeBand(0)).toBe("xs");
    expect(sizeBand(50)).toBe("xs");
    expect(sizeBand(51)).toBe("s");
    expect(sizeBand(400)).toBe("m");
    expect(sizeBand(5000)).toBe("xl");
  });
});
