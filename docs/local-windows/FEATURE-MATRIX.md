# FITRON Local Windows Edition: feature matrix

Every feature of the Gym Accounting console, classified for the Local Edition
(Phase 2). Source of each row: the sidebar (`src/lib/nav.ts`), the route tree under
`src/app`, the settings tabs (`src/components/section-tabs.tsx`), the jobs
(`src/lib/services/jobs.ts`) and the integrations (`src/lib/integrations`).

Classes:

| Class | Meaning |
| --- | --- |
| **LOCAL-SAFE** | Works offline on SQLite with no code change beyond the database adapter. |
| **NEEDS-ADAPTER** | Works offline once a local replacement is wired in (file paths, scheduler, dialect, printing). The adapter is part of this project. |
| **ONLINE-REQUIRED** | Needs the internet by nature. Shipped in Local behind an explicit switch; shows "This feature requires an internet connection" when offline, never crashes, never sends accounting data unless the gym turned the feature on. |
| **NOT-SUPPORTED-IN-LOCAL** | Belongs to the hosted product (fitron.in, FITRON's own billing, the AI Trainer service) and is not part of the Local Edition. The route is not shipped or answers with a plain page saying so. |

## Front desk

| Feature | Route | Class | Notes |
| --- | --- | --- | --- |
| Dashboard | `/dashboard` | LOCAL-SAFE | Reads today's numbers, renewals, dues; the "AI brief" card appears only when the AI feature is on. |
| Members: list, search, filters, add, edit, suspend, soft delete, restore, profile with status and dues, history | `/members`, `/members/[id]`, `/members/new`, `/members/[id]/edit` | NEEDS-ADAPTER | Case-insensitive search (`mode: "insensitive"`) → dialect helper. `tags`/`riskReasons` arrays → JSON columns. |
| Member photo | `/members/[id]/photo` | NEEDS-ADAPTER | `STORAGE_DIR` → `%LOCALAPPDATA%\FITRON\documents`. |
| Member documents (ID proof, waiver…) | `/documents/[id]` | NEEDS-ADAPTER | Same file storage adapter; metadata stays in `MemberDocument`. |
| Sell membership / renewal (plan, pricing category, offer code, start date) | `/members/[id]/sell` | LOCAL-SAFE | Transactional: invoice + membership + optional payment + audit. First vertical slice. |
| Membership freeze / unfreeze / transfer | member profile actions | LOCAL-SAFE | |
| Renewals due | `/renewals` | LOCAL-SAFE | |
| Leads & trials | `/leads`, `/leads/[id]`, `/leads/new` | LOCAL-SAFE | |
| Attendance: manual check-in/out, guest, day pass, override, close day, busy hours | `/attendance` | NEEDS-ADAPTER | `pg_advisory_xact_lock` in self check-in → dialect no-op. QR scan uses the device camera in WebView2 (works). |
| Front-desk QR poster / member self check-in page | `/c/[gym]/[branch]` | NEEDS-ADAPTER | The page is served by the local server; a member's phone can only reach it on the gym's LAN if the owner opts in. Default: localhost only, so the poster is replaced by a note in Local. |
| Classes & bookings, waitlist | `/classes`, `/classes/[id]` | NEEDS-ADAPTER | `SELECT … FOR UPDATE` → dialect no-op. |

## Billing

| Feature | Route | Class | Notes |
| --- | --- | --- | --- |
| Invoices: list, create (custom lines), view, cancel with reason, GST split (CGST+SGST / IGST) | `/invoices`, `/invoices/new`, `/invoices/[id]` | LOCAL-SAFE | Integer paise; `gstRate` Decimal read with `Number()`. |
| Invoice PDF | `/invoices/[id]/pdf` | NEEDS-ADAPTER | pdf-lib + DejaVu fonts: fonts must be inside the standalone bundle (already traced); cwd set by the shell. |
| Printing (A4, A5, thermal, receipts) | `PrintButton` → `window.print()` | NEEDS-ADAPTER | WebView2 print dialog works; thermal/A5 need `@page` CSS presets and a Tauri print command. Phase 17. |
| Payments: record, partial, reverse with reason, receipts | `/payments`, member/invoice actions | LOCAL-SAFE | |
| Receivables | `/receivables` | LOCAL-SAFE | |
| POS & inventory: counter sale, products, stock movements, low-stock notices | `/pos`, `/products`, `/products/[id]`, `/products/new` | LOCAL-SAFE | Walk-in member per branch. |
| UPI Autopay (Razorpay mandates, demo mode) | `/autopay`, `/autopay/[id]` | ONLINE-REQUIRED | Live mode needs Razorpay. Demo mode is local-safe and stays available for training. |
| Offers (gym's own promo codes) | `/plans/offers/new` | LOCAL-SAFE | |

## Accounts

| Feature | Route | Class | Notes |
| --- | --- | --- | --- |
| Expenses: record, void, categories, attachments, trend | `/expenses` | NEEDS-ADAPTER | Attachment file storage adapter. |
| Accounting: P&L, ledgers (income, expense, payment, receivable), cash and bank on hand, reconciliation, month-end closing, month locks | `/accounting` | NEEDS-ADAPTER | Audit search uses JSON path filters → LIKE fallback on SQLite. Everything else is plain Prisma. |
| Purchases (supplier bills, lines to stock/asset/expense, vendor payments) | `/purchases`, `/purchases/[id]`, `/purchases/new` | NEEDS-ADAPTER | `FOR UPDATE` → dialect no-op. |
| Fixed assets, depreciation (WDV/SLM), disposal | `/assets`, `/assets/[id]`, `/assets/[id]/edit`, `/assets/new` | LOCAL-SAFE | `rate` Decimal read with `Number()`. |
| Payroll (salaries, advances) | `/staff` payroll actions | LOCAL-SAFE | |
| Reports (17): Collections, Revenue by category, Sales by plan, GST invoice register, Expense list, Outstanding dues, Expiring in 15 days, Member list, New members by source, All leads, Fixed asset register, Depreciation this FY, Monthly depreciation, Asset disposals, Purchases by month, Purchases by vendor, Vendor payables | `/reports`, `/reports/[key]` | LOCAL-SAFE | |
| CSV / Excel exports | `/reports/[key]/csv`, `/[key]/xls`, `/accounting/csv`, `/expenses/csv`, `/attendance/csv`, `/audit/csv`, `/audit/xls`, `/purchases/csv`, `/settings/export/[kind]` | LOCAL-SAFE | Own xlsx writer, no network. |
| GST settings, GST preview, GSTIN per branch | Settings › Billing & GST | LOCAL-SAFE | |
| Audit log (hash chain, verify) | `/audit` | NEEDS-ADAPTER | Advisory lock → dialect no-op; `BigInt` id is supported by SQLite as INTEGER. |

## Engage

| Feature | Route | Class | Notes |
| --- | --- | --- | --- |
| Fitron AI (chat, tools over the books, drafted actions, daily brief, churn risk) | `/ai`, `/api/ai/chat` | ONLINE-REQUIRED | Anthropic API. Off by default in Local; when the gym turns it on, Settings says what is sent. Churn risk scoring (`computeRisk`) is pure code and stays local. |
| WhatsApp: templates, send, automation rules, quiet hours, campaign | `/whatsapp`, `/whatsapp/send`, `/whatsapp/templates` | ONLINE-REQUIRED | Meta Cloud API or the connector. "Demo" provider (logs the message) is local-safe and is the Local default. |
| Workouts & diet programs, progress logs, personal records | `/programs` and member profile | LOCAL-SAFE | `WorkoutPlan.days` / `DietPlan.meals` JSON, supported. |
| Gym Partnership (AI Trainer linking, payouts) | `/partnership` | NOT-SUPPORTED-IN-LOCAL | Depends on the hosted AI Trainer service. |
| Notifications (in-app) | `/notifications` | LOCAL-SAFE | |

## Admin and settings

| Feature | Route | Class | Notes |
| --- | --- | --- | --- |
| Plans & pricing categories | `/plans`, `/plans/new`, `/plans/[id]/edit` | NEEDS-ADAPTER | `features String[]` → JSON column. |
| Staff: add, edit, reset password, deactivate | `/staff`, `/staff/new`, `/staff/[id]/edit` | LOCAL-SAFE | |
| Roles & custom permissions | `/settings/roles` | LOCAL-SAFE | |
| Settings › Gym profile, logo | `/settings`, `/settings/logo` | NEEDS-ADAPTER | Logo file storage adapter. |
| Settings › Billing & GST, numbering | `/settings?tab=billing` | LOCAL-SAFE | |
| Settings › Reminders | `/settings?tab=reminders` | ONLINE-REQUIRED | Reminder rules are stored locally; sending needs WhatsApp. |
| Settings › WhatsApp (connect with Meta, link phone) | `/settings?tab=wa` | ONLINE-REQUIRED | |
| Settings › Integrations & AI (Razorpay, AI, devices) | `/settings?tab=int` | ONLINE-REQUIRED | Each card shows its online requirement. |
| Settings › Migrate & import (CSV) | `/settings/import` | LOCAL-SAFE | Long transaction (`timeout: 120 s`), fine on SQLite. |
| Settings › Backup (JSON per gym in storage, auto backup, restore test) | `/settings/backup` | NEEDS-ADAPTER | Replaced by the `.fitronbackup` file format: SQLite snapshot + documents + manifest + checksum. The existing JSON export stays as "Export data". Phase 10. |
| Settings › Go live (checklist, clear demo data, security: idle minutes) | `/settings/go-live` | LOCAL-SAFE | |
| Settings › Subscription (FITRON plan, Razorpay checkout, coupons) | `/settings/billing` | NOT-SUPPORTED-IN-LOCAL | Replaced by Settings › Licence (Phase 13). |
| Settings › Branches | `/settings?tab=branches` | NEEDS-ADAPTER | Extra-branch billing to FITRON is removed from the flow; branch count is a licence term. |
| Settings › Privacy & DPDP (officer, member rights export, retention job) | `/settings?tab=privacy`, `/settings/privacy/export` | LOCAL-SAFE | |
| Settings › Help & support (tickets, system details) | `/settings?tab=help` | ONLINE-REQUIRED | Ticket email needs SMTP; system details are local. Offline the form says so and shows the support phone/WhatsApp cards. |
| Biometric & door devices (ZKTeco/eSSL ADMS push) | `/settings/devices`, `/iclock/*` | NEEDS-ADAPTER | Devices push over HTTP to the server. On localhost only they cannot reach it; a LAN opt-in (bind to the LAN address) is a later phase and not in scope for 1.0. Shown as "available in the Cloud Edition or on request". |
| Product tour, theme | client components | LOCAL-SAFE | `localStorage` for preferences only, never data. |
| Global search | `/api/search` | NEEDS-ADAPTER | Case-insensitive search helper. |

## Authentication and accounts

| Feature | Class | Notes |
| --- | --- | --- |
| Email + password sign-in (Argon2id, sessions, idle sign-out, rate limit) | LOCAL-SAFE | Unchanged. |
| First-run: create gym + owner | LOCAL-SAFE (done, Phase 8) | `/setup` creates the gym, branch, roles and owner offline, then opens the existing onboarding steps. A one-time recovery key replaces the email reset for the owner. |
| Two-step sign-in (TOTP + recovery codes) | LOCAL-SAFE | Needs `BIOMETRIC_KEY`: generated once per installation and kept in the data folder with restricted ACL. |
| Continue with Google | ONLINE-REQUIRED | Hidden in Local (no client id). |
| Email sign-in link / code, forgot password by email | ONLINE-REQUIRED | Hidden in Local and their routes redirect to sign-in (Phase 8). Owner: recovery key at `/recover`. Staff: reset by a Super Admin. |
| Sign-up / trial / onboarding wizard | NOT-SUPPORTED-IN-LOCAL (sign-up) / LOCAL-SAFE (onboarding steps) | The onboarding steps (GST, branch, plans, team, opening balances) are reused by the first-run wizard. |

## Background jobs (`src/lib/services/jobs.ts`)

| Job | Class | Local behaviour |
| --- | --- | --- |
| members.risk, attendance.close, leads.followup, privacy.retention, backup.auto, backup.nudge | LOCAL-SAFE | Run by the in-process scheduler on start-up and daily. |
| ai.brief | ONLINE-REQUIRED | Only when AI is on. |
| reminders.* , whatsapp.refresh, whatsapp.dispatch | ONLINE-REQUIRED | Only when WhatsApp is on; demo provider logs. |
| autopay, autopay.sync | ONLINE-REQUIRED | Live mode only. |
| devices.sync | NEEDS-ADAPTER | No-op without devices. |
| billing.branches | NOT-SUPPORTED-IN-LOCAL | FITRON billing. |
| reports.monthly (P&L email) | ONLINE-REQUIRED | Needs SMTP; the same statement is available as a download. |
| backup.test (weekly restore test) | NEEDS-ADAPTER | Re-implemented over the `.fitronbackup` format. |

## Hosted-only parts (never in Local)

Website pages (`src/app/(site)` except the shared layout pieces), `/api/assistant`,
`/api/coach*`, `/api/gym-demo`, AI Trainer app and `/api/trainer/*`, `/api/webhooks/*`,
`/fitron-admin/*`, `/plan-ended`, Enquiries, Coupons, BranchSubscription,
RazorpaySubscription, TrainerPayment and the other `Trainer*` tables. They stay in the
Cloud schema; the Local schema does not carry them.

## Online services in Local (Phase 12)

```
src/lib/integrations/
  whatsapp/   Meta Cloud API + connector      opt-in, per gym
  razorpay/   member UPI Autopay (live mode)  opt-in, per gym
  email/      SMTP                            opt-in, per gym
  ai/         Anthropic                       opt-in, per gym
  license/    FITRON licence server           Local only; sends licence id, installation id, edition, version. Never gym data.
  updates/    signed update feed              Local only; downloads the installer, verifies the signature, backs up, installs.
```

Each exposes `available(): { ok: true } | { ok: false; reason: "offline" | "not-configured" | "cloud-only" }` and the UI
renders the reason instead of calling it. Nothing in this list is called unless the gym
enabled the feature, so no accounting data leaves the laptop silently.
