import { describe, expect, it } from "vitest";
import { explanationIsGrounded, findings, score, type GrowthInputs } from "./growth";

const quiet: GrowthInputs = {
  period: { from: "2026-10-01", to: "2026-10-31", label: "Oct 2026" },
  previous: { from: "2026-09-01", to: "2026-09-30", label: "Sep 2026" },
  revenue: 10_000_000,
  revenuePrev: 10_000_000,
  expenses: 6_000_000,
  expensesPrev: 6_000_000,
  net: 4_000_000,
  netPrev: 4_000_000,
  expenseGroups: [{ group: "Utilities", amount: 1_000_000, previous: 1_000_000 }],
  activeMembers: 100,
  activeMembersPrev: 100,
  newMembers: 10,
  newMembersPrev: 10,
  renewal: { ended: 20, renewed: 16, rate: 80 },
  renewalPrev: { ended: 20, renewed: 16, rate: 80 },
  recovery: { outstanding: 100_000, eligible: 100_000, openCases: 1, pendingActions: 1, recoveredInPeriod: 0, rate: null, over90: 0 },
  ltvEstimate: null,
  cac: null,
  atRisk: 2,
  monthsOfHistory: 12,
  bestScenario: null,
};

describe("growth findings", () => {
  it("says nothing when nothing changed", () => {
    expect(findings(quiet)).toEqual([]);
  });
  it("flags a renewal decline only with enough endings on both sides", () => {
    const f = findings({ ...quiet, renewal: { ended: 20, renewed: 12, rate: 60 } });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ rule: "renewals.decline", key: "renewals.decline:2026-10", urgency: "HIGH", impactPaise: null });
    expect(f[0]!.evidence[0]).toMatchObject({ metric: "ltv.renewalRate", value: 60, previous: 80, unit: "pct", kind: "actual" });
    expect(findings({ ...quiet, renewal: { ended: 5, renewed: 3, rate: 60 } })).toEqual([]);
  });
  it("flags a recovery backlog with its eligible balance as the impact, never as recovered revenue", () => {
    const f = findings({ ...quiet, recovery: { outstanding: 900_000, eligible: 800_000, openCases: 6, pendingActions: 4, recoveredInPeriod: 0, rate: 10, over90: 2 } });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ rule: "recovery.backlog", impactPaise: 800_000, urgency: "HIGH", effort: "LOW", link: "/intelligence/recovery" });
    expect(f[0]!.impactNote).toContain("if every case were recovered");
  });
  it("flags an expense group that outgrew revenue, naming the group in the key", () => {
    const f = findings({ ...quiet, expenseGroups: [{ group: "Utilities", amount: 1_500_000, previous: 1_000_000 }] });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ rule: "expense.rise", key: "expense.rise.utilities:2026-10", impactPaise: 500_000 });
    // Revenue grew as fast: no finding.
    expect(findings({ ...quiet, revenue: 15_000_000, expenseGroups: [{ group: "Utilities", amount: 1_500_000, previous: 1_000_000 }] })).toEqual([]);
    // Too small to matter.
    expect(findings({ ...quiet, expenseGroups: [{ group: "Utilities", amount: 150_000, previous: 100_000 }] })).toEqual([]);
  });
  it("flags falling revenue, churn risk, a better scenario and a poor acquisition ratio", () => {
    const f = findings({
      ...quiet,
      revenue: 8_000_000,
      atRisk: 15,
      bestScenario: { id: "s1", name: "Raise prices 5%", extraProfit: 300_000, months: 12 },
      cac: 200_000,
      ltvEstimate: 400_000,
    });
    expect(f.map((x) => x.rule)).toEqual(["revenue.decline", "retention.risk", "scenario.better", "cac.high"]);
    const sc = f.find((x) => x.rule === "scenario.better")!;
    expect(sc.evidence[0]!.kind).toBe("estimate");
    expect(sc.confidence).toBe("LOW");
    expect(sc.link).toBe("/intelligence/simulator/s1");
    expect(findings({ ...quiet, bestScenario: { id: "s1", name: "Worse", extraProfit: -5, months: 12 } })).toEqual([]);
    expect(findings({ ...quiet, cac: 200_000, ltvEstimate: 900_000 })).toEqual([]);
  });
});

describe("ranking", () => {
  it("scores by impact, urgency and confidence, less effort", () => {
    const base = { impactPaise: 100_000, urgency: "MEDIUM" as const, confidence: "MEDIUM" as const, effort: "MEDIUM" as const };
    expect(score({ ...base, urgency: "HIGH" })).toBeGreaterThan(score(base));
    expect(score({ ...base, effort: "HIGH" })).toBeLessThan(score(base));
    expect(score({ ...base, impactPaise: 10_000_000 })).toBeGreaterThan(score(base));
    expect(score({ ...base, impactPaise: null })).toBe(10 + 24 + 16 - 12);
  });
});

describe("grounding a worded explanation", () => {
  const evidence = [{ metric: "fin.revenue", label: "Revenue", value: 1_234_500, previous: 1_000_000, unit: "paise" as const, period: "Oct", kind: "actual" as const }, { metric: "ltv.renewalRate", label: "Renewal", value: 62.5, unit: "pct" as const, period: "Oct", kind: "actual" as const }];
  it("accepts figures that are in the evidence, in rupees or as given", () => {
    expect(explanationIsGrounded("Revenue was ₹12,345 against ₹10,000 and renewals 62.5%.", evidence)).toBe(true);
    expect(explanationIsGrounded("Renewals at 63% are down.", evidence)).toBe(true);
    expect(explanationIsGrounded("No numbers here.", evidence)).toBe(true);
  });
  it("refuses an invented rupee amount or percentage", () => {
    expect(explanationIsGrounded("You could earn ₹50,000 more.", evidence)).toBe(false);
    expect(explanationIsGrounded("Renewals fell 20%.", evidence)).toBe(false);
    expect(explanationIsGrounded("Renewals fell 20%.", evidence, [20])).toBe(true);
  });
});
