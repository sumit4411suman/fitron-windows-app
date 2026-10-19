# FITRON Business Intelligence & Growth Suite

Six modules under one sidebar entry, **Business intelligence** (`/intelligence`), built on the existing Gym Accounting
console: Growth Engine, Revenue Recovery, Member Lifetime Value, Profit Simulator, Decision Simulator, and Benchmarking &
Franchise Intelligence. Everything is computed from the records FITRON already keeps (members, memberships, invoices,
payments, expenses, assets, attendance); nothing here writes an invoice, payment or expense except through the same
service functions the front desk uses.

This document is the audit summary, the architecture, the data flow, the API, the test results and the known limits of
the suite, in the order the brief asked for them.

## 1. Repository audit (what the suite was built on)

| Concern | What exists | How the suite uses it |
| --- | --- | --- |
| Framework | Next.js 16 App Router, server components, server actions, route handlers | New pages under `src/app/(app)/intelligence`, actions beside them, one CSV route |
| Database | Prisma 7, PostgreSQL (Cloud) and SQLite (FITRON for Windows) from one schema source (`scripts/local-schema.ts`) | Eight new models in `prisma/schema.prisma`, regenerated local schema, one migration for each database |
| Money | Integer paise; invoice totals written once; paid state computed (`invoiceState`, `balanceDue`) | Every BI figure is paise; balances come from `invoiceState` |
| Profit & loss | `profitAndLoss` in `src/lib/services/accounting.ts` (invoice lines net of discount before GST; non-capital expenses; depreciation from the asset register) | The shared analytics layer calls it; no second P&L |
| Receivables | `listReceivables` (open invoices, ageing, totals) | Recovery's "outstanding" figure is this total; the queue is built from the same open invoices |
| Reminders | `remindDue`, `remindRenewal` over the gym's WhatsApp templates (de-duplication, quiet hours, demo mode) | Recovery sends through these, never its own WhatsApp call |
| Payments | `collectPayment` (balance check, locked months, gap-free numbering, audit) | Recovery records a payment through it |
| Churn risk | `riskScore` per member, nightly (`members.risk`) | Growth Engine reads the high-risk count |
| Branch comparison | Dashboard table on the Enterprise plan (`analytics` feature) | Internal benchmarking is gated the same way |
| Fitron AI | Claude over tools (`src/lib/services/ai-tools.ts`), with a no-model fallback | Five read-only BI tools added; the Growth Engine's explanation is checked against the evidence |
| Jobs | `src/lib/services/jobs.ts` daily list, run per gym by the scheduler or the Windows timer | Three jobs added: `recovery.refresh`, `growth.refresh`, `benchmark.snapshot` (cloud only) |
| Permissions | Role → permission keys; plan features gate sections | No new permission key: `accounting.view` opens the area, `settings.manage` approves decisions and consents, `payments.collect` and `whatsapp.send` keep their meaning |
| Audit | Hash-chained `AuditLog` per gym, written in the transaction | Every consequential BI action audits with a `bi.*` action; the audit page has an "Intelligence" module |
| Backup, demo clear, privacy | Table lists in `backup.ts`, `go-live.ts`, `privacy.ts` | New tables added to all three |
| Sync (Windows ↔ fitron.in) | Transactional outbox per synced table, triggers generated per migration | BI tables are **not** synced in this release (see limitations); their inputs are |

Baseline before the work (this branch's parent): `npm run typecheck` clean, `npm run lint` two pre-existing warnings,
`npm test` 1,646 passed with two pre-existing date-sensitive failures in `reminders*.db.test.ts` (a one-month plan sold on
19 October ends on 18 November, one day later than the test's `addDays(today, 15)` assumption on this calendar date;
unrelated to this work).

## 2. Architecture and data flow

```
records (Member, Membership, Invoice, InvoiceItem, Payment, Expense, Asset, Attendance, MembershipPlan)
        │
        ▼
src/lib/services/analytics.ts         membershipFacts(scope) · snapshot(user, period) · systemScope(orgId)
        │  (one reader; reuses profitAndLoss, listReceivables; limited to the branches in view)
        ├──► src/lib/services/recovery.ts     queue (RecoveryCase/RecoveryAttempt) ← rules in domain/recovery.ts
        ├──► src/lib/services/ltv.ts          cohorts, segments, estimate     ← maths in domain/ltv.ts, domain/metrics.ts
        ├──► src/lib/services/simulator.ts    baseline, Scenario rows          ← engine in domain/simulator.ts
        ├──► src/lib/services/decisions.ts    Decision/DecisionOption/Revision ← the SAME engine (no second formula)
        ├──► src/lib/services/growth.ts       Recommendation rows              ← rules in domain/growth.ts, inputs from the four above
        └──► src/lib/services/benchmark.ts    branch ranking; BenchmarkSnapshot ← domain/benchmark.ts (thresholds)
                                                                      │
                 src/lib/domain/metrics.ts  ◄── every figure is a MetricResult {id, value, unit, kind, period, currency,
                                                 timezone, version, computedAt, warnings, definition, sources, assumptions}
```

- **Pure domain, tested on its own.** `src/lib/domain/{metrics,recovery,simulator,ltv,growth,benchmark}.ts` have no
  database and no `server-only`; the simulator runs in the browser (`scenario-editor.tsx`) with the identical code.
- **Actual, estimate, forecast.** Every `MetricResult` and every screen figure carries a kind. Rules: recovery and P&L
  figures are actuals; lifetime value and acquisition ratios are estimates with the model stated; simulator output is a
  forecast and is labelled so on every screen and in the AI tool's answer.
- **Tenant and branch isolation.** Services take `CurrentUser` and filter by `orgId` and `branchIds` (or by a parent
  with an `orgId`). Jobs use `systemScope(orgId)` (every branch, no permissions). Cross-gym reads of BI rows are only the
  external benchmarking aggregate, which never returns another gym's row.

### Metric definitions

Registered in `src/lib/domain/metrics.ts` (`METRICS`): identifier, name, definition, unit, formula version, source
tables, assumptions, kind. Shown on every tile under "How it is worked out" and returned by the AI tools. Highlights:

| Metric | Definition |
| --- | --- |
| `recovery.rate` | Recovered in period ÷ (open cases' balance at the period start + opening balance of cases opened in the period). Renewal opportunities are never in the denominator. |
| `ltv.renewalRate` | Of memberships that ended in the period, the share followed by another of the same member starting within 30 days. Endings whose 30 days are still running are counted neither way. |
| `ltv.retention` | Of members who joined in a month, the share covered by a membership 1, 3, 6 and 12 months later; a point is shown only once every member of the cohort has reached it. |
| `ltv.estimate` | Monthly net revenue per active member ÷ monthly churn (six-month window). Shown only with ≥ 20 members with a membership, ≥ 6 months of history and observed churn > 0. Gross revenue, not profit. |
| `ltv.cac` | Marketing-group expenses ÷ members joined; only when both are non-zero. |
| `fin.net` | Revenue − operating expenses (incl. depreciation and disposal losses), before income tax, financing and owner's drawings. |

### Profit Simulator engine (`SIM_CALC_VERSION = 1`)

Monthly loop: members leave at the churn rate, join at the joiner rate (both seasonal), fees are earned on the average
members of the month at the member-weighted average monthly fee (price per cycle ÷ cycle months, after discount,
before GST). Included: other income, fixed costs by group, variable cost per member, payment fees on collections,
refunds as a share of revenue, income tax on a positive profit when a rate is given. Excluded and said so: GST (shown
apart), depreciation, loan interest, owner's drawings, capital purchases. Cash (`cashIn`, `cashOut`, `netCash`) is kept
apart from accrual operating profit. Break-even = fixed costs less other income ÷ contribution per member; minimum fee
for a target profit solves the same equation for the fee. Conservative/optimistic variants: joiners ±20%, churn ±2
points, costs ±5%. Sensitivity: ten one-at-a-time changes. Integer rounding at every monthly step; `simulate(x)` is
deterministic.

### Growth Engine rules (`src/lib/domain/growth.ts`)

| Rule | Fires when | Impact figure |
| --- | --- | --- |
| `renewals.decline` | Renewal rate ≥ 10 points below the previous month, ≥ 10 endings on both sides | none (members listed as opportunities) |
| `recovery.backlog` | ≥ ₹5,000 eligible and ≥ 3 actions pending | the eligible balance, labelled "if every case were recovered" |
| `expense.rise` | A category group ≥ ₹5,000 grew ≥ 20% and faster than revenue by ≥ 10 points | the rise |
| `revenue.decline` | Revenue ≥ 15% below the previous month (≥ ₹10,000 before) | the fall |
| `retention.risk` | ≥ 5 high-risk members and ≥ 10% of active | none |
| `scenario.better` | A saved scenario beats its own baseline | the forecast difference, confidence LOW |
| `cac.high` | Estimated LTV ÷ CAC < 3, both available | none |

Ranking: impact (log scale) + urgency + confidence − effort. The model, when the gym has Fitron AI on, may word the top
three findings; `explanationIsGrounded` rejects any reply containing a rupee amount or percentage that is not in the
evidence, and the rule's own text is shown instead. Without a key or offline the rule text is shown; nothing breaks.

### Benchmarking safeguards (`src/lib/domain/benchmark.ts`)

Opt-in per gym by a Super Admin (Setting `benchmarking`); one aggregated row per gym per month (`BenchmarkSnapshot`,
written by the daily job only while consent stands; withdrawing consent deletes the gym's rows). Cohort by size band
(active members) and, when ≥ 10 gyms share it, state. A comparison opens at ≥ 10 other gyms; each metric needs ≥ 10 gyms
reporting it; the gym is never in its own sample; only quartiles and the gym's percentile are returned. Not available
on FITRON for Windows (figures stay on the computer).

## 3. Files added or modified

Added:

- `prisma/migrations/20261019120000_business_intelligence/migration.sql`, `prisma/local-migrations/0006_business_intelligence/migration.sql`
- `src/lib/domain/{metrics,recovery,simulator,ltv,growth,benchmark}.ts` and their `.test.ts`
- `src/lib/services/{analytics,recovery,ltv,simulator,decisions,growth,benchmark}.ts` and `{recovery,ltv,simulator,decisions,growth,benchmark}.db.test.ts`
- `src/lib/validation/intelligence.ts`
- `src/components/action-form.tsx`
- `src/app/(app)/intelligence/**` (six modules, actions, client editors, CSV route)
- `docs/BUSINESS-INTELLIGENCE.md` (this file)

Modified:

- `prisma/schema.prisma` (+8 models, relations on Member and Invoice), `prisma/schema.local.prisma` (regenerated)
- `src/lib/nav.ts`, `src/components/nav-links.tsx` (sidebar group "Grow")
- `src/lib/services/jobs.ts` (three jobs), `src/lib/services/ai-tools.ts` (five tools), `src/lib/domain/ai-labels.ts`
- `src/lib/services/settings.ts` (setting keys `recovery`, `benchmarking`)
- `src/lib/domain/backup.ts`, `src/lib/services/backup.ts`, `src/lib/services/go-live.ts`, `src/lib/services/privacy.ts`, `src/lib/domain/audit.ts`

## 4. Database migrations and rollback

Cloud (PostgreSQL): `npx prisma migrate deploy` applies `20261019120000_business_intelligence` (eight tables, indexes,
foreign keys, row-level security enabled, as every FITRON table). Additive only; no existing column changes.

Windows (SQLite): `prisma/local-migrations/0006_business_intelligence` is applied by the app's own runner at start-up,
after the pre-update backup, like every local migration.

Rollback (either database): the suite's tables hold only derived or planning data, so dropping them loses nothing
financial:

```sql
DROP TABLE "RecoveryAttempt", "RecoveryCase", "DecisionRevision", "DecisionOption", "Decision", "Scenario", "Recommendation", "BenchmarkSnapshot";
-- PostgreSQL: DELETE FROM "_prisma_migrations" WHERE migration_name = '20261019120000_business_intelligence';
-- SQLite:     DELETE FROM "_fitron_migrations" WHERE name = '0006_business_intelligence';
```

Then deploy the previous build (the old code never reads these tables). Settings `recovery` and `benchmarking` can stay.

## 5. Features and where they are in the UI

Sidebar › **Grow › Business intelligence** (Professional plan and above, `accounting.view`). Tabs:

| Tab | Route | What it does |
| --- | --- | --- |
| Growth Engine | `/intelligence` | Ranked recommendations with evidence table, impact, urgency/effort/confidence, next action and link; Accept / Dismiss / Defer / Complete with a note; outcome measured on completion; history with tallies; Refresh from the books |
| Revenue Recovery | `/intelligence/recovery`, `/intelligence/recovery/[id]` | Metric tiles (outstanding, eligible, pending, recovered, rate with its denominator), ageing bars, by branch and by plan, filterable work queue, rules form (Super Admin). Case page: balance, follow-ups, WhatsApp reminder, call/visit/note with promise, record payment (through Collect payment), close with reason, reopen, link to sell a renewal |
| Member Lifetime Value | `/intelligence/ltv` | Period, plan and source filters; eight metric tiles with definitions; active-member trend; estimate basis; cohort retention table; value by plan, source and branch with drill-down to members (roles with `members.view`); data notes |
| Profit Simulator | `/intelligence/simulator`, `/new`, `/[id]`, `/[id]/csv` | Scenario list with forecast profit against the books; editor pre-filled from the books with live recalculation, three variants, sensitivity, month table; save, rename, duplicate, archive/restore; CSV report; forecast vs actual for months that have passed |
| Decision Simulator | `/intelligence/decisions`, `/new`, `/[id]` | Decision with category, objective, constraints, review period; options edited with the simulator plus 1–5 scores on weighted criteria; side-by-side comparison with calculated financial score; verdict (Super Admin) with reasoning; implementation date; review figures (actual vs projected vs baseline); lessons; revision history |
| Benchmarking | `/intelligence/benchmarking` | Branch comparison ranked per metric with change vs the previous period (Enterprise `analytics` feature, as the dashboard's branch table); peer comparison with quartiles and percentile or the reason it is unavailable; methodology; opt-in / withdraw (Super Admin, Cloud only) |

Fitron AI (`/ai`): tools `business_metrics`, `recovery_queue`, `lifetime_value`, `simulate_profit`, `growth_recommendations`
answer natural-language questions from the same services with definitions attached; the simulate tool returns a
forecast marked as such.

## 6. API and environment

No new HTTP endpoints beyond the pages' server actions and `GET /intelligence/simulator/[id]/csv` (signed-in,
`accounting.view`). The daily jobs run from the existing `/api/jobs/daily` (Cloud) and the Windows timer. No new
environment variables; `ANTHROPIC_API_KEY` (or the Windows licence relay) is optional and only words explanations.

Service entry points (all take `CurrentUser` and respect branches): `refreshQueue`, `listCases`, `getCase`,
`logAttempt`, `sendCaseReminder`, `recordCasePayment`, `closeCase`, `reopenCase`, `recoveryDashboard`; `ltvReport`,
`segmentMembers`; `baselineInputs`, `createScenario`, `updateScenario`, `duplicateScenario`, `archiveScenario`,
`scenarioVersusActual`; `createDecision`, `updateDecision`, `saveOption`, `removeOption`, `decide`, `markImplemented`,
`reviewFigures`, `recordReview`, `compareOptions`; `growthInputs`, `refreshRecommendations`, `listRecommendations`,
`decideRecommendation`, `measureOutcome`, `explainRecommendation`; `internalBenchmark`, `externalBenchmark`,
`setBenchmarkConsent`, `writeBenchmarkSnapshot`.

## 7. Tests and results

See the pull request description for the numbers of the run on this commit. Coverage added:

- Unit (no database): every formula in the six domain modules, incl. paise rounding, GST split, refunds, discounts,
  missing data (nulls, never zeros), small samples, ageing buckets, recovery rate denominator, LTV refusal, CAC,
  percentiles and suppression thresholds, simulator determinism, negative profit, zero revenue, impossible break-even,
  seasonality, variants, sensitivity, forecast-vs-actual, grounding of AI wording (invented figures rejected).
- Database (PostgreSQL and SQLite): queue idempotence and one case per invoice, payment through Collect payment with
  double-click refusal and over-balance refusal, reconciliation of recovered amounts with the ledger, closed cases
  staying closed, renewal opportunities closing on a sale; LTV against hand-computed figures with filters and
  role-limited drill-down; simulator baseline from records and the invariant that scenarios touch no financial row;
  decision versioning, owner-only verdicts, implementation and review; growth recommendations from the other modules,
  no duplicates on refresh, decisions surviving refreshes, measured outcomes; internal benchmark reconciling with P&L,
  external benchmark unavailable without consent, aggregation or a large cohort, consent withdrawal; tenant and branch
  isolation in every suite.
- Regression: the whole existing suite on both databases, lint, typecheck, production build; the end-to-end console
  spec covers the new pages automatically (it reads the route tree).

## 8. Build and deployment

Unchanged: `npm ci`, `npx prisma migrate deploy`, `npm run build`, start. The three new jobs run with the existing daily
job (`deploy/scheduler.sh` / GitHub-run jobs on Vercel). For FITRON for Windows the migration is in the release bundle
and applied on first start after the update.

## 9. Windows and online compatibility

| Module | FITRON for Windows (Local Only) | fitron.in |
| --- | --- | --- |
| Growth Engine, Recovery, LTV, Profit and Decision Simulators | Work offline on the computer's database; the rules word every recommendation; "Use Claude" (licence) words the top three when online | Same; Claude with the server key |
| Recovery WhatsApp | Through the gym's WhatsApp as everywhere else (demo mode saves, linked phone sends) | Same |
| Benchmarking, internal | Works | Works |
| Benchmarking, external | Not offered; the page says so | Opt-in |
| Sync | BI rows stay on the side they were made; their inputs sync as before | — |

## 10. Known limitations and unresolved dependencies

- **Payment links.** FITRON has no one-off payment-link provider for members (Razorpay is used for UPI Autopay
  subscriptions and FITRON's own billing). Recovery therefore offers WhatsApp reminders and recording of payments, not
  generated links. Adding Razorpay Payment Links would need the gym's Razorpay keys, a `payment_link.paid` webhook and
  reconciliation to `collectPayment` with the Razorpay payment id as the idempotency key.
- **Failed payment attempts.** Only autopay mandates record provider-side failures (`AutopayMandate.lastResult`); the
  queue lowers the priority of a member with an active mandate and suggests checking it first, but does not list failed
  charges as cases.
- **Sync.** `RecoveryCase`, `RecoveryAttempt`, `Scenario`, `Decision*`, `Recommendation` are not in `SYNC_ENTITIES`:
  follow-ups logged on a Windows computer do not appear on fitron.in and vice versa. Adding them means change-capture
  triggers in both migration sets and the sync tests; left for a follow-up so this release stays additive.
- **External benchmarking** stays unavailable until ten or more gyms opt in; no sample data is ever seeded.
- **Acquisition cost** counts only the Marketing category group; agency fees recorded elsewhere are missed.
- **Refunds** are not a FITRON concept beyond payment reversals and invoice cancellations; the simulator's refund rate is
  an assumption the owner enters.
- **Lifetime value** is a simple churn model, not a survival model; it is refused on small or young data.

## 11. Performance and security

- Pages read memberships and open invoices of the branches in view once per request (`membershipFacts`); a gym with
  thousands of members fits in memory. `refreshQueue` is linear in open invoices and lapsed members and runs under the
  daily `JobRun` lock (once a day per gym) plus on page view, idempotently.
- Inputs: zod schemas in `src/lib/validation/intelligence.ts`; simulator inputs are re-parsed and clamped
  (`parseInputs`, `checkInputs`) on save; JSON columns hold only shapes the code wrote.
- Authorisation: `requirePermission("accounting.view")` on every page and action; verdicts, implementation, review,
  rules and consent need `settings.manage`; payments `payments.collect`; reminders `whatsapp.send`; member lists
  `members.view` (+ trainer scope). Every lookup includes `orgId` and the branch filter, so another gym's id is "not
  found".
- AI: tools are read-only and compute in code; the model never supplies a number; its wording is checked against the
  evidence; tool results are limited to 30 kB as before. Logs name events, never member data.
- Privacy: erasure clears follow-up notes; demo clear and restore handle the new tables; row-level security is on.

## 12. Remaining tasks, in priority order

1. Razorpay Payment Links for recovery cases (see §10) with webhook reconciliation.
2. Sync the BI tables between FITRON for Windows and fitron.in.
3. Excel export of the scenario report and of the recovery queue (CSV exists for scenarios).
4. A "compare with original cohort" shortcut on the LTV page after a retention action (the cohort table already shows
   it month by month).
5. Promotion-specific fields in the Decision Simulator (offer code uptake from `Offer.uses`).
6. End-to-end specs for the case workflow and the scenario editor beyond the page-render check.
