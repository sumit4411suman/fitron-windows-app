import { invoiceTotals } from "./billing";

// The maths behind the free calculators on fitron.in/tools. Plain functions with no screen in them, so each can be
// tested and each page can say exactly what it does. Amounts are in rupees (the pages' inputs), rounded to paise;
// GST goes through the same invoice function the console uses, so a figure here matches an invoice there.

const paise = (rupees: number) => Math.round(rupees * 100);
const rupees = (p: number) => p / 100;
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type Check = { ok: true } | { ok: false; error: string };
const need = (label: string, v: number, min: number, max: number, whole = false): string | null => {
  if (!Number.isFinite(v)) return `Enter ${label}.`;
  if (v < min || v > max) return `${label[0]!.toUpperCase()}${label.slice(1)} should be between ${min.toLocaleString("en-IN")} and ${max.toLocaleString("en-IN")}.`;
  if (whole && !Number.isInteger(v)) return `${label[0]!.toUpperCase()}${label.slice(1)} should be a whole number.`;
  return null;
};
const firstError = (...e: (string | null)[]): Check => {
  const found = e.find((x) => x);
  return found ? { ok: false, error: found } : { ok: true };
};

// ---------------------------------------------------------------- GST on a gym membership

export type GstInput = { amount: number; inclusive: boolean; ratePct: number; supply: "same-state" | "other-state" };
export type GstResult = { base: number; tax: number; cgst: number; sgst: number; igst: number; total: number };

export const checkGst = (i: GstInput) => firstError(need("the amount", i.amount, 0.01, 10_000_000), need("the GST rate", i.ratePct, 0, 40));

/** Splits or adds GST. A price that includes GST is split the way FITRON's invoices split it: the tax is what is left of the total. */
export function gstOnMembership(i: GstInput): GstResult {
  const amount = paise(i.amount);
  let base: number;
  let tax: number;
  if (i.inclusive) {
    base = Math.round((amount * 100) / (100 + i.ratePct));
    tax = amount - base;
  } else {
    base = amount;
    tax = invoiceTotals([{ qty: 1, rate: base, discount: 0, taxRate: i.ratePct }]).tax;
  }
  const same = i.supply === "same-state";
  // An odd paisa goes to SGST, so the halves add up to the tax.
  const cgst = same ? Math.floor(tax / 2) : 0;
  const sgst = same ? tax - cgst : 0;
  return { base: rupees(base), tax: rupees(tax), cgst: rupees(cgst), sgst: rupees(sgst), igst: same ? 0 : rupees(tax), total: rupees(base + tax) };
}

// ---------------------------------------------------------------- Gym profit

export type ProfitInput = {
  members: number;
  avgFee: number;
  otherIncome: number;
  includesGst: boolean;
  gstRatePct: number;
  rent: number;
  salaries: number;
  utilities: number;
  marketing: number;
  maintenance: number;
  other: number;
};
export type ProfitResult = { revenue: number; expenses: number; profit: number; marginPct: number; profitPerMember: number; breakEvenMembers: number | null };

export const checkProfit = (i: ProfitInput) =>
  firstError(
    need("the number of members", i.members, 0, 100_000, true),
    need("the average monthly fee", i.avgFee, 0, 1_000_000),
    need("other income", i.otherIncome, 0, 100_000_000),
    need("the GST rate", i.gstRatePct, 0, 40),
    ...([["rent", i.rent], ["salaries", i.salaries], ["utilities", i.utilities], ["marketing", i.marketing], ["maintenance", i.maintenance], ["other costs", i.other]] as const).map(([l, v]) => need(l, v, 0, 100_000_000)),
  );

/** Monthly profit. Revenue is counted without GST, because the GST a gym collects is the government's money, not the gym's. */
export function gymProfit(i: ProfitInput): ProfitResult {
  const exGst = (x: number) => (i.includesGst ? x / (1 + i.gstRatePct / 100) : x);
  const feeNet = exGst(i.avgFee);
  const otherNet = exGst(i.otherIncome);
  const revenue = i.members * feeNet + otherNet;
  const expenses = i.rent + i.salaries + i.utilities + i.marketing + i.maintenance + i.other;
  const profit = revenue - expenses;
  return {
    revenue: round2(revenue),
    expenses: round2(expenses),
    profit: round2(profit),
    marginPct: revenue > 0 ? round2((profit / revenue) * 100) : 0,
    profitPerMember: i.members > 0 ? round2(profit / i.members) : 0,
    breakEvenMembers: feeNet > 0 ? Math.max(0, Math.ceil((expenses - otherNet) / feeNet)) : null,
  };
}

// ---------------------------------------------------------------- Membership revenue

export type PlanLine = { name: string; members: number; price: number; months: number };
export type RevenueResult = { lines: { name: string; monthly: number; sharePct: number }[]; monthly: number; yearly: number; membersTotal: number; cashPerCycle: number };

export const checkRevenue = (plans: readonly PlanLine[]) =>
  firstError(
    plans.some((p) => p.members > 0) ? null : "Enter the number of members on at least one plan.",
    ...plans.flatMap((p) => [need(`${p.name}: members`, p.members, 0, 100_000, true), need(`${p.name}: price`, p.price, 0, 10_000_000), need(`${p.name}: months`, p.months, 1, 36, true)]),
  );

/** What the members on each plan are worth per month: the price spread over the months it covers. Prices are what members pay. */
export function membershipRevenue(plans: readonly PlanLine[]): RevenueResult {
  const monthlyOf = (p: PlanLine) => (p.members * p.price) / p.months;
  const monthly = plans.reduce((s, p) => s + monthlyOf(p), 0);
  return {
    lines: plans.map((p) => ({ name: p.name, monthly: round2(monthlyOf(p)), sharePct: monthly > 0 ? round2((monthlyOf(p) / monthly) * 100) : 0 })),
    monthly: round2(monthly),
    yearly: round2(monthly * 12),
    membersTotal: plans.reduce((s, p) => s + p.members, 0),
    cashPerCycle: round2(plans.reduce((s, p) => s + p.members * p.price, 0)),
  };
}

// ---------------------------------------------------------------- Break-even

export type BreakEvenInput = { fixedCosts: number; feePerMember: number; costPerMember: number; currentMembers: number; setupInvestment: number };
export type BreakEvenResult = { contribution: number; membersNeeded: number | null; revenueNeeded: number | null; monthlyProfit: number; paybackMonths: number | null };

export const checkBreakEven = (i: BreakEvenInput) =>
  firstError(
    need("the fixed costs", i.fixedCosts, 0, 100_000_000),
    need("the fee per member", i.feePerMember, 0, 1_000_000),
    need("the cost per member", i.costPerMember, 0, 1_000_000),
    need("the current number of members", i.currentMembers, 0, 100_000, true),
    need("the set-up investment", i.setupInvestment, 0, 1_000_000_000),
  );

/** Members needed so the fees left after each member's own cost cover the fixed costs. Fees are counted without GST. */
export function breakEven(i: BreakEvenInput): BreakEvenResult {
  const contribution = i.feePerMember - i.costPerMember;
  const membersNeeded = contribution > 0 ? Math.ceil(i.fixedCosts / contribution) : null;
  const monthlyProfit = i.currentMembers * contribution - i.fixedCosts;
  return {
    contribution: round2(contribution),
    membersNeeded,
    revenueNeeded: membersNeeded === null ? null : round2(membersNeeded * i.feePerMember),
    monthlyProfit: round2(monthlyProfit),
    paybackMonths: i.setupInvestment > 0 && monthlyProfit > 0 ? Math.ceil(i.setupInvestment / monthlyProfit) : null,
  };
}

// ---------------------------------------------------------------- Churn

export type ChurnInput = { start: number; lost: number; joined: number; months: number; avgFee: number };
export type ChurnResult = { periodChurnPct: number; monthlyChurnPct: number; retentionPct: number; lifetimeMonths: number | null; end: number; revenueLostMonthly: number };

export const checkChurn = (i: ChurnInput) =>
  firstError(
    need("the members at the start", i.start, 1, 1_000_000, true),
    need("the members lost", i.lost, 0, 1_000_000, true),
    i.lost > i.start ? "Members lost cannot be more than the members you started with." : null,
    need("the new members", i.joined, 0, 1_000_000, true),
    need("the number of months", i.months, 1, 60, true),
    need("the average monthly fee", i.avgFee, 0, 1_000_000),
  );

/** Churn is members lost from those you started with (new joiners are not counted: they were not there to leave). */
export function churn(i: ChurnInput): ChurnResult {
  const period = i.lost / i.start;
  const monthly = period >= 1 ? 1 : 1 - Math.pow(1 - period, 1 / i.months);
  return {
    periodChurnPct: round2(period * 100),
    monthlyChurnPct: round2(monthly * 100),
    retentionPct: round2((1 - period) * 100),
    lifetimeMonths: monthly > 0 ? round2(1 / monthly) : null,
    end: i.start - i.lost + i.joined,
    revenueLostMonthly: round2((i.lost / i.months) * i.avgFee),
  };
}

// ---------------------------------------------------------------- Pricing

export type PricingInput = { monthlyCosts: number; targetProfit: number; members: number; gstRatePct: number; discount3: number; discount6: number; discount12: number };
export type PricingResult = { feeExGst: number; feeWithGst: number; plans: { months: number; discountPct: number; priceWithGst: number; perMonthWithGst: number }[] };

export const checkPricing = (i: PricingInput) =>
  firstError(
    need("the monthly costs", i.monthlyCosts, 0, 100_000_000),
    need("the target profit", i.targetProfit, 0, 100_000_000),
    need("the number of members", i.members, 1, 100_000, true),
    need("the GST rate", i.gstRatePct, 0, 40),
    need("the 3-month discount", i.discount3, 0, 60),
    need("the 6-month discount", i.discount6, 0, 60),
    need("the 12-month discount", i.discount12, 0, 60),
  );

/** The monthly fee that covers the costs and the profit you want across the members you expect, then plan prices from it. */
export function gymPricing(i: PricingInput): PricingResult {
  const feeExGst = (i.monthlyCosts + i.targetProfit) / i.members;
  const feeWithGst = feeExGst * (1 + i.gstRatePct / 100);
  const plan = (months: number, discountPct: number) => {
    const price = feeWithGst * months * (1 - discountPct / 100);
    return { months, discountPct, priceWithGst: Math.round(price), perMonthWithGst: Math.round(price / months) };
  };
  return { feeExGst: round2(feeExGst), feeWithGst: round2(feeWithGst), plans: [plan(1, 0), plan(3, i.discount3), plan(6, i.discount6), plan(12, i.discount12)] };
}

// ---------------------------------------------------------------- Protein

export const PROTEIN_GOALS = {
  basic: { label: "Not training much", range: [0.8, 1.0] },
  fitness: { label: "General fitness", range: [1.2, 1.6] },
  muscle: { label: "Build muscle", range: [1.6, 2.0] },
  fat: { label: "Lose fat and keep muscle", range: [1.6, 2.2] },
} as const;
export type ProteinGoal = keyof typeof PROTEIN_GOALS;

export const checkProtein = (weightKg: number) => firstError(need("your weight in kg", weightKg, 30, 250));

/** Grams of protein a day: grams per kg of body weight, by goal. A planning range, not a prescription. */
export function proteinTarget(weightKg: number, goal: ProteinGoal, meals: number) {
  const [lo, hi] = PROTEIN_GOALS[goal].range;
  const min = Math.round(weightKg * lo);
  const max = Math.round(weightKg * hi);
  return { min, max, perKgMin: lo, perKgMax: hi, perMealMin: Math.round(min / meals), perMealMax: Math.round(max / meals) };
}

// ---------------------------------------------------------------- Calories

export const ACTIVITY = {
  sedentary: { label: "Little or no exercise", factor: 1.2 },
  light: { label: "Light exercise 1 to 3 days a week", factor: 1.375 },
  moderate: { label: "Moderate exercise 3 to 5 days a week", factor: 1.55 },
  high: { label: "Hard exercise 6 to 7 days a week", factor: 1.725 },
  extra: { label: "Very hard exercise or a physical job", factor: 1.9 },
} as const;
export type Activity = keyof typeof ACTIVITY;
export const CALORIE_GOALS = { lose: { label: "Lose fat", delta: -500 }, maintain: { label: "Stay the same", delta: 0 }, gain: { label: "Gain muscle", delta: 300 } } as const;
export type CalorieGoal = keyof typeof CALORIE_GOALS;
export type CalorieInput = { sex: "male" | "female"; age: number; heightCm: number; weightKg: number; activity: Activity; goal: CalorieGoal };

export const checkCalories = (i: CalorieInput) =>
  firstError(need("your age", i.age, 15, 90, true), need("your height in cm", i.heightCm, 120, 230), need("your weight in kg", i.weightKg, 30, 250));

/** Mifflin-St Jeor resting energy, times an activity factor, plus or minus for the goal. An estimate: bodies differ by a few hundred kcal. */
export function calories(i: CalorieInput) {
  const bmr = 10 * i.weightKg + 6.25 * i.heightCm - 5 * i.age + (i.sex === "male" ? 5 : -161);
  const maintenance = bmr * ACTIVITY[i.activity].factor;
  const target = maintenance + CALORIE_GOALS[i.goal].delta;
  // Below these, an eating plan needs a doctor or dietitian watching it.
  const floor = i.sex === "male" ? 1500 : 1200;
  return { bmr: Math.round(bmr), maintenance: Math.round(maintenance), target: Math.round(target), belowFloor: target < floor, floor };
}
