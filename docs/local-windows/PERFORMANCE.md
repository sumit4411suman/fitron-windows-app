# FITRON Local Windows Edition: performance (Phase 20)

FITRON for Windows on a gym with years of records: every daily screen, a sale and its invoice, measured on the
production build, with what was slow and how it was fixed.

## The dataset

`npm run perf:local` builds it once in `.perf/dataset/` (`--fresh` builds it again), with the app's own services: the
gym, its owner, four plans, one member, one sale with its payment and one expense are made as the desk makes them.
Every other row is a copy of those with its own id, number, dates and amounts (`perf/seed.perf.ts`):

| Records | Count |
| --- | --- |
| Members | 5,000 |
| Memberships | 20,000 |
| Invoices (and their items) | 50,000 |
| Payments | 100,000 |
| Expenses | 20,000 |
| Audit log entries | 200,000 |

Three and a half years of history; about one invoice in five still owed (deliberately more than a real gym, to stress
the screens that list what is owed). The generator checks what it made: counts, no invoice paid past its total, and an
audit log whose hash chain verifies. The database is 211 MB.

## Results

`e2e/perf/perf.spec.ts` starts the production server on a copy of the dataset and opens each screen in a browser,
timing until its content is on screen. Each screen is opened twice: the first visit after FITRON starts also loads the
screen's code (once per start) and may take twice the budget; the second is what the desk sees all day.

Measured on a 4-core 2.1 GHz Xeon (cloud CI machine, slower per core than a current desktop), 15 GB RAM:

| Screen | First visit | After | Budget |
| --- | ---: | ---: | ---: |
| Server start on the full dataset | 1.9 s | | 20 s |
| Sign in | 2.6 s | | 3 s |
| Dashboard | 1.0 s | 0.8 s | 3 s |
| Members list | 1.6 s | 1.5 s | 3 s |
| Member search by name | 1.3 s | 1.1 s | 3 s |
| Member search by phone | 0.8 s | 0.8 s | 3 s |
| Invoices | 0.9 s | 0.9 s | 3 s |
| Payments | 0.9 s | 0.9 s | 3 s |
| Outstanding payments | 2.5 s | 2.7 s | 3 s |
| Renewals | 1.6 s | 1.7 s | 3 s |
| Expenses (this month) | 0.9 s | 1.0 s | 3 s |
| Attendance | 2.3 s | 2.4 s | 3 s |
| Audit log | 5.4 s | 1.8 s | 3 s |
| Profit & loss | 2.9 s | 3.2 s | 6 s |
| Ledgers | 0.9 s | 0.9 s | 6 s |
| GST summary | 1.9 s | 2.1 s | 6 s |
| Collections report | 1.8 s | 1.9 s | 6 s |
| Outstanding dues report | 2.6 s | 2.5 s | 6 s |
| Revenue by month | 4.4 s | 3.0 s | 6 s |
| Members by plan | 2.1 s | 2.3 s | 6 s |
| Reports centre | 2.0 s | 1.9 s | 3 s |
| Add a member | 3.4 s | | 6 s |
| Sell a membership: invoice and payment | 1.6 s | | 6 s |
| Invoice PDF | 0.3 s | | 3 s |

Invoice numbers continue the series past 50,000 invoices (the test checks the new sale's number).

## What was slow, and the fix

| Found | Cause | Fix |
| --- | --- | --- |
| The members list, renewals and risk scores **failed outright** on Windows for a gym with more than about a thousand members | One query carried every member's id; SQLite takes at most 999 values in a statement | The Windows database client reads a long list in slices of 500 and combines the results exactly as one query would: order (NULLs as SQLite orders them), distinct, skip and take; counts, groups and bulk writes added up. A query it cannot combine exactly is left alone (`src/lib/runtime/sqlite-in.ts`, `sqlite-in.test.ts`, `many-members.db.test.ts`) |
| Outstanding payments: 45 s | Every issued invoice was read with its payments to find the ones still owed, and all of them (10,000 here) were drawn, each with its own reminder button | The owed invoices are picked in one SQL query with the same round-off rule as the invoice screen (`openInvoiceIds`, `open-invoices.db.test.ts` checks both agree on every edge); the table shows 100 rows a page, most overdue first, while the totals above it cover all |
| Dashboard 5.4 s, receivables report 2 s | The same reading of every issued invoice | `openInvoiceIds` |
| Members list 1.6 s of balances | Every invoice and payment of every member read to add up balances | Long lists add up what each member owes in one query per gym (the short path, for one member, is unchanged; the test checks both agree) |
| Audit log 5.8 s on every visit | The whole 200,000-entry hash chain was walked each time | The whole walk runs in the background at most every six hours per gym; in between only new entries are checked, continuing from where the walk ended. A log replaced since (a restore), or any break found in new entries, starts a whole walk before a break is reported (`audit.db.test.ts`) |

Indexes: the queries above use the existing indexes (`Invoice(orgId, number)`, `Payment(invoiceId)`,
`Member(orgId, phone)`, `AuditLog(orgId, id)` and the others in the schema); none had to be added. The long lists
were already bounded: members and the audit log are paged, invoices and payments show the latest 500 (narrowed by
search and dates), and now outstanding payments is paged too; the browser is never sent the whole database.

## Running it

```
npm run build
npm run perf:local            # the dataset is built the first time (about 2 minutes), then reused
npm run perf:local -- --fresh # build the dataset again
```

The results are in `.perf/run/perf-results.json`. A screen over its budget fails the test with its name and time.
