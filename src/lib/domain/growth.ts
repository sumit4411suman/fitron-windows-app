// AI Gym Business Growth Engine: the rules that turn verified metrics into recommendations with evidence
// (docs/BUSINESS-INTELLIGENCE.md, Module 5). Pure: the figures come from the other modules through
// src/lib/services/growth.ts, and the model (when on) only words them; it never produces a number of its own.

export type Level = "LOW" | "MEDIUM" | "HIGH";

export type Evidence = { metric: string; label: string; value: number | null; previous?: number | null; unit: "paise" | "count" | "pct" | "months" | "ratio"; period: string; kind: "actual" | "estimate" };

export type Finding = {
  /** Stable per finding and period, so a refresh updates rather than duplicates. */
  key: string;
  rule: string;
  title: string;
  body: string;
  action: string;
  link?: string;
  evidence: Evidence[];
  impactPaise: number | null;
  impactNote?: string;
  effort: Level;
  urgency: Level;
  confidence: Level;
};

/** Everything the rules look at, for one period and the one before it. All figures are actuals unless named estimates. */
export type GrowthInputs = {
  period: { from: string; to: string; label: string };
  previous: { from: string; to: string; label: string };
  revenue: number;
  revenuePrev: number;
  expenses: number;
  expensesPrev: number;
  net: number;
  netPrev: number;
  /** Expense by category group, now and before */
  expenseGroups: { group: string; amount: number; previous: number }[];
  activeMembers: number;
  activeMembersPrev: number;
  newMembers: number;
  newMembersPrev: number;
  renewal: { ended: number; renewed: number; rate: number | null };
  renewalPrev: { ended: number; renewed: number; rate: number | null };
  recovery: { outstanding: number; eligible: number; openCases: number; pendingActions: number; recoveredInPeriod: number; rate: number | null; over90: number };
  ltvEstimate: number | null;
  cac: number | null;
  atRisk: number;
  /** Months of history the gym has */
  monthsOfHistory: number;
  /** A saved simulator scenario that beats the baseline: name and the extra operating profit over its period */
  bestScenario: { id: string; name: string; extraProfit: number; months: number } | null;
};

const L = (n: number, lo: number, hi: number): Level => (n >= hi ? "HIGH" : n >= lo ? "MEDIUM" : "LOW");

/** Evidence-backed findings, or nothing when the data cannot support one. Rules are listed in docs/BUSINESS-INTELLIGENCE.md. */
export function findings(i: GrowthInputs): Finding[] {
  const out: Finding[] = [];
  const key = (rule: string) => `${rule}:${i.period.to.slice(0, 7)}`;
  const ev = (metric: string, label: string, value: number | null, unit: Evidence["unit"], previous?: number | null, kind: Evidence["kind"] = "actual"): Evidence => ({ metric, label, value, previous, unit, period: i.period.label, kind });
  const change = (now: number, prev: number) => (prev > 0 ? (now - prev) / prev : null);

  // 1. Renewals fell against the previous period. Needs enough endings to be a trend, not noise.
  if (i.renewal.ended >= 10 && i.renewalPrev.ended >= 10 && i.renewal.rate !== null && i.renewalPrev.rate !== null && i.renewal.rate <= i.renewalPrev.rate - 10) {
    const lost = i.renewal.ended - i.renewal.renewed;
    out.push({
      key: key("renewals.decline"),
      rule: "renewals.decline",
      title: `Renewals fell to ${i.renewal.rate}% from ${i.renewalPrev.rate}%`,
      body: `Of ${i.renewal.ended} memberships that ended in ${i.period.label}, ${i.renewal.renewed} were renewed within 30 days, against ${i.renewalPrev.renewed} of ${i.renewalPrev.ended} in ${i.previous.label}. Review the cohorts that lapsed and the follow-up process before changing prices.`,
      action: "Open the renewal opportunities in Revenue Recovery and the cohort view in Member Lifetime Value.",
      link: "/intelligence/recovery?kind=RENEWAL",
      evidence: [ev("ltv.renewalRate", "Renewal rate", i.renewal.rate, "pct", i.renewalPrev.rate), ev("ltv.renewalRate.ended", "Memberships ended", i.renewal.ended, "count", i.renewalPrev.ended)],
      impactPaise: null,
      impactNote: `${lost} members did not renew; their last plans are listed as renewal opportunities.`,
      effort: "MEDIUM",
      urgency: "HIGH",
      confidence: L(Math.min(i.renewal.ended, i.renewalPrev.ended), 10, 30),
    });
  }

  // 2. Overdue balances piling up. Needs real money, not a rounding.
  if (i.recovery.eligible >= 500_000 && i.recovery.pendingActions >= 3) {
    out.push({
      key: key("recovery.backlog"),
      rule: "recovery.backlog",
      title: `${i.recovery.pendingActions} recovery actions are waiting on ₹${Math.round(i.recovery.eligible / 100).toLocaleString("en-IN")} of dues`,
      body: `${i.recovery.openCases} invoices are past due or part paid and eligible for follow-up; ${i.recovery.over90} of them are over 90 days old, which rarely come back without a call. ${i.recovery.rate === null ? "No recovery rate yet for the period." : `This period's recovery rate is ${i.recovery.rate}%.`}`,
      action: "Work the recovery queue from the top: the highest-priority cases first.",
      link: "/intelligence/recovery",
      evidence: [ev("recovery.eligible", "Eligible for recovery", i.recovery.eligible, "paise"), ev("recovery.pending", "Actions pending", i.recovery.pendingActions, "count"), ev("recovery.rate", "Recovery rate", i.recovery.rate, "pct")],
      impactPaise: i.recovery.eligible,
      impactNote: "The whole eligible balance, if every case were recovered; the recovery rate shows what usually comes back.",
      effort: "LOW",
      urgency: i.recovery.over90 > 0 ? "HIGH" : "MEDIUM",
      confidence: "HIGH",
    });
  }

  // 3. An expense group grew faster than revenue. Needs a meaningful amount.
  for (const g of i.expenseGroups) {
    const grew = change(g.amount, g.previous);
    const rev = change(i.revenue, i.revenuePrev);
    if (grew === null || g.amount < 500_000 || grew < 0.2) continue;
    if (rev !== null && grew <= rev + 0.1) continue;
    out.push({
      key: key(`expense.rise.${g.group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`),
      rule: "expense.rise",
      title: `${g.group} costs rose ${Math.round(grew * 100)}% while revenue ${rev === null ? "has no previous period to compare" : rev >= 0 ? `rose ${Math.round(rev * 100)}%` : `fell ${Math.round(-rev * 100)}%`}`,
      body: `${g.group} came to ₹${Math.round(g.amount / 100).toLocaleString("en-IN")} in ${i.period.label} against ₹${Math.round(g.previous / 100).toLocaleString("en-IN")} in ${i.previous.label}. Compare usage, rates and hours before changing anything; a one-off bill can also do this.`,
      action: "Open the expense list for the period and check the largest entries in this group.",
      link: "/expenses",
      evidence: [ev(`fin.expenses.${g.group}`, `${g.group} expenses`, g.amount, "paise", g.previous), ev("fin.revenue", "Revenue", i.revenue, "paise", i.revenuePrev)],
      impactPaise: g.amount - g.previous,
      impactNote: "The rise against the previous period, not a saving that is promised.",
      effort: "LOW",
      urgency: "MEDIUM",
      confidence: L(g.previous, 200_000, 1_000_000),
    });
  }

  // 4. Revenue fell against the previous period.
  {
    const rev = change(i.revenue, i.revenuePrev);
    if (rev !== null && rev <= -0.15 && i.revenuePrev >= 1_000_000) {
      out.push({
        key: key("revenue.decline"),
        rule: "revenue.decline",
        title: `Revenue fell ${Math.round(-rev * 100)}% against ${i.previous.label}`,
        body: `Net revenue was ₹${Math.round(i.revenue / 100).toLocaleString("en-IN")} in ${i.period.label} and ₹${Math.round(i.revenuePrev / 100).toLocaleString("en-IN")} in ${i.previous.label}. Active members went from ${i.activeMembersPrev} to ${i.activeMembers} and new members from ${i.newMembersPrev} to ${i.newMembers}.`,
        action: "Check whether sales fell (fewer renewals or joiners) or prices did (more discounts), then look at the Profit Simulator's conservative scenario.",
        link: "/intelligence/ltv",
        evidence: [ev("fin.revenue", "Revenue", i.revenue, "paise", i.revenuePrev), ev("bench.activeMembers", "Active members", i.activeMembers, "count", i.activeMembersPrev), ev("members.new", "New members", i.newMembers, "count", i.newMembersPrev)],
        impactPaise: i.revenue - i.revenuePrev,
        effort: "MEDIUM",
        urgency: "HIGH",
        confidence: "HIGH",
      });
    }
  }

  // 5. Members at high churn risk.
  if (i.atRisk >= 5 && i.activeMembers > 0 && i.atRisk / i.activeMembers >= 0.1) {
    out.push({
      key: key("retention.risk"),
      rule: "retention.risk",
      title: `${i.atRisk} members are at high risk of leaving`,
      body: `${i.atRisk} of ${i.activeMembers} active members score high on churn risk (not visiting, expiring soon or owing money). A message or a call now is cheaper than a new member later.`,
      action: "Open the at-risk list in Fitron AI and send a win-back message to those who have not visited.",
      link: "/ai",
      evidence: [ev("members.atRisk", "High-risk members", i.atRisk, "count"), ev("bench.activeMembers", "Active members", i.activeMembers, "count")],
      impactPaise: null,
      effort: "LOW",
      urgency: "MEDIUM",
      confidence: "MEDIUM",
    });
  }

  // 6. A saved scenario improves on the baseline.
  if (i.bestScenario && i.bestScenario.extraProfit > 0) {
    out.push({
      key: key(`scenario.${i.bestScenario.id}`),
      rule: "scenario.better",
      title: `Scenario "${i.bestScenario.name}" projects ₹${Math.round(i.bestScenario.extraProfit / 100).toLocaleString("en-IN")} more operating profit over ${i.bestScenario.months} months`,
      body: "This is a forecast from your own assumptions, not a result. Review its conservative and baseline variants, and the sensitivity table, before putting it into practice.",
      action: "Open the scenario, compare it with the baseline, and turn it into a decision if it still looks right.",
      link: `/intelligence/simulator/${i.bestScenario.id}`,
      evidence: [{ metric: "sim.extraProfit", label: "Extra operating profit (forecast)", value: i.bestScenario.extraProfit, unit: "paise", period: `${i.bestScenario.months} months`, kind: "estimate" }],
      impactPaise: i.bestScenario.extraProfit,
      impactNote: "A forecast under the scenario's assumptions.",
      effort: "MEDIUM",
      urgency: "LOW",
      confidence: "LOW",
    });
  }

  // 7. Acquisition cost versus lifetime value: only when both are reliable.
  if (i.cac !== null && i.ltvEstimate !== null && i.cac > 0 && i.ltvEstimate / i.cac < 3) {
    out.push({
      key: key("cac.high"),
      rule: "cac.high",
      title: `Each new member costs ₹${Math.round(i.cac / 100).toLocaleString("en-IN")} to acquire against an estimated ₹${Math.round(i.ltvEstimate / 100).toLocaleString("en-IN")} of lifetime revenue`,
      body: "A lifetime value under three times the acquisition cost leaves little room once the cost of serving members is counted. The lifetime value is an estimate from observed churn; the acquisition cost counts only Marketing-group expenses.",
      action: "Check which sources bring members who stay (Member Lifetime Value › by source) before spending more on marketing.",
      link: "/intelligence/ltv",
      evidence: [ev("ltv.cac", "Acquisition cost", i.cac, "paise"), ev("ltv.estimate", "Estimated lifetime value", i.ltvEstimate, "paise", undefined, "estimate")],
      impactPaise: null,
      effort: "MEDIUM",
      urgency: "MEDIUM",
      confidence: "LOW",
    });
  }

  return out;
}

const LEVEL_SCORE: Record<Level, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };

/** Ranking score: impact (log of rupees, capped), urgency and confidence up, effort down. */
export function score(f: Pick<Finding, "impactPaise" | "urgency" | "confidence" | "effort">): number {
  const impact = f.impactPaise ? Math.min(40, Math.max(0, Math.round(Math.log10(Math.max(1, Math.abs(f.impactPaise) / 100)) * 8))) : 10;
  return impact + LEVEL_SCORE[f.urgency] * 12 + LEVEL_SCORE[f.confidence] * 8 - LEVEL_SCORE[f.effort] * 6;
}

export const RECOMMENDATION_STATUS = ["OPEN", "ACCEPTED", "DISMISSED", "DEFERRED", "COMPLETED"] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUS)[number];
export const RECOMMENDATION_STATUS_LABEL: Record<RecommendationStatus, string> = { OPEN: "Open", ACCEPTED: "Accepted", DISMISSED: "Dismissed", DEFERRED: "Deferred", COMPLETED: "Completed" };

/**
 * Checks a model-worded explanation against the evidence it was given: any rupee figure or percentage in the text that
 * is not one of the evidence values (allowing rounding to whole rupees or a decimal) is a made-up number, and the text
 * is refused. Keeps the model to explaining, never to inventing.
 */
export function explanationIsGrounded(text: string, evidence: Evidence[], extraNumbers: number[] = []): boolean {
  const allowed = new Set<number>();
  const add = (v: number | null | undefined) => {
    if (v === null || v === undefined) return;
    allowed.add(Math.round(v));
    allowed.add(Math.round(v / 100));
    allowed.add(Math.round(v / 10) / 10);
    allowed.add(Math.round(v * 10) / 10);
  };
  for (const e of evidence) {
    add(e.value);
    add(e.previous);
  }
  for (const n of extraNumbers) add(n);
  const nums = text.match(/₹\s?[\d,]+(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?%/g) ?? [];
  for (const raw of nums) {
    const n = Number(raw.replace(/[₹%,\s]/g, ""));
    if (!Number.isFinite(n)) continue;
    if (!allowed.has(n) && !allowed.has(Math.round(n)) && !allowed.has(Math.round(n * 10) / 10)) return false;
  }
  return true;
}
