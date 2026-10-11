# FITRON Local Windows Edition: online services (Phase 12)

FITRON Gym Accounting for Windows works without the internet. These are the only ways gym data can leave the
computer, and on a fresh installation every one is off. A gym user turns each on deliberately, in Settings, next to a
sentence that says what it sends and to whom. Settings › Integrations & AI lists them all under "Online services on
this computer".

## Where they live

```
src/lib/integrations/
  online.ts      the offline rule: probablyOnline(service), online(), OfflineError, "This feature requires an internet connection."
  service.ts     askService(): one JSON request with the offline rule, answering { ok } or { ok: false, reason, message }
  email/         SMTP (nodemailer)
  whatsapp/      index.ts: send through the chosen provider; cloud.ts: Meta's WhatsApp Business (Graph API)
  razorpay/      member UPI autopay (live mode), and FITRON's own billing on the Cloud Edition
  ai/            Anthropic's Claude
  license/       the FITRON licence server: unused, since licences are signed files checked offline (LICENSING.md)
  updates/       the update feed (Phase 18 adds the signed download and the backup before installing)
  google.ts      "Continue with Google", Cloud Edition only
  storage.ts     where files are kept (the computer's own disk on Windows)
```

`src/lib/integrations/egress.test.ts` keeps it that way. It fails when code anywhere else opens a connection (a
`fetch` to another computer, a mail, socket or push library). It also fails when a console page names a website that
is not on its list, each listed one with the reason it is allowed. Two Cloud-only modules sit outside the folder by
name: the S3 file bucket and the AI Trainer's push reminders.

## What each one sends, and what turns it on

| Service | Off until | Sends when on |
| --- | --- | --- |
| WhatsApp | A gym user links WhatsApp (Settings › WhatsApp). Messages nobody pressed send for need a second switch, "Send automatic messages" (off). | Each message's text and the member's WhatsApp number, through WhatsApp's servers. Automatic renewal messages attach the invoice PDF (the member's address, your GSTIN), as the switch says. |
| Email | FITRON sets up a mail server for the installation (SMTP_HOST); the monthly profit and loss also needs its tick in Settings › Reminders (off). | Support tickets a user raises (the message, the user's name, email and role, the System details); the monthly profit and loss to the Super Admins. |
| Fitron AI | FITRON sets an Anthropic key, and a gym user ticks "Use Claude for fuller answers" (off). | The question, the chat so far, the gym's name, the staff member's name and role, and the records looked up to answer it (named in full next to the tick). |
| UPI autopay | A gym user picks Live mode, with Razorpay keys set. | Per mandate: the plan name, amount, first debit date and the member's FITRON code. Not the member's name or phone. |
| Licence | Nothing: a licence is a signed file checked on the computer (LICENSING.md). If online renewal is added, FITRON_LICENCE_URL. | Only the licence id, the installation id, the edition, plan and version. `licencePayload()` refuses any other field before a connection opens. |
| Updates | FITRON_UPDATE_URL is set (Phase 18). | Only the edition, version, update channel and kind of Windows. `updateQueryString()` refuses anything else. |

Never on FITRON for Windows, whatever is set:

- WhatsApp messages from FITRON's shared number (`WHATSAPP_TOKEN`).
- Error alert emails.
- Website enquiries.
- Google sign-in.
- Plan billing, the AI Trainer, door devices and the server's job addresses: their routes answer 404 (`notInLocal`).
- The console's security policy does not let the browser reach Razorpay.

Also never sent:

- Demo autopay is a simulation, so it messages no member: no mandate link, no "debited tomorrow", no result.
- A message saved while WhatsApp was "Not linked" stays saved. Linking later never sends it.

## When a service cannot be reached

Each one answers with a reason and a sentence for the screen, never an error page: "not-configured", "offline"
("Checking the FITRON licence requires an internet connection. FITRON keeps working with the licence it already has."),
or "refused" with the service's own words. Daily jobs that need a service wait for it (OFFLINE.md).

## Tests

| Test | What it proves |
| --- | --- |
| `integrations/egress.test.ts` | no connection outside the integrations; no unlisted website in console pages; one folder per service |
| `integrations/license/license.test.ts`, `updates/updates.test.ts` | only the allowed fields go; not set up, offline and refused each give an answer, never an exception |
| `domain/online-services.test.ts` | a fresh installation sends nothing; each service says what it sends once on |
| `services/wa-consent.db.test.ts` | linking WhatsApp sends nothing automatic until switched on; demo-time messages are never sent later; demo autopay messages nobody |
| `services/pl-email.db.test.ts` | the monthly profit and loss is off on a computer until ticked |
| `lib/csp.test.ts` | the Windows console cannot reach Razorpay |
