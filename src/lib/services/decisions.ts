import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import type { Prisma } from "@/generated/prisma/client";
import { addDays } from "@/lib/domain/dates";
import { checkInputs, parseInputs, simulate, SIM_CALC_VERSION, threeScenarios, type SimInputs, type SimResult } from "@/lib/domain/simulator";
import { activeOn, membershipFacts, snapshot } from "./analytics";
import { audit } from "./audit";
import { UserError } from "./errors";
import { baselineInputs } from "./simulator";
import { fromIso, todayIso, toIso } from "./time";

// FITRON Business Decision Simulator (docs/BUSINESS-INTELLIGENCE.md, Module 4). A decision holds an objective,
// constraints, weighted criteria and options; each option's money runs through the Profit Simulator (the same
// simulate() as Module 3, never a second formula) and carries the owner's own 1–5 scores, kept apart from the
// calculated figures. Every save adds a revision; approval, implementation and review are recorded with dates.

export const DECISION_CATEGORIES = { PRICING: "Pricing change", PROMOTION: "Promotion or offer", HIRING: "Trainer or staff hiring", EQUIPMENT: "Equipment purchase", HOURS: "Operating hours", OTHER: "Other" } as const;
export type DecisionCategory = keyof typeof DECISION_CATEGORIES;
export const DECISION_STATUS = { DRAFT: "Draft", APPROVED: "Approved", REJECTED: "Rejected", DEFERRED: "Deferred", IMPLEMENTED: "Implemented", REVIEWED: "Reviewed" } as const;
export type DecisionStatus = keyof typeof DECISION_STATUS;

export type Criterion = { key: string; label: string; weight: number };
export const DEFAULT_CRITERIA: Criterion[] = [
  { key: "financial", label: "Financial result (calculated)", weight: 50 },
  { key: "members", label: "Member experience", weight: 20 },
  { key: "staff", label: "Staff and operations", weight: 15 },
  { key: "risk", label: "Risk and reversibility", weight: 15 },
];

const scope = (u: CurrentUser): Prisma.DecisionWhereInput => ({ orgId: u.orgId, OR: [{ branchId: null }, { branchId: { in: u.branchIds } }] });

export function parseCriteria(raw: unknown): Criterion[] {
  if (!Array.isArray(raw)) return DEFAULT_CRITERIA;
  const out = raw
    .map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>) : {}))
    .filter((c) => typeof c.key === "string" && typeof c.label === "string")
    .map((c) => ({ key: String(c.key).slice(0, 40), label: String(c.label).slice(0, 80), weight: Math.max(0, Math.min(100, Number(c.weight) || 0)) }));
  return out.length ? out : DEFAULT_CRITERIA;
}

export const parseScores = (raw: unknown): Record<string, number> => {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.max(1, Math.min(5, Math.round(Number(v) || 0)))]).filter(([, v]) => (v as number) >= 1));
};

export type DecisionBaseline = { from: string; to: string; revenue: number; expenses: number; net: number; activeMembers: number; newMembers: number; renewalRate: number | null; readAt: string };

export async function listDecisions(u: CurrentUser) {
  return db.decision.findMany({ where: scope(u), orderBy: { updatedAt: "desc" }, include: { options: { select: { id: true, name: true, results: true } } } });
}

export async function getDecision(u: CurrentUser, id: string) {
  const d = await db.decision.findFirst({ where: { ...scope(u), id }, include: { options: { orderBy: { createdAt: "asc" } }, revisions: { orderBy: { version: "desc" } } } });
  if (!d) throw new UserError("Decision not found.");
  return d;
}

export type DecisionInput = { title: string; category: DecisionCategory; objective: string; constraints?: string; criteria?: Criterion[]; reviewDays?: number; branchId?: string | null };

const canDecide = (u: CurrentUser) => u.can("settings.manage");

/** A new decision with the books' current figures as its baseline and the simulator's own baseline as its first option. */
export async function createDecision(u: CurrentUser, i: DecisionInput) {
  if (!(i.category in DECISION_CATEGORIES)) throw new UserError("Pick a category.", "category");
  if (!i.title.trim()) throw new UserError("Give the decision a title.", "title");
  if (!i.objective.trim()) throw new UserError("Say what the decision should achieve.", "objective");
  const today = todayIso();
  const base = await baselineInputs(u, today);
  const baseline: DecisionBaseline = { from: base.from, to: base.to, revenue: base.snapshot.revenue, expenses: base.snapshot.expenses, net: base.snapshot.net, activeMembers: base.snapshot.activeMembers, newMembers: base.snapshot.newMembers, renewalRate: base.snapshot.renewal.rate, readAt: new Date().toISOString() };
  const criteria = i.criteria?.length ? i.criteria : DEFAULT_CRITERIA;
  return db.$transaction(async (tx) => {
    const d = await tx.decision.create({
      data: {
        orgId: u.orgId,
        branchId: i.branchId ?? (u.branch === "ALL" ? null : u.branch),
        title: i.title.trim().slice(0, 160),
        category: i.category,
        objective: i.objective.trim().slice(0, 2000),
        constraints: i.constraints?.trim().slice(0, 2000) || null,
        criteria: criteria as unknown as Prisma.InputJsonValue,
        baseline: baseline as unknown as Prisma.InputJsonValue,
        reviewDays: Math.max(14, Math.min(365, Math.round(i.reviewDays ?? 90))),
        createdById: u.id,
      },
    });
    const results = simulate(base.inputs);
    await tx.decisionOption.create({ data: { decisionId: d.id, orgId: u.orgId, name: "Do nothing (baseline)", description: "The gym as it stands, from the books.", inputs: base.inputs as unknown as Prisma.InputJsonValue, results: results as unknown as Prisma.InputJsonValue, calcVersion: SIM_CALC_VERSION, scores: {} } });
    await tx.decisionRevision.create({ data: { decisionId: d.id, orgId: u.orgId, version: 1, note: "Created", snapshot: { title: d.title, objective: d.objective, constraints: d.constraints, criteria, baseline, options: [] } as unknown as Prisma.InputJsonValue, byId: u.id } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "bi.decision.create", entity: "Decision", entityId: d.id, after: { title: d.title, category: d.category } });
    return d;
  });
}

/** Saves a revision of the decision's own fields (objective, constraints, criteria), numbered after the last. */
export async function updateDecision(u: CurrentUser, id: string, i: Partial<DecisionInput>, note = "Edited") {
  const d = await getDecision(u, id);
  if (d.status === "REVIEWED") throw new UserError("A reviewed decision is history; start a new one.");
  await db.$transaction(async (tx) => {
    const after = await tx.decision.update({
      where: { id },
      data: {
        ...(i.title !== undefined ? { title: i.title.trim().slice(0, 160) || d.title } : {}),
        ...(i.category !== undefined && i.category in DECISION_CATEGORIES ? { category: i.category } : {}),
        ...(i.objective !== undefined ? { objective: i.objective.trim().slice(0, 2000) || d.objective } : {}),
        ...(i.constraints !== undefined ? { constraints: i.constraints.trim().slice(0, 2000) || null } : {}),
        ...(i.criteria !== undefined ? { criteria: (i.criteria.length ? i.criteria : DEFAULT_CRITERIA) as unknown as Prisma.InputJsonValue } : {}),
        ...(i.reviewDays !== undefined ? { reviewDays: Math.max(14, Math.min(365, Math.round(i.reviewDays))) } : {}),
        version: d.version + 1,
      },
    });
    await revision(tx, u, after.id, after.version, note);
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "bi.decision.update", entity: "Decision", entityId: id, before: { title: d.title, version: d.version }, after: { title: after.title, version: after.version } });
  });
}

async function revision(tx: Prisma.TransactionClient, u: CurrentUser, decisionId: string, version: number, note: string) {
  const d = await tx.decision.findUniqueOrThrow({ where: { id: decisionId }, include: { options: true } });
  const snapshot = { title: d.title, objective: d.objective, constraints: d.constraints, criteria: d.criteria, baseline: d.baseline, status: d.status, selectedId: d.selectedId, rationale: d.rationale, options: d.options.map((o) => ({ id: o.id, name: o.name, inputs: o.inputs, scores: o.scores, operatingProfit: (o.results as { totals?: { operatingProfit?: number } }).totals?.operatingProfit ?? null })) };
  await tx.decisionRevision.create({ data: { decisionId, orgId: u.orgId, version, note: note.slice(0, 200), snapshot: snapshot as unknown as Prisma.InputJsonValue, byId: u.id } });
}

export type OptionInput = { name: string; description?: string; inputs: SimInputs; scores?: Record<string, number>; benefits?: string; costs?: string; risks?: string };

/** Adds or edits an option: its money through the Profit Simulator, its scores as given. Each save is a decision revision. */
export async function saveOption(u: CurrentUser, decisionId: string, o: OptionInput, optionId?: string) {
  const d = await getDecision(u, decisionId);
  if (["IMPLEMENTED", "REVIEWED"].includes(d.status)) throw new UserError("Options can't change once the decision is implemented.");
  const check = checkInputs(o.inputs);
  if (!check.ok) throw new UserError(check.error);
  const results = simulate(o.inputs);
  const data = {
    name: o.name.trim().slice(0, 120) || "Option",
    description: o.description?.trim().slice(0, 2000) || null,
    inputs: o.inputs as unknown as Prisma.InputJsonValue,
    results: results as unknown as Prisma.InputJsonValue,
    calcVersion: SIM_CALC_VERSION,
    scores: parseScores(o.scores) as unknown as Prisma.InputJsonValue,
    benefits: o.benefits?.trim().slice(0, 2000) || null,
    costs: o.costs?.trim().slice(0, 2000) || null,
    risks: o.risks?.trim().slice(0, 2000) || null,
  };
  return db.$transaction(async (tx) => {
    const row = optionId
      ? await tx.decisionOption.update({ where: { id: optionId, decisionId }, data })
      : await tx.decisionOption.create({ data: { ...data, decisionId, orgId: u.orgId } });
    const version = d.version + 1;
    await tx.decision.update({ where: { id: decisionId }, data: { version } });
    await revision(tx, u, decisionId, version, `${optionId ? "Edited" : "Added"} option "${row.name}"`);
    await audit(tx, { orgId: u.orgId, userId: u.id, action: optionId ? "bi.decision.option.update" : "bi.decision.option.create", entity: "DecisionOption", entityId: row.id, after: { decisionId, name: row.name, operatingProfit: results.totals.operatingProfit } });
    return row;
  });
}

export async function removeOption(u: CurrentUser, decisionId: string, optionId: string) {
  const d = await getDecision(u, decisionId);
  if (["IMPLEMENTED", "REVIEWED"].includes(d.status)) throw new UserError("Options can't change once the decision is implemented.");
  if (d.selectedId === optionId) throw new UserError("This is the chosen option; choose another first.");
  const o = d.options.find((x) => x.id === optionId);
  if (!o) throw new UserError("Option not found.");
  await db.$transaction(async (tx) => {
    await tx.decisionOption.delete({ where: { id: optionId } });
    const version = d.version + 1;
    await tx.decision.update({ where: { id: decisionId }, data: { version } });
    await revision(tx, u, decisionId, version, `Removed option "${o.name}"`);
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "bi.decision.option.remove", entity: "DecisionOption", entityId: optionId, before: { name: o.name } });
  });
}

/** The owner's verdict: approve (with the chosen option and the reasoning), reject or defer. Never automatic. */
export async function decide(u: CurrentUser, id: string, verdict: "APPROVED" | "REJECTED" | "DEFERRED", a: { optionId?: string; rationale: string; deferredUntil?: string }) {
  if (!canDecide(u)) throw new UserError("Only a Super Admin can approve, reject or defer a decision.");
  const d = await getDecision(u, id);
  if (["IMPLEMENTED", "REVIEWED"].includes(d.status)) throw new UserError("This decision is already implemented.");
  if (!a.rationale.trim()) throw new UserError("Write the reasoning; it is what the review later compares against.", "rationale");
  if (verdict === "APPROVED" && !d.options.some((o) => o.id === a.optionId)) throw new UserError("Choose the option you are approving.", "optionId");
  if (verdict === "DEFERRED" && !a.deferredUntil) throw new UserError("Say until when.", "deferredUntil");
  await db.$transaction(async (tx) => {
    const version = d.version + 1;
    await tx.decision.update({ where: { id }, data: { status: verdict, selectedId: verdict === "APPROVED" ? a.optionId : d.selectedId, rationale: a.rationale.trim().slice(0, 4000), decidedById: u.id, decidedAt: new Date(), deferredUntil: verdict === "DEFERRED" ? fromIso(a.deferredUntil!) : null, version } });
    await revision(tx, u, id, version, `${DECISION_STATUS[verdict]}`);
    await audit(tx, { orgId: u.orgId, userId: u.id, action: `bi.decision.${verdict.toLowerCase()}`, entity: "Decision", entityId: id, before: { status: d.status }, after: { status: verdict, optionId: a.optionId ?? null } });
  });
}

/** Records the day the approved option went live. The review date is that plus the decision's review period. */
export async function markImplemented(u: CurrentUser, id: string, implementedOn: string) {
  if (!canDecide(u)) throw new UserError("Only a Super Admin can record implementation.");
  const d = await getDecision(u, id);
  if (d.status !== "APPROVED") throw new UserError("Only an approved decision can be implemented.");
  if (implementedOn > todayIso()) throw new UserError("The implementation date can't be in the future.", "implementedOn");
  await db.$transaction(async (tx) => {
    const version = d.version + 1;
    await tx.decision.update({ where: { id }, data: { status: "IMPLEMENTED", implementedOn: fromIso(implementedOn), version } });
    await revision(tx, u, id, version, `Implemented on ${implementedOn}`);
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "bi.decision.implement", entity: "Decision", entityId: id, after: { implementedOn } });
  });
}

export type Review = { from: string; to: string; actual: { revenue: number; expenses: number; net: number; activeMembers: number; newMembers: number; renewalRate: number | null }; projected: { revenue: number; expenses: number; net: number; activeMembers: number } | null; baseline: DecisionBaseline; monthsCovered: number; ready: boolean };

/**
 * What the books show since implementation, next to the chosen option's forecast for the same number of months and
 * the baseline read when the decision was made. Ready once the review period has passed; shown as "so far" before.
 */
export async function reviewFigures(u: CurrentUser, id: string, today = todayIso()): Promise<Review | null> {
  const d = await getDecision(u, id);
  if (!d.implementedOn) return null;
  const from = toIso(d.implementedOn);
  const reviewTo = addDays(from, d.reviewDays - 1);
  const to = reviewTo < today ? reviewTo : addDays(today, -1);
  if (to < from) return null;
  const facts = await membershipFacts(u);
  const s = await snapshot(u, { from, to }, facts, today);
  const monthsCovered = Math.max(1, Math.round(((fromIso(to).getTime() - fromIso(from).getTime()) / 86_400_000 + 1) / 30.44));
  const chosen = d.options.find((o) => o.id === d.selectedId);
  let projected: Review["projected"] = null;
  if (chosen) {
    const r = simulate({ ...parseInputs(chosen.inputs), months: monthsCovered });
    projected = { revenue: r.totals.revenue + r.totals.otherIncome - r.totals.refunds, expenses: r.totals.operatingExpenses, net: r.totals.operatingProfit, activeMembers: r.totals.activeEnd };
  }
  return { from, to, actual: { revenue: s.revenue, expenses: s.expenses, net: s.net, activeMembers: activeOn(facts, to), newMembers: s.newMembers, renewalRate: s.renewal.rate }, projected, baseline: d.baseline as unknown as DecisionBaseline, monthsCovered, ready: reviewTo < today };
}

/** Closes the loop: the actual figures and the lessons are written on the decision. */
export async function recordReview(u: CurrentUser, id: string, lessons: string) {
  if (!canDecide(u)) throw new UserError("Only a Super Admin can record a review.");
  const d = await getDecision(u, id);
  if (d.status !== "IMPLEMENTED") throw new UserError("Only an implemented decision can be reviewed.");
  const r = await reviewFigures(u, id);
  if (!r) throw new UserError("Nothing to review yet.");
  await db.$transaction(async (tx) => {
    const version = d.version + 1;
    await tx.decision.update({ where: { id }, data: { status: "REVIEWED", reviewedAt: new Date(), actual: { from: r.from, to: r.to, ...r.actual, projected: r.projected } as unknown as Prisma.InputJsonValue, lessons: lessons.trim().slice(0, 4000) || null, version } });
    await revision(tx, u, id, version, "Reviewed");
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "bi.decision.review", entity: "Decision", entityId: id, after: { from: r.from, to: r.to, net: r.actual.net, projectedNet: r.projected?.net ?? null } });
  });
}

/** Side by side: each option's calculated totals, its three variants, and its weighted score with the financial criterion filled from the figures. */
export function compareOptions(options: { id: string; name: string; inputs: unknown; results: unknown; calcVersion: number; scores: unknown }[], criteria: Criterion[]) {
  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0) || 1;
  const rows = options.map((o) => {
    const inputs = parseInputs(o.inputs);
    const result = o.calcVersion === SIM_CALC_VERSION ? (o.results as SimResult) : simulate(inputs);
    const variants = threeScenarios(inputs);
    return { id: o.id, name: o.name, inputs, result, variants, scores: parseScores(o.scores) };
  });
  // Financial score: 5 for the best operating profit, 1 for the worst, scaled between.
  const profits = rows.map((r) => r.result.totals.operatingProfit);
  const hi = Math.max(...profits);
  const lo = Math.min(...profits);
  return rows.map((r) => {
    const financial = hi === lo ? 3 : 1 + Math.round(((r.result.totals.operatingProfit - lo) / (hi - lo)) * 4);
    const per = criteria.map((c) => ({ key: c.key, label: c.label, weight: c.weight, score: c.key === "financial" ? financial : (r.scores[c.key] ?? null), calculated: c.key === "financial" }));
    const scored = per.filter((p) => p.score !== null);
    const weighted = scored.length ? Math.round((scored.reduce((s, p) => s + p.score! * p.weight, 0) / (scored.reduce((s, p) => s + p.weight, 0) || 1)) * 10) / 10 : null;
    const unscored = per.filter((p) => p.score === null).map((p) => p.label);
    return { ...r, per, weighted, unscored, totalWeight };
  });
}
