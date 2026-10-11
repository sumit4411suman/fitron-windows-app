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
| Member consent (`Member.consentAt`, upstream Oct 2026) | add member | LOCAL-SAFE | The privacy notice is ticked when a member is added; stored with the member, printed nowhere. |

## Billing

| Feature | Route | Class | Notes |
| --- | --- | --- | --- |
| Invoices: list, create (custom lines), view, cancel with reason, GST split (CGST+SGST / IGST) | `/invoices`, `/invoices/new`, `/invoices/[id]` | LOCAL-SAFE | Integer paise; `gstRate` Decimal read with `Number()`. |
| Invoice PDF | `/invoices/[id]/pdf?paper=` | LOCAL-SAFE (done, Phases 14, 17) | pdf-lib + DejaVu fonts inside the packaged server; A4, A5, 80 mm, 58 mm. |
| Printing (A4, A5, thermal, receipts) | `PaperPrint` → `/invoices/[id]/pdf`, `/payments/[id]/receipt` | LOCAL-SAFE (done, Phase 17) | PDFs made for the paper (A4, A5, 80 mm and 58 mm rolls) printed through the printer's Windows driver, not the screen. Payment receipts are new. PRINTING.md. |
| Payments: record, partial, reverse with reason, receipts | `/payments`, member/invoice actions | LOCAL-SAFE | |
| Receivables | `/receivables` | LOCAL-SAFE | |
| POS & inventory: counter sale, products, stock movements, low-stock notices | `/pos`, `/products`, `/products/[id]`, `/products/new` | LOCAL-SAFE | Walk-in member per branch. |
| UPI Autopay (Razorpay mandates, demo mode) | `/autopay`, `/autopay/[id]` | ONLINE-REQUIRED (done, Phase 11) | Live mode needs Razorpay and the internet; every live action checks first. Razorpay's webhooks cannot reach a computer, so charges are recorded by Sync with Razorpay (by hand, and once a day when online). Demo mode is local-safe; its simulated debits run only from "Run today's debits", never on the timer. |
| Offers (gym's own promo codes) | `/plans/offers/new` | LOCAL-SAFE | |
| Invoice seller snapshot (`Invoice.seller`, upstream Oct 2026) | invoice page, invoice and receipt PDFs | LOCAL-SAFE | Who issued the invoice is written with it; the page, the PDF and every receipt print that, so a later change in Settings never alters an old invoice. Invoices from before fall back to the live settings. |
| Send an invoice on WhatsApp (upstream Oct 2026) | invoice page | ONLINE-REQUIRED | The invoice message with its PDF, under the same rules as reminders: "Not linked" saves it and says "saved, not sent"; a second press within two minutes of a real send is not sent again. |

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
| Fitron AI (chat, tools over the books, drafted actions, daily brief, churn risk) | `/ai`, `/api/ai/chat` | LOCAL-SAFE without a model key / ONLINE-REQUIRED with one (done, Phase 11) | Without an Anthropic key (the Windows default) it answers from the books on the computer and nothing leaves it. With a key, a question and the figures needed go to Anthropic; offline it answers from the books and says so. Settings › Integrations & AI says which. Churn risk (`computeRisk`) is pure code, run by the daily jobs. |
| WhatsApp: templates, send, automation rules, quiet hours, campaign | `/whatsapp`, `/whatsapp/send`, `/whatsapp/templates` | ONLINE-REQUIRED (done, Phase 11) | "Not linked" (demo) saves messages and every screen says "saved, not sent". Meta Cloud API checks the internet first. The phone connector (`whatsapp-connector/`, one deployment serving every gym, each gym linked by QR with its own key kept sealed in the gym's settings) is not shipped in the Windows app yet; upstream runs it on a gym PC with `install-windows.ps1` (Node.js), and its Settings wording still speaks of a hosted server. Results are worded by what really happened (OFFLINE.md). |
| Workouts & diet programs, progress logs, personal records | `/programs` and member profile | LOCAL-SAFE | `WorkoutPlan.days` / `DietPlan.meals` JSON, supported. |
| Gym Partnership (AI Trainer linking, payouts) | `/partnership` | NOT-SUPPORTED-IN-LOCAL | Depends on the hosted AI Trainer service. |
| Notifications (in-app) | `/notifications` | LOCAL-SAFE | |
| Fitron AI chat history and attachments (upstream Oct 2026) | `/ai`, `/api/ai/chat`, `/api/ai/chats` | LOCAL-SAFE | Saved chats live in the gym's own database (`AiChat`, `AiChatMessage`); a chat is one person's own. Files attached to a question are read for that answer and never stored. Without the model (no key, or "Use Claude" off) a question with files is answered with a plain refusal; questions without files are answered from the books. Offline with the model on: answered from the books, and the chat says so. |

## Admin and settings

| Feature | Route | Class | Notes |
| --- | --- | --- | --- |
| Plans & pricing categories | `/plans`, `/plans/new`, `/plans/[id]/edit` | NEEDS-ADAPTER | `features String[]` → JSON column. |
| Cloud sync with fitron.in | `/settings/sync`, `/api/local/sync/status`; on fitron.in `/api/sync/*` | ONLINE-REQUIRED to sync, LOCAL-SAFE to work (done, S3 to S9) | Off until a Super Admin links the computer. Offline the desk works as usual and changes wait in the outbox; they go up and come down when the connection is back. Linked computers number from their own range and leave the daily jobs to fitron.in. SYNC.md, DEPLOY-SYNC.md. |
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
| Settings › Subscription (FITRON plan, Razorpay checkout, coupons) | `/settings/billing` | NOT-SUPPORTED-IN-LOCAL | Replaced by Settings › Licence (done, Phase 13): a signed licence file checked offline, a 30-day trial, grace days. See LICENSING.md. |
| Settings › Branches | `/settings?tab=branches` | NEEDS-ADAPTER (done, Phase 13) | Extra-branch billing to FITRON is removed from the flow; the number of active branches comes from the licence (3 during the trial). |
| Settings › Privacy & DPDP (officer, member rights export, retention job) | `/settings?tab=privacy`, `/settings/privacy/export` | LOCAL-SAFE | |
| Settings › Help & support (tickets, system details) | `/settings?tab=help` | ONLINE-REQUIRED (done, Phase 11) | A ticket reaches FITRON only by email. Without email set up there is no form, only the support cards and the copyable System details; offline it says so and saves nothing. See OFFLINE.md. |
| Biometric & door devices (ZKTeco/eSSL ADMS push) | `/settings/devices`, `/iclock/*` | NEEDS-ADAPTER | Devices push over HTTP to the server. On localhost only they cannot reach it; a LAN opt-in (bind to the LAN address) is a later phase and not in scope for 1.0. Phase 11: the devices page says so instead of the setup steps, and `/iclock/*` answers 404. |
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
| members.risk, attendance.close, leads.followup, privacy.retention, ai.brief, autopay (demo) | LOCAL-SAFE (done, Phase 11) | Run by FITRON's own timer: a few minutes after it opens, then hourly, each once a day (`LOCAL_JOBS`, OFFLINE.md). |
| reminders.*, whatsapp.refresh, whatsapp.dispatch | ONLINE-REQUIRED (done, Phase 11) | "Not linked" (demo) saves the messages. Linked: they wait while WhatsApp cannot take messages, and run when it can. |
| autopay.sync | ONLINE-REQUIRED (done, Phase 11) | Live mode only; waits for the internet. |
| reports.monthly (P&L email) | ONLINE-REQUIRED (done, Phase 11) | Needs SMTP; waits for the internet within the first three days. The same statement is a download. |
| devices.sync, billing.branches, backup.auto, backup.nudge | NOT-SUPPORTED-IN-LOCAL | Door devices cannot reach a computer; branch billing is a licence term; the computer makes `.fitronbackup` files instead. |
| backup.test (weekly restore test) | NEEDS-ADAPTER | Re-implemented over the `.fitronbackup` format. |

## Hosted-only parts (never in Local)

Website pages (`src/app/(site)` except the shared layout pieces), `/api/assistant`,
`/api/coach*`, `/api/gym-demo`, AI Trainer app and `/api/trainer/*`, `/api/webhooks/*`,
`/fitron-admin/*`, `/plan-ended`, Enquiries, Coupons, BranchSubscription,
RazorpaySubscription, TrainerPayment and the other `Trainer*` tables. They stay in the
Cloud schema; the Local schema does not carry them.

## Online services in Local (done, Phase 12)

Updates (Phase 18, UPDATES.md): the desktop program checks FITRON's download address, verifies FITRON's signature, backs the data up, installs; the new version backs up again before migrating, checks the database, and puts it back if the update fails. Done.

Each online service has its own folder under `src/lib/integrations/` (email, whatsapp, razorpay, ai, license, updates, sync),
and nothing else in the app opens a connection. Every one is off on a fresh installation; Settings › Integrations & AI
lists them with what each sends. Details, consent rules and tests: ONLINE-SERVICES.md.
