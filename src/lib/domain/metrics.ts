// The Business Intelligence suite's metric definitions and the pure arithmetic behind them (docs/BUSINESS-INTELLIGENCE.md).
//
// Every figure a BI screen shows is a MetricResult: the value, the metric's identifier and version, the period and the
// data it was read from, and whether it is an actual figure, an estimate or a forecast. The services under
// src/lib/services read the records; nothing here touches the database, so each formula is unit-tested on its own.
// Money is integer paise throughout, as everywhere in FITRON.

export type MetricUnit = "paise" | "count" | "pct" | "months" | "ratio" | "days";
export type MetricKind = "actual" | "estimate" | "forecast";

export type MetricDef = {
  id: string;
  name: string;
  /** The definition a gym owner reads: what is counted, what is left out. */
  definition: string;
  unit: MetricUnit;
  /** Bumped when the formula changes, so a saved figure says which formula made it. */
  version: number;
  /** The FITRON records it is read from. */
  sources: string[];
  /** What the formula assumes or excludes. */
  assumptions?: string[];
  kind: MetricKind;
};

export type Period = { from: string; to: string };

export type MetricResult<T = number | null> = {
  id: string;
  name: string;
  value: T;
  unit: MetricUnit;
  kind: MetricKind;
  period: Period;
  currency: "INR";
  timezone: "Asia/Kolkata";
  version: number;
  computedAt: string;
  /** Data-quality notes: small samples, missing data, estimates in play. */
  warnings: string[];
  definition: string;
  sources: string[];
  assumptions: string[];
};

const def = (d: MetricDef) => d;

/** The registry. Screens and the AI tools read names and definitions from here; the calculation version travels with every result. */
export const METRICS = {
  // ── Recovery ──
  "recovery.outstanding": def({ id: "recovery.outstanding", name: "Outstanding membership dues", definition: "Balance still owed on issued invoices (total less successful payments, round-off under ₹1 ignored), across the branches you can see.", unit: "paise", version: 1, sources: ["Invoice", "Payment"], kind: "actual" }),
  "recovery.eligible": def({ id: "recovery.eligible", name: "Eligible for recovery", definition: "Outstanding dues on open recovery cases, i.e. invoices past their due date or with a part payment that are not closed or written off.", unit: "paise", version: 1, sources: ["Invoice", "Payment", "RecoveryCase"], kind: "actual" }),
  "recovery.pending": def({ id: "recovery.pending", name: "Recovery actions pending", definition: "Open cases whose next action is due today or earlier.", unit: "count", version: 1, sources: ["RecoveryCase"], kind: "actual" }),
  "recovery.recovered": def({ id: "recovery.recovered", name: "Recovered in period", definition: "Successful payments dated in the period on invoices that had an open recovery case when the payment came in.", unit: "paise", version: 1, sources: ["Payment", "RecoveryCase"], kind: "actual" }),
  "recovery.rate": def({ id: "recovery.rate", name: "Recovery rate", definition: "Recovered in period ÷ (outstanding on open cases at the start of the period + dues that fell overdue during it). Renewal opportunities are never in the denominator.", unit: "pct", version: 1, sources: ["Payment", "RecoveryCase"], assumptions: ["Written-off cases leave the denominator from the day they are closed."], kind: "actual" }),
  // ── Lifetime value ──
  "ltv.revenue": def({ id: "ltv.revenue", name: "Historical member revenue", definition: "Net invoice lines (after discount, before GST) on issued invoices of the member, less nothing else: refunds in FITRON are payment reversals and invoice cancellations, which are already out.", unit: "paise", version: 1, sources: ["Invoice", "InvoiceItem"], kind: "actual" }),
  "ltv.tenure": def({ id: "ltv.tenure", name: "Average membership tenure", definition: "Days from the first membership start to the last membership end (or today while active), averaged over the members in the cohort, in months of 30.44 days.", unit: "months", version: 1, sources: ["Membership"], kind: "actual" }),
  "ltv.renewalRate": def({ id: "ltv.renewalRate", name: "Renewal rate", definition: "Of memberships that ended in the period, the share followed by another membership of the same member starting within 30 days of the end.", unit: "pct", version: 1, sources: ["Membership"], kind: "actual" }),
  "ltv.retention": def({ id: "ltv.retention", name: "Retention by cohort", definition: "Of members who joined in the cohort month, the share still covered by a membership N months later (only cohorts old enough to be observed).", unit: "pct", version: 1, sources: ["Member", "Membership"], kind: "actual" }),
  "ltv.cancellation": def({ id: "ltv.cancellation", name: "Cancellation rate", definition: "Memberships cancelled (invoice cancelled) ÷ memberships sold in the period.", unit: "pct", version: 1, sources: ["Membership"], kind: "actual" }),
  "ltv.arpm": def({ id: "ltv.arpm", name: "Average revenue per member", definition: "Net invoice revenue in the period ÷ members who held a membership covering any day of the period.", unit: "paise", version: 1, sources: ["InvoiceItem", "Membership"], kind: "actual" }),
  "ltv.cac": def({ id: "ltv.cac", name: "Customer acquisition cost", definition: "Marketing-group expenses in the period ÷ members who joined in it. Only shown when both are non-zero.", unit: "paise", version: 1, sources: ["Expense", "Member"], assumptions: ["Only expenses in the Marketing category group count as acquisition spend."], kind: "actual" }),
  "ltv.estimate": def({ id: "ltv.estimate", name: "Estimated lifetime value", definition: "Average monthly net revenue per active member ÷ observed monthly churn, i.e. the revenue an average member would bring if today's churn held. Shown only with at least 6 months of history and 20 members.", unit: "paise", version: 1, sources: ["InvoiceItem", "Membership"], assumptions: ["Churn and revenue per member stay at the observed rate.", "Gross revenue, not profit."], kind: "estimate" }),
  "ltv.ratio": def({ id: "ltv.ratio", name: "Lifetime value to acquisition cost", definition: "Estimated lifetime value ÷ customer acquisition cost. Needs both.", unit: "ratio", version: 1, sources: ["InvoiceItem", "Membership", "Expense", "Member"], kind: "estimate" }),
  // ── P&L and benchmarking ──
  "fin.revenue": def({ id: "fin.revenue", name: "Revenue", definition: "Net invoice lines (after discount, before GST) on issued invoices dated in the period: the Profit & loss figure.", unit: "paise", version: 1, sources: ["InvoiceItem"], kind: "actual" }),
  "fin.expenses": def({ id: "fin.expenses", name: "Operating expenses", definition: "Active, non-capital expenses dated in the period plus depreciation and disposal losses: the Profit & loss figure.", unit: "paise", version: 1, sources: ["Expense", "Asset"], kind: "actual" }),
  "fin.net": def({ id: "fin.net", name: "Operating profit", definition: "Revenue less operating expenses, before income tax, financing and the owner's own drawings.", unit: "paise", version: 1, sources: ["InvoiceItem", "Expense", "Asset"], assumptions: ["Income tax, loan interest and owner compensation are not deducted unless recorded as expenses."], kind: "actual" }),
  "fin.margin": def({ id: "fin.margin", name: "Operating margin", definition: "Operating profit ÷ revenue.", unit: "pct", version: 1, sources: ["InvoiceItem", "Expense"], kind: "actual" }),
  "fin.expenseRatio": def({ id: "fin.expenseRatio", name: "Operating expense ratio", definition: "Operating expenses ÷ revenue.", unit: "pct", version: 1, sources: ["InvoiceItem", "Expense"], kind: "actual" }),
  "bench.revenuePerActive": def({ id: "bench.revenuePerActive", name: "Revenue per active member", definition: "Revenue in the period ÷ members with a membership covering the last day of the period.", unit: "paise", version: 1, sources: ["InvoiceItem", "Membership"], kind: "actual" }),
  "bench.activeMembers": def({ id: "bench.activeMembers", name: "Active members", definition: "Members (not suspended) with a membership covering the last day of the period.", unit: "count", version: 1, sources: ["Member", "Membership"], kind: "actual" }),
} as const;

export type MetricId = keyof typeof METRICS;

/** Wraps a value with the metric's definition and the period it was read for. */
export function metric<T = number | null>(id: MetricId, value: T, period: Period, opts: { warnings?: string[]; kind?: MetricKind; computedAt?: Date } = {}): MetricResult<T> {
  const d = METRICS[id];
  return {
    id,
    name: d.name,
    value,
    unit: d.unit,
    kind: opts.kind ?? d.kind,
    period,
    currency: "INR",
    timezone: "Asia/Kolkata",
    version: d.version,
    computedAt: (opts.computedAt ?? new Date()).toISOString(),
    warnings: opts.warnings ?? [],
    definition: d.definition,
    sources: [...d.sources],
    assumptions: [...(d.assumptions ?? [])],
  };
}

// ── Shared arithmetic ──

/** Percent of `part` in `whole`, to one decimal; null when there is no whole (never 0 for "unknown"). */
export const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/** Percent change from `prev` to `now`, to one decimal; null without a previous figure. */
export const pctChange = (now: number, prev: number): number | null => (prev !== 0 ? Math.round(((now - prev) / Math.abs(prev)) * 1000) / 10 : null);

/** Average of integer paise, rounded to a paisa; null for an empty list. */
export const avgPaise = (xs: number[]): number | null => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

/** Days of overdue → the ageing bucket every recovery screen uses. */
export const AGING_BUCKETS = ["Not yet due", "1–30 days", "31–60 days", "61–90 days", "Over 90 days"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];
export const agingBucket = (overdueDays: number): AgingBucket => (overdueDays <= 0 ? "Not yet due" : overdueDays <= 30 ? "1–30 days" : overdueDays <= 60 ? "31–60 days" : overdueDays <= 90 ? "61–90 days" : "Over 90 days");

/** Recovery rate with its denominator spelled out: null when nothing was eligible. */
export function recoveryRate(recovered: number, openingEligible: number, newlyEligible: number): { rate: number | null; denominator: number } {
  const denominator = openingEligible + newlyEligible;
  return { rate: denominator > 0 ? Math.min(100, pct(recovered, denominator)!) : null, denominator };
}

/** Months of 30.44 days between two ISO dates (end inclusive), to one decimal. */
export const monthsBetween = (from: string, to: string): number => Math.round(((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1) / 30.44 * 10) / 10;

export const MIN_LTV_MEMBERS = 20;
export const MIN_LTV_MONTHS = 6;

/**
 * Lifetime value estimate: average monthly revenue per active member ÷ monthly churn. Null, with the reason, when the
 * data is too thin to say anything (small gyms, young gyms, no churn observed yet).
 */
export function ltvEstimate(i: { avgMonthlyRevenuePerActive: number | null; monthlyChurnPct: number | null; members: number; monthsOfHistory: number }): { value: number | null; warnings: string[] } {
  const warnings: string[] = [];
  if (i.members < MIN_LTV_MEMBERS) warnings.push(`Needs at least ${MIN_LTV_MEMBERS} members with a membership; this view has ${i.members}.`);
  if (i.monthsOfHistory < MIN_LTV_MONTHS) warnings.push(`Needs at least ${MIN_LTV_MONTHS} months of membership history; this gym has ${i.monthsOfHistory}.`);
  if (i.avgMonthlyRevenuePerActive === null) warnings.push("No revenue per active member could be worked out.");
  if (i.monthlyChurnPct === null) warnings.push("No churn has been observed yet, so a lifetime cannot be estimated.");
  else if (i.monthlyChurnPct <= 0) warnings.push("No member has left in the observed period; the lifetime would be unbounded, so no estimate is shown.");
  if (warnings.length) return { value: null, warnings };
  return { value: Math.round(i.avgMonthlyRevenuePerActive! / (i.monthlyChurnPct! / 100)), warnings };
}

/** Customer acquisition cost: only when both the spend and the new-member count are there. */
export function cac(marketingSpend: number, newMembers: number): { value: number | null; warnings: string[] } {
  if (marketingSpend <= 0) return { value: null, warnings: ["No expenses in the Marketing category group in this period, so acquisition cost cannot be worked out."] };
  if (newMembers <= 0) return { value: null, warnings: ["No member joined in this period, so acquisition cost cannot be worked out."] };
  return { value: Math.round(marketingSpend / newMembers), warnings: [] };
}

/** Monthly churn from members at the start and members lost over `months`, as a percent; null without a start count. */
export function monthlyChurnPct(start: number, lost: number, months: number): number | null {
  if (start <= 0 || months <= 0) return null;
  const period = Math.min(1, lost / start);
  const monthly = period >= 1 ? 1 : 1 - Math.pow(1 - period, 1 / months);
  return Math.round(monthly * 1000) / 10;
}

/** Percentile rank (0–100) of `value` among `others` (inclusive of ties below). */
export function percentileRank(value: number, others: number[]): number | null {
  if (!others.length) return null;
  const below = others.filter((x) => x < value).length;
  const equal = others.filter((x) => x === value).length;
  return Math.round(((below + equal / 2) / others.length) * 100);
}

/** The p-th percentile (nearest-rank) of a list; null when empty. */
export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}
