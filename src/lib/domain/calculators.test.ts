import { describe, expect, it } from "vitest";
import { invoiceTotals } from "./billing";
import { ACTIVITY, breakEven, calories, checkChurn, checkGst, checkProtein, churn, gstOnMembership, gymPricing, gymProfit, membershipRevenue, proteinTarget } from "./calculators";

describe("GST on a gym membership", () => {
  it("adds 18% to a price without GST and splits it in two for a sale inside the state", () => {
    expect(gstOnMembership({ amount: 5000, inclusive: false, ratePct: 18, supply: "same-state" })).toEqual({ base: 5000, tax: 900, cgst: 450, sgst: 450, igst: 0, total: 5900 });
  });
  it("takes GST out of a price that includes it", () => {
    const r = gstOnMembership({ amount: 5900, inclusive: true, ratePct: 18, supply: "same-state" });
    expect(r).toMatchObject({ base: 5000, tax: 900, total: 5900 });
  });
  it("charges IGST, not CGST and SGST, on a sale to another state", () => {
    expect(gstOnMembership({ amount: 1000, inclusive: false, ratePct: 18, supply: "other-state" })).toMatchObject({ cgst: 0, sgst: 0, igst: 180, total: 1180 });
  });
  it("always adds up: base + tax = total, and the halves make the tax, to the paisa", () => {
    for (const amount of [99.99, 1234.56, 4999, 0.01, 12345.67]) {
      for (const inclusive of [true, false]) {
        const r = gstOnMembership({ amount, inclusive, ratePct: 18, supply: "same-state" });
        expect(Math.round((r.base + r.tax) * 100), `${amount} ${inclusive}`).toBe(Math.round(r.total * 100));
        expect(Math.round((r.cgst + r.sgst) * 100)).toBe(Math.round(r.tax * 100));
      }
    }
  });
  it("matches the console's invoice for the same price", () => {
    const base = 4237.29;
    const inv = invoiceTotals([{ qty: 1, rate: Math.round(base * 100), discount: 0, taxRate: 18 }]);
    const r = gstOnMembership({ amount: base, inclusive: false, ratePct: 18, supply: "same-state" });
    expect(Math.round(r.tax * 100)).toBe(inv.tax);
    expect(Math.round(r.total * 100)).toBe(inv.total);
  });
  it("refuses a missing or absurd amount", () => {
    expect(checkGst({ amount: NaN, inclusive: true, ratePct: 18, supply: "same-state" }).ok).toBe(false);
    expect(checkGst({ amount: 100, inclusive: true, ratePct: 90, supply: "same-state" }).ok).toBe(false);
  });
});

describe("gym profit", () => {
  const base = { members: 100, avgFee: 1000, otherIncome: 0, includesGst: false, gstRatePct: 18, rent: 40_000, salaries: 30_000, utilities: 8_000, marketing: 5_000, maintenance: 5_000, other: 2_000 };
  it("is revenue minus costs", () => {
    expect(gymProfit(base)).toMatchObject({ revenue: 100_000, expenses: 90_000, profit: 10_000, marginPct: 10, profitPerMember: 100, breakEvenMembers: 90 });
  });
  it("does not count the GST that fees include as the gym's income", () => {
    const r = gymProfit({ ...base, includesGst: true, avgFee: 1180 });
    expect(r.revenue).toBe(100_000);
  });
  it("shows a loss as negative and does not divide by zero", () => {
    expect(gymProfit({ ...base, members: 0 })).toMatchObject({ revenue: 0, profit: -90_000, marginPct: 0, profitPerMember: 0 });
  });
});

describe("membership revenue", () => {
  it("spreads each plan's price over the months it covers", () => {
    const r = membershipRevenue([
      { name: "Monthly", members: 50, price: 1000, months: 1 },
      { name: "Annual", members: 10, price: 9600, months: 12 },
    ]);
    expect(r.monthly).toBe(58_000);
    expect(r.yearly).toBe(696_000);
    expect(r.membersTotal).toBe(60);
    expect(r.lines.map((l) => l.sharePct)).toEqual([86.21, 13.79]);
    expect(r.cashPerCycle).toBe(146_000);
  });
});

describe("break-even", () => {
  it("needs enough members to cover the fixed costs from what is left of each fee", () => {
    const r = breakEven({ fixedCosts: 90_000, feePerMember: 1000, costPerMember: 100, currentMembers: 120, setupInvestment: 500_000 });
    expect(r).toMatchObject({ contribution: 900, membersNeeded: 100, revenueNeeded: 100_000, monthlyProfit: 18_000, paybackMonths: 28 });
  });
  it("says there is no break-even when a member costs more than they pay", () => {
    expect(breakEven({ fixedCosts: 10_000, feePerMember: 500, costPerMember: 600, currentMembers: 10, setupInvestment: 0 })).toMatchObject({ membersNeeded: null, revenueNeeded: null, paybackMonths: null });
  });
});

describe("churn", () => {
  it("is members lost from those you started with", () => {
    expect(churn({ start: 200, lost: 20, joined: 30, months: 1, avgFee: 1000 })).toMatchObject({ periodChurnPct: 10, monthlyChurnPct: 10, retentionPct: 90, lifetimeMonths: 10, end: 210, revenueLostMonthly: 20_000 });
  });
  it("turns a longer period into a monthly rate", () => {
    const r = churn({ start: 100, lost: 27, joined: 0, months: 3, avgFee: 1000 });
    expect(r.periodChurnPct).toBe(27);
    expect(r.monthlyChurnPct).toBe(9.96);
  });
  it("refuses more members lost than there were", () => {
    expect(checkChurn({ start: 10, lost: 11, joined: 0, months: 1, avgFee: 0 }).ok).toBe(false);
  });
  it("has no lifetime when nobody left", () => {
    expect(churn({ start: 50, lost: 0, joined: 5, months: 1, avgFee: 800 }).lifetimeMonths).toBeNull();
  });
});

describe("pricing", () => {
  it("finds the monthly fee that covers costs and profit, then the plan prices with GST", () => {
    const r = gymPricing({ monthlyCosts: 90_000, targetProfit: 30_000, members: 120, gstRatePct: 18, discount3: 5, discount6: 10, discount12: 15 });
    expect(r.feeExGst).toBe(1000);
    expect(r.feeWithGst).toBe(1180);
    expect(r.plans).toEqual([
      { months: 1, discountPct: 0, priceWithGst: 1180, perMonthWithGst: 1180 },
      { months: 3, discountPct: 5, priceWithGst: 3363, perMonthWithGst: 1121 },
      { months: 6, discountPct: 10, priceWithGst: 6372, perMonthWithGst: 1062 },
      { months: 12, discountPct: 15, priceWithGst: 12_036, perMonthWithGst: 1003 },
    ]);
  });
});

describe("protein", () => {
  it("is grams per kilo by goal, split over the day's meals", () => {
    expect(proteinTarget(70, "muscle", 4)).toEqual({ min: 112, max: 140, perKgMin: 1.6, perKgMax: 2, perMealMin: 28, perMealMax: 35 });
  });
  it("starts at the usual recommendation for someone who barely trains", () => {
    expect(proteinTarget(60, "basic", 3).min).toBe(48);
  });
  it("refuses a weight that is not a person's", () => {
    expect(checkProtein(5).ok).toBe(false);
    expect(checkProtein(70).ok).toBe(true);
  });
});

describe("calories", () => {
  it("uses the Mifflin-St Jeor equation, the activity factor and the goal", () => {
    // 10×70 + 6.25×175 − 5×30 + 5 = 1648.75
    const r = calories({ sex: "male", age: 30, heightCm: 175, weightKg: 70, activity: "moderate", goal: "lose" });
    expect(r.bmr).toBe(1649);
    expect(r.maintenance).toBe(Math.round(1648.75 * ACTIVITY.moderate.factor));
    expect(r.target).toBe(Math.round(1648.75 * 1.55 - 500));
    expect(r.belowFloor).toBe(false);
  });
  it("warns when the target is lower than is advised without supervision", () => {
    const r = calories({ sex: "female", age: 45, heightCm: 150, weightKg: 45, activity: "sedentary", goal: "lose" });
    expect(r.belowFloor).toBe(true);
    expect(r.floor).toBe(1200);
  });
});
