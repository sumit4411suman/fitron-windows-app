import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import type { Prisma } from "@/generated/prisma/client";
import { explanationIsGrounded, findings, score, type Evidence, type GrowthInputs, type RecommendationStatus } from "@/lib/domain/growth";
import { monthLabel } from "@/lib/domain/periods";
import { ltvEstimate, monthlyChurnPct, type Period } from "@/lib/domain/metrics";
import { churnWindow } from "@/lib/domain/ltv";
import { aiReady, claude } from "@/lib/integrations/ai";
import { log } from "@/lib/log";
import { membershipFacts, monthPeriodOf, previousPeriod, snapshot } from "./analytics";
import { audit } from "./audit";
import { UserError } from "./errors";
import { getAiSettings } from "./ai-settings";
import { recoveryDashboard } from "./recovery";
import { bestScenario } from "./simulator";
import { fromIso, todayIso } from "./time";

// AI Gym Business Growth Engine (docs/BUSINESS-INTELLIGENCE.md, Module 5). The recommendations are made by rules over
// the other modules' verified outputs (src/lib/domain/growth.ts); the model, when the gym has it on, may word an
// explanation and is checked against the evidence before it is shown. Nothing here acts on the books.

const scope = (u: CurrentUser): Prisma.RecommendationWhereInput => ({ orgId: u.orgId, OR: [{ branchId: null }, { branchId: { in: u.branchIds } }] });

/** The latest complete month and the one before it: the engine looks at whole months so a mid-month dip is not a trend. */
export function growthPeriods(today = todayIso()): { period: Period & { label: string }; previous: Period & { label: string } } {
  const thisMonth = monthPeriodOf(today.slice(0, 7));
  const last = previousPeriod(thisMonth);
  const lastYm = last.from.slice(0, 7);
  const period = { ...monthPeriodOf(lastYm), label: monthLabel(lastYm) };
  const prevYm = previousPeriod(period).from.slice(0, 7);
  const previous = { ...monthPeriodOf(prevYm), label: monthLabel(prevYm) };
  return { period, previous };
}

/** Everything the rules look at, read through the shared analytics layer and the other modules. */
export async function growthInputs(u: CurrentUser, today = todayIso()): Promise<GrowthInputs> {
  const { period, previous } = growthPeriods(today);
  const facts = await membershipFacts(u);
  const [now, before, recovery, best, atRisk] = await Promise.all([
    snapshot(u, period, facts, today),
    snapshot(u, previous, facts, today),
    recoveryDashboard(u, period, today),
    bestScenario(u),
    db.member.count({ where: { orgId: u.orgId, branchId: { in: u.branchIds }, deletedAt: null, walkIn: false, suspended: false, riskScore: { gte: 60 } } }),
  ]);
  const cw = churnWindow(facts.byMember, today, 6);
  const churn = monthlyChurnPct(cw.start, cw.lost, 6);
  const withPlan = facts.members.filter((m) => (facts.byMember.get(m.id) ?? []).length).length;
  const est = ltvEstimate({ avgMonthlyRevenuePerActive: now.activeMembers > 0 ? Math.round(now.revenue / now.activeMembers) : null, monthlyChurnPct: churn, members: withPlan, monthsOfHistory: now.monthsOfHistory });
  const groups = new Map<string, { amount: number; previous: number }>();
  for (const g of now.expenseGroups) groups.set(g.group, { amount: g.amount, previous: 0 });
  for (const g of before.expenseGroups) groups.set(g.group, { amount: groups.get(g.group)?.amount ?? 0, previous: g.amount });
  return {
    period,
    previous,
    revenue: now.revenue,
    revenuePrev: before.revenue,
    expenses: now.expenses,
    expensesPrev: before.expenses,
    net: now.net,
    netPrev: before.net,
    expenseGroups: [...groups.entries()].map(([group, v]) => ({ group, ...v })),
    activeMembers: now.activeMembers,
    activeMembersPrev: before.activeMembers,
    newMembers: now.newMembers,
    newMembersPrev: before.newMembers,
    renewal: now.renewal,
    renewalPrev: before.renewal,
    recovery: { outstanding: recovery.outstanding, eligible: recovery.eligible, openCases: recovery.openCases, pendingActions: recovery.pending, recoveredInPeriod: recovery.recovered, rate: recovery.rate, over90: recovery.over90 },
    ltvEstimate: est.value,
    cac: now.cac,
    atRisk,
    monthsOfHistory: now.monthsOfHistory,
    bestScenario: best,
  };
}

/**
 * Runs the rules and keeps the Recommendation table in step: a finding seen again updates its evidence and lastSeenAt
 * (a decision already taken on it stands); a new one is added; an open one the rules no longer find is dismissed as
 * resolved. Run by the daily job and when the page asks for a refresh.
 */
export async function refreshRecommendations(u: CurrentUser, today = todayIso()) {
  const inputs = await growthInputs(u, today);
  const found = findings(inputs);
  const existing = await db.recommendation.findMany({ where: { orgId: u.orgId, branchId: u.branch === "ALL" ? null : u.branch } });
  const byKey = new Map(existing.map((r) => [r.key, r]));
  let added = 0;
  let updated = 0;
  let resolved = 0;
  const branchId = u.branch === "ALL" ? null : u.branch;
  for (const f of found) {
    const data = { rule: f.rule, title: f.title, body: f.body, action: f.action, link: f.link ?? null, evidence: f.evidence as unknown as Prisma.InputJsonValue, periodFrom: inputs.period.from, periodTo: inputs.period.to, impactPaise: f.impactPaise, impactNote: f.impactNote ?? null, effort: f.effort, urgency: f.urgency, confidence: f.confidence, score: score(f), lastSeenAt: new Date() };
    const row = byKey.get(f.key);
    if (row) {
      await db.recommendation.update({ where: { id: row.id }, data });
      updated++;
    } else {
      await db.recommendation.create({ data: { orgId: u.orgId, branchId, key: f.key, ...data } });
      added++;
    }
  }
  const keys = new Set(found.map((f) => f.key));
  for (const r of existing) {
    if (keys.has(r.key) || r.status !== "OPEN") continue;
    // Only this period's findings can be "no longer found"; older open ones are left for the owner.
    if (r.periodFrom !== inputs.period.from) continue;
    await db.recommendation.update({ where: { id: r.id }, data: { status: "DISMISSED", outcomeNote: "No longer found by the rules on refresh.", decidedAt: new Date() } });
    resolved++;
  }
  return { added, updated, resolved, period: inputs.period };
}

export type RecommendationRow = Awaited<ReturnType<typeof listRecommendations>>[number];

export async function listRecommendations(u: CurrentUser, status: "open" | "all" | RecommendationStatus = "open") {
  return db.recommendation.findMany({
    where: { ...scope(u), ...(status === "open" ? { status: { in: ["OPEN", "ACCEPTED", "DEFERRED"] } } : status === "all" ? {} : { status }) },
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
  });
}

export async function getRecommendation(u: CurrentUser, id: string) {
  const r = await db.recommendation.findFirst({ where: { ...scope(u), id } });
  if (!r) throw new UserError("Recommendation not found.");
  return r;
}

/** The owner's verdict on a recommendation. Accepting it never does anything to the books; it marks it to be acted on. */
export async function decideRecommendation(u: CurrentUser, id: string, status: "ACCEPTED" | "DISMISSED" | "DEFERRED" | "COMPLETED", a: { note?: string; deferredUntil?: string } = {}) {
  if (!u.can("settings.manage") && !u.can("accounting.view")) throw new UserError("Your role can't act on recommendations.");
  const r = await getRecommendation(u, id);
  if (status === "DEFERRED" && !a.deferredUntil) throw new UserError("Say until when.", "deferredUntil");
  if (status === "COMPLETED" && !["ACCEPTED", "OPEN"].includes(r.status)) throw new UserError("Only an accepted recommendation can be completed.");
  const outcome = status === "COMPLETED" ? await measureOutcome(u, r) : undefined;
  await db.$transaction(async (tx) => {
    await tx.recommendation.update({
      where: { id },
      data: {
        status,
        decidedById: u.id,
        decidedAt: new Date(),
        deferredUntil: status === "DEFERRED" ? fromIso(a.deferredUntil!) : null,
        completedAt: status === "COMPLETED" ? new Date() : r.completedAt,
        outcomeNote: a.note?.slice(0, 1000) ?? r.outcomeNote,
        ...(outcome ? { outcome: outcome as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: `bi.recommendation.${status.toLowerCase()}`, entity: "Recommendation", entityId: id, before: { status: r.status }, after: { status, title: r.title } });
  });
}

export type Outcome = { measuredAt: string; period: Period; rows: { metric: string; label: string; then: number | null; now: number | null; unit: Evidence["unit"] }[] };

/** The recommendation's own evidence metrics read again for the latest complete month, so "did it help" has a number. */
export async function measureOutcome(u: CurrentUser, r: { evidence: unknown; periodFrom: string }, today = todayIso()): Promise<Outcome> {
  const inputs = await growthInputs(u, today);
  const evidence = (Array.isArray(r.evidence) ? r.evidence : []) as Evidence[];
  const current: Record<string, number | null> = {
    "fin.revenue": inputs.revenue,
    "fin.expenses": inputs.expenses,
    "ltv.renewalRate": inputs.renewal.rate,
    "ltv.renewalRate.ended": inputs.renewal.ended,
    "recovery.eligible": inputs.recovery.eligible,
    "recovery.pending": inputs.recovery.pendingActions,
    "recovery.rate": inputs.recovery.rate,
    "bench.activeMembers": inputs.activeMembers,
    "members.new": inputs.newMembers,
    "members.atRisk": inputs.atRisk,
    "ltv.cac": inputs.cac,
    "ltv.estimate": inputs.ltvEstimate,
    ...Object.fromEntries(inputs.expenseGroups.map((g) => [`fin.expenses.${g.group}`, g.amount])),
  };
  return { measuredAt: new Date().toISOString(), period: inputs.period, rows: evidence.map((e) => ({ metric: e.metric, label: e.label, then: e.value, now: e.metric in current ? current[e.metric]! : null, unit: e.unit })) };
}

/** Recommendations with a decision and, for completed ones, their measured outcome: how useful the engine has been. */
export async function recommendationHistory(u: CurrentUser) {
  const rows = await db.recommendation.findMany({ where: { ...scope(u), status: { in: ["ACCEPTED", "DISMISSED", "DEFERRED", "COMPLETED"] } }, orderBy: { decidedAt: "desc" }, take: 100 });
  const tally = { accepted: 0, dismissed: 0, deferred: 0, completed: 0 };
  for (const r of rows) {
    if (r.status === "ACCEPTED") tally.accepted++;
    else if (r.status === "DISMISSED") tally.dismissed++;
    else if (r.status === "DEFERRED") tally.deferred++;
    else if (r.status === "COMPLETED") tally.completed++;
  }
  return { rows, tally };
}

const EXPLAIN_SYSTEM = `You explain one business finding of an Indian gym to its owner in plain English, in at most four sentences. Use only the figures given; never add a number that is not in them, never promise a result, and say "estimate" or "forecast" where the figures are marked so. Do not give legal or tax advice. Answer with the explanation only.`;

/**
 * A worded explanation of a recommendation from the model, when the gym has Fitron AI on and the model is reachable.
 * Any rupee amount or percentage in the reply that is not in the evidence makes the reply unusable, and the rule's own
 * wording is shown instead. Null means "use the rule's text".
 */
export async function explainRecommendation(u: CurrentUser, r: { title: string; body: string; evidence: unknown; impactPaise: number | null; confidence: string }): Promise<string | null> {
  if (!u.can("ai.use")) return null;
  const ai = await getAiSettings(u.orgId);
  if (!ai.enabled || !aiReady()) return null;
  const evidence = (Array.isArray(r.evidence) ? r.evidence : []) as Evidence[];
  const lines = evidence.map((e) => `${e.label} (${e.kind}, ${e.period}): ${fmt(e.value, e.unit)}${e.previous !== undefined && e.previous !== null ? `, previously ${fmt(e.previous, e.unit)}` : ""}`);
  try {
    const res = await claude({ system: EXPLAIN_SYSTEM, messages: [{ role: "user", content: `Finding: ${r.title}\nDetail: ${r.body}\nConfidence: ${r.confidence}\nFigures:\n${lines.join("\n")}` }], tools: [], maxTokens: 400, timeoutMs: 20_000 });
    const text = res.content.filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text").map((b) => b.text).join("").trim();
    if (!text || res.stop_reason === "refusal") return null;
    if (!explanationIsGrounded(text, evidence, r.impactPaise ? [r.impactPaise] : [])) {
      log.warn("growth.explanation_rejected", undefined, { title: r.title });
      return null;
    }
    return text;
  } catch (e) {
    log.warn("growth.explanation_failed", e);
    return null;
  }
}

const fmt = (v: number | null, unit: Evidence["unit"]) => (v === null ? "not available" : unit === "paise" ? `₹${Math.round(v / 100).toLocaleString("en-IN")}` : unit === "pct" ? `${v}%` : String(v));
