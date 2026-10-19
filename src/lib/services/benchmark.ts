import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import type { Prisma } from "@/generated/prisma/client";
import { BENCH_METRICS, MIN_COHORT_GYMS, SIZE_BANDS, branchChange, cohortLargeEnough, comparePeers, rankBranches, sizeBand, type BenchMetricKey, type BranchFigures, type PeerRow } from "@/lib/domain/benchmark";
import type { Period } from "@/lib/domain/metrics";
import { addMonths } from "@/lib/domain/dates";
import { isLocal } from "@/lib/runtime/edition";
import { branchScope, membershipFacts, monthPeriodOf, previousPeriod, snapshot, systemScope, type BusinessSnapshot } from "./analytics";
import { audit } from "./audit";
import { UserError } from "./errors";
import { getSetting, putSetting } from "./settings";
import { todayIso } from "./time";

// Benchmarking & Franchise Intelligence (docs/BUSINESS-INTELLIGENCE.md, Module 6). Internal: the gym's own branches
// over the same period, from the shared snapshot. External: an opt-in, aggregated, anonymised peer comparison that
// stays unavailable until enough gyms have consented; it never reads another gym's rows one by one.

const figuresOf = (s: BusinessSnapshot): Record<BenchMetricKey, number | null> => ({
  revenue: s.revenue,
  activeMembers: s.activeMembers,
  revenuePerActive: s.revenuePerActive,
  renewalRate: s.renewal.rate,
  expenseRatio: s.expenseRatioPct,
  operatingMargin: s.marginPct,
  newMembers: s.newMembers,
  cac: s.cac,
});

export type InternalBenchmark = Awaited<ReturnType<typeof internalBenchmark>>;

/** Every branch the person may see, over the period and the one before, ranked by each defined metric. */
export async function internalBenchmark(u: CurrentUser, period: Period, today = todayIso()) {
  const prev = previousPeriod(period);
  const branches = u.branches.filter((b) => u.branchIds.includes(b.id));
  const rows: (BranchFigures & { previous: Record<BenchMetricKey, number | null>; change: Record<BenchMetricKey, number | null>; warnings: string[] })[] = [];
  for (const b of branches) {
    const s = branchScope(u, b.id);
    const facts = await membershipFacts(s);
    const [now, before] = await Promise.all([snapshot(s, period, facts, today), snapshot(s, prev, facts, today)]);
    const metrics = figuresOf(now);
    const previous = figuresOf(before);
    rows.push({ id: b.id, name: b.name, metrics, previous, change: branchChange(metrics, previous), warnings: now.warnings });
  }
  const ranked = rankBranches(rows);
  return { period, previous: prev, metrics: BENCH_METRICS, rows: ranked.map((r) => ({ ...r, previous: rows.find((x) => x.id === r.id)!.previous, change: rows.find((x) => x.id === r.id)!.change, warnings: rows.find((x) => x.id === r.id)!.warnings })) };
}

// ── External ──

export type BenchmarkConsent = { optIn: boolean; consentById: string | null; consentAt: string | null; state: string | null };

export const getBenchmarkConsent = async (orgId: string): Promise<BenchmarkConsent> => ({ optIn: false, consentById: null, consentAt: null, state: null, ...((await getSetting<Partial<BenchmarkConsent>>(orgId, "benchmarking")) ?? {}) });

/** The owner's explicit choice to share aggregated monthly figures with the peer pool, or to stop. */
export async function setBenchmarkConsent(u: CurrentUser, optIn: boolean) {
  if (!u.can("settings.manage")) throw new UserError("Only a Super Admin can change benchmarking consent.");
  if (isLocal()) throw new UserError("External benchmarking needs fitron.in: this computer keeps its figures to itself.");
  const gym = await getSetting<{ state?: string }>(u.orgId, "gym");
  await putSetting(u, "benchmarking", { optIn, consentById: optIn ? u.id : null, consentAt: optIn ? new Date().toISOString() : null, state: gym?.state ?? null });
  if (!optIn) {
    // Withdrawn consent takes the gym's figures out of the pool, past months included.
    await db.$transaction(async (tx) => {
      const n = await tx.benchmarkSnapshot.deleteMany({ where: { orgId: u.orgId } });
      await audit(tx, { orgId: u.orgId, userId: u.id, action: "bi.benchmark.withdraw", entity: "Setting", entityId: "benchmarking", after: { removed: n.count } });
    });
  }
}

/** Written by the daily job for an opted-in gym: one aggregated row per month, nothing that identifies a member. */
export async function writeBenchmarkSnapshot(orgId: string, month: string, today = todayIso()) {
  if (isLocal()) return null;
  const consent = await getBenchmarkConsent(orgId);
  if (!consent.optIn) return null;
  const u = await systemScope(orgId);
  const s = await snapshot(u, monthPeriodOf(month), undefined, today);
  const cohort = { sizeBand: sizeBand(s.activeMembers), state: consent.state ?? null };
  const metrics = figuresOf(s);
  await db.benchmarkSnapshot.upsert({ where: { orgId_month: { orgId, month } }, create: { orgId, month, cohort: cohort as Prisma.InputJsonValue, metrics: metrics as Prisma.InputJsonValue }, update: { cohort: cohort as Prisma.InputJsonValue, metrics: metrics as Prisma.InputJsonValue } });
  return { month, cohort };
}

export type ExternalBenchmark = {
  available: boolean;
  reason: string | null;
  month: string;
  cohort: { sizeBand: string; sizeLabel: string; state: string | null } | null;
  cohortGyms: number;
  comparisons: ReturnType<typeof comparePeers>;
  freshness: string | null;
  methodology: string[];
};

const METHODOLOGY = [
  `Only gyms whose owner opted in share figures, as one aggregated row per month; the row holds totals and rates, never a member, invoice or payment.`,
  `A gym is compared within its size band (by active members) and, where enough gyms share it, its state.`,
  `A comparison is shown only with at least ${MIN_COHORT_GYMS} other gyms in the cohort; a single metric needs at least ${MIN_COHORT_GYMS} gyms reporting it.`,
  "Percentiles are nearest-rank over the other gyms' figures; your own gym is never in its own sample.",
  "Raw rows of other gyms are never returned to anyone; the figures shown are quartiles and your percentile.",
  "A better figure than the median is a difference, not a cause: use it to ask questions, not to copy practices blindly.",
];

/** The anonymised peer comparison for the latest complete month, or why it is unavailable. */
export async function externalBenchmark(u: CurrentUser, today = todayIso()): Promise<ExternalBenchmark> {
  // The latest complete month.
  const last = addMonths(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  const base: ExternalBenchmark = { available: false, reason: null, month: last, cohort: null, cohortGyms: 0, comparisons: [], freshness: null, methodology: METHODOLOGY };
  if (isLocal()) return { ...base, reason: "External benchmarking compares gyms on fitron.in. FITRON for Windows keeps its figures on this computer, so it is not available here." };
  const consent = await getBenchmarkConsent(u.orgId);
  if (!consent.optIn) return { ...base, reason: "Your gym has not opted in. A Super Admin can share aggregated monthly figures in return for the comparison." };
  const own = await db.benchmarkSnapshot.findUnique({ where: { orgId_month: { orgId: u.orgId, month: last } } });
  if (!own) return { ...base, reason: `Your gym's figures for ${last} have not been aggregated yet; the daily job writes them overnight.` };
  const cohort = own.cohort as { sizeBand: string; state: string | null };
  // Aggregate across the pool: only the cohort's rows, only their metrics, never identified.
  const pool = await db.benchmarkSnapshot.findMany({ where: { month: last, orgId: { not: u.orgId } }, select: { orgId: true, cohort: true, metrics: true } });
  const sameBand = pool.filter((p) => (p.cohort as { sizeBand: string }).sizeBand === cohort.sizeBand);
  const sameState = sameBand.filter((p) => cohort.state && (p.cohort as { state: string | null }).state === cohort.state);
  const peers: PeerRow[] = (cohortLargeEnough(sameState.length) ? sameState : sameBand).map((p) => ({ orgId: p.orgId, metrics: p.metrics as PeerRow["metrics"] }));
  const narrowed = cohortLargeEnough(sameState.length);
  const sizeLabel = SIZE_BANDS.find((b) => b.key === cohort.sizeBand)?.label ?? cohort.sizeBand;
  const out: ExternalBenchmark = { ...base, cohort: { sizeBand: cohort.sizeBand, sizeLabel, state: narrowed ? cohort.state : null }, cohortGyms: peers.length, freshness: own.createdAt.toISOString() };
  if (!cohortLargeEnough(peers.length)) return { ...out, reason: `Only ${peers.length} other gym${peers.length === 1 ? "" : "s"} in your size band (${sizeLabel}) share figures for ${last}; comparisons open at ${MIN_COHORT_GYMS}.` };
  return { ...out, available: true, comparisons: comparePeers(own.metrics as PeerRow["metrics"], peers, u.orgId) };
}
