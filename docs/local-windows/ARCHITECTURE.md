# FITRON Local Windows Edition: architecture audit

Written at the start of the Local Edition work (Phase 0 and 1), against the production
source at `sumitgoxlofficial-jpg/fitron` commit `5153ce6` (merge of PR #102, 8 Oct 2026),
imported into this repository as its first commit. This document records what exists
today, what the Local Edition will add, and where the two editions share code.

## 1. What FITRON is today

One Next.js application, deployed as one server, with three faces:

| Part | Where | Backing |
| --- | --- | --- |
| Website (fitron.in) | `public/site/index.html` (static), `src/app/(site)` (sign-up, contact, policies, guides, tools) | Enquiry table, SMTP |
| Gym Accounting console | `src/app/(app)` (every console page), `src/app/login`, `src/app/onboarding` | PostgreSQL via Prisma |
| AI Trainer member app | `public/trainer` (static React bundle) + `src/app/api/trainer/*` | PostgreSQL, Anthropic, Razorpay, Web Push |

Plus machine endpoints: webhooks (`/api/webhooks/*`), the daily job runner
(`/api/jobs/*`), biometric door devices (`/iclock/*`), the member self check-in
page (`/c/<gym>/<branch>`), and `/api/health`.

### Stack

| Concern | Choice | Notes for the Local Edition |
| --- | --- | --- |
| Framework | Next.js 16.3 (App Router, React 19, Turbopack) | Server components, server actions and route handlers everywhere. A Node.js server runtime is required; a static export is not possible. |
| Language | TypeScript 5, strict | `npm run typecheck` = `next typegen && tsc --noEmit` |
| Styling | Tailwind 4 | Unchanged |
| ORM | Prisma 7.10, `prisma-client` generator, output `src/generated/prisma`, driver adapter `@prisma/adapter-pg` | Prisma 7 is driver-adapter only, which is exactly what makes a SQLite adapter possible without touching queries. |
| Database | PostgreSQL 16, 72 models, 47 migrations | See `DATABASE-MIGRATION.md` |
| Auth | Argon2id (`@node-rs/argon2`), server-side sessions (SHA-256 of a cookie token in `Session`), TOTP two-step, Google OAuth, email links and codes | Password + session parts are local-safe; Google and email are online. |
| Permissions | Role → RolePermission → Permission, 35 keys, 5 default roles, custom roles on Enterprise | Fully local. |
| Files | `src/lib/integrations/storage.ts`: S3-compatible bucket or `STORAGE_DIR` on disk | Disk mode is already a local file storage; the Local Edition points it at the app data folder. |
| PDF | `pdf-lib` + DejaVu fonts, server-rendered invoice PDF | Local-safe |
| Excel/CSV | own `src/lib/xlsx.ts` | Local-safe |
| Email | nodemailer (SMTP) | Online |
| AI | Anthropic Messages API via `fetch` | Online |
| Payments | Razorpay (gym members' UPI Autopay; FITRON's own billing of gyms) | Online |
| WhatsApp | Meta Cloud API, or the linked-phone connector in `prototype/connector` | Online |
| Push | web-push (AI Trainer only) | Online, not part of Gym Accounting |
| Tests | Vitest (145 files, 1,345 tests; `*.db.test.ts` need `DATABASE_URL`), Playwright (14 specs against the production build) | Local tests will run the same suites against SQLite plus `e2e/local`. |
| Hosting | Docker (Oracle Cloud) or Vercel + Supabase | Unchanged for the Cloud Edition. |

### Layering that already exists

The console is already layered; the UI never speaks SQL:

```
src/app/(app)/<page>/page.tsx          server components: read via services
src/app/(app)/<page>/actions.ts        server actions: validate (zod) → requirePermission → service
src/lib/services/*.ts                  business operations; every write inside db.$transaction with audit()
src/lib/domain/*.ts                    pure rules: invoice totals, GST split, membership status, dates, backup format
src/lib/validation/*.ts                zod schemas shared by forms and services
src/lib/db.ts                          the one PrismaClient (adapter-pg)
src/generated/prisma                   generated client
```

Pages do call `db` directly for simple reads (for example `members/page.tsx` reads
distinct areas and a count), so "repository" today means "the Prisma client". The
services are the real seam: 134 files under `src/lib/services`, with the money paths
(`billing.ts`, `expenses.ts`, `accounting.ts`, `purchases.ts`, `pos.ts`, `payroll.ts`,
`assets.ts`) all transactional.

### Financial invariants to preserve

- Money is integer paise everywhere (`Int` columns, `invoiceTotals` in
  `src/lib/domain/billing.ts`). Only tax **rates** are `Decimal(5,2)` and they are read
  back with `Number()` before use.
- Invoice totals are computed once at issue; paid state is computed from payments and
  never stored (`invoiceState`).
- Gap-free numbering per gym through the `Sequence` table with an atomic upsert
  (`src/lib/services/sequence.ts`), inside the caller's transaction.
- Every write to a core table leaves an `AuditLog` row in the same transaction, chained by
  SHA-256 onto the previous row of that gym (`src/lib/services/audit.ts`).
- Locked months refuse writes (`src/lib/services/locks.ts`).
- The database itself refuses to delete financial rows and to change the audit log
  (`prisma/migrations/20261005031500_financial_row_guard`, PL/pgSQL triggers), except
  inside a transaction that set `fitron.allow_delete` to `restore` or `demo-clear`
  (`src/lib/services/db-guard.ts`).

### PostgreSQL-specific code found (what a SQLite port must replace)

| Where | What | Local Edition answer |
| --- | --- | --- |
| `services/sequence.ts` | `INSERT … ON CONFLICT DO UPDATE … RETURNING` | SQLite supports the same upsert syntax; `RETURNING` since 3.35. Same SQL works; verified in Phase 6. |
| `services/audit.ts`, `coupons.ts`, `self-checkin.ts`, `subscriptions.ts` | `pg_advisory_xact_lock(hashtext(…))` | SQLite has one writer at a time: a write transaction is already serialised (`BEGIN IMMEDIATE`). The lock becomes a no-op in the local dialect. |
| `services/classes.ts`, `purchases.ts`, `saas.ts`, `trainer-billing.ts` | `SELECT … FOR UPDATE` | Same: the write transaction already holds the database lock. No-op in the local dialect. |
| `services/saas.ts` | `nextval('fitron_invoice_seq')` | FITRON's own invoice to gyms: online-only (billing), not reached in Local. |
| `services/db-guard.ts` + trigger migration | `set_config('fitron.allow_delete')` read by PL/pgSQL | SQLite triggers reading a one-row `_fitron_guard` table set inside the same transaction. Same behaviour, written in `prisma/local-migrations`. |
| Row-level security migration | `ALTER TABLE … ENABLE ROW LEVEL SECURITY` | Not applicable (no Supabase API in front of the file). Dropped. |
| `Member_orgId_phone_active_key` partial unique index | `WHERE "deletedAt" IS NULL AND NOT "walkIn"` | SQLite supports partial indexes. Kept. |
| 17 service files | `mode: "insensitive"` in `contains` filters | Prisma rejects `mode` on SQLite. Replaced by a small `ci()` helper that returns `{ contains }` on SQLite (LIKE is case-insensitive for ASCII there) and `{ contains, mode: "insensitive" }` on PostgreSQL. |
| `services/accounting.ts` audit search, `pl-email.ts` | JSON path filters (`path: […], string_contains`) | Not supported on SQLite. Audit search falls back to a `LIKE` on the serialised JSON text; the job lookup reads the row and checks in code. |
| `Member.tags`, `riskReasons`, `MembershipPlan.features`, `AiProposal.memberIds` | `String[]` | SQLite has no arrays: stored as JSON text columns; the few readers are wrapped. |
| `createMany` with `skipDuplicates` | Not supported on SQLite | None used outside generated types. |
| Interactive transactions with `timeout: 300_000` | Supported by the adapter | Kept. |

### Dates and times

`@db.Date` columns hold Indian calendar dates as UTC midnight; `@db.Timestamptz` holds
instants. `src/lib/services/time.ts` fixes the Indian offset in code, so the server's own
time zone never matters. SQLite stores both as Prisma's ISO text / integer representations
through the adapter; the domain code keeps working unchanged, which the existing unit tests
(`dates.test.ts`, `periods.test.ts`) check.

## 2. The HTML demo (`public/site/gym-demo.html`, fitron.in/site/gym-demo.html)

Inspected from the repository copy (the fitron.in host is not reachable from this build
environment; the file is identical, `next.config.ts` serves `public/site` as is and
`src/lib/gym-demo.test.ts` ties it to `prototype/`). Findings:

- It is a **standalone, localStorage-based UI prototype**: one 3.6 MB file bundling React
  from unpkg, the prototype's `fitron-core.js`, `fitron-views.js`, `fitron-app.js` (the
  demo build of `prototype/`) and its assets, built by `scripts/build-gym-demo.py`.
- The only network calls are one `fetch('/api/gym-demo/ai')` (the demo's AI chat, an open
  rate-limited route) and the theme preference in `localStorage`. The demo session is
  seeded by `src/app/(site)/live-demo.tsx` into `localStorage` (`fitron-session-v1`).
- It is **not connected to the backend** and shares no code with the console in
  `src/app/(app)`. The console was built from `prototype/HANDOFF.md`, so the demo is the
  design reference, not a reusable implementation.

Conclusion: the Local Edition is built from the real console (`src/`), not from the demo.
The demo is not touched.

## 3. Target architecture

```
                              FITRON (one repository)
                                       |
                 +---------------------+---------------------+
                 |                                           |
          CLOUD EDITION                               LOCAL EDITION
   Next.js on a server / Vercel                  Tauri 2 window (WebView2)
                 |                                           |
          same src/app, src/lib                    Node sidecar runs the same
                 |                                 Next.js standalone server on
     src/lib/db.ts (adapter-pg)                    127.0.0.1:<dynamic port>
                 |                                           |
            PostgreSQL                          src/lib/db.ts (adapter-better-sqlite3)
                                                             |
                                                %LOCALAPPDATA%\FITRON\data\fitron.db
```

Decision (Phase 0): **Tauri 2 + Node sidecar + Next.js standalone + SQLite via
`@prisma/adapter-better-sqlite3`.**

Why not something else:

- A static export is impossible: every page is a server component and every form is a
  server action. Rewriting 130 pages to a client-side API would be the "rebuild from
  scratch" the brief forbids.
- Prisma 7 is driver-adapter only, so switching the adapter at start-up is the smallest
  possible change to 134 service files. `better-sqlite3` is synchronous, in-process,
  production SQLite with WAL mode and prebuilt Windows binaries; it is what the Prisma
  team ships the adapter for.
- The customer must not install Node.js: the installer carries `node.exe` as a Tauri
  sidecar (`desktop/src-tauri/binaries/`) plus the `.next/standalone` output as resources.
  Tauri starts it on a free loopback port, waits for `/api/health`, and kills it on exit.
- Electron would also work but needs a 150 MB runtime of its own next to the Node
  sidecar; Tauri uses the WebView2 runtime that Windows 10/11 already ship.

### One codebase, two editions

An **edition** is chosen at process start from `FITRON_EDITION=local|cloud` (default
`cloud`, so nothing changes for existing deployments):

```
src/lib/runtime/edition.ts      isLocal(), edition()
src/lib/runtime/paths.ts        the FITRON app-data folder (data/, backups/, documents/, logs/)
src/lib/db.ts                   picks the adapter: PrismaPg or PrismaBetterSqlite3
src/lib/db-dialect.ts           the few SQL differences (locks, case-insensitive search)
src/lib/integrations/<service>/ every online service in its own folder (email, whatsapp, razorpay, ai, license,
                                updates), off until a gym user turns it on, offline answered in words (Phase 12,
                                ONLINE-SERVICES.md); nothing else in the app opens a connection
src/lib/licence/                the licence: a FITRON-signed file checked offline, trial, grace, clock guard
                                (Phase 13, LICENSING.md)
```

Two Prisma schemas, one generated client each:

```
prisma/schema.prisma            PostgreSQL (unchanged)        → src/generated/prisma
prisma/schema.local.prisma      SQLite                        → src/generated/prisma-local
```

Both generate the **same TypeScript model names and the same query API**, so
`src/lib/services` compiles against either. The import path is chosen once in
`src/lib/db.ts`; the type `Prisma.TransactionClient` used across services resolves to the
same shape. Differences (`String[]` → JSON, `Decimal` handling) are listed per model in
`DATABASE-MIGRATION.md` and hidden behind the small helpers above.

### Local Edition runtime layout

```
C:\Program Files\FITRON Gym Accounting\        (installer, read-only for the app)
├── FITRON Gym Accounting.exe                  Tauri shell
├── node.exe                                   sidecar (Node 22 LTS)
└── resources\server\                          .next/standalone + static + prisma migrations

%LOCALAPPDATA%\FITRON\                         (customer data, never touched by uninstall)
├── data\fitron.db  (+ -wal, -shm)
├── backups\FITRON-Backup-YYYY-MM-DD-HHMM.fitronbackup
├── documents\<orgId>\{invoices,receipts,member-documents}\
├── logs\server.log, shell.log
├── licence.fitronlicence, licence-state.json   the licence and the latest date seen (Phase 13)
└── secrets.json, settings.json (install id and date, keys; port, last version)
```

Start-up sequence (Phase 14):

1. Tauri resolves `%LOCALAPPDATA%\FITRON`, creates the folders.
2. Picks a free port on 127.0.0.1, writes a one-time shell token.
3. Spawns `node.exe resources/server/server.js` with `FITRON_EDITION=local`,
   `FITRON_DATA_DIR`, `PORT`, `HOSTNAME=127.0.0.1`, `DATABASE_URL=file:…\data\fitron.db`.
4. The server applies pending migrations from `prisma/local-migrations` on start (after a
   pre-migration backup when the schema version changes), then listens.
5. Tauri polls `/api/health` until `{ ok: true, edition: "local" }`, then shows the window.
6. On window close Tauri sends SIGTERM to the sidecar and waits for it to exit; the WAL is
   checkpointed on `SIGTERM` by the server.

### What stays Cloud-only

The website, sign-up and trial flows, FITRON's own billing of gyms (`saas.ts`,
`subscriptions.ts`, `/settings/billing`), the FITRON team console (`/fitron-admin`), the
AI Trainer member app and its API, Google sign-in, email links and codes, webhooks, and
the hosted job scheduler. In Local these routes either do not exist (not shipped) or
answer with a clear "requires the Cloud Edition / an internet connection" page. The full
list is in `FEATURE-MATRIX.md`.

## 4. Baseline (Phase 1)

Branch: `claude/stoic-darwin-k9o1zg` in `sumit4411suman/fitron-windows-app` (the
designated development branch for this work; the brief's `feature/fitron-local-windows`
name is kept as the pull request title). The import commit is unchanged source.

Environment: Ubuntu 24.04, Node 22, PostgreSQL 16 local cluster, Rust 1.97 (for Tauri).

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | pass, 0 errors (39 s) |
| ESLint | `npm run lint` | pass, 0 errors, 2 pre-existing warnings in `scripts/site-assistant.js` (unused `e`) |
| Unit + database tests | `DATABASE_URL=… npm test` | 145 files, 1,345 tests, all pass (2 m 54 s) |
| Production build | `npm run build` | pass, 137 static pages, 375 MB `.next` (1 m 23 s) |
| E2E | `CI=1 npx playwright test` | 313 tests, all pass (6 m 24 s) |

No existing failures were found in any check; the two lint warnings pre-date this work.

## 5. Risks found during inspection

1. **Native modules in the sidecar.** `@node-rs/argon2` and `better-sqlite3` ship
   prebuilt Windows x64 binaries; the Node version in the sidecar must match the ABI the
   binaries were built for. The release build pins Node 22 LTS and installs with
   `npm ci --omit=dev` on a Windows runner (`RELEASE.md`).
2. **Next.js standalone and `process.cwd()`.** `src/lib/pdf/invoice.ts` reads fonts from
   `process.cwd()/node_modules`; `outputFileTracingIncludes` already copies them. The
   sidecar must be started with `cwd` set to the standalone folder.
3. **Daily jobs.** The Cloud Edition relies on an external scheduler calling
   `/api/jobs/daily`. Local needs an in-process scheduler (runs the local-safe jobs on
   start-up and once a day while the app is open).
4. **Single user, many roles.** Sessions, idle sign-out and rate limits already work per
   process; the loopback server trusts `x-forwarded-for` only when set, which the shell
   never sets.
5. **Concurrency.** SQLite serialises writers. The app's transactions are short except
   restore and import (minutes); those are explicitly single-user operations already.

## 6. The owner's architecture diagram, mapped to this code

The FITRON owner's diagram "FITRON Gym Accounting: Complete System Architecture" (Cloud + Windows Desktop)
is the target. Each of its boxes, and where it lives here:

| Diagram box | Implementation | Status |
| --- | --- | --- |
| Shared Code & Business Logic (UI components, domain logic, types, business rules, tests) | `src/components`, `src/lib/domain`, `src/lib/services`, `src/lib/validation`; one copy, used by both editions | Done: the whole test suite runs on both databases |
| Cloud Edition: Next.js + PostgreSQL | unchanged; `FITRON_EDITION` unset | Unchanged, all tests pass |
| Windows Desktop Edition: Tauri 2 shell | `desktop/src-tauri` | Phase 14 |
| Local Application Layer: business logic, data access (Prisma), local file and backup management | the same Next.js server run by the shell on 127.0.0.1; `src/lib/runtime`, `src/lib/db.ts`, `src/lib/integrations/storage.ts` | Data access and files done; backup Phase 10 |
| Local Database: SQLite on the PC | `prisma/schema.local.prisma`, `prisma/local-migrations`, `%LOCALAPPDATA%\FITRON\data\fitron.db` | Done |
| Database Schemas, separate but compatible | `prisma/schema.prisma` and the generated `prisma/schema.local.prisma` | Done |
| Local Integrations (optional): WhatsApp, email, printer, export files | `src/lib/integrations/<service>/`, each off until turned on; printing and PDF/Excel exports work offline | Exports and online services done (Phase 12); printer Phase 17 |
| Optional Cloud Sync (two-way, user controlled, can be disabled) | not in the source today; designed after the Local Edition ships (section 7) | Planned, off by default |
| Encrypted database (optional) | SQLCipher build of SQLite, key in Windows DPAPI | Planned with Phase 19 |
| Local Backup & Restore: `.fitronbackup`, encrypted file, manual or scheduled | Phase 10 | Planned |
| Security: local data, signed updates, no mandatory internet | Phases 13, 18, 19 | Planned |
| Multi-Gym Support: single or multiple gyms, switch between gyms | already multi-tenant (`orgId` on every table); one file holds several gyms, sign-in picks the gym. Separate files per gym (optional) is a later switch in the shell | Single file: done. Separate files: planned |
| Application Updates: check, download signed, install, keep user data | Phase 18 (Tauri updater + pre-update backup) | Planned |
| Deployment: Windows installer, auto updates, no data loss, uninstall keeps data | Phases 15, 16, 18 | Planned |

### The one deliberate difference: where the business logic runs

The diagram's Local Application Layer reads "Rust Commands (Tauri)". In this build the business logic stays
in TypeScript and runs in a bundled Node.js process (the Tauri sidecar); Rust is used only for the shell's own
jobs (start and stop the server, printing, file dialogs, updates, single-instance lock). Reasons:

- The business rules are 134 TypeScript service modules and 1,348 tests. Porting them to Rust would be the
  "rebuild from scratch" the brief rules out, and would leave two copies of every GST and invoice rule to keep
  equal.
- With the sidecar, the Cloud and Desktop editions run the same code, so a fix to an invoice rule reaches both.
- The customer still installs nothing else: `node.exe` ships inside the installer, listens on 127.0.0.1 only,
  and stops when FITRON closes.

## 7. Optional Cloud Sync (later)

Not part of 1.0. When built, it will be off by default and switched on by the owner, sending only the gym's
own records to the gym's own FITRON Cloud account. It needs, per table, a change log (row id, version,
updated-at) and a conflict rule. Money records are append-only (invoices are cancelled, payments reversed,
never edited), which makes them conflict-free to merge; settings and member details need last-writer-wins
with an audit entry. Numbering (invoice numbers) must stay gap-free per branch, so each device would get its
own invoice prefix before sync is enabled.
