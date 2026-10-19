import { describe, expect, it } from "vitest";
import { SIM_CALC_VERSION, avgMonthlyFee, checkInputs, compareWithActual, emptyInputs, parseInputs, sensitivity, simulate, threeScenarios, variant, type SimInputs } from "./simulator";

/** A 100-member gym: ₹1,500 a month incl. GST, ₹60,000 of fixed costs, no joiners or leavers. */
const steady: SimInputs = {
  ...emptyInputs(1),
  months: 3,
  plans: [{ name: "Monthly", members: 100, price: 150_000, months: 1, discountPct: 0 }],
  pricesIncludeGst: true,
  gstRatePct: 18,
  fixed: { rent: 3_000_000, utilities: 1_000_000, salaries: 2_000_000, marketing: 0, maintenance: 0, software: 0, other: 0 },
};

describe("inputs", () => {
  it("are checked field by field", () => {
    expect(checkInputs(steady)).toEqual({ ok: true });
    expect(checkInputs({ ...steady, months: 0 })).toEqual({ ok: false, error: expect.stringContaining("Forecast months") });
    expect(checkInputs({ ...steady, plans: [] })).toEqual({ ok: false, error: "Add at least one plan." });
    expect(checkInputs({ ...steady, monthlyChurnPct: 120 })).toEqual({ ok: false, error: expect.stringContaining("Monthly churn") });
    expect(checkInputs({ ...steady, seasonality: [1, 1] })).toEqual({ ok: false, error: "Seasonality needs twelve months." });
    expect(checkInputs({ ...steady, fixed: { ...steady.fixed, rent: NaN } })).toEqual({ ok: false, error: expect.stringContaining("Rent") });
  });
  it("come back from JSON with every field defaulted and clamped", () => {
    const p = parseInputs({ months: "6", plans: [{ name: "X", members: "10", price: 1000 }], fixed: { rent: 5 }, seasonality: [1, 2] }, 4);
    expect(p.months).toBe(6);
    expect(p.plans).toEqual([{ name: "X", members: 10, price: 1000, months: 1, discountPct: 0 }]);
    expect(p.fixed.rent).toBe(5);
    expect(p.fixed.other).toBe(0);
    expect(p.seasonality).toHaveLength(12);
    expect(p.startMonth).toBe(4);
    expect(parseInputs(null).plans).toEqual([]);
  });
});

describe("fees", () => {
  it("takes GST out of an inclusive price the way an invoice does and weights by members", () => {
    expect(avgMonthlyFee(steady)).toBe(127_119); // 150000 × 100 / 118
    expect(avgMonthlyFee({ ...steady, pricesIncludeGst: false })).toBe(150_000);
    const mixed = { ...steady, plans: [{ name: "M", members: 1, price: 100_000, months: 1, discountPct: 0 }, { name: "Y", members: 3, price: 960_000, months: 12, discountPct: 0 }], pricesIncludeGst: false };
    expect(avgMonthlyFee(mixed)).toBe(85_000); // (100000 + 3 × 80000) / 4
    expect(avgMonthlyFee({ ...steady, plans: [{ name: "M", members: 0, price: 120_000, months: 1, discountPct: 50 }], pricesIncludeGst: false })).toBe(60_000);
    expect(avgMonthlyFee({ ...steady, plans: [] })).toBe(0);
  });
});

describe("a steady gym", () => {
  const r = simulate(steady);
  it("earns the fee on every member each month, before GST", () => {
    expect(r.calcVersion).toBe(SIM_CALC_VERSION);
    expect(r.months).toHaveLength(3);
    expect(r.months[0]).toMatchObject({ activeStart: 100, joined: 0, left: 0, activeEnd: 100, revenue: 12_711_900, gst: 2_288_142, fixedCosts: 6_000_000, operatingExpenses: 6_000_000, operatingProfit: 6_711_900, tax: 0 });
    expect(r.totals.revenue).toBe(3 * 12_711_900);
    expect(r.totals.operatingProfit).toBe(3 * 6_711_900);
    expect(r.operatingMarginPct).toBe(52.8);
  });
  it("breaks even where contribution covers the fixed costs", () => {
    expect(r.contributionPerMember).toBe(127_119);
    expect(r.breakEvenMembers).toBe(48); // ceil(6,000,000 / 127,119)
    expect(r.breakEvenRevenue).toBe(48 * 127_119);
  });
  it("names the fee that reaches a target profit, and the plan prices it means", () => {
    const t = simulate({ ...steady, targetProfitMonthly: 1_000_000 });
    // (6,000,000 + 1,000,000) / 100 members
    expect(t.minFeeForTarget).toBe(70_000);
    expect(t.minPriceByPlan).toEqual([{ name: "Monthly", price: 82_600 }]); // × 1.18
  });
  it("keeps cash and accrual apart: cash in includes GST, cash out pays it over", () => {
    const m = r.months[0]!;
    expect(m.cashIn).toBe(12_711_900 + 2_288_142);
    expect(m.cashOut).toBe(6_000_000 + 2_288_142);
    expect(m.netCash).toBe(m.operatingProfit);
  });
  it("is deterministic", () => {
    expect(simulate(steady)).toEqual(r);
  });
});

describe("movement, costs and tax", () => {
  it("loses and gains members each month and earns on the average", () => {
    const r = simulate({ ...steady, months: 2, monthlyChurnPct: 10, newMembersPerMonth: 5, pricesIncludeGst: false });
    expect(r.months[0]).toMatchObject({ activeStart: 100, left: 10, joined: 5, activeEnd: 95, revenue: 97.5 * 150_000 });
    expect(r.months[1]).toMatchObject({ activeStart: 95, left: 10, joined: 5, activeEnd: 90 });
    expect(r.totals.joined).toBe(10);
    expect(r.totals.left).toBe(20);
    expect(r.totals.activeEnd).toBe(90);
  });
  it("charges variable costs per member, payment fees on collections, refunds on revenue and tax on a profit", () => {
    const r = simulate({ ...steady, months: 1, pricesIncludeGst: false, gstRatePct: 0, variablePerMember: 10_000, paymentFeePct: 2, refundPct: 1, taxPct: 25 });
    const m = r.months[0]!;
    expect(m.revenue).toBe(15_000_000);
    expect(m.refunds).toBe(150_000);
    expect(m.variableCosts).toBe(1_000_000);
    expect(m.paymentFees).toBe(297_000); // 2% of (15,000,000 − 150,000)
    expect(m.operatingProfit).toBe(15_000_000 - 150_000 - 6_000_000 - 1_000_000 - 297_000);
    expect(m.tax).toBe(Math.round(m.operatingProfit * 0.25));
    expect(m.netProfit).toBe(m.operatingProfit - m.tax);
  });
  it("never taxes a loss and reports negative profit, zero revenue and an impossible break-even safely", () => {
    const r = simulate({ ...steady, months: 1, plans: [{ name: "Free", members: 50, price: 0, months: 1, discountPct: 0 }], taxPct: 30 });
    expect(r.months[0]!.revenue).toBe(0);
    expect(r.months[0]!.operatingProfit).toBe(-6_000_000);
    expect(r.months[0]!.tax).toBe(0);
    expect(r.operatingMarginPct).toBeNull();
    expect(r.breakEvenMembers).toBeNull();
    expect(r.minFeeForTarget).toBe(120_000); // 6,000,000 / 50
    expect(r.notes[0]).toContain("costs more to serve");
  });
  it("applies seasonality to fees, other income and joiners", () => {
    const s = [...steady.seasonality];
    s[0] = 0.5;
    const r = simulate({ ...steady, months: 1, pricesIncludeGst: false, otherIncomeMonthly: 100_000, newMembersPerMonth: 10, seasonality: s, startMonth: 1 });
    expect(r.months[0]!.joined).toBe(5);
    expect(r.months[0]!.otherIncome).toBe(50_000);
    expect(r.months[0]!.revenue).toBe(Math.round(102.5 * 150_000 * 0.5));
    expect(r.months[0]!.month).toBe(1);
    expect(simulate({ ...steady, startMonth: 11 }).months.map((m) => m.month)).toEqual([11, 12, 1]);
  });
});

describe("scenarios and sensitivity", () => {
  it("makes a conservative and an optimistic variant around the baseline", () => {
    const i = { ...steady, newMembersPerMonth: 10, monthlyChurnPct: 5 };
    expect(variant(i, "baseline")).toBe(i);
    expect(variant(i, "conservative")).toMatchObject({ newMembersPerMonth: 8, monthlyChurnPct: 7, fixed: { rent: 3_150_000 } });
    expect(variant(i, "optimistic")).toMatchObject({ newMembersPerMonth: 12, monthlyChurnPct: 3, fixed: { rent: 2_850_000 } });
    const t = threeScenarios(i);
    expect(t.conservative.totals.operatingProfit).toBeLessThan(t.baseline.totals.operatingProfit);
    expect(t.optimistic.totals.operatingProfit).toBeGreaterThan(t.baseline.totals.operatingProfit);
  });
  it("shows what each assumption does to the profit, one at a time", () => {
    const rows = sensitivity(steady);
    expect(rows).toHaveLength(10);
    const up = rows.find((r) => r.label === "Prices" && r.change === "+10%")!;
    expect(up.delta).toBeGreaterThan(0);
    expect(rows.find((r) => r.label === "Fixed costs" && r.change === "+10%")!.delta).toBe(-1_800_000);
    expect(rows.find((r) => r.label === "Monthly churn" && r.change === "−2 points")!.delta).toBe(0); // churn was 0 already
  });
  it("compares a forecast month with the books", () => {
    const c = compareWithActual({ revenue: 100, operatingExpenses: 60, operatingProfit: 40, activeEnd: 10 }, { revenue: 120, expenses: 60, net: 60, activeMembers: 9 });
    expect(c[0]).toEqual({ label: "Revenue", forecast: 100, actual: 120, delta: 20, deltaPct: 20 });
    expect(c[3]).toMatchObject({ label: "Active members", delta: -1, deltaPct: -10 });
    expect(compareWithActual({ revenue: 0, operatingExpenses: 0, operatingProfit: 0, activeEnd: 0 }, { revenue: 5, expenses: 0, net: 5, activeMembers: 0 })[0]!.deltaPct).toBeNull();
  });
});
