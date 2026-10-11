# FITRON cloud sync: design (phase S1 and S2 of the sync work)

Status: built (S3 to S9); deployment, recovery and rollback in DEPLOY-SYNC.md. §1 to §10 are the design as agreed;
§11 lists where the build differs from it, and why.

## 1. What exists today

| | fitron.in (Cloud Edition) | FITRON for Windows (Local Edition) |
| --- | --- | --- |
| Code | `sumitgoxlofficial-jpg/fitron` (moved on since this repo's baseline: 284 files, 3 new models, 5 migrations as of 11 Oct 2026) | this repository, branched from that baseline, both editions in one codebase |
| Server | Next.js 16 App Router, server actions and route handlers, one `src/lib/services` layer | the same server, packaged with Node.js inside the desktop program |
| Database | PostgreSQL (Prisma 7); on Vercel through the Supabase pooler, or a Postgres container on a Docker host | SQLite (`prisma/schema.local.prisma`, generated from the Cloud schema; same models and fields) |
| Identity | gym accounts on fitron.in (email + password, two-step, Google); one organisation per gym, branches, roles | first-run setup makes the owner and gym on the computer; no fitron.in account; its own sessions |
| Ids | `cuid()` on 57 models: globally unique, made by whichever side creates the record, so a record keeps its id on both sides | the same |
| Timestamps | `createdAt` everywhere; `updatedAt` on 17 of 72 models only | the same |
| Audit | `AuditLog`: hash-chained per organisation, written inside the service transaction for financial and most other writes (`src/lib/services/audit.ts`) | the same |
| Writes | 172 `db.$transaction` sites across 78 services; every financial change is one transaction | the same services |
| Realtime | none; no Supabase client, no WebSockets; Vercel route handlers may stream for up to `maxDuration` | none |
| Online rule | n/a | every connection in `src/lib/integrations/`; nothing leaves the computer unless a user turns a feature on (ONLINE-SERVICES.md) |

One codebase for both sides is a precondition: the sync protocol lives in the services layer, which both editions
share. Reuniting the two repositories is the first build step (the owner decides where fitron.in deploys from).

## 2. Decisions

| Question | Decision | Why |
| --- | --- | --- |
| Who may sync | A Windows installation is **linked** to one fitron.in gym by that gym's owner (Super Admin) signing in once in Settings › Cloud sync. The server issues a **device token** for that installation and gym, held sealed with DPAPI (Phase 19). The token carries the gym, the device and the role of the person who linked it; every request is checked against it. | Gym-level isolation, no fitron.in password on the computer, revocable from the website (Settings › Devices). |
| Source of truth | For a record changed on one side only, that side. For a record changed on both sides between syncs, the rules in §6 per data type. Financial records are never overwritten. | What the owner asked for: the website is authoritative for cloud-side changes, and nothing financial is lost silently. |
| Change tracking | A **transactional outbox**: `SyncChange` on both sides, written in the same database transaction as the change it records (one hook in the services layer, next to `audit()`). Every row: organisation, sequence, entity, entity id, operation (upsert/delete), record version, the record's data as of that write, who, when, and on the Windows side a change id (uuid) as the idempotency key. | Durable: a change is recorded exactly when it is committed, never lost if the app closes. Incremental: a consumer reads from its last sequence. |
| Pull | `GET /api/sync/changes?since=<seq>&limit=500`: the gym's changes after `since`, in order, with the new cursor. Applied to SQLite in one transaction per batch; the checkpoint (`SyncState.pulledSeq`) is written in that same transaction, so a failed batch advances nothing. | Pagination, checkpoints, recovery after long offline periods, a failed SQLite transaction never advances the checkpoint. |
| Push | `POST /api/sync/push` with a batch of outbound changes. Each is applied **through the same service function** the website uses for that action (not by writing rows), inside one transaction per change, with the change id recorded in `SyncApplied` in that transaction; a change id seen before answers the stored result without applying again. The answer carries, per change: applied (with the server version), already-applied, rejected (reason), or conflict (both versions). Only then is the local row marked synced. | Validation and business rules stay on the server; idempotent retries; no duplicate payments or invoices; the server never lies "synced". |
| Notify | **Server-Sent Events** at `GET /api/sync/events` (one line per new sequence number for the gym), reconnecting automatically; the server's `maxDuration` bounds a connection and the client reconnects with `since`. A poll every 60 seconds when the stream is unavailable. | Near-real-time on the hosting FITRON has (Vercel streams, Docker hosts hold connections); no new infrastructure. Supabase Realtime is not used because fitron.in does not use Supabase's client. |
| Versions | `SyncChange.version` per record, the server's sequence number at the last confirmed write of that record. A Windows change carries the version it was made from (`baseVersion`). The server compares with the record's current version: equal → apply; older → conflict path (§6). | Explicit conflict detection without a column on 72 models; the outbox is the version store. |
| Deletes | FITRON rarely deletes (financial records cannot be deleted; members are deactivated, invoices cancelled, payments reversed). Where a true delete exists (a draft, a lead, a document), the outbox row is a **tombstone** (`op: delete`) that the other side applies as a delete and remembers, so the record does not come back. | Removed data does not reappear. |
| Full reconciliation | If a checkpoint is invalid (the gym's outbox was trimmed past it, or a restore moved the database back), the client falls back to a **snapshot** pull: every synced record of the gym, by entity, paginated, applied with the same upsert rules, then incremental again from the snapshot's sequence. | Recovery from a checkpoint that cannot be resumed. |
| Transport | HTTPS only; the device token in a header; the server's existing CSP, rate limits and audit apply. No database credentials on the computer. The Windows side opens connections only from `src/lib/integrations/sync/` (the egress rule, Phase 12). | §8 of the request. |

## 3. Data that syncs

Per gym, in this order of dependency (parents first), each with its service functions for push and its upsert for pull:

| Group | Models | Push applies through |
| --- | --- | --- |
| Gym and settings | Organization (profile fields), Branch, Setting, Sequence (read-only on pull; see §6), ExpenseCategory, Role, RolePermission, User (staff, without password hashes), UserBranch | `settings.ts`, `staff.ts` |
| Members | Member, MemberDocument (metadata; files by `StoredFile`/documents transfer), MembershipPlan, PlanPrice, Membership, MembershipFreeze, Lead, Enquiry | `members.ts`, `plans.ts`, `freeze.ts` |
| Money | Invoice, InvoiceItem, Payment, Expense, Purchase, PurchaseLine, VendorPayment, SalaryPayment, Asset, MonthLock, Offer, Coupon, CouponRedemption | `billing.ts`, `expenses.ts`, `purchases.ts`, `payroll.ts`, `assets.ts`, `periods.ts` |
| Operations | Attendance, AccessLog, ClassSlot, Booking, Product, StockMovement, WorkoutPlan, DietPlan, ProgressLog, PersonalRecord, Notification, WhatsAppTemplate, WhatsAppMessage, AutopayMandate, AutopayEvent | the matching services |
| Audit | AuditLog is **not merged**: each side keeps its own chain, and sync writes its own audit entries ("applied from cloud", "applied from device X"). | `audit.ts` |

Not synced: Session, AuthToken, AuthCode, RecoveryCode, BiometricTemplate, Device/DeviceCommand/DeviceUser (hardware on one network), JobRun, Backup, the FITRON-side billing models (BranchSubscription, RazorpaySubscription), the AI Trainer models, SupportTicket, AiChat (personal), AiProposal, TrainerPush. Files (documents, photos, logos): their metadata syncs; bodies are fetched by key when missing, both ways, through the existing storage integration.

GST: the GST figures live on Invoice and InvoiceItem (rates, type, amounts in paise) and Setting (GSTIN, SAC); they sync with those records and are never recomputed on the receiving side.

## 4. Schema additions

Both schemas (Cloud and Local), applied by both migration runners:

```
SyncChange     id (uuid, the idempotency key)   orgId   seq (bigint, per side)   entity   entityId
               op (upsert|delete)   version (bigint)   baseVersion (bigint?)   data (json)   actorUserId
               deviceId?   createdAt   index (orgId, seq), (orgId, entity, entityId)
SyncDevice     id   orgId   name   tokenHash   linkedByUserId   linkedAt   lastSeenAt   revokedAt?   (Cloud only)
SyncApplied    changeId (pk)   orgId   result (json)   appliedAt           (Cloud: idempotency; Local: pulled changes)
SyncState      one row: deviceId, orgId, pulledSeq, pushedChangeId, lastOkAt, lastError   (Local only)
SyncConflict   id   orgId   entity   entityId   ours (json)   theirs (json)   kind   openedAt   resolvedAt?   resolution?
```

Indexes on `(orgId, seq)` serve every incremental query; the outbox is trimmed after 90 days once every linked device
has pulled past it (never before), and a device further behind takes the snapshot path.

## 5. Flows

**Website → Windows.** A service writes the record and its `SyncChange` in one transaction (the hook is the same
function that writes the audit entry). The SSE stream for the gym sends the new sequence. The client pulls
`changes?since=`, validates each change (schema per entity, gym id equals the device's gym), applies the batch in one
SQLite transaction with the checkpoint, and the open page refreshes the changed records (a `sync` event on the
page's existing data hooks). The cursor is written only in the batch's transaction.

**Windows → website.** A service writes the record and its `SyncChange` (op, data, baseVersion, a new change id) in
one SQLite transaction; the screen shows the change at once. The sync worker (in the local scheduler process) pushes
pending changes in order, in batches of up to 100, with a bounded exponential backoff (5 s to 10 min) on network or
5xx failures and no retry on a 4xx rejection (shown as a failed item). The server applies each through its service
function, records the change id, answers per change; the client marks a change synced only on `applied` or
`already-applied`, keeps `rejected` ones for the owner, and opens a `SyncConflict` for `conflict`. After a push the
client pulls, so the server's versions of its own writes (and anything else new) land in SQLite.

**Offline.** Nothing changes for the desk. The worker sleeps and retries when the computer is online again
(`probablyOnline` from Phase 11 before each attempt). Pending counts come from the outbox and are shown in the
header badge and Settings › Cloud sync. Queued changes live in SQLite, so a restart or a crash loses none.

## 6. Conflict rules, per data type

A conflict is a Windows change whose `baseVersion` is older than the record's current server version.

| Data | Rule |
| --- | --- |
| Member contact and profile fields | Field-level merge where the two sides changed different fields. Where both changed the same field, the later confirmed write wins (server time of confirmation, not the computer's clock), **both versions are kept** in `SyncConflict`, and Settings › Cloud sync shows them with "Keep website's" / "Keep this computer's". |
| Membership (dates, status, freezes) | Never merged field by field. The server's state wins; the Windows change is kept as a conflict for the owner, with the actions the services allow (extend, freeze, cancel) offered as the way to re-apply it. Validity dates and audit history are never rewritten. |
| Payment | Immutable once confirmed on either side. A payment made offline is pushed as a new payment (new id, idempotent by change id) through `collectPayment`, which checks the invoice balance on the server; one that would overpay is rejected with the reason and kept for the owner. Corrections only through `reversePayment` (audited). |
| Invoice | Issued invoices keep their number and figures on both sides. Numbers come from `Sequence`, which is **per side**: Windows invoices carry the computer's own prefix (`INV-W1-`, set when linking, from the gym's numbering settings) so two sides never issue the same number. Corrections through `cancelInvoice` and a new invoice, as today. |
| Accounting entries | Derived from invoices, payments, expenses, purchases and payroll by the same services on both sides; they sync as part of those records, and the ledger is rebuilt by the receiving side's services, never copied row by row. The books tie out because the paise are identical. |
| Expenses, purchases, payroll, assets | A confirmed record is immutable; edits are voids plus new records, as the services already work. |
| Settings | Last confirmed write wins; the previous value is kept in the audit entry. GST settings and numbering changes made on the website apply to invoices issued afterwards on the computer. |
| Deletes | A tombstone wins over a concurrent edit; the edit is kept in `SyncConflict` so nothing is lost silently. |
| Staff | Password hashes, two-step secrets and sessions never sync. A staff member created on the website gets a password set on the computer by the Super Admin, as today. |

Unresolved conflicts never block the rest of the queue: the conflicting change is set aside with both versions, the
queue continues, and the owner settles it in Settings › Cloud sync.

## 7. Security

- Every request carries the device token (random 256-bit, stored as a hash); the server resolves gym and device from
  it, never from the request body. A request naming another gym's record is rejected and audited.
- The token is scoped by the role of the person who linked the device: a device linked by a receptionist pushes only
  what a receptionist may do (`requirePermission` runs for every applied change with that role).
- Linking needs the gym owner's fitron.in password and two-step code, on the computer, over HTTPS; the token comes
  back once and is sealed with DPAPI beside the installation's other secrets. Revoking it on the website stops the
  device at its next request.
- The server validates every change against the entity's zod schema and applies it through the service function, so
  every business rule (balances, month locks, GST arithmetic in paise) holds for synced changes as for typed ones.
- No database credentials, no S3 keys, no FITRON secrets on the computer. The computer never connects to PostgreSQL.
- Sync writes its own audit entries on both sides; the health page shows counts and times only, never record contents.
- Nothing is sent to analytics or any third party; the egress test keeps every connection inside `integrations/`.

## 8. The Windows screen (Settings › Cloud sync)

Status (Connected, Offline, Syncing, Error), the cloud account and gym it is linked to, last successful sync, pending
uploads and downloads (counts from the outbox and the last cursor), failed items with their reasons and a Retry
button, open conflicts with both versions and the actions of §6, a link to the sync log (times and counts only), and
"Unlink this computer". The header shows a small badge with the pending count while anything is queued.

## 9. Tests (what each build phase must pass before the next)

| Test | Kind |
| --- | --- |
| Website member update → Windows reflects it (through SSE and through polling) | end-to-end, two servers on one machine (a Cloud server on PostgreSQL and a Local server on SQLite, linked) |
| Website membership update → Windows | end-to-end |
| Website payment and invoice → Windows receives the records, paise identical | end-to-end |
| Windows update → website reflects the confirmed change | end-to-end |
| Offline changes → synced after reconnection; app restart keeps the queue | end-to-end (the offline preload from Phase 11) |
| Duplicate delivery → one payment, one invoice | integration (push the same batch twice) |
| Simultaneous edits → §6 rules, both versions kept | integration |
| Another gym's device → rejected and audited | integration |
| Server transaction fails → not acknowledged, client keeps it pending | integration |
| SQLite transaction fails → checkpoint not advanced | unit |
| 5,000 members, 100,000 payments → incremental pull and push stay bounded | load (the Phase 20 dataset) |
| Network cut during upload and during download → safe recovery | end-to-end with the connection dropped mid-batch |
| Deleted records → do not reappear | integration |
| Both migrations on populated databases → existing data intact | the Phase 18 update test, extended |

## 10. Build phases

| Phase | Deliverable |
| --- | --- |
| S0 | Reunite the codebases: merge upstream `fitron` into this repository, generate the SQLite side of its 5 migrations, all suites green |
| S1, S2 | This document (done when the owner agrees to it) |
| S3 | Cloud outbox: `SyncChange` and the services hook, `SyncDevice`, linking endpoints; migrations |
| S4 | Local outbox and queue, `SyncState`, the worker in the local scheduler |
| S5 | `/api/sync/changes`, `/api/sync/push`, `/api/sync/snapshot`, the client, idempotency and audit |
| S6 | SSE stream and reconnection; page refresh on applied changes |
| S7 | Backoff, reconciliation, conflicts and `SyncConflict` |
| S8 | Settings › Cloud sync, the header badge, diagnostics |
| S9 | The tests of §9, including the load test |
| S10 | Deployment, migration, recovery and rollback notes (DEPLOY-SYNC.md) |

## 11. As built: where the build differs from the design

| Design said | Built | Why |
| --- | --- | --- |
| A hook next to `audit()` in the services writes the outbox row | **Database triggers** on each synced table write it, in the same transaction (`src/lib/sync/triggers.ts`, generated into both migrations) | Every write path is covered, including nested writes, imports and raw SQL, not only the services that were changed |
| An upload is applied by calling the website's service function for that action | An upload is applied as a **checked record write** (`src/lib/sync/server.ts`): the gym, every field's type (whole paise), the fields a money record may change (cancel, reverse, void, freeze), closed months, an invoice's remaining balance for a payment, then stored with its id | Records must keep the same ids and numbers on both sides; replaying a sale through `sellMembership` would make a second invoice with new ids and a new number |
| Each side's invoices carry their own prefix (`INV-W1-`) | Each linked computer numbers from its **own range**: computer N from N × 1,000,000 (`src/lib/services/sequence.ts`) | One change in one place covers every numbered record (invoices, payments, members, memberships, expenses, purchases…), some of which have no prefix setting |
| The device token sealed with DPAPI beside the other secrets | Sealed with the installation's key (`BIOMETRIC_KEY`, itself DPAPI-sealed) in `SyncState`, as two-step secrets are | The server cannot call DPAPI; the protection at rest is the same |
| Sync writes an audit entry per applied change | One `sync.upload` entry per batch (counts, first reasons), plus entries for refusals of another gym's record, linking, unlinking and settled conflicts | An initial upload of a large gym would otherwise write one hash-chained entry per record |
| Linking (one way) | **Two ways**: download a fitron.in gym into a new database, or create the fitron.in account from the computer; separate books on both sides cannot be merged | Ids differ between a gym set up on a computer and one made on fitron.in; one side must adopt the other's |
| (not covered) | A linked computer leaves the **daily jobs** to fitron.in | Otherwise each member gets every reminder twice, and every member's risk score is written on both sides daily |
| Page refresh through the page's data hooks | The header badge reads the computer's sync state every 5 seconds and re-renders the open page when new changes arrived (not while a form has focus) | The console renders on the server; a re-render keeps what was typed |
| Outbox trimmed after 90 days | Not built yet | DEPLOY-SYNC.md §7 |
| File bodies fetched by key when missing | Not built yet: files' records sync, the files do not | DEPLOY-SYNC.md §7 |
