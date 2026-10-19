// Benchmarking & Franchise Intelligence: ranking branches and comparing a gym with an anonymised peer group
// (docs/BUSINESS-INTELLIGENCE.md, Module 6). Pure maths and the privacy thresholds; src/lib/services/benchmark.ts reads
// the records.

import { percentile, percentileRank } from "./metrics";

export type BenchMetricKey = "revenue" | "activeMembers" | "revenuePerActive" | "renewalRate" | "expenseRatio" | "operatingMargin" | "cac" | "newMembers";

export type BenchMetric = { key: BenchMetricKey; label: string; unit: "paise" | "count" | "pct"; /** Higher is better unless said. */ higherIsBetter: boolean; definition: string };

export const BENCH_METRICS: BenchMetric[] = [
  { key: "revenue", label: "Revenue", unit: "paise", higherIsBetter: true, definition: "Net invoice lines (after discount, before GST) dated in the period." },
  { key: "activeMembers", label: "Active members", unit: "count", higherIsBetter: true, definition: "Members with a membership covering the last day of the period, not suspended." },
  { key: "revenuePerActive", label: "Revenue per active member", unit: "paise", higherIsBetter: true, definition: "Revenue ÷ active members." },
  { key: "renewalRate", label: "Renewal rate", unit: "pct", higherIsBetter: true, definition: "Of memberships that ended in the period, the share followed by another within 30 days." },
  { key: "expenseRatio", label: "Operating expense ratio", unit: "pct", higherIsBetter: false, definition: "Operating expenses ÷ revenue." },
  { key: "operatingMargin", label: "Operating margin", unit: "pct", higherIsBetter: true, definition: "Operating profit ÷ revenue." },
  { key: "newMembers", label: "New members", unit: "count", higherIsBetter: true, definition: "Members who joined in the period." },
  { key: "cac", label: "Acquisition cost per member", unit: "paise", higherIsBetter: false, definition: "Marketing expenses ÷ new members; only when both exist." },
];

export type BranchFigures = { id: string; name: string; metrics: Record<BenchMetricKey, number | null> };

export type RankedRow = BranchFigures & { rank: Record<BenchMetricKey, number | null> };

/** Ranks branches per metric (1 = best by that metric's direction); a null figure gets no rank. */
export function rankBranches(rows: BranchFigures[]): RankedRow[] {
  const ranks = new Map<string, Record<BenchMetricKey, number | null>>();
  for (const r of rows) ranks.set(r.id, {} as Record<BenchMetricKey, number | null>);
  for (const m of BENCH_METRICS) {
    const have = rows.filter((r) => r.metrics[m.key] !== null).sort((a, b) => (m.higherIsBetter ? b.metrics[m.key]! - a.metrics[m.key]! : a.metrics[m.key]! - b.metrics[m.key]!));
    have.forEach((r, i) => (ranks.get(r.id)![m.key] = i + 1));
    for (const r of rows) if (r.metrics[m.key] === null) ranks.get(r.id)![m.key] = null;
  }
  return rows.map((r) => ({ ...r, rank: ranks.get(r.id)! }));
}

/** Change between two periods for one branch, per metric, as a signed percent; null when either side is missing or the previous is zero. */
export function branchChange(now: Record<BenchMetricKey, number | null>, prev: Record<BenchMetricKey, number | null>): Record<BenchMetricKey, number | null> {
  const out = {} as Record<BenchMetricKey, number | null>;
  for (const m of BENCH_METRICS) {
    const a = now[m.key];
    const b = prev[m.key];
    out[m.key] = a === null || b === null || b === 0 ? null : Math.round(((a - b) / Math.abs(b)) * 1000) / 10;
  }
  return out;
}

// ── External benchmarking safeguards ──

/** A cohort or a comparison is shown only with this many distinct gyms in it. */
export const MIN_COHORT_GYMS = 10;
/** A percentile is shown only when the gym's own figure sits among at least this many others. */
export const MIN_PERCENTILE_SAMPLE = 10;

/** The size bands a gym is compared within (by active members), so a chain is not compared with a single room. */
export const SIZE_BANDS = [
  { key: "xs", label: "Up to 50 members", max: 50 },
  { key: "s", label: "51 to 150 members", max: 150 },
  { key: "m", label: "151 to 400 members", max: 400 },
  { key: "l", label: "401 to 1,000 members", max: 1000 },
  { key: "xl", label: "Over 1,000 members", max: Infinity },
] as const;
export type SizeBand = (typeof SIZE_BANDS)[number]["key"];
export const sizeBand = (activeMembers: number): SizeBand => SIZE_BANDS.find((b) => activeMembers <= b.max)!.key;

export type PeerRow = { orgId: string; metrics: Partial<Record<BenchMetricKey, number | null>> };

export type PeerComparison = {
  key: BenchMetricKey;
  /** The gym's own figure */
  value: number | null;
  /** Shown only when the sample is large enough */
  sample: number;
  p25: number | null;
  median: number | null;
  p75: number | null;
  percentile: number | null;
  /** Why no comparison is shown */
  unavailable: string | null;
};

/**
 * Compares one gym with its peers metric by metric. Peers with no figure for a metric drop out of that metric's sample;
 * a metric whose sample is under the threshold shows nothing, and the gym's own row is never in its own sample.
 */
export function comparePeers(own: Partial<Record<BenchMetricKey, number | null>>, peers: PeerRow[], ownOrgId: string): PeerComparison[] {
  return BENCH_METRICS.map((m) => {
    const sample = peers.filter((p) => p.orgId !== ownOrgId).map((p) => p.metrics[m.key]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    // Distinct gyms only: a gym appears once per cohort month, but guard against duplicates anyway.
    const value = own[m.key] ?? null;
    if (sample.length < MIN_PERCENTILE_SAMPLE) return { key: m.key, value, sample: sample.length, p25: null, median: null, p75: null, percentile: null, unavailable: `Needs at least ${MIN_PERCENTILE_SAMPLE} other gyms reporting this figure; ${sample.length} do.` };
    const pr = value === null ? null : percentileRank(value, sample);
    return { key: m.key, value, sample: sample.length, p25: percentile(sample, 25), median: percentile(sample, 50), p75: percentile(sample, 75), percentile: pr !== null && !m.higherIsBetter ? 100 - pr : pr, unavailable: value === null ? "Your own figure for this metric is not available for the period." : null };
  });
}

/** Whether an anonymised cohort may be shown at all. */
export const cohortLargeEnough = (distinctGyms: number) => distinctGyms >= MIN_COHORT_GYMS;
