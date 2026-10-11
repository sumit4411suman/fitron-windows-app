# FITRON Local Windows Edition: module status (Phase 7)

Each module checked on the Local Edition (SQLite), in the migration order of the brief. "Unit + DB" is
`npx tsx scripts/local-module-check.ts`: that module's tests on a fresh SQLite file built by the production
migration runner. "Browser" is the end-to-end spec run against a production build started with
`FITRON_EDITION=local` (`npm run e2e:local`). The same specs also pass on PostgreSQL (`npm run e2e`).

| # | Module | Unit + DB on SQLite | Browser spec(s) on Local | Result |
| --- | --- | --- | --- | --- |
| 1 | Members | 78 / 78 | sale, console, accessibility, `local/audit` | PASS |
| 2 | Memberships | 29 / 29 | sale, onboarding | PASS |
| 3 | Payments | 39 / 39 (2 TRUNCATE skipped) | sale (part payment, reversal) | PASS |
| 4 | Invoices | 29 / 29 | sale (GST invoice, PDF), ai-assistant | PASS |
| 5 | Expenses | 18 / 18 | `local/expenses` | PASS |
| 6 | Accounting / Ledger | 13 / 13 | `local/accounting` (P&L on screen and CSV, ledgers, month close) | PASS |
| 7 | GST | 25 / 25 | `local/gst` (GST invoice register, CGST/SGST, CSV) | PASS |
| 8 | Attendance | 23 / 23 | checkin | PASS |
| 9 | Reports | 9 / 9 | `local/reports` (all 17 reports, CSV and Excel) | PASS |
| 10 | POS / Inventory | 14 / 14 | `local/pos` (counter sale → paid invoice) | PASS |
| 11 | Assets | 15 / 15 | `local/assets` (register at cost, asset register report) | PASS |
| 12 | Audit Logs | 18 / 18 | `local/audit` (hash chain, append-only) | PASS |
| 13 | Settings | 84 / 84 | settings, plans, two-step, onboarding | PASS |

Whole suites, same commit:

| Suite | PostgreSQL (Cloud) | SQLite (Local) |
| --- | --- | --- |
| Unit + DB (`npm test`, `npm run test:local`) | 1,348 passed, 4 skipped (Local-only slice) | 1,348 passed, 4 skipped (no SQLite counterpart) |
| Browser (`npm run e2e`, `npm run e2e:local`) | 320 passed | 320 passed |

What changed in the app for Phase 7:

- Member documents, photos, logos and expense bills are stored under the customer's data folder in the
  Local Edition (`…\FITRON\documents`), never beside the program and never in a cloud bucket.
- `/api/health` reports `{ ok, edition, version }` and stays `ok: false` until the Local database is migrated,
  so the desktop shell can wait for it (Phase 14).

What changed in the tests:

- `e2e/support.ts` runs the specs' SQL on either database (placeholders, casts, `now()`, `FILTER`).
- `e2e/local/*.spec.ts`: expenses, accounting, GST, reports, POS, assets, audit.
- One existing assertion (`accounts.spec.ts`) accepts SQLite's `1` for a true comparison.

Not covered yet by Phase 7, and where it is planned: the hosted-only screens (FITRON billing, AI Trainer,
`/fitron-admin`) still render in Local and will be hidden in Phase 12; sign-up still uses the website flow
until the Local first-run wizard (Phase 8).
