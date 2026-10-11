# FITRON Local Windows Edition: database migration design

How the Cloud Edition's PostgreSQL schema (`prisma/schema.prisma`, 72 models, 47 migrations) becomes the
Local Edition's SQLite schema (`prisma/schema.local.prisma`), what changes, what does not, and why.

## 1. Approach

**One schema source, two generated clients.** `prisma/schema.local.prisma` is produced from the Cloud schema
by `scripts/local-schema.ts` and checked by `src/lib/local-schema.test.ts`, so the two cannot drift. Every
model, field, relation, index and unique constraint of the Cloud schema exists in the Local schema. Only
what SQLite cannot store is written differently, and every such case is listed in section 3 and handled in
exactly one place in code (section 4). The Cloud schema and its migrations are untouched.

Why parity rather than a trimmed local schema:

- The 134 service modules compile against one set of model types. Dropping tables would make a service
  that happens to touch one of them fail at run time in Local only, which is the class of bug this
  project must not have in accounting software.
- The existing JSON backup format (`src/lib/domain/backup.ts`) lists tables by name; a gym moving from
  Cloud to Local (or back) can carry its data across because the tables exist on both sides.
- Hosted-only tables (section 5) are simply empty on a laptop. Empty tables cost nothing.

**Money stays integer paise.** Every amount is an `Int` on both databases. SQLite integers are 64-bit, so
there is no range change. No column changes from integer to a floating type; the only `Decimal`
columns are percentage rates, which the services already read with `Number()` before any arithmetic
(`invoice-pdf.ts`, `assets.ts`, `reports.ts`, the invoice page). No financial calculation changes.

**Migrations** live in `prisma/local-migrations/<name>/migration.sql` and are applied by
`src/lib/runtime/local-migrate.ts` at start-up (one transaction each, recorded with a checksum in
`_fitron_migrations`). The shipped app has no Prisma CLI, so this runner is the production path, and the
same code runs in tests. `0001_init` is the full schema: generated with `prisma migrate diff`, then
hand-adjusted where marked `-- fitron:` (section 3).

## 2. Type mapping

| Prisma type (Cloud native type) | PostgreSQL | SQLite column | Notes |
| --- | --- | --- | --- |
| `Int` (money in paise, counts, rates in paise) | integer | INTEGER | identical range in practice (SQLite is 64-bit) |
| `BigInt @default(autoincrement())` (AuditLog.id) | bigserial | INTEGER PRIMARY KEY AUTOINCREMENT | the generator emits `BIGINT PRIMARY KEY`, which SQLite would not auto-assign; corrected by hand. Prisma still returns `bigint`. |
| `Decimal @db.Decimal(5,2)` / `(5,1)` / `(4,1)` | numeric | DECIMAL | tax rates and body measurements only; read with `Number()`. Not used for money. |
| `Float` (AI Trainer water, weight) | double | REAL | hosted-only tables |
| `String` | text | TEXT | |
| `String[]` | text[] | TEXT, default `"[]"` | JSON text; converted by the Local client (section 4) |
| `Boolean` | boolean | BOOLEAN (0/1) | |
| `DateTime @db.Date` (Indian calendar dates) | date | DATETIME (ISO text, midnight UTC) | `src/lib/services/time.ts` already treats these as UTC-midnight instants; unchanged |
| `DateTime @db.Timestamptz` | timestamptz | DATETIME (ISO text) | |
| `Json` | jsonb | JSONB (text) | Prisma filters use a JSONPath string on SQLite (`jsonPath()` helper) |
| `Bytes` | bytea | BLOB | encrypted biometric templates, TOTP secret |
| `@db.VarChar(64)` | varchar(64) | TEXT | audit hashes |
| `@default(cuid())`, `@updatedAt`, `@default(now())` | client/`now()` | client/`CURRENT_TIMESTAMP` | same behaviour |
| enums | none in the schema | none | status columns are strings on both |

## 3. Schema features that needed a hand-written answer

| Cloud (PostgreSQL) | Local (SQLite) | Where |
| --- | --- | --- |
| Partial unique index `Member(orgId, phone) WHERE deletedAt IS NULL AND NOT walkIn` (a migration, not in the schema) | identical partial index | `0001_init` |
| PL/pgSQL triggers refusing DELETE on money tables unless `current_setting('fitron.allow_delete')` says `restore` or `demo-clear`; TRUNCATE refused; AuditLog UPDATE/DELETE refused | SQLite triggers with the same rules reading a one-row `_fitron_guard` table written inside the transaction; same error wording; SQLite has no TRUNCATE | `0001_init`, `src/lib/services/db-guard.ts` |
| `set_config(..., true)` ends with the transaction | the guard row is removed by `revokeDelete()` before commit, by a rollback, and by every connect | `db-guard.ts`, `sqlite-adapter.ts` |
| Row-level security on every table (for Supabase's API roles) | not applicable: no network API in front of the file | dropped |
| `pg_advisory_xact_lock` (audit chain, coupons, self check-in, subscriptions) | no-op: the adapter runs one transaction at a time and SQLite has one writer | `db-dialect.ts lockKey()` |
| `SELECT … FOR UPDATE` (class capacity, purchase balance, FITRON billing) | no-op, same reason | `db-dialect.ts lockRow()` |
| `INSERT … ON CONFLICT DO UPDATE … RETURNING` (gap-free numbering) | same SQL; SQLite supports upsert and RETURNING | unchanged `sequence.ts` |
| `nextval('fitron_invoice_seq')` (FITRON's own invoices to gyms) | hosted-only path, never runs in Local | unchanged `saas.ts` |
| `mode: "insensitive"` on `contains`/`equals` (32 sites) | plain `contains` (LIKE is case-insensitive for ASCII) | `db-dialect.ts ci()`, `ciEquals()` |
| Json filter `path: ["a","b"]` | `path: "$.a.b"` | `db-dialect.ts jsonPath()` |
| `createMany({ skipDuplicates })` (roles, WhatsApp templates) | insert all, and on a clash insert one by one skipping clashes | `local-client.ts` |
| Json column defaults `DEFAULT '{}'` | generator emitted a bare `{}`; quoted by hand | `0001_init` |

## 4. Where the differences are handled in code

```
src/lib/db.ts                     picks the client by FITRON_EDITION
src/lib/runtime/local-client.ts   Local client: list fields array ⇄ JSON, skipDuplicates
src/lib/runtime/sqlite-adapter.ts PRAGMAs (foreign_keys, WAL, synchronous=FULL, busy_timeout), one statement at a time
src/lib/runtime/local-migrate.ts  applies prisma/local-migrations, integrity check
src/lib/db-dialect.ts             lockKey, lockRow, ci, ciEquals, jsonPath, listHas, listEmpty
src/lib/services/db-guard.ts      allowDelete / revokeDelete
```

Nothing else in `src/lib/services` knows which database it is on.

## 5. Model-by-model table

Columns: indexes and unique constraints are carried over 1:1 (the numbers are from the Cloud schema);
"relations" is the delete behaviour, identical on both; "changes" lists every type that is stored
differently on SQLite. "none" means the table is byte-for-byte the same definition apart from column
type names.

Local use: **core** (written by the Local Edition), **online** (written only when an online feature is
switched on), **hosted-only** (exists for parity; always empty on a laptop).

| Model | Indexes | Unique | Relations | Changes on SQLite |
| --- | --- | --- | --- | --- |
| Organization | 0 | 0 | Restrict (default) | 0 date + 2 timestamp columns → DATETIME (ISO text) |
| Branch | 2 | 0 | Restrict (default) | 0 date + 2 timestamp columns → DATETIME (ISO text) |
| User | 0 | 0 | Restrict (default) | Bytes → BLOB: totpSecret; 1 date + 6 timestamp columns → DATETIME (ISO text) |
| RecoveryCode | 0 | 1 | onDelete Cascade | 0 date + 2 timestamp columns → DATETIME (ISO text) |
| AuthToken | 1 | 0 | onDelete Cascade | 0 date + 3 timestamp columns → DATETIME (ISO text) |
| AuthCode | 1 | 0 | onDelete Cascade | 0 date + 3 timestamp columns → DATETIME (ISO text) |
| Session | 1 | 0 | onDelete Cascade | 0 date + 3 timestamp columns → DATETIME (ISO text) |
| Role | 0 | 0 | Restrict (default) | none |
| Permission | 0 | 0 | Restrict (default) | none |
| RolePermission | 0 | 0 + composite id | Restrict (default) | none |
| UserBranch | 0 | 0 + composite id | Restrict (default) | none |
| Member | 3 | 3 | Restrict (default) | 1 date + 5 timestamp columns → DATETIME (ISO text) |
| MembershipPlan | 0 | 0 | Restrict (default) | String[] → JSON text: features; 0 date + 2 timestamp columns → DATETIME (ISO text) |
| PlanPrice | 0 | 0 + composite id | Restrict (default) | none |
| Membership | 2 | 0 | Restrict (default) | 2 date + 1 timestamp columns → DATETIME (ISO text) |
| Invoice | 2 | 1 | Restrict (default) | 2 date + 2 timestamp columns → DATETIME (ISO text) |
| InvoiceItem | 0 | 0 | Restrict (default) | Decimal(5,2)/(5,1) → DECIMAL (read with Number()): taxRate |
| Payment | 3 | 1 | Restrict (default) | 1 date + 2 timestamp columns → DATETIME (ISO text) |
| Expense | 2 | 0 | Restrict (default) | 1 date + 1 timestamp columns → DATETIME (ISO text) |
| SalaryPayment | 2 | 1 | Restrict (default) | 1 date + 1 timestamp columns → DATETIME (ISO text) |
| ExpenseCategory | 0 | 0 | Restrict (default) | none |
| AuditLog | 3 | 0 | Restrict (default) | Json → JSONB text: after; BigInt autoincrement id → INTEGER PRIMARY KEY AUTOINCREMENT; 0 date + 1 timestamp columns → DATETIME (ISO text) |
| MonthLock | 0 | 0 + composite id | Restrict (default) | 0 date + 1 timestamp columns → DATETIME (ISO text) |
| Setting | 0 | 0 + composite id | Restrict (default) | none |
| Sequence | 0 | 0 + composite id | Restrict (default) | none |
| Attendance | 2 | 0 | Restrict (default) | 1 date + 2 timestamp columns → DATETIME (ISO text) |
| Lead | 2 | 0 | Restrict (default) | 2 date + 3 timestamp columns → DATETIME (ISO text) |
| ClassSlot | 1 | 0 | Restrict (default) | 0 date + 1 timestamp columns → DATETIME (ISO text) |
| Booking | 1 | 1 | Restrict (default) | 1 date + 2 timestamp columns → DATETIME (ISO text) |
| Product | 0 | 1 | Restrict (default) | 0 date + 1 timestamp columns → DATETIME (ISO text) |
| StockMovement | 1 | 0 | Restrict (default) | 0 date + 1 timestamp columns → DATETIME (ISO text) |
| WorkoutPlan | 0 | 0 | Restrict (default) | Json → JSONB text: days; 0 date + 1 timestamp columns → DATETIME (ISO text) |
| DietPlan | 0 | 0 | Restrict (default) | Json → JSONB text: meals; 0 date + 1 timestamp columns → DATETIME (ISO text) |
| ProgressLog | 1 | 0 | Restrict (default) | Decimal(5,2)/(5,1) → DECIMAL (read with Number()): weightKg, bodyFat, waistCm; 1 date + 1 timestamp columns → DATETIME (ISO text) |
| MembershipFreeze | 1 | 0 | Restrict (default) | 2 date + 1 timestamp columns → DATETIME (ISO text) |
| Notification | 1 | 0 | Restrict (default) | 0 date + 2 timestamp columns → DATETIME (ISO text) |
| WhatsAppTemplate | 0 | 1 | Restrict (default) | 0 date + 1 timestamp columns → DATETIME (ISO text) |
| WhatsAppMessage | 4 | 0 | Restrict (default) | 0 date + 4 timestamp columns → DATETIME (ISO text) |
| AutopayMandate | 1 | 1 | Restrict (default) | 2 date + 2 timestamp columns → DATETIME (ISO text) |
| AutopayEvent | 0 | 0 | Restrict (default) | 0 date + 1 timestamp columns → DATETIME (ISO text) |
| JobRun | 0 | 1 | Restrict (default) | Json → JSONB text: result; 0 date + 2 timestamp columns → DATETIME (ISO text) |
| Asset | 1 | 1 | Restrict (default) | Decimal(5,2)/(5,1) → DECIMAL (read with Number()): rate; 2 date + 2 timestamp columns → DATETIME (ISO text) |
| Purchase | 1 | 1 | Restrict (default) | 1 date + 1 timestamp columns → DATETIME (ISO text) |
| PurchaseLine | 0 | 0 | Restrict (default) | none |
| VendorPayment | 1 | 0 | Restrict (default) | 1 date + 1 timestamp columns → DATETIME (ISO text) |
| AiProposal | 1 | 0 | Restrict (default) | Json → JSONB text: payload; 0 date + 2 timestamp columns → DATETIME (ISO text) |
| Device | 0 | 0 | Restrict (default) | 0 date + 2 timestamp columns → DATETIME (ISO text) |
| DeviceCommand | 1 | 1 | Restrict (default) | 0 date + 3 timestamp columns → DATETIME (ISO text) |
| DeviceUser | 0 | 0 + composite id | Restrict (default) | 0 date + 1 timestamp columns → DATETIME (ISO text) |
| BiometricTemplate | 0 | 1 | Restrict (default) | Bytes → BLOB: data; 0 date + 1 timestamp columns → DATETIME (ISO text) |
| AccessLog | 2 | 0 | Restrict (default) | 0 date + 1 timestamp columns → DATETIME (ISO text) |
| BranchSubscription | 4 | 0 | Restrict (default) | 2 date + 4 timestamp columns → DATETIME (ISO text) |
| RazorpaySubscription | 2 | 0 | Restrict (default) | 0 date + 4 timestamp columns → DATETIME (ISO text) |
| MemberDocument | 1 | 0 | Restrict (default) | 0 date + 2 timestamp columns → DATETIME (ISO text) |
| Backup | 1 | 0 | Restrict (default) | Json → JSONB text: counts; 0 date + 3 timestamp columns → DATETIME (ISO text) |
| Enquiry | 1 | 0 | Restrict (default) | 0 date + 2 timestamp columns → DATETIME (ISO text) |
| Offer | 0 | 1 | Restrict (default) | 1 date + 2 timestamp columns → DATETIME (ISO text) |
| Coupon | 0 | 0 | Restrict (default) | 1 date + 2 timestamp columns → DATETIME (ISO text) |
| CouponRedemption | 3 | 0 | onDelete Restrict | 0 date + 2 timestamp columns → DATETIME (ISO text) |
| TrainerMember | 2 | 0 | onDelete SetNull | Json → JSONB text: profile; 1 date + 8 timestamp columns → DATETIME (ISO text) |
| TrainerLoginToken | 1 | 0 | Restrict (default) | 0 date + 3 timestamp columns → DATETIME (ISO text) |
| TrainerSession | 1 | 0 | onDelete Cascade | 0 date + 3 timestamp columns → DATETIME (ISO text) |
| TrainerDay | 0 | 1 | onDelete Cascade | Json → JSONB text: habits, sets; Float → REAL: water; 1 date + 1 timestamp columns → DATETIME (ISO text) |
| TrainerChat | 1 | 1 | onDelete Cascade | Json → JSONB text: messages; 0 date + 2 timestamp columns → DATETIME (ISO text) |
| TrainerReview | 0 | 1 | onDelete Cascade | Json → JSONB text: focus; Float → REAL: avgWater; 1 date + 1 timestamp columns → DATETIME (ISO text) |
| TrainerPayment | 3 | 0 | onDelete Restrict | 2 date + 4 timestamp columns → DATETIME (ISO text) |
| TrainerPush | 1 | 0 | onDelete Cascade | Json → JSONB text: sent; 0 date + 2 timestamp columns → DATETIME (ISO text) |
| TrainerContent | 0 | 0 | Restrict (default) | 0 date + 1 timestamp columns → DATETIME (ISO text) |
| TrainerCoachUsage | 0 | 0 + composite id | Restrict (default) | 1 date + 0 timestamp columns → DATETIME (ISO text) |
| SupportTicket | 1 | 1 | Restrict (default) | 0 date + 3 timestamp columns → DATETIME (ISO text) |
| SupportTicketReply | 1 | 0 | onDelete Cascade | 0 date + 1 timestamp columns → DATETIME (ISO text) |
| PersonalRecord | 1 | 0 | Restrict (default) | 1 date + 1 timestamp columns → DATETIME (ISO text) |

Local use by model:

- **core**: Organization, Branch, User, RecoveryCode, Session, Role, Permission, RolePermission, UserBranch,
  Member, MembershipPlan, PlanPrice, Membership, Invoice, InvoiceItem, Payment, Expense, SalaryPayment,
  ExpenseCategory, AuditLog, MonthLock, Setting, Sequence, Attendance, Lead, ClassSlot, Booking, Product,
  StockMovement, WorkoutPlan, DietPlan, ProgressLog, MembershipFreeze, Notification, JobRun, Asset,
  Purchase, PurchaseLine, VendorPayment, MemberDocument, Backup, Offer, SupportTicket, SupportTicketReply,
  PersonalRecord.
- **online** (only when the gym turns the feature on): WhatsAppTemplate, WhatsAppMessage (the demo provider
  writes "Logged" rows offline), AutopayMandate, AutopayEvent (demo mode offline), AiProposal, Device,
  DeviceCommand, DeviceUser, BiometricTemplate, AccessLog, AuthToken, AuthCode.
- **hosted-only** (empty in Local): BranchSubscription, RazorpaySubscription, Coupon, CouponRedemption,
  Enquiry, TrainerMember, TrainerLoginToken, TrainerSession, TrainerDay, TrainerChat, TrainerReview,
  TrainerPayment, TrainerPush, TrainerContent, TrainerCoachUsage.

## 6. Data loss and financial-correctness review

- No column narrows. Integers stay 64-bit; text has no length limit on SQLite; DECIMAL keeps the digits
  given.
- No column is dropped, no table is merged.
- Dates: the Cloud stores `@db.Date` as a calendar date and Prisma hands it to code as UTC midnight;
  SQLite stores the same UTC-midnight instant as ISO text. `toIso`/`fromIso` in `time.ts` produce the same
  strings on both. The 1,345 unit and database tests, which include every date and period calculation,
  run on both databases (section 7).
- Transactions: every money write already runs in `db.$transaction`; SQLite transactions are atomic and,
  with `synchronous=FULL` and WAL, durable across a power cut once committed. A failed transaction rolls
  back the invoice, the membership, the payment, the sequence number and the audit row together, exactly
  as on PostgreSQL.
- Concurrency: PostgreSQL allowed many writers; SQLite allows one. The adapter serialises statements and
  transactions inside the process, so the application sees the same outcome (one of two simultaneous
  sales of the last class place is refused, both audit rows chain correctly). A long restore blocks other
  requests for its duration instead of running beside them, which is the intended behaviour for a
  single-user desktop.
- Case-insensitive search: SQLite's LIKE folds ASCII only. Member names, codes, phone numbers and invoice
  numbers in the console are ASCII; a name typed in another script matches exactly as typed.

## 7. Verification

- `npx prisma validate --schema prisma/schema.local.prisma`: valid.
- `0001_init` applies to an empty file in one transaction and is idempotent: 72 model tables +
  `_fitron_guard` + `_fitron_migrations`, 15 triggers, 186 indexes, `PRAGMA integrity_check` ok.
- The whole existing suite runs on both databases. `npm test` (PostgreSQL) and `npm run test:local`
  (a fresh SQLite file migrated by the production runner, `FITRON_EDITION=local`); CI runs both.

  | Suite | Files | Tests passed | Skipped |
  | --- | --- | --- | --- |
  | PostgreSQL (Cloud) | 146 | 1,348 | 0 |
  | SQLite (Local) | 146 + 1 skipped | 1,348 | 4 |

  The four Local skips have no SQLite counterpart: row-level security (no database API in front of a
  file), the two TRUNCATE tests (SQLite has no TRUNCATE; DELETE runs the row triggers, which are tested),
  and the vertical-slice file is skipped on PostgreSQL. PostgreSQL-only steps inside other tests
  (`DISABLE TRIGGER`, `set_config`) have SQLite equivalents.
- `src/lib/services/local-vertical-slice.db.test.ts` (Phase 6): member → membership with a registration
  fee and 18% GST → partial payment → balance payment → invoice state PAID → member history; plus
  overpayment refused before any write, a mid-transaction failure rolling back the invoice number, and a
  second connection reading the committed invoice from the WAL-mode file.

Bugs the SQLite run found and fixed while porting (each now covered by the suite):

1. Guard triggers let deletes through when no permission row existed (`NOT (NULL OR NULL)` is NULL, which
   a `WHEN` treats as false). Every comparison is now `COALESCE`d.
2. The delete permission could outlive its transaction if a caller forgot to revoke it. The adapter now
   clears it inside every commit, matching PostgreSQL's transaction-local setting.
3. Prisma reports a trigger abort as a foreign-key error and hides its text; the Local client rethrows it
   with the trigger's sentence ("Deleting a Payment record is not allowed: financial records are kept").
4. One shared connection deadlocked when code read through `db` while a transaction was open. Plain reads
   now use a second, read-only connection (committed data only, like a second PostgreSQL connection);
   writes wait their turn with a 30-second limit and a clear "database is busy" error.
5. Prisma field references (`uses < usageLimit` on offers) were being copied by the list-field encoder;
   only plain object literals are now walked.

## 8. Future migrations

A change to `prisma/schema.prisma` is followed by:

1. `npx tsx scripts/local-schema.ts` (regenerates the Local schema; the test fails otherwise).
2. `npx prisma generate --schema prisma/schema.local.prisma`.
3. `npx prisma migrate diff --from-migrations prisma/local-migrations --to-schema prisma/schema.local.prisma --script`
   with a SQLite shadow database, reviewed by hand (SQLite rewrites tables for most column changes:
   check that the generated script copies data and keeps the guard triggers), saved as
   `prisma/local-migrations/<NNNN>_<name>/migration.sql`.
4. The updater runs the new migration after taking a pre-update backup (Phase 18); a failure restores
   it.
