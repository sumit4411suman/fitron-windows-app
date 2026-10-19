// Gym Profit Simulator: the shared financial calculation engine (docs/BUSINESS-INTELLIGENCE.md, Modules 3 and 4).
// Deterministic, pure and in integer paise: the same inputs always give the same figures, on the server, in the
// browser and in the tests. Nothing here reads or writes the books; src/lib/services/simulator.ts reads the baseline
// from the records and saves scenarios, and the Decision Simulator calls these same functions for its options.
//
// What is and is not in the figures (stated on every screen):
//   included:  membership fees (after discount, before GST), other income, fixed and variable operating costs, payment
//              processing fees, refunds as a share of revenue, income tax at a flat rate when one is given
//   excluded:  GST (the government's money, shown apart), depreciation, loan interest and financing, owner's drawings
//              unless entered as a cost, capital purchases
//   cash:      collections are the GST-inclusive price less refunds; "operating profit" is accrual (revenue less costs)

export const SIM_CALC_VERSION = 1;

export type PlanMix = {
  name: string;
  /** Members on this plan now. */
  members: number;
  /** Price of one cycle, paise, as members pay it (GST included when pricesIncludeGst). */
  price: number;
  /** Months one cycle covers. */
  months: number;
  /** Average discount given, percent of price. */
  discountPct: number;
};

export type FixedCosts = { rent: number; utilities: number; salaries: number; marketing: number; maintenance: number; software: number; other: number };
export const FIXED_KEYS = ["rent", "utilities", "salaries", "marketing", "maintenance", "software", "other"] as const;
export const FIXED_LABELS: Record<keyof FixedCosts, string> = { rent: "Rent", utilities: "Utilities", salaries: "Trainer and staff pay", marketing: "Marketing", maintenance: "Equipment and maintenance", software: "Software and subscriptions", other: "Other operating costs" };

export type SimInputs = {
  /** Forecast period in months, 1–36. */
  months: number;
  plans: PlanMix[];
  pricesIncludeGst: boolean;
  gstRatePct: number;
  /** Members joining each month. */
  newMembersPerMonth: number;
  /** Members leaving each month, percent of active members (100 − monthly renewal). */
  monthlyChurnPct: number;
  /** POS, personal training and the like, paise a month, before GST. */
  otherIncomeMonthly: number;
  fixed: FixedCosts;
  /** Cost of serving one active member for a month (towels, water, wear), paise. */
  variablePerMember: number;
  /** Payment gateway and card fees, percent of collections. */
  paymentFeePct: number;
  /** Refunds, percent of revenue. */
  refundPct: number;
  /** Income tax on a positive profit, percent; 0 leaves tax out. */
  taxPct: number;
  /** Twelve multipliers, January first; 1 = an ordinary month. */
  seasonality: number[];
  /** The calendar month the forecast starts in (1–12), for seasonality. */
  startMonth: number;
  /** Operating profit wanted each month, paise, for the minimum-price figure. */
  targetProfitMonthly: number;
};

export type MonthRow = {
  index: number;
  /** Calendar month 1–12 */
  month: number;
  activeStart: number;
  joined: number;
  left: number;
  activeEnd: number;
  revenue: number;
  otherIncome: number;
  gst: number;
  refunds: number;
  fixedCosts: number;
  variableCosts: number;
  paymentFees: number;
  operatingExpenses: number;
  operatingProfit: number;
  tax: number;
  netProfit: number;
  cashIn: number;
  cashOut: number;
  netCash: number;
};

export type SimResult = {
  calcVersion: number;
  months: MonthRow[];
  totals: Omit<MonthRow, "index" | "month" | "activeStart" | "joined" | "left" | "activeEnd"> & { joined: number; left: number; activeEnd: number };
  /** Operating profit ÷ revenue (incl. other income), percent; null without revenue. */
  operatingMarginPct: number | null;
  /** Average monthly fee per member after discount, before GST, paise. */
  avgMonthlyFee: number;
  /** Fee less the variable cost and the payment fee on it, paise a month. */
  contributionPerMember: number;
  /** Members needed for contribution to cover the fixed costs (less other income); null when contribution ≤ 0. */
  breakEvenMembers: number | null;
  /** Monthly revenue at the break-even member count, paise; null as above. */
  breakEvenRevenue: number | null;
  /** Average monthly fee (before GST) needed for the target monthly profit with the current member count; null without members. */
  minFeeForTarget: number | null;
  /** The same, as a cycle price for each plan, with GST where prices include it. */
  minPriceByPlan: { name: string; price: number }[];
  notes: string[];
};

export type Check = { ok: true } | { ok: false; error: string };

const num = (v: unknown, lo: number, hi: number, label: string): string | null => {
  if (typeof v !== "number" || !Number.isFinite(v)) return `${label}: enter a number.`;
  if (v < lo || v > hi) return `${label}: should be between ${lo.toLocaleString("en-IN")} and ${hi.toLocaleString("en-IN")}.`;
  return null;
};

export function checkInputs(i: SimInputs): Check {
  const errors = [
    num(i.months, 1, 36, "Forecast months"),
    i.plans.length ? null : "Add at least one plan.",
    ...i.plans.flatMap((p) => [num(p.members, 0, 100_000, `${p.name}: members`), num(p.price, 0, 100_000_000, `${p.name}: price`), num(p.months, 1, 36, `${p.name}: months`), num(p.discountPct, 0, 100, `${p.name}: discount`)]),
    num(i.gstRatePct, 0, 40, "GST rate"),
    num(i.newMembersPerMonth, 0, 100_000, "New members a month"),
    num(i.monthlyChurnPct, 0, 100, "Monthly churn"),
    num(i.otherIncomeMonthly, 0, 10_000_000_000, "Other income"),
    ...FIXED_KEYS.map((k) => num(i.fixed[k], 0, 10_000_000_000, FIXED_LABELS[k])),
    num(i.variablePerMember, 0, 100_000_000, "Variable cost per member"),
    num(i.paymentFeePct, 0, 20, "Payment fees"),
    num(i.refundPct, 0, 50, "Refunds"),
    num(i.taxPct, 0, 60, "Income tax"),
    i.seasonality.length === 12 ? null : "Seasonality needs twelve months.",
    ...i.seasonality.map((s, k) => num(s, 0, 5, `Seasonality month ${k + 1}`)),
    num(i.startMonth, 1, 12, "Start month"),
    num(i.targetProfitMonthly, -10_000_000_000, 10_000_000_000, "Target profit"),
  ].filter((e): e is string => !!e);
  return errors.length ? { ok: false, error: errors[0]! } : { ok: true };
}

/** Price before GST: a price that includes GST is split the way FITRON's invoices split it. */
const exGst = (price: number, includes: boolean, ratePct: number) => (includes ? Math.round((price * 100) / (100 + ratePct)) : price);

/** Average monthly fee per member after discount, before GST, weighted by the members on each plan. */
export function avgMonthlyFee(i: Pick<SimInputs, "plans" | "pricesIncludeGst" | "gstRatePct">): number {
  const members = i.plans.reduce((s, p) => s + p.members, 0);
  if (members <= 0) {
    // No members yet: the plain average of the plans, so a new gym still gets a figure.
    const fees = i.plans.filter((p) => p.months > 0).map((p) => (exGst(p.price, i.pricesIncludeGst, i.gstRatePct) * (1 - p.discountPct / 100)) / p.months);
    return fees.length ? Math.round(fees.reduce((s, x) => s + x, 0) / fees.length) : 0;
  }
  const total = i.plans.reduce((s, p) => s + ((p.members * exGst(p.price, i.pricesIncludeGst, i.gstRatePct) * (1 - p.discountPct / 100)) / p.months), 0);
  return Math.round(total / members);
}

export const fixedTotal = (f: FixedCosts) => FIXED_KEYS.reduce((s, k) => s + f[k], 0);

/** Runs the forecast. Call checkInputs first; this never throws on odd numbers, it clamps them. */
export function simulate(i: SimInputs): SimResult {
  const fee = avgMonthlyFee(i);
  const fixed = fixedTotal(i.fixed);
  const churn = Math.min(100, Math.max(0, i.monthlyChurnPct)) / 100;
  const gstFactor = i.gstRatePct / 100;
  let active = i.plans.reduce((s, p) => s + p.members, 0);
  const months: MonthRow[] = [];
  const notes: string[] = [];
  for (let k = 0; k < Math.max(1, Math.min(36, Math.round(i.months))); k++) {
    const month = ((i.startMonth - 1 + k) % 12) + 1;
    const season = i.seasonality[month - 1] ?? 1;
    const left = Math.round(active * churn);
    const joined = Math.round(i.newMembersPerMonth * season);
    const activeEnd = Math.max(0, active - left + joined);
    // Fees are earned on the average members in the month (joiners and leavers count for half).
    const avgActive = (active + activeEnd) / 2;
    const revenue = Math.round(avgActive * fee * season);
    const otherIncome = Math.round(i.otherIncomeMonthly * season);
    const gst = Math.round((revenue + otherIncome) * gstFactor);
    const refunds = Math.round((revenue * i.refundPct) / 100);
    const variableCosts = Math.round(avgActive * i.variablePerMember);
    const cashGross = revenue + otherIncome + gst - refunds;
    const paymentFees = Math.round((Math.max(0, cashGross) * i.paymentFeePct) / 100);
    const operatingExpenses = fixed + variableCosts + paymentFees;
    const operatingProfit = revenue + otherIncome - refunds - operatingExpenses;
    const tax = operatingProfit > 0 ? Math.round((operatingProfit * i.taxPct) / 100) : 0;
    const netProfit = operatingProfit - tax;
    const cashIn = cashGross;
    const cashOut = operatingExpenses + tax + gst;
    months.push({ index: k + 1, month, activeStart: active, joined, left, activeEnd, revenue, otherIncome, gst, refunds, fixedCosts: fixed, variableCosts, paymentFees, operatingExpenses, operatingProfit, tax, netProfit, cashIn, cashOut, netCash: cashIn - cashOut });
    active = activeEnd;
  }
  const sum = (f: (m: MonthRow) => number) => months.reduce((s, m) => s + f(m), 0);
  const totals = {
    revenue: sum((m) => m.revenue),
    otherIncome: sum((m) => m.otherIncome),
    gst: sum((m) => m.gst),
    refunds: sum((m) => m.refunds),
    fixedCosts: sum((m) => m.fixedCosts),
    variableCosts: sum((m) => m.variableCosts),
    paymentFees: sum((m) => m.paymentFees),
    operatingExpenses: sum((m) => m.operatingExpenses),
    operatingProfit: sum((m) => m.operatingProfit),
    tax: sum((m) => m.tax),
    netProfit: sum((m) => m.netProfit),
    cashIn: sum((m) => m.cashIn),
    cashOut: sum((m) => m.cashOut),
    netCash: sum((m) => m.netCash),
    joined: sum((m) => m.joined),
    left: sum((m) => m.left),
    activeEnd: months[months.length - 1]!.activeEnd,
  };
  const income = totals.revenue + totals.otherIncome - totals.refunds;
  // Contribution: what a member's monthly fee leaves after the cost of serving them and the fee on collecting it.
  const feeOnCollection = Math.round((fee * (1 + gstFactor) * (1 - i.refundPct / 100) * i.paymentFeePct) / 100);
  const contribution = Math.round(fee * (1 - i.refundPct / 100)) - i.variablePerMember - feeOnCollection;
  const otherNet = i.otherIncomeMonthly - Math.round((i.otherIncomeMonthly * (1 + gstFactor) * i.paymentFeePct) / 100);
  const breakEvenMembers = contribution > 0 ? Math.max(0, Math.ceil((fixed - otherNet) / contribution)) : null;
  const members0 = i.plans.reduce((s, p) => s + p.members, 0);
  // Minimum fee: fee × members × (1 − refund) − members × variable − fees = fixed − other + target.
  // Solve for fee with the collection fee proportional to the fee: fee × m × [(1 − r) − (1 + g)(1 − r)·f] = fixed − otherNet + target + m × variable.
  const perMemberFactor = (1 - i.refundPct / 100) * (1 - ((1 + gstFactor) * i.paymentFeePct) / 100);
  const minFeeForTarget = members0 > 0 && perMemberFactor > 0 ? Math.max(0, Math.ceil((fixed - otherNet + i.targetProfitMonthly + members0 * i.variablePerMember) / (members0 * perMemberFactor))) : null;
  const minPriceByPlan = minFeeForTarget === null ? [] : i.plans.map((p) => ({ name: p.name, price: Math.ceil((minFeeForTarget * p.months * (i.pricesIncludeGst ? 1 + gstFactor : 1)) / Math.max(0.01, 1 - p.discountPct / 100)) }));
  if (contribution <= 0) notes.push("Each member costs more to serve than the fee they pay: no member count breaks even until the fee rises or the variable cost falls.");
  if (members0 === 0) notes.push("No members in the mix: revenue comes only from joiners.");
  if (i.taxPct === 0) notes.push("Income tax is left out (set a rate to include it).");
  notes.push("GST is shown apart and never counted as income. Depreciation, loan interest and owner's drawings are not deducted unless entered as costs.");
  return {
    calcVersion: SIM_CALC_VERSION,
    months,
    totals,
    operatingMarginPct: income > 0 ? Math.round((totals.operatingProfit / income) * 1000) / 10 : null,
    avgMonthlyFee: fee,
    contributionPerMember: contribution,
    breakEvenMembers,
    breakEvenRevenue: breakEvenMembers === null ? null : breakEvenMembers * fee + i.otherIncomeMonthly,
    minFeeForTarget,
    minPriceByPlan,
    notes,
  };
}

export type ScenarioKey = "conservative" | "baseline" | "optimistic";
export const SCENARIO_LABEL: Record<ScenarioKey, string> = { conservative: "Conservative", baseline: "Baseline", optimistic: "Optimistic" };

/** The three standard variants: joiners ±20%, churn ±2 points, costs ±5%, prices unchanged. */
export function variant(i: SimInputs, key: ScenarioKey): SimInputs {
  if (key === "baseline") return i;
  const s = key === "conservative" ? -1 : 1;
  const scale = (v: number, pct: number) => Math.round(v * (1 + (s * pct) / 100));
  return {
    ...i,
    newMembersPerMonth: Math.max(0, scale(i.newMembersPerMonth, 20)),
    monthlyChurnPct: Math.max(0, Math.min(100, i.monthlyChurnPct - s * 2)),
    fixed: Object.fromEntries(FIXED_KEYS.map((k) => [k, scale(i.fixed[k], -5)])) as FixedCosts,
    variablePerMember: scale(i.variablePerMember, -5),
  };
}

export const threeScenarios = (i: SimInputs): Record<ScenarioKey, SimResult> => ({ conservative: simulate(variant(i, "conservative")), baseline: simulate(i), optimistic: simulate(variant(i, "optimistic")) });

export type SensitivityRow = { label: string; change: string; operatingProfit: number; delta: number; marginPct: number | null };

/** What each assumption does to the operating profit over the period, one at a time. */
export function sensitivity(i: SimInputs): SensitivityRow[] {
  const base = simulate(i).totals.operatingProfit;
  const row = (label: string, change: string, j: SimInputs): SensitivityRow => {
    const r = simulate(j);
    return { label, change, operatingProfit: r.totals.operatingProfit, delta: r.totals.operatingProfit - base, marginPct: r.operatingMarginPct };
  };
  const priced = (pct: number): SimInputs => ({ ...i, plans: i.plans.map((p) => ({ ...p, price: Math.round(p.price * (1 + pct / 100)) })) });
  const membered = (pct: number): SimInputs => ({ ...i, plans: i.plans.map((p) => ({ ...p, members: Math.round(p.members * (1 + pct / 100)) })) });
  const costed = (pct: number): SimInputs => ({ ...i, fixed: Object.fromEntries(FIXED_KEYS.map((k) => [k, Math.round(i.fixed[k] * (1 + pct / 100))])) as FixedCosts });
  return [
    row("Prices", "+10%", priced(10)),
    row("Prices", "−10%", priced(-10)),
    row("Members now", "+10%", membered(10)),
    row("Members now", "−10%", membered(-10)),
    row("Monthly churn", "+2 points", { ...i, monthlyChurnPct: Math.min(100, i.monthlyChurnPct + 2) }),
    row("Monthly churn", "−2 points", { ...i, monthlyChurnPct: Math.max(0, i.monthlyChurnPct - 2) }),
    row("New members a month", "+20%", { ...i, newMembersPerMonth: Math.round(i.newMembersPerMonth * 1.2) }),
    row("New members a month", "−20%", { ...i, newMembersPerMonth: Math.round(i.newMembersPerMonth * 0.8) }),
    row("Fixed costs", "+10%", costed(10)),
    row("Fixed costs", "−10%", costed(-10)),
  ];
}

/** A one-month comparison of a forecast with what the books later showed. */
export type Comparison = { label: string; forecast: number; actual: number; delta: number; deltaPct: number | null };
export function compareWithActual(f: { revenue: number; operatingExpenses: number; operatingProfit: number; activeEnd: number }, a: { revenue: number; expenses: number; net: number; activeMembers: number }): Comparison[] {
  const line = (label: string, forecast: number, actual: number): Comparison => ({ label, forecast, actual, delta: actual - forecast, deltaPct: forecast !== 0 ? Math.round(((actual - forecast) / Math.abs(forecast)) * 1000) / 10 : null });
  return [line("Revenue", f.revenue, a.revenue), line("Operating expenses", f.operatingExpenses, a.expenses), line("Operating profit", f.operatingProfit, a.net), line("Active members", f.activeEnd, a.activeMembers)];
}

export const DEFAULT_SEASONALITY = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

export function emptyInputs(startMonth: number): SimInputs {
  return {
    months: 12,
    plans: [],
    pricesIncludeGst: true,
    gstRatePct: 18,
    newMembersPerMonth: 0,
    monthlyChurnPct: 0,
    otherIncomeMonthly: 0,
    fixed: { rent: 0, utilities: 0, salaries: 0, marketing: 0, maintenance: 0, software: 0, other: 0 },
    variablePerMember: 0,
    paymentFeePct: 0,
    refundPct: 0,
    taxPct: 0,
    seasonality: [...DEFAULT_SEASONALITY],
    startMonth,
    targetProfitMonthly: 0,
  };
}

/** Reads inputs saved as JSON (a scenario, a decision option) back into the typed shape, with every field defaulted and clamped. */
export function parseInputs(raw: unknown, startMonth = 1): SimInputs {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
  const base = emptyInputs(startMonth);
  const fixedRaw = (o.fixed && typeof o.fixed === "object" ? o.fixed : {}) as Record<string, unknown>;
  const plans = Array.isArray(o.plans) ? o.plans : [];
  const seasonality = Array.isArray(o.seasonality) && o.seasonality.length === 12 ? o.seasonality.map((s) => n(s, 1)) : base.seasonality;
  return {
    months: n(o.months, base.months),
    plans: plans.map((p) => {
      const q = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
      return { name: typeof q.name === "string" ? q.name.slice(0, 80) : "Plan", members: n(q.members, 0), price: n(q.price, 0), months: n(q.months, 1), discountPct: n(q.discountPct, 0) };
    }),
    pricesIncludeGst: typeof o.pricesIncludeGst === "boolean" ? o.pricesIncludeGst : base.pricesIncludeGst,
    gstRatePct: n(o.gstRatePct, base.gstRatePct),
    newMembersPerMonth: n(o.newMembersPerMonth, 0),
    monthlyChurnPct: n(o.monthlyChurnPct, 0),
    otherIncomeMonthly: n(o.otherIncomeMonthly, 0),
    fixed: Object.fromEntries(FIXED_KEYS.map((k) => [k, n(fixedRaw[k], 0)])) as FixedCosts,
    variablePerMember: n(o.variablePerMember, 0),
    paymentFeePct: n(o.paymentFeePct, 0),
    refundPct: n(o.refundPct, 0),
    taxPct: n(o.taxPct, 0),
    seasonality,
    startMonth: n(o.startMonth, startMonth),
    targetProfitMonthly: n(o.targetProfitMonthly, 0),
  };
}
