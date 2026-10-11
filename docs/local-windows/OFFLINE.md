# FITRON Local Windows Edition: offline mode (Phase 11)

FITRON Gym Accounting for Windows works with the internet switched off. Everything the gym does at the desk and in
the books runs on the computer's own SQLite database. The few features that talk to an online service (WhatsApp
through Meta, Razorpay, email, Fitron AI's model) say in plain words that they need the internet, and never pretend
that something was sent.

## What works offline

Login, the dashboard, members, memberships (sell, renew, freeze), attendance and check-in, payments and receipts,
invoices and their PDFs, expenses, purchases, assets, accounting (books, P&L, balance sheet), GST and GST reports, all
reports and their CSV downloads, global search, printing, backup and restore, every Settings tab, the daily jobs that
need no internet (churn risk, closing open visits, lead follow-ups, retention), and Fitron AI answering from the books.

How it is proved: `e2e/local/offline.spec.ts` starts a production FITRON server with `e2e/local/offline-preload.cjs`
loaded into it. The preload makes every name lookup fail (`ENOTFOUND`, as with Wi-Fi off) and every connection to
another computer fail (`ENETUNREACH`), and writes each attempt to a log. The browser refuses and records every request
that leaves the computer. The spec then:

| Test | What it checks |
| --- | --- |
| The server really is offline | the health check answers on 127.0.0.1 |
| A whole Gym Accounting day | first-run setup, GST on, a plan, a member, a sale with part payment, the balance, the GST invoice PDF, an expense, a check-in, search, four reports with CSV, the books, a backup |
| Every console page opens | every page under `src/app/(app)` and every Settings tab: no error page, no status 500, none slower than 4 seconds |
| Online-only features | reminder with the connector closed, the daily jobs waiting, reminder in "Not linked" mode, the support tickets, Fitron AI |

Each test ends by asserting that neither the server nor the browser tried to reach the internet.

## One rule for online services (`src/lib/integrations/online.ts`)

| Piece | What it does |
| --- | --- |
| `OFFLINE_MESSAGE`, `offlineMessage(feature, then?)` | "This feature requires an internet connection." or "Sending email requires an internet connection. Check the computer's connection and try again. Everything else in FITRON keeps working offline." Also in `src/lib/domain/offline.ts` for the browser. |
| `isNetworkError(e)` | true for "could not reach the service" (DNS, refused, unreachable, timed out, `fetch failed`), false for "the service said no" (a refused key, a bad request) |
| `online(feature, call)` | runs the call; a network failure becomes a `UserError` with the offline message, shown as a normal notice; anything else is left as it is |
| `probablyOnline(service)` | one connection to the host the feature will use (`SERVICE.razorpay`, `.meta`, `.anthropic`, or the gym's own mail server for email), within 1.5 seconds, remembered for 30 seconds per host. A mail server on the gym's own network counts as reachable; a name the computer merely remembers does not. Used to word online features before trying. It never decides whether core work may happen. |
| `OfflineError` | the `UserError` these throw, so a job can tell "no internet" from "the service refused" |

The Cloud Edition's behaviour is unchanged: these checks run only when `FITRON_EDITION=local`.

## Each online feature, offline

| Feature | Offline on FITRON for Windows |
| --- | --- |
| Email (`integrations/email.ts`) | Not set up by default, so nothing is sent and nothing pretends to be. With SMTP set up: checks the internet first and says "Sending email requires an internet connection."; short timeouts (DNS 5 s, connect 10 s, socket 30 s) bound a send that loses the connection part-way. |
| Support tickets (Settings › Help & support) | The gym's database is out of FITRON's sight, so a ticket reaches support only by email. Without email set up there is no form, only the phone, WhatsApp and email cards and the copyable System details. With email: offline, nothing is saved and the desk is told; a ticket whose email failed is kept, marked not sent, and never acknowledged. |
| Sign-in by email link or code, password reset by email | Not part of FITRON for Windows. The pages redirect to sign-in and their server actions refuse. The owner resets with the recovery key; a Super Admin resets staff passwords. |
| WhatsApp, "Not linked" (the default) | Messages are saved, not sent, and every screen says so: "Payment reminder saved, not sent: WhatsApp is not linked". |
| WhatsApp, linked phone (connector) | A connector that is not running is reported at once ("Nothing is answering at http://127.0.0.1:3131"). One whose WhatsApp is not linked or not online counts as not ready, since a message handed to it would wait in its memory. Batches (remind all, campaigns, class reminders) check once and send nothing rather than fail per member. Linking the phone is not in FITRON for Windows yet: the connector needs Node.js, which a customer must never install. |
| WhatsApp Business (Meta) | Checks the internet before calling Meta. Offline, a message is kept as Failed with "Sending WhatsApp messages through Meta requires an internet connection…", ready to send again. |
| Every WhatsApp result | Worded by what really happened (`src/lib/domain/wa-outcome.ts`): sent, queued on the phone, saved in demo mode, or not sent with the reason, in red when it did not go. Batches and automation runs count those apart. |
| Fitron AI | Without a model key (the default) it answers from the books, as always. With a key and no internet, it says "This computer is offline, so Fitron AI is answering from the books on this computer." and does exactly that. |
| UPI Autopay, demo mode | Simulated debits book renewals, invoices and payments, so on a computer they run only when someone presses "Run today’s debits", never on the timer. |
| UPI Autopay, live mode | Every live action (set up, pause, resume, cancel, retry, sync) checks the internet first and says what it needs. A cancel says Razorpay keeps debiting until it is cancelled online. A sync that loses the connection stops and keeps the last good sync time. Razorpay's webhooks cannot reach a computer, so the page says charges reach FITRON when "Sync with Razorpay" is pressed online. Demo mode is unchanged. |
| Leads › WhatsApp button | With no network the chat cannot open, so it says so and does not mark the lead as contacted. |
| Error screen › Contact support | Leads to Settings › Help & support, not the website. |

## Not part of FITRON for Windows

`src/proxy.ts` sends the website, the AI Trainer, FITRON's plan billing, the Gym Partnership and the FITRON team
console to the dashboard. Routes the proxy never runs for (webhooks, door devices, the AI Trainer's APIs, the website
assistant, Google sign-in) close themselves with `notInLocal()` (`src/lib/runtime/not-in-local.ts`).
`src/lib/runtime/not-in-local.test.ts` fails if a handler there forgets. Pages that only made sense online are hidden:
the front-desk QR poster (members' phones cannot reach the computer), the AI Trainer partnership panel, door-device
setup, and the account menu's "Plan & billing".

## Daily jobs on a computer

A hosted server has a scheduler calling `/api/jobs/daily`. A laptop has nobody, and is off at night. FITRON's own timer
(`src/lib/runtime/local-scheduler.ts`) runs a couple of minutes after FITRON opens and then every hour: first the
automatic backup, then `runDueOnThisComputer` (`src/lib/services/jobs.ts`).

- The jobs are `LOCAL_JOBS`: all daily jobs except door devices, FITRON's branch billing, the server's own JSON
  backups and their reminder (the computer makes `.fitronbackup` files instead), and the demo autopay debits (simulated
  payments are never booked unasked).
- While WhatsApp is "Not linked", the reminder jobs save nothing: a saved-but-unsent reminder would otherwise stop the
  real one once WhatsApp is linked (a member reminded recently is skipped). The desk can still remind by hand.
- Each job runs once a day per gym, so a day the computer was off is caught up the next time it is on.
- A job that needs a service it cannot reach (WhatsApp, Razorpay, email) throws `NotNow`. Nothing is recorded and
  nobody is alerted. The next hourly pass tries again, so it runs once the internet is back. Settings › Daily jobs lists
  what is waiting and why.
- Messages held by quiet hours go out on the hourly pass.

## Limits

- `probablyOnline()` opens a connection, not a full request. A network that lets the connection through but blocks the
  request still fails at the call, where the error is turned into the same offline message.
- Two-step sign-in codes depend on the computer's clock. A computer offline for a long time can drift past the
  30-second window; Windows corrects the clock when it is next online. (Phase 19 looks at a wider, explained window.)
- `navigator.onLine` (used before opening wa.me) is false only with no network at all. On a LAN without internet, the
  chat window opens and shows the browser's own offline page.
- A message queued on the connector lives in the connector's memory until WhatsApp is back. If the connector is closed
  first, FITRON marks it Failed after 6 hours (`refreshQueued`).
