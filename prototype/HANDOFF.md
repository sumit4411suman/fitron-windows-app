# Fitron: developer handoff

This is the production build spec for the Fitron prototype (`Fitron Gym.dc.html`). The prototype runs entirely in the browser: demo data is stored in localStorage, WhatsApp and UPI autopay are simulated, and Fitron AI calls a hosted model. Everything below describes how to build the real system behind the same screens.

## Stack
- Frontend: Next.js (App Router), React, TypeScript, Tailwind. Recharts for charts. Match the prototype's tokens: Source Serif 4, paper ground `#f3f2f2`, ink `#201e1d`, gold accent `#8a6612` with its 100–900 ramp, magenta `#d6006c` for alerts.
- Backend: Next.js route handlers or a separate Node (Fastify) REST API. Zod validates every request.
- Database: PostgreSQL + Prisma. Money is stored as integer paise (`Int`). Dates are `Date` columns, timestamps are `timestamptz`.
- Auth: Auth.js or Lucia with Argon2id password hashes, httpOnly secure session cookies, CSRF tokens, optional TOTP 2FA for Super Admin and Accountant.
- Files: S3-compatible private bucket (AWS S3 / Cloudflare R2). Objects are never public; the API streams them or issues signed URLs that expire in 5 minutes, after a permission check and an audit entry.
- PDF: server-side HTML → PDF with Playwright (same invoice layout as the prototype), stored in the bucket and attached to WhatsApp.
- Jobs: BullMQ on Redis (or pg-boss) for scheduled jobs and WhatsApp/autopay webhooks.
- WhatsApp: Meta WhatsApp Business Cloud API with approved templates.
- UPI autopay: Razorpay Subscriptions / UPI Autopay (or Cashfree). Webhooks confirm debits.
- AI: Claude via the Anthropic API from the server only. Tools run server-side against the caller's branch and role.

## Tenancy
`Organization` (the gym brand) → `Branch`. Every operational row carries `branchId`. All queries go through a repository layer that injects `branchId IN (user's branches)`. Super Admin can pass `branchId=ALL` for consolidated reports. Postgres row-level security on `branchId` is a second guard.

## Prisma schema (core)
```prisma
model Organization { id String @id @default(cuid()) name String branches Branch[] settings Setting[] createdAt DateTime @default(now()) }
model Branch { id String @id @default(cuid()) orgId String org Organization @relation(fields:[orgId],references:[id]) name String address String phone String gstin String? createdAt DateTime @default(now()) @@index([orgId]) }

model User { id String @id @default(cuid()) orgId String name String email String @unique phone String passwordHash String roleId String role Role @relation(fields:[roleId],references:[id]) branches UserBranch[] ptRate Int @default(0) shift String? active Boolean @default(true) lastLoginAt DateTime? createdAt DateTime @default(now()) updatedAt DateTime @updatedAt deletedAt DateTime? }
model Role { id String @id @default(cuid()) name String @unique permissions RolePermission[] }
model Permission { id String @id key String @unique }   // e.g. members.create, payments.reverse, months.unlock
model RolePermission { roleId String permissionId String @@id([roleId,permissionId]) }
model UserBranch { userId String branchId String @@id([userId,branchId]) }

model Member {
  id String @id @default(cuid())
  code String            // PHG-1001, unique per org
  orgId String branchId String
  name String gender String dob DateTime? phone String whatsapp String? email String? occupation String?
  house String? area String? city String? state String? pin String?
  emergencyName String? emergencyRelation String? emergencyPhone String?
  source String notes String? staffNotes String? tags String[] photoKey String?
  trainerId String? workoutPlanId String? dietPlanId String?
  suspended Boolean @default(false)
  createdById String createdAt DateTime @default(now()) updatedAt DateTime @updatedAt deletedAt DateTime?
  @@unique([orgId,code]) @@unique([orgId,phone]) @@index([branchId]) @@index([name])
}

model MembershipPlan { id String @id @default(cuid()) orgId String name String months Int price Int regFee Int discount Int @default(0) gstApplicable Boolean @default(true) kind String description String? features String[] status String @default("ACTIVE") createdAt DateTime @default(now()) updatedAt DateTime @updatedAt prices PlanPrice[] }
model PlanPrice { planId String category String price Int @@id([planId,category]) }   // Female, Student, Couple…

model Membership {
  id String @id @default(cuid()) code String   // MS-…
  memberId String planId String branchId String
  type String            // NEW | RENEWAL | AUTOPAY | IMPORT
  startDate DateTime @db.Date endDate DateTime @db.Date
  price Int discount Int pricingCategory String offerCode String?
  invoiceId String @unique
  status String @default("VALID")   // VALID | CANCELLED
  createdAt DateTime @default(now())
  @@index([memberId]) @@index([endDate])
}

model Invoice {
  id String @id @default(cuid()) number String   // INV-1024
  orgId String branchId String memberId String
  date DateTime @db.Date dueDate DateTime @db.Date
  subtotal Int discount Int tax Int total Int    // denormalised, written once at issue
  gstType String? gstRate Decimal? @db.Decimal(5,2)
  status String          // ISSUED | CANCELLED   (paid state is computed from payments)
  cancelReason String? cancelledById String? cancelledAt DateTime?
  pdfKey String? createdById String createdAt DateTime @default(now())
  items InvoiceItem[] payments Payment[]
  @@unique([orgId,number]) @@index([memberId]) @@index([date])
}
model InvoiceItem { id String @id @default(cuid()) invoiceId String description String qty Int rate Int discount Int taxRate Decimal @db.Decimal(5,2) taxAmount Int amount Int category String planId String? productId String? trainerId String? }

model Payment {
  id String @id @default(cuid()) code String      // PAY-5001
  orgId String branchId String invoiceId String memberId String
  date DateTime @db.Date amount Int method String txnRef String? notes String?
  status String @default("SUCCESS")  // SUCCESS | REVERSED
  receivedById String reversedById String? reversedAt DateTime? reverseReason String?
  createdAt DateTime @default(now())
  @@unique([orgId,code]) @@index([invoiceId]) @@index([date]) @@index([txnRef])
}

model Expense { id String @id @default(cuid()) code String orgId String branchId String date DateTime @db.Date categoryId String description String vendor String? amount Int method String billNo String? attachmentKey String? notes String? createdById String status String @default("ACTIVE") voidReason String? createdAt DateTime @default(now()) @@index([branchId,date]) }
model ExpenseCategory { id String @id name String group String }   // Rent, Utilities, Salaries…

model Document { id String @id @default(cuid()) memberId String category String fileName String mime String size Int storageKey String version Int @default(1) replacesId String? uploadedById String createdAt DateTime @default(now()) deletedAt DateTime? deletedById String? }
model Attendance { id String @id @default(cuid()) branchId String memberId String? guestName String? guestPhone String? type String date DateTime @db.Date checkIn DateTime checkOut DateTime? method String deviceId String? @@index([branchId,date]) @@index([memberId,date]) }

model WhatsAppTemplate { id String @id @default(cuid()) orgId String key String name String trigger String body String metaTemplateName String language String @default("en") autoSend Boolean @default(true) updatedAt DateTime @updatedAt @@unique([orgId,key]) }
model WhatsAppMessage { id String @id @default(cuid()) memberId String templateKey String toNumber String body String attachmentKey String? providerMessageId String? status String error String? sentAt DateTime deliveredAt DateTime? readAt DateTime? @@index([memberId,templateKey,sentAt]) @@index([providerMessageId]) }

model Lead { id String @id @default(cuid()) branchId String name String phone String source String interest String stage String followUpOn DateTime? trialOn DateTime? ownerId String notes String? lostReason String? memberId String? createdAt DateTime @default(now()) }
model ClassSlot { id String @id @default(cuid()) branchId String name String trainerId String weekday Int startTime String durationMin Int capacity Int room String? active Boolean @default(true) }
model Booking { id String @id @default(cuid()) classSlotId String date DateTime @db.Date memberId String status String createdAt DateTime @default(now()) @@unique([classSlotId,date,memberId]) }
model Product { id String @id @default(cuid()) branchId String sku String name String category String price Int cost Int stock Int? reorderLevel Int? }
model StockMovement { id String @id @default(cuid()) productId String qty Int reason String invoiceItemId String? expenseId String? createdById String createdAt DateTime @default(now()) }
model WorkoutPlan { id String @id orgId String name String goal String level String weeks Int days Json }
model DietPlan { id String @id orgId String name String kcal Int protein Int meals Json }
model ProgressLog { id String @id @default(cuid()) memberId String date DateTime @db.Date weightKg Decimal? bodyFat Decimal? waistCm Decimal? notes String? }
model AutopayMandate { id String @id @default(cuid()) memberId String providerMandateId String vpa String amount Int planId String status String nextDebitOn DateTime @db.Date retries Int @default(0) lastResult String? createdAt DateTime @default(now()) }
model Offer { id String @id @default(cuid()) orgId String code String type String value Int validTill DateTime usageLimit Int? uses Int @default(0) status String @@unique([orgId,code]) }

model Notification { id String @id @default(cuid()) branchId String? userId String? type String text String link String? readAt DateTime? createdAt DateTime @default(now()) }
model AuditLog { id BigInt @id @default(autoincrement()) orgId String userId String? actorType String action String entity String entityId String before Json? after Json? ip String? userAgent String? createdAt DateTime @default(now()) @@index([orgId,createdAt]) @@index([entity,entityId]) }
model MonthLock { branchId String month String lockedById String lockedAt DateTime @@id([branchId,month]) }
model Setting { orgId String key String value Json @@id([orgId,key]) }
model TaxConfiguration { id String @id orgId String enabled Boolean rate Decimal type String gstin String? sac String? effectiveFrom DateTime }
model Sequence { orgId String name String next Int @@id([orgId,name]) }   // member, invoice, payment, expense…
```

## Numbering
IDs come from `Sequence` rows incremented inside the same transaction (`UPDATE … SET next = next + 1 RETURNING next`), so member IDs, invoice numbers and payment IDs are gap-free and unique per organisation. Invoice format is configurable (`{prefix}{seq}`, optionally `{fy}`).

## Business rules (enforced in the service layer)
1. A member has many memberships; renewals always create a new `Membership` + `Invoice` + optional `Payment`. Nothing is overwritten.
2. Financial rows are immutable. `Invoice` → cancel with reason. `Payment` → reverse with reason. `Expense` → void with reason. No DELETE on these tables (revoke it at the DB role level).
3. Every payment links to an invoice. Invoice balance = total − sum(successful payments). Status (PAID / PARTIALLY PAID / UNPAID / OVERDUE) is computed, never stored.
4. Membership status is computed from dates and balance: SUSPENDED, EXPIRED (end < today), EXPIRING SOON (≤ 7 days), PAYMENT PENDING (balance > 0), ACTIVE.
5. Reminder de-duplication: before sending a reminder template, check `WhatsAppMessage` for the same member + template within the configured window (default 3 days).
6. Failed WhatsApp messages are stored with the provider error and raise a notification.
7. Month lock: writes dated in a locked month return 423 unless the user has `months.unlock` (Super Admin). Lock and unlock are audited.
8. Plans used by any membership or invoice can't be deleted, only deactivated. Price edits apply to new sales only.
9. Members are soft-deleted (`deletedAt`). Phone is unique per organisation among non-deleted members.
10. Every write to members, plans, invoices, payments, expenses, documents, settings, locks and roles writes an `AuditLog` row with before/after JSON, IP and user agent, in the same transaction.
11. Reports read from invoice items, payments and expenses only, never from stored totals.
12. Fixed assets. Equipment and other capital purchases go to `Asset`, not to P&L. If paid from the gym's cash book, a linked `Expense` row is written with `capital = true` and `assetId`; capital expenses show in cash flow, ledgers and month-end closing balance but are excluded from P&L. P&L instead carries a **Depreciation** line computed monthly from the register. Methods: **WDV** (written-down value, rate % per financial year, opening WDV re-based every 1 April; Indian income-tax defaults: plant & machinery 15%, furniture 10%, computers/software 40%) or **SLM** (straight line: (cost − salvage) ÷ (life × 12) per month). Purchase month counts as a full month; charge never takes book value below salvage. Disposal (`Sold`/`Scrapped`) stops depreciation after the disposal month and posts `received − book value` as "Gain on sale of assets" (revenue) or "Loss on disposal of assets" (expense) in the month of disposal. Schedules are recomputed from the register, never stored, so a corrected cost or date reflows everything; month locks apply to purchase and disposal dates.

```prisma
model Asset { id String @id organizationId String branchId String code String @unique name String category String qty Int @default(1) vendor String? purchaseDate DateTime cost Int salvage Int @default(0) method AssetMethod rate Decimal? life Int? serial String? billNo String? payMethod String? expenseId String? status AssetStatus @default(IN_USE) disposedOn DateTime? disposedFor Int? disposeNote String? notes String? createdById String createdAt DateTime @default(now()) }
enum AssetMethod { WDV SLM }  enum AssetStatus { IN_USE SOLD SCRAPPED }
```
API: `GET/POST /api/assets`, `GET /api/assets/:id/schedule?by=fy|month`, `POST /api/assets/:id/dispose`, reports `assets`, `dep-fy`, `dep-month`, `disposals`. Roles: Accountant, Admin, Super Admin.

13. Purchases. A `Purchase` is a supplier bill with typed lines. `STOCK` lines add `qty` to `Product.stock` (weighted-average `Product.cost`), or create the product when `sku = new`; `ASSET` lines create an `Asset` (WDV, category default rate) plus a `capital = true` expense; `EXPENSE` lines create a normal expense. Every posted expense carries `purchaseId`. Payment: paid in full, part, or unpaid; the outstanding balance is a vendor payable. Expenses posted for a bill with a balance take `method = Credit`; when the bill is fully settled (`POST /api/purchases/:id/pay`) they move to the settling payment method, so cash-in-hand and the payment ledgers stay right. Line rate is ex-GST; the GST-inclusive amount is the cost booked (no input-credit tracking in v1).

```prisma
model Purchase { id String @id organizationId String branchId String code String @unique date DateTime vendor String billNo String? method String? notes String? total Int lines PurchaseLine[] payments VendorPayment[] createdById String createdAt DateTime @default(now()) }
model PurchaseLine { id String @id purchaseId String type PurchaseLineType desc String category String? productId String? assetId String? qty Int rate Int gstPct Decimal amount Int }
model VendorPayment { id String @id purchaseId String date DateTime amount Int method String reference String? createdById String }
enum PurchaseLineType { STOCK ASSET EXPENSE }
```
API: `GET/POST /api/purchases`, `GET /api/purchases/:id`, `POST /api/purchases/:id/pay`; reports `pur-month`, `pur-vendor`, `payables`. Roles: Accountant, Admin, Super Admin (Receptionist can raise a STOCK-only purchase from POS if the gym enables it).

## Migration from other software
Settings → Migrate & import is a six-step centre: Members, Payment history, Expenses, POS products & stock, Equipment & assets, Opening balances. Each step accepts a CSV (Excel users save as CSV), auto-maps columns by header synonyms (`A.MIG[kind].fields` holds the synonym lists), lets the user fix the mapping, previews validated rows with per-row errors/warnings, then imports only valid rows. Dates accept DD-MM-YYYY, DD/MM/YY, YYYY-MM-DD and "12 Aug 2026". Payment modes and expense/asset/product categories are fuzzy-matched to Fitron's lists. Members: missing plans are created from the sheet (name, duration parsed from "3 months"/"Quarterly", price = fee); paid/due produce an opening invoice + payment dated at the start date; the old member ID is kept in `Member.oldId` and receipts can be matched by phone, old ID or name. Assets accept "accumulated depreciation so far" and continue depreciating from the switch month (`depFrom`, `accDepCarried`). Progress is stored in `Setting.migration` (`source`, `done[kind] = {n, at}`). Production: run imports as a background job with a downloadable error report, allow XLSX directly (SheetJS server-side), and offer an assisted migration (support@fitron.in, free, 2 working days).

## UPI Autopay (recurring debits)
Two modes, `Setting.autopay.mode`: `demo` (Fitron simulates approval and debits, deterministic per mandate+date, retries per settings, pre-debit WhatsApp notice 24 h before, automatic run once a day at first sign-in) and `live`. Live uses **Razorpay Subscriptions (UPI Autopay)** through the connector (`connector/autopay.js`): `POST /autopay/mandate` creates a Razorpay plan (amount × plan months) and subscription with `notes.fitron_mandate = MD-id`, returns `subscriptionId` + `shortUrl`; the app stores both, sends the short URL on WhatsApp and can open Razorpay Checkout with `subscription_id` for in-person approval. Razorpay sends the NPCI pre-debit notification, charges on `charge_at`, retries, and posts webhooks to `POST /autopay/webhook` (HMAC verified with `RZP_WEBHOOK_SECRET`); the connector stores them and the app pulls `GET /autopay/events?since=n` (on boot and via Sync) and applies: `authenticated/activated → Active`, `charged → renewal + invoice + payment (idempotent on payment id)`, `payment.failed/pending → Failed`, `halted → Halted (manual collection)`, `cancelled/paused/resumed`. Pause/resume/cancel call `POST /autopay/:sid/{pause|resume|cancel}`. Production: keep the event log in Postgres, run the poll as a server job (or apply webhooks directly), and store the Razorpay key id in `Setting.autopay.keyId` only (secret stays on the server).

## Production readiness (what the prototype now enforces, and what the build must add)
In the app: Settings → Go live checklist (gym profile, logo, GST, plans, staff, WhatsApp mode, autopay mode, device, DPDP officer, backup age, idle sign-out, subscription, demo data cleared, with a one-click "Clear demo data" that keeps profile/plans/branches/staff/templates); idle sign-out (default 30 min, `Setting.security.idleMinutes`); global error guard (no white screens); storage-quota protection with backup prompts; weekly backup nudge; tamper-evident audit chain; no hard-coded gym name (all copy reads `Setting.gym`); demo-only controls hidden once live.
For the production build: HTTPS only with HSTS; Postgres with PITR and nightly encrypted dumps (restore drill monthly); secrets only in server env (Razorpay, WhatsApp, Claude); rate limits on auth and public check-in URLs; CSP + SameSite cookies; Sentry (or similar) for errors and uptime checks on fitron.in, the API and the connector; structured logs with request ids; background job runner (BullMQ/cron) for 06:30 autopay, 07:00 reminders, month-end reports, backup; feature flags for demo vs live; DPDP: consent records, erasure job, breach-notification runbook, Grievance Officer page on fitron.in; support@fitron.in ticket inbox; status page; versioned API and DB migrations; load test at 5× expected members; per-tenant data isolation tests in CI.

## REST API
```
POST   /api/auth/login                  POST /api/auth/logout            GET /api/me
GET    /api/members?q&status&plan&gender&area&page      POST /api/members
GET    /api/members/:id                 PUT  /api/members/:id            DELETE /api/members/:id (soft)
GET    /api/members/:id/timeline        (payments, invoices, memberships, attendance, messages)
POST   /api/members/import/validate     POST /api/members/import/commit  GET /api/members/import/template
POST   /api/memberships                 (new or renewal; creates invoice + payment in one transaction)
GET    /api/plans   POST /api/plans   PUT /api/plans/:id   PATCH /api/plans/:id/status
GET    /api/offers  POST /api/offers  PATCH /api/offers/:code
POST   /api/invoices                    GET /api/invoices?status&q        GET /api/invoices/:id
GET    /api/invoices/:id/pdf            POST /api/invoices/:id/cancel     POST /api/invoices/:id/send {channel}
POST   /api/payments                    GET /api/payments?q&method        POST /api/payments/:id/reverse
GET    /api/receivables?filter=due_today|overdue|partial|unpaid
POST   /api/expenses  GET /api/expenses  POST /api/expenses/:id/void
POST   /api/documents (multipart)       GET /api/documents/:id/url        POST /api/documents/:id/replace  DELETE /api/documents/:id
POST   /api/attendance/check-in         POST /api/attendance/:id/check-out  GET /api/attendance?date
POST   /api/devices/biometric/webhook   (ZKTeco / eSSL push, HMAC signed)
GET    /api/leads  POST /api/leads  PATCH /api/leads/:id  POST /api/leads/:id/convert
GET    /api/classes?week  POST /api/classes  POST /api/bookings  PATCH /api/bookings/:id
GET    /api/products  POST /api/products  POST /api/pos/sales  POST /api/products/:id/restock
GET    /api/autopay  POST /api/autopay/mandates  POST /api/autopay/:id/retry  PATCH /api/autopay/:id
POST   /api/autopay/webhook             (provider signature verified)
POST   /api/whatsapp/send               GET /api/whatsapp/history         PUT /api/whatsapp/templates/:key
POST   /api/whatsapp/webhook            (delivery/read/failed status from Meta)
GET    /api/reports/:key?from&to&branch&format=json|csv|xlsx|pdf
GET    /api/accounting/profit-loss?from&to    GET /api/accounting/ledger/:type    GET /api/accounting/month-end/:month
POST   /api/accounting/months/:month/lock     POST /api/accounting/months/:month/unlock
GET    /api/notifications  POST /api/notifications/read
GET    /api/audit?user&q&page
GET    /api/settings  PUT /api/settings/:key
POST   /api/backups  GET /api/backups  POST /api/backups/:id/restore   (Super Admin only)
POST   /api/ai/chat                     (streams; server runs tools)
```

## Scheduled jobs
- 06:00 birthday wishes (if enabled).
- 06:30 UPI autopay: pre-debit notice 24 h ahead, debit on renewal date, retries per settings.
- 07:00 expiry scan: members at 15/7/3/1/0 days per settings → reminder messages (with de-dup) + renewal list notification.
- 07:00 payment due report; reminders every N days while balance > 0.
- 07:05 Fitron AI daily brief and alerts: high outstanding, unusual expense (> 2.5× category average), failed messages, low renewal pace, members at risk, low stock.
- 1st of month 08:00 P&L email to owner.
- 02:00 encrypted `pg_dump` to a separate bucket, 30-day retention, weekly restore test.

## Fitron AI
`POST /api/ai/chat` builds a system prompt with gym, branch, role and date, and exposes read-only tools: `get_overview`, `list_members(filter)`, `find_member(query)`, `revenue_breakdown(period)`, `class_and_attendance`. Financial tools check the caller's permissions. The only write tool is `propose_action`, which returns a proposal ID; the UI shows a confirm button and the send happens through the normal WhatsApp endpoint under the staff member's identity. Risk score (0–100) per member is computed nightly from days since last visit, visit trend vs the previous 30 days, days to expiry and outstanding balance, and stored for the dashboard.

## Security checklist
Argon2id passwords; session rotation on login; 15-minute idle timeout for finance roles; RBAC checks on every route (deny by default); Zod validation; parameterised queries via Prisma; rate limits (login 5/min/IP, API 120/min/user, AI 15/min/user); CSP and secure headers; private bucket with signed URLs and per-access audit; webhook signature verification (Meta, Razorpay, devices); encrypted backups; secrets in a vault, never in the client.

## Acceptance tests (Playwright + Vitest)
Member creation with duplicate-phone rejection · new membership with partial payment · collect balance → PAID · invoice PDF renders · cancel invoice reverses payments · expense in locked month is blocked for Accountant · P&L equals sum of invoice items minus expenses · membership expiry buckets on fixed dates · renewal from expired member · reminder not re-sent inside window · failed WhatsApp logged · document upload/replace/delete keeps history · class booking fills to capacity then waitlists and promotes on cancel · POS sale decrements stock · autopay webhook creates renewal · Receptionist cannot open Accounting, Trainer sees only assigned members · mobile viewport (375 px) add member, search, collect payment.


## Biometric attendance and door access
Recommended device: **ZKTeco SpeedFace-V5L** (face + fingerprint + RFID card, anti-spoofing, 6,000 faces / 6,000 fingerprints, built-in lock relay, Wi-Fi option). Roughly ₹30,000 to ₹45,000 in India from ZKTeco dealers. Any ZKTeco or eSSL model that supports **ADMS (push SDK)** works the same way.

Wiring: device relay → electric lock or turnstile (12 V supply, door sensor and exit button optional). One device per entrance.

Protocol (ADMS / iclock push, HTTPS):
- Device polls `GET /iclock/cdata?SN=…` and `GET /iclock/getrequest?SN=…`; server replies with queued commands (add/remove user, update face/fingerprint templates, open door, set time).
- Device posts punches to `POST /iclock/cdata?SN=…&table=ATTLOG` (user PIN, time, verify mode). Server maps PIN → member code, evaluates rules, writes `Attendance` and `AccessLog`, and replies.
- Access control: the server keeps each member's validity window on the device (user start/end date + access group). When a membership expires, is suspended or dues pass the limit, the server pushes an update so the device refuses entry even if the internet drops.
- Enrolment: server queues `ENROLL_FP` / face capture for a PIN; the device captures and uploads the template (`table=BIODATA`), stored encrypted and never shown in the UI.

Tables: `Device(id, branchId, serial unique, model, name, ip, lastSeenAt, doorRelay, relaySeconds)`, `DeviceCommand(id, deviceId, command, payload, status, createdAt, ackAt)`, `BiometricTemplate(memberId, type, deviceId, data bytea encrypted, createdAt)`, `AccessLog(id, deviceId, memberId?, method, result, reason, at)`.
Privacy: biometric templates are sensitive personal data under the DPDP Act. Take written consent at enrolment, delete templates when a member leaves, and never export them.


## WhatsApp without the Business API (linked device)
Option chosen by the owner: no Meta API key. A "Fitron connector" (Node service using the open-source `whatsapp-web.js` or `Baileys` library) runs 24/7 on the gym PC or a small VPS, is paired once by scanning a QR from WhatsApp › Linked devices, and exposes a local endpoint the Fitron backend calls to send text and PDF invoices. Store the session in an encrypted file so it survives restarts; the phone must come online at least every 14 days.
Safety: queue with 8–15 s random gaps, 250/day cap, send only to members (contacts who opted in), stop and alert on disconnect. This is unofficial and against WhatsApp's terms; the number can be restricted, so keep the official Cloud API path in the code as a fallback.


## Branch plan billing (Fitron SaaS)
- Plan includes 3 branches. Each extra branch: ₹2,500/month or ₹8,000/year, plus 18% GST (₹2,950 / ₹9,440).
- Payment goes to Fitron's own Razorpay account. Set `A.PLAN.rzpKey` (public key id) in fitron-app.js; the secret never goes in the browser.
- Production flow: backend `POST /api/billing/branch-order` creates a Razorpay Order (amount incl. GST) → Checkout opens with `order_id` → webhook `payment.captured` verified with HMAC-SHA256 of the raw body using the webhook secret → create `BranchSubscription(tenantId, branchId?, cycle, base, gst, total, periodStart, periodEnd, status, razorpayPaymentId)` and a Fitron GST tax invoice to the gym.
- For auto-renew use Razorpay Subscriptions (plans: branch_monthly, branch_yearly). On `subscription.halted` give 7 days' grace, then set the branch read-only (no new members/invoices) — never delete data.
- Enforce the limit on the server: creating an active branch beyond 3 requires an unassigned paid subscription.
