import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import type { Prisma } from "@/generated/prisma/client";
import { addMonths } from "@/lib/domain/dates";
import { monthlyChurnPct } from "@/lib/domain/metrics";
import { churnWindow } from "@/lib/domain/ltv";
import { checkInputs, compareWithActual, emptyInputs, parseInputs, simulate, SIM_CALC_VERSION, type FixedCosts, type SimInputs, type SimResult } from "@/lib/domain/simulator";
import { activeOn, membershipFacts, monthPeriodOf, snapshot, type BusinessSnapshot } from "./analytics";
import { profitAndLoss } from "./accounting";
import { audit } from "./audit";
import { UserError } from "./errors";
import { getTax } from "./tax";
import { todayIso } from "./time";

// Gym Profit Simulator (docs/BUSINESS-INTELLIGENCE.md, Module 3). The baseline is read from the books; everything the
// owner changes lives in a Scenario row; the arithmetic is src/lib/domain/simulator.ts. No function here writes an
// invoice, payment or expense: the only tables touched are Scenario and the audit log.

/** Which expense category groups feed which fixed-cost line of the simulator. Groups not listed go to "other". */
const GROUP_TO_FIXED: Record<string, keyof FixedCosts> = { Rent: "rent", Utilities: "utilities", Salaries: "salaries", Marketing: "marketing", Maintenance: "maintenance", Equipment: "maintenance", Operating: "software" };

export type Baseline = {
  from: string;
  to: string;
  months: number;
  snapshot: BusinessSnapshot;
  inputs: SimInputs;
  notes: string[];
};

/**
 * The gym's current position as simulator inputs: the active membership mix by plan, the last three months' average
 * fixed costs by category group, other income, GST, observed churn and joiners. The owner edits a copy of this.
 */
export async function baselineInputs(u: CurrentUser, today = todayIso()): Promise<Baseline> {
  const months = 3;
  const to = today;
  const from = `${addMonths(`${today.slice(0, 7)}-01`, -(months - 1)).slice(0, 7)}-01`;
  const facts = await membershipFacts(u);
  const [snap, pl, tax] = await Promise.all([snapshot(u, { from, to }, facts, today), profitAndLoss(u, { from, to }), getTax(u.orgId)]);
  // Membership mix: members active today by the plan covering today, with the plan's list price and cycle.
  const plans = await db.membershipPlan.findMany({ where: { orgId: u.orgId }, select: { id: true, name: true, months: true, price: true, discount: true, gstApplicable: true, status: true } });
  const mix = new Map<string, { members: number; net: number[]; plan: (typeof plans)[number] | undefined }>();
  for (const m of facts.members) {
    if (m.suspended) continue;
    const cur = (facts.byMember.get(m.id) ?? []).find((x) => x.start <= today && x.end >= today);
    if (!cur) continue;
    const e = mix.get(cur.planName) ?? { members: 0, net: [], plan: plans.find((p) => p.name === cur.planName) };
    e.members++;
    e.net.push(cur.net);
    mix.set(cur.planName, e);
  }
  const notes: string[] = [];
  const planLines = [...mix.entries()].map(([name, e]) => {
    const months = e.plan?.months ?? 1;
    const list = e.plan?.price ?? Math.round(e.net.reduce((s, x) => s + x, 0) / e.net.length);
    const avgNet = Math.round(e.net.reduce((s, x) => s + x, 0) / e.net.length);
    const discountPct = list > 0 ? Math.max(0, Math.round((1 - avgNet / list) * 1000) / 10) : 0;
    return { name, members: e.members, price: list, months, discountPct };
  });
  for (const p of plans.filter((p) => p.status === "ACTIVE" && !mix.has(p.name))) planLines.push({ name: p.name, members: 0, price: p.price, months: p.months, discountPct: 0 });
  // Membership prices in FITRON are before GST (the invoice adds it), so the simulator starts with GST excluded.
  const fixed: FixedCosts = { rent: 0, utilities: 0, salaries: 0, marketing: 0, maintenance: 0, software: 0, other: 0 };
  for (const g of pl.expenseGroups) fixed[GROUP_TO_FIXED[g.key] ?? "other"] += Math.round(g.amount / months);
  const otherIncome = Math.round(pl.revenue.filter((r) => r.key !== "Membership").reduce((s, r) => s + r.amount, 0) / months);
  const cw = churnWindow(facts.byMember, today, 6);
  const churn = monthlyChurnPct(cw.start, cw.lost, 6);
  if (churn === null) notes.push("No six-month churn could be observed yet: monthly churn starts at 0%; enter your own estimate.");
  const joiners = Math.round(snap.newMembers / months);
  if (!planLines.length) notes.push("No membership plans or active members yet: add plans to the mix by hand.");
  notes.push(`Fixed costs are the average of the last ${months} months' expenses by category group (depreciation and capital purchases left out).`);
  notes.push("Membership prices are shown before GST, as the plans are set up; GST is added on top and never counted as income.");
  const inputs: SimInputs = {
    ...emptyInputs(Number(today.slice(5, 7))),
    months: 12,
    plans: planLines,
    pricesIncludeGst: false,
    gstRatePct: Number(tax.rate ?? 18),
    newMembersPerMonth: joiners,
    monthlyChurnPct: churn ?? 0,
    otherIncomeMonthly: otherIncome,
    fixed,
    variablePerMember: 0,
    paymentFeePct: 0,
    refundPct: 0,
    taxPct: 0,
    startMonth: Number(addMonths(`${today.slice(0, 7)}-01`, 1).slice(5, 7)),
  };
  return { from, to, months, snapshot: snap, inputs, notes };
}

const scope = (u: CurrentUser): Prisma.ScenarioWhereInput => ({ orgId: u.orgId, OR: [{ branchId: null }, { branchId: { in: u.branchIds } }] });

export async function listScenarios(u: CurrentUser, includeArchived = false) {
  return db.scenario.findMany({ where: { ...scope(u), ...(includeArchived ? {} : { archivedAt: null }) }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, note: true, results: true, baseline: true, inputs: true, calcVersion: true, baselineFrom: true, baselineTo: true, createdAt: true, updatedAt: true, archivedAt: true, branchId: true } });
}

export type ScenarioRow = Awaited<ReturnType<typeof listScenarios>>[number];

/** The saved results, recomputed if the formula moved on since they were saved (the saved copy is kept for the record). */
export function scenarioResult(s: { inputs: unknown; results: unknown; calcVersion: number }): { result: SimResult; recomputed: boolean } {
  if (s.calcVersion === SIM_CALC_VERSION && s.results && typeof s.results === "object") return { result: s.results as SimResult, recomputed: false };
  return { result: simulate(parseInputs(s.inputs)), recomputed: true };
}

export const scenarioInputs = (s: { inputs: unknown }) => parseInputs(s.inputs);

export async function getScenario(u: CurrentUser, id: string) {
  const s = await db.scenario.findFirst({ where: { ...scope(u), id } });
  if (!s) throw new UserError("Scenario not found.");
  return s;
}

export type ScenarioSave = { name: string; note?: string; inputs: SimInputs };

/** Saves a new scenario with its baseline (the books as they stand) and the deterministic result of its inputs. */
export async function createScenario(u: CurrentUser, s: ScenarioSave) {
  const check = checkInputs(s.inputs);
  if (!check.ok) throw new UserError(check.error);
  const base = await baselineInputs(u);
  const results = simulate(s.inputs);
  return db.$transaction(async (tx) => {
    const row = await tx.scenario.create({
      data: {
        orgId: u.orgId,
        branchId: u.branch === "ALL" ? null : u.branch,
        name: s.name.trim().slice(0, 120) || "Untitled scenario",
        note: s.note?.trim().slice(0, 2000) || null,
        baseline: { inputs: base.inputs, snapshot: base.snapshot } as unknown as Prisma.InputJsonValue,
        inputs: s.inputs as unknown as Prisma.InputJsonValue,
        results: results as unknown as Prisma.InputJsonValue,
        calcVersion: SIM_CALC_VERSION,
        baselineFrom: base.from,
        baselineTo: base.to,
        createdById: u.id,
      },
    });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "bi.scenario.create", entity: "Scenario", entityId: row.id, after: { name: row.name, months: s.inputs.months, operatingProfit: results.totals.operatingProfit } });
    return row;
  });
}

export async function updateScenario(u: CurrentUser, id: string, s: Partial<ScenarioSave>) {
  const before = await getScenario(u, id);
  if (before.archivedAt) throw new UserError("This scenario is archived. Duplicate it to work on it.");
  const inputs = s.inputs ?? parseInputs(before.inputs);
  const check = checkInputs(inputs);
  if (!check.ok) throw new UserError(check.error);
  const results = simulate(inputs);
  await db.$transaction(async (tx) => {
    await tx.scenario.update({ where: { id }, data: { ...(s.name !== undefined ? { name: s.name.trim().slice(0, 120) || before.name } : {}), ...(s.note !== undefined ? { note: s.note.trim().slice(0, 2000) || null } : {}), inputs: inputs as unknown as Prisma.InputJsonValue, results: results as unknown as Prisma.InputJsonValue, calcVersion: SIM_CALC_VERSION } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "bi.scenario.update", entity: "Scenario", entityId: id, before: { name: before.name }, after: { name: s.name ?? before.name, operatingProfit: results.totals.operatingProfit } });
  });
}

export async function duplicateScenario(u: CurrentUser, id: string) {
  const s = await getScenario(u, id);
  return createScenario(u, { name: `${s.name} (copy)`, note: s.note ?? undefined, inputs: parseInputs(s.inputs) });
}

export async function archiveScenario(u: CurrentUser, id: string, archived = true) {
  const s = await getScenario(u, id);
  await db.$transaction(async (tx) => {
    await tx.scenario.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: archived ? "bi.scenario.archive" : "bi.scenario.restore", entity: "Scenario", entityId: id, after: { name: s.name } });
  });
}

/**
 * The forecast's months that have since passed, against the books: a scenario saved in July compared with August's
 * and September's actual revenue, expenses, profit and active members. Forecast months still in the future are skipped.
 */
export async function scenarioVersusActual(u: CurrentUser, id: string, today = todayIso()) {
  const s = await getScenario(u, id);
  const { result } = scenarioResult(s);
  const inputs = parseInputs(s.inputs);
  const facts = await membershipFacts(u);
  // Forecast month k is the k-th calendar month after the baseline's last month.
  const firstMonth = addMonths(`${s.baselineTo.slice(0, 7)}-01`, 1).slice(0, 7);
  const out: { month: string; rows: ReturnType<typeof compareWithActual> }[] = [];
  for (let k = 0; k < result.months.length; k++) {
    const ym = addMonths(`${firstMonth}-01`, k).slice(0, 7);
    const p = monthPeriodOf(ym);
    if (p.to >= today) break;
    const pl = await profitAndLoss(u, p);
    const f = result.months[k]!;
    out.push({ month: ym, rows: compareWithActual({ revenue: f.revenue + f.otherIncome - f.refunds, operatingExpenses: f.operatingExpenses, operatingProfit: f.operatingProfit, activeEnd: f.activeEnd }, { revenue: pl.totalRevenue, expenses: pl.totalExpenses + pl.depreciation + pl.disposalLoss, net: pl.net, activeMembers: activeOn(facts, p.to) }) });
  }
  return { scenario: s, inputs, result, months: out, firstMonth };
}

/** The scenario report as rows for CSV or Excel: assumptions, then the month-by-month forecast. */
export function scenarioReportRows(s: { name: string; baselineFrom: string; baselineTo: string; createdAt: Date }, inputs: SimInputs, r: SimResult) {
  const rupees = (p: number) => Math.round(p) / 100;
  const assumptions: (string | number)[][] = [
    ["Scenario", s.name],
    ["Baseline read from the books", `${s.baselineFrom} to ${s.baselineTo}`],
    ["Saved on", s.createdAt.toISOString().slice(0, 10)],
    ["Calculation version", r.calcVersion],
    ["Forecast months", inputs.months],
    ["Prices include GST", inputs.pricesIncludeGst ? "Yes" : "No"],
    ["GST rate %", inputs.gstRatePct],
    ["New members a month", inputs.newMembersPerMonth],
    ["Monthly churn %", inputs.monthlyChurnPct],
    ["Other income a month (₹)", rupees(inputs.otherIncomeMonthly)],
    ["Variable cost per member (₹)", rupees(inputs.variablePerMember)],
    ["Payment fees %", inputs.paymentFeePct],
    ["Refunds %", inputs.refundPct],
    ["Income tax %", inputs.taxPct],
    ...inputs.plans.map((p) => [`Plan: ${p.name}`, `${p.members} members · ₹${rupees(p.price)} per ${p.months} month(s) · ${p.discountPct}% discount`]),
    ...(Object.keys(inputs.fixed) as (keyof FixedCosts)[]).map((k) => [`Fixed cost: ${k}`, rupees(inputs.fixed[k])]),
    ["Average monthly fee before GST (₹)", rupees(r.avgMonthlyFee)],
    ["Contribution per member (₹)", rupees(r.contributionPerMember)],
    ["Break-even members", r.breakEvenMembers ?? "n/a"],
    ["Break-even monthly revenue (₹)", r.breakEvenRevenue === null ? "n/a" : rupees(r.breakEvenRevenue)],
    ["Minimum monthly fee for target (₹)", r.minFeeForTarget === null ? "n/a" : rupees(r.minFeeForTarget)],
    ["Operating margin %", r.operatingMarginPct ?? "n/a"],
    ...r.notes.map((n) => ["Note", n]),
  ];
  const columns = ["Month", "Active at start", "Joined", "Left", "Active at end", "Revenue (₹)", "Other income (₹)", "GST (₹)", "Refunds (₹)", "Fixed costs (₹)", "Variable costs (₹)", "Payment fees (₹)", "Operating expenses (₹)", "Operating profit (₹)", "Tax (₹)", "Net profit (₹)", "Cash in (₹)", "Cash out (₹)", "Net cash (₹)"];
  const rows: (string | number)[][] = r.months.map((m) => [m.index, m.activeStart, m.joined, m.left, m.activeEnd, rupees(m.revenue), rupees(m.otherIncome), rupees(m.gst), rupees(m.refunds), rupees(m.fixedCosts), rupees(m.variableCosts), rupees(m.paymentFees), rupees(m.operatingExpenses), rupees(m.operatingProfit), rupees(m.tax), rupees(m.netProfit), rupees(m.cashIn), rupees(m.cashOut), rupees(m.netCash)]);
  const t = r.totals;
  rows.push(["Total", "", t.joined, t.left, t.activeEnd, rupees(t.revenue), rupees(t.otherIncome), rupees(t.gst), rupees(t.refunds), rupees(t.fixedCosts), rupees(t.variableCosts), rupees(t.paymentFees), rupees(t.operatingExpenses), rupees(t.operatingProfit), rupees(t.tax), rupees(t.netProfit), rupees(t.cashIn), rupees(t.cashOut), rupees(t.netCash)]);
  return { assumptions, columns, rows };
}

/** The scenario, if any, whose forecast beats its own baseline inputs by the most (for the Growth Engine). */
export async function bestScenario(u: CurrentUser) {
  const list = await listScenarios(u);
  let best: { id: string; name: string; extraProfit: number; months: number } | null = null;
  for (const s of list) {
    const base = (s.baseline as { inputs?: unknown } | null)?.inputs;
    if (!base) continue;
    const inputs = parseInputs(s.inputs);
    const b = simulate({ ...parseInputs(base), months: inputs.months });
    const r = scenarioResult(s).result;
    const extra = r.totals.operatingProfit - b.totals.operatingProfit;
    if (extra > 0 && (!best || extra > best.extraProfit)) best = { id: s.id, name: s.name, extraProfit: extra, months: inputs.months };
  }
  return best;
}
