# Put FITRON live on a free server

FITRON is one product at **fitron.in** with three parts, all served by this one app and one database:

| Part | Where | Who uses it |
|---|---|---|
| **Website** | `fitron.in` | Visitors: the landing page with pricing, free-trial sign-up, contact form and policies |
| **AI Trainer** (AI coach) | `fitron.in/trainer` (the design is in `prototype/ai-trainer/`) | Gym members: workout and Indian meal plans, a 24/7 AI coach, habits and progress, from ₹299 a month |
| **Gym Accounting** | `fitron.in/login`, then `/dashboard` | Gym owners and staff: members, renewals, GST invoices, payments, expenses, P&L, reports and Fitron AI, from ₹999 a month |

Gyms sign up themselves from the website (`fitron.in/signup?plan=starter`, `professional` or `enterprise`), confirm their email, and get a 7-day free trial. They pay FITRON through Razorpay, and their plan turns on by itself when Razorpay confirms the payment (steps 9 and 10).

This guide sets it all up on an **Oracle Cloud "Always Free"** server. The server is free with no time limit, and it can easily handle 100 staff and thousands of members. You get:

- the website, the AI Trainer and Gym Accounting, served over HTTPS with automatic certificates
- the Postgres database
- daily reminders and other jobs at 06:30 India time
- a backup every night at 02:00
- a weekly test, on Sunday at 02:30, that each gym's latest in-app backup can really be restored

It takes about 30 minutes. You only type commands in steps 5 to 7.

## 1. Create the Oracle Cloud account

1. Go to <https://www.oracle.com/cloud/free/> and sign up.
2. Pick **India South (Hyderabad)** or **India West (Mumbai)** as your home region. You can't change it later.
3. Oracle checks your card. It stays on the free tier and doesn't charge you unless you choose to upgrade.

## 2. Create the server

In the Oracle console, go to **Compute › Instances › Create instance**.

- **Image:** Canonical Ubuntu 24.04.
- **Shape:** Ampere, `VM.Standard.A1.Flex`, with 2 OCPU and 12 GB memory. That's well inside the free allowance of 4 OCPU and 24 GB.
- **Networking:** leave the defaults, and make sure "Assign a public IPv4 address" is on.
- **SSH keys:** choose "Generate a key pair for me" and **download the private key**. You need it to log in.
- **Boot volume:** 100 GB (up to 200 GB is free).

Press **Create**. When it's running, note its **Public IP address**.

> If it says **"Out of capacity"**, try another *availability domain* in the same form, or try again later. Free Ampere servers are in demand.

## 3. Let web traffic in

Go to **Networking › Virtual cloud networks**, then your network, then **Security Lists › Default Security List › Add Ingress Rules**. Add two rules:

| Source CIDR | Protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

## 4. Point a web address at the server

**For fitron.in:** at the registrar where you bought fitron.in, open its DNS settings and add two records:

| Type | Name / Host | Value | TTL |
|---|---|---|---|
| `A` | `@` (some registrars want it blank or `fitron.in`) | the server's public IP | 600 or the lowest offered |
| `A` | `www` | the server's public IP | 600 or the lowest offered |

Delete any other `A`, `AAAA` or `CNAME` records for `@` and `www` first (registrars often add a "parking" record). Leave `MX` and `TXT` records alone: they're for email. When the install script asks for the domain, type `fitron.in`. The landing page is then at `https://fitron.in`, staff sign in at `https://fitron.in/login`, and `www.fitron.in` redirects to `fitron.in`.

Other options:

- **Another domain** (about ₹800 a year from any registrar). Add an **A record**, for example `app` pointing to the server's public IP. That gives you `app.yourgym.in`.
- **Free:** sign in at <https://www.duckdns.org>, create a name such as `yourgym`, and set its IP to the server's public IP. That gives you `yourgym.duckdns.org`.

New records take from a few minutes to a few hours to work. Check with `nslookup fitron.in`: it should print the server's IP before you run the install in step 7.

## 5. Log in to the server

On Windows, use PowerShell. On Mac, use Terminal.

```bash
ssh -i path/to/the-downloaded-key.key ubuntu@YOUR_SERVER_IP
```

If it complains about the key's permissions on Mac or Linux, run `chmod 600 path/to/the-downloaded-key.key` first.

## 6. Get the code

The repository is private, so the server needs its own read-only key:

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub
```

Copy the line it prints. On GitHub, open the repository, go to **Settings › Deploy keys › Add deploy key**, and paste it. Leave "Allow write access" **off**. Then:

```bash
sudo apt-get update && sudo apt-get install -y git
git clone git@github.com:sumitgoxlofficial-jpg/fitron.git
cd fitron
```

## 7. Install

```bash
bash deploy/install.sh
```

The script:

- installs Docker and opens the server's firewall
- asks for your web address
- asks for your email, which opens the FITRON team console (you can skip it and add `FITRON_ADMIN_EMAILS` later)
- generates the database password and secret keys
- builds and starts everything

The first build takes 5 to 10 minutes. At the end it asks for your gym name and owner login. Use the same email you gave for the team console: that login opens `/fitron-admin/trainer` (members, payments and partner payouts).

Open `https://your-address` to see the website, and `https://your-address/login` to sign in. 🎉

## 8. Switch on the real services

Until you add their keys, everything runs in **demo mode**: nothing is charged and nothing is sent. To add keys, run the command below on the server. Fill in only what you use, then save with Ctrl+O, Enter and Ctrl+X.

```bash
nano deploy/.env
```

| What | Settings | Also set up |
|---|---|---|
| WhatsApp (official) | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` | In Meta: webhook `https://your-address/api/webhooks/whatsapp`, verify token = `WHATSAPP_VERIFY_TOKEN` from the file |
| UPI Autopay (your gym's Razorpay) | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Razorpay webhook `https://your-address/api/webhooks/razorpay` |
| **Payments to FITRON** (Razorpay) | `FITRON_RAZORPAY_KEY_ID`, `FITRON_RAZORPAY_KEY_SECRET`, `FITRON_RAZORPAY_WEBHOOK_SECRET`. Without them gyms and AI Trainer members can't pay (demo mode on a test server, a refusal on a live one) | Razorpay webhook `https://your-address/api/webhooks/fitron-billing`. See step 10 |
| FITRON team console | `FITRON_ADMIN_EMAILS` (your login email; several are comma separated). The installer fills in the email you typed | Nothing else |
| Your details on FITRON's invoices to gyms, and on the website's Contact page | `FITRON_LEGAL_NAME`, `FITRON_GSTIN`, `FITRON_ADDRESS` | Leave `FITRON_GSTIN` empty if you're not GST-registered yet. The Contact page shows your registered business name, address and GSTIN once the address or GSTIN is set (payment providers and Indian consumer rules usually expect them on the website) |
| **Sign in with Google** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | See "Google sign-in" below. Until both are set, the Google button stays hidden and email + password still work |
| Fitron AI and the AI Trainer's coach | `ANTHROPIC_API_KEY` | from console.anthropic.com |
| Email (sign-up confirmation, password reset and email sign-in (six-digit code and link), payment emails, website enquiries, and each gym owner's monthly profit-and-loss email with its Excel statement) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `ENQUIRY_TO` | Verify fitron.in with your email provider (it gives you DNS records to add). Without email, new sign-ups are trusted without a confirmation link and password reset and email sign-in (code and link) can't send anything |
| Documents in the cloud (optional) | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | e.g. a Cloudflare R2 bucket (free up to 10 GB); otherwise they're kept on the server |

Then apply them:

```bash
bash deploy/update.sh
```

Never paste these keys into chat or email. They belong only in this file on the server.

You don't need to set `APP_URL`: it's set from your domain automatically. FITRON's own Razorpay settings (`FITRON_RAZORPAY_*`, step 10) are how gyms and AI Trainer members pay you, so set them before you open sign-ups.

### Google sign-in

1. Open <https://console.cloud.google.com/>, create a project (for example "FITRON") and select it.
2. Go to **APIs & Services › OAuth consent screen**. Pick **External**, app name **FITRON**, your support email, and add `fitron.in` under authorised domains. Add the links to `https://fitron.in/privacy` and `https://fitron.in/terms`. Then **Publish app** so anyone with a Google account can sign in.
3. Go to **APIs & Services › Credentials › Create credentials › OAuth client ID**. Pick **Web application**.
4. Under **Authorised redirect URIs** add exactly `https://fitron.in/auth/google/callback` (use your own domain if it's different).
5. Copy the **Client ID** and **Client secret** into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `deploy/.env`, then run `bash deploy/update.sh`.

How it behaves: staff whose email is already a FITRON login sign straight in. A new gym owner can press **Sign up with Google** on the sign-up page; Google confirms the email, so no confirmation link is sent and no password is needed (they can set one later with "Forgot your password?"). A Google account with no FITRON login is told to ask their gym's owner to add them.

## 9. How gyms and AI Trainer members pay you

Nothing is confirmed by hand: Razorpay tells FITRON when a payment goes through, and the plan turns on by itself. When a gym pays you, this is what happens:

1. In **Settings › Plan & billing**, the gym picks a plan (or an extra branch) and monthly or yearly.
2. Razorpay Checkout opens with the exact amount (GST included). The gym pays with UPI, a card or net banking, whichever you enabled in step 10.
3. FITRON checks Razorpay's signature and asks Razorpay whether the money was captured. Then it switches the gym to the plan at once, issues FITRON's invoice, and emails the gym. If Razorpay is still confirming, the gym is told so and the plan turns on within a few minutes, when the webhook arrives.

**AI Trainer members** (the app at `https://your-address/trainer`) pay the same way: they pick AI Pro or AI Premium, monthly or yearly, and pay in Razorpay Checkout. Their plan starts the day after their free trial or current paid period ends, and they are emailed. Every payment, with its Razorpay payment ID, is listed on `/fitron-admin/trainer`.

You can see every payment in your Razorpay dashboard too. A gym's own record is in Settings › Plan & billing › Payment history.

Plans and limits (from the pricing page): Starter is up to 100 active members and one branch, Professional up to 300 and one branch, Enterprise has no member limit and 3 branches, and more branches cost ₹499 a month. After a trial or paid period ends there are 7 days' grace, then the gym can still see everything but can't add members or invoices until it pays. Gyms you set up by hand with `npm run setup` aren't on a trial and have no limits.

## 10. Take payments with Razorpay (plans that renew themselves)

Gyms and AI Trainer members pay FITRON through Razorpay (UPI AutoPay, cards, net banking). A plan renews by itself every month or year until the customer stops it (Settings › Plan & billing › Automatic renewals for gyms, Settings › Subscription in the AI Trainer). Every listed price includes GST.

1. In the Razorpay dashboard turn on **Subscriptions** (Subscriptions › Settings) and enable **every method you want customers to see**: Cards, UPI (AutoPay) and Net banking (e-mandate). FITRON does not filter methods: Razorpay's checkout shows whatever is enabled on your account, so card, UPI and net banking all appear once they are on. One-time payments (add-ons, yearly partner plans and yearly extra branches) show all methods enabled under Settings › Payment Methods, wallets included. FITRON's 14 plans (AI Pro, AI Premium, Starter, Professional, Enterprise, the three partner plans and the extra branch) are already made in the **live** account; their ids are in `src/lib/domain/razorpay-plans.ts`. Test mode has its own separate plans: to try payments with test keys, make the same plans there and change the ids in that file.
2. Account & Settings › API Keys: create a key and put it in `deploy/.env` as `FITRON_RAZORPAY_KEY_ID` and `FITRON_RAZORPAY_KEY_SECRET`. These are **FITRON's** Razorpay account. The `RAZORPAY_*` keys in the table above are a gym's own account for its members' UPI Autopay; do not mix them up.
3. Account & Settings › Webhooks: add `https://your-address/api/webhooks/fitron-billing`, choose a long random secret, put the same secret in `deploy/.env` as `FITRON_RAZORPAY_WEBHOOK_SECRET`, and tick these events: `subscription.activated`, `subscription.charged`, `subscription.halted`, `subscription.pending`, `subscription.cancelled`, `subscription.completed`, `payment.captured`, `payment.failed`.
4. Run `bash deploy/update.sh`. Until the keys are set, a test server runs payments in demo mode (nothing is charged) and a live server takes no payment at all.
5. Try it with a small real payment from a test gym, then check **Settings › Plan & billing** shows the plan as paid with an invoice, and **Automatic renewals** lists it.

### Try it with test keys first

Razorpay's **Test mode** has its own keys, its own plans and its own webhooks, and no real money moves. In Test mode generate a key (it starts with `rzp_test_`) and put it in `FITRON_RAZORPAY_KEY_ID` and `FITRON_RAZORPAY_KEY_SECRET`. FITRON notices the `rzp_test_` prefix and finds or makes the matching plans in the test account the first time each one is paid for (they are named `FITRON test …`), so there are no plans to create by hand.

- A live server refuses test keys unless `FITRON_ALLOW_TEST_PAYMENTS=1` is also set. That is on purpose: a test payment is free, so on a real site it would give a plan away. Set it only while you try payments.
- Add a separate webhook in Test mode (same address, its own secret) if you want to see renewals and failed payments. Checkout's own confirmation is enough for a first payment.
- Pay with Razorpay's test cards or the test UPI ID `success@razorpay`. Each test payment marks the gym or member as paid for the period, so try it on a test account.
- To go live: generate **Live** keys, put them in the same two variables, clear `FITRON_ALLOW_TEST_PAYMENTS`, add the Live webhook and redeploy. The live plans are already made.

What is paid how: a monthly plan, a partner plan (monthly) and an extra branch (monthly) are Razorpay subscriptions. A yearly extra branch and a yearly partner plan have no Razorpay plan, so they are one payment that the gym renews by hand. One-time add-ons (onboarding, branding, data migration, custom integration, mobile app) are one payment each, and the FITRON team is not told automatically: check **Settings › Plan & billing › Payment history** or your Razorpay dashboard. If a renewal fails, Razorpay retries and the gym is told in the app and by email; if it gives up, the plan runs to the end of the period already paid, then the usual 7 days' grace and read-only apply.

Not automatic: paying partner gyms their 70% share. The monthly amount owed is on `/fitron-admin/trainer` (70% of what members pay before GST: the GST inside the listed price is not shared); paying it out is manual unless you ask Razorpay to turn on Route.

## 11. Use Supabase for the database (and, if you want, member files)

Optional. **Hosting on Vercel instead of a server? Follow [VERCEL.md](VERCEL.md); the certificate *file* below is for this Docker server.** By default the database is a Postgres container on this server, backed up every night into `deploy/backups`. [Supabase](https://supabase.com) can host it instead, so there is no database to look after here. Fitron uses Supabase only as a Postgres database and a file bucket. It does not use Supabase's own sign-in or its web API, and it needs none of the project's `SUPABASE_*` keys (project URL, publishable key, secret key): do not put them in `deploy/.env`.

**Before you start**

- **Pick Mumbai (`ap-south-1`) when you create the project.** A project's region can't be changed afterwards, and every page makes several round trips to the database: a far region (Seoul, Singapore, the US) makes every page slower for your gyms.
- **Turn the Data API off** (in the project's API settings). Fitron connects to the database directly and never uses Supabase's automatic web API. Leaving it on puts every table behind a public address. As a second lock, Fitron switches row-level security on for all of its tables, with no policies, so the public roles `anon` and `authenticated` can read or change nothing even if the API is switched on later.
- Supabase's own daily backups are on its paid plans, and on every plan they do **not** include files in Storage. Fitron's own nightly backup keeps running either way (database only): see "Backups" below.

**Connect the database**

1. In the Supabase project click **Connect** and choose **Session pooler** (port 5432). Not "Direct connection" (it needs IPv6, which many servers lack) and not "Transaction pooler" (made for short-lived serverless functions; it doesn't support prepared statements, and Fitron is one long-running server, so it gains nothing). Use a database password of only letters and numbers; if it has other characters they must be written as `%40` for `@`, `%23` for `#` and so on.
2. Supabase's connections use its own certificate authority, so a plain `sslmode=require` fails. In the project's database settings (SSL configuration) download the certificate and put it on the server as `deploy/certs/supabase-ca.crt` (`mkdir -p deploy/certs` if the folder is not there).
3. Add one line to `deploy/.env`. Keep the single quotes: without them a `$` or `#` in the line is changed by Docker.

   ```
   EXTERNAL_DATABASE_URL='postgres://postgres.YOURREF:YOURPASSWORD@YOUR-POOLER-HOST:5432/postgres?sslmode=verify-full&sslrootcert=/certs/supabase-ca.crt'
   ```

   Copy the host and the `postgres.YOURREF` user from the Session pooler string Supabase shows.
4. **A new server with no gyms yet:** run the installer (step 7) and answer `n` when it offers to create your gym, or that first gym would go into the bundled database. Then add the line from step 3 to `deploy/.env` and run `bash deploy/update.sh`: the tables are created on start. Create your gym with the same command the installer would have run, from the `deploy` folder:

   ```bash
   docker compose exec -T app npm run -s setup -- --gym "Gym name" --branch Main --name "Your name" --email you@example.com --phone 9XXXXXXXXX --password 'at least 10 characters'
   ```

   **A server that already has real data:** move it first, in this order, or the app will start on an empty database.

   ```bash
   bash deploy/update.sh                      # 1. bring the bundled database up to date first
   cd deploy
   docker compose exec -T db pg_dump -U fitron -d fitron -Fc --no-acl > backups/move-to-supabase.dump
   nano .env                                  # 2. add the EXTERNAL_DATABASE_URL line from step 3
   bash restore.sh backups/move-to-supabase.dump   # 3. type RESTORE; it fills Supabase and starts Fitron
   ```

   The bundled Postgres container stays in place, idle. To go back, delete the `EXTERNAL_DATABASE_URL` line and run `bash deploy/update.sh`; the app returns to the bundled database, which holds your data only up to the day you moved.
5. Check: `docker compose logs app` shows no database errors, you can sign in, and **Settings › Backup** works. In Supabase, the **Table Editor** shows Fitron's tables (each marked "RLS enabled") and **Advisors** shows no security warnings.

**Member files in Supabase Storage (optional)**

1. **Storage › New bucket**, for example `fitron-files`. Keep it **private**: Fitron serves files itself, after checking who is asking.
2. **Storage › S3 Configuration**: note the region, then **New access key**.
3. In `deploy/.env` set, between single quotes:

   ```
   S3_ENDPOINT='https://YOURREF.storage.supabase.co/storage/v1/s3'
   S3_REGION='ap-south-1'
   S3_BUCKET='fitron-files'
   S3_ACCESS_KEY_ID='…'
   S3_SECRET_ACCESS_KEY='…'
   ```

   `S3_REGION` must be the project's own region: the default `auto` does not work with Supabase. These access keys can read and write every bucket and bypass all access rules, so they belong only in this file.
4. Run `bash deploy/update.sh`.

Files already on this server's disk are **not** copied by switching: from then on Fitron looks in the bucket, so documents and logos uploaded earlier would not be found. Switch before real documents exist, or copy them into the bucket first, using the same names as the paths under the storage folder.

**Backups**

- The nightly backup dumps the database Fitron really uses, which with Supabase is the Supabase one, into `deploy/backups` as before. Keep copying those files off the server.
- With a bucket in use, the nightly backup says so in its log (`docker compose logs scheduler`) and does **not** include the files, and Supabase's own backups don't either. Until you have your own copy of the bucket (for example a scheduled `rclone sync` of it to another provider), a lost bucket is lost documents.
- To restore a dump, `bash deploy/restore.sh deploy/backups/fitron-….dump` works the same way: it puts the dump into whichever database `deploy/.env` points at.

**Good to know**

- Fitron's start-up step that applies database changes encrypts its connection to Supabase but does not check the certificate. The app itself and the backups do check it.

## Door devices (ZKTeco / eSSL)

On the device, open **Menu › Comm. › Cloud Server Setting**. Set the server address to your web address and the port to **80**, then restart the device. Add its serial number in Fitron under **Settings › Door devices**.

## Everyday care

- **Updates:** `cd ~/fitron && bash deploy/update.sh`. This gets the latest version, applies any database changes and restarts the scheduler, so new scheduled jobs start.
- **WhatsApp reminders:** the daily job at 06:30 India time queues expiry, dues and birthday reminders, but the default quiet hours (21:00 to 08:00, Settings › WhatsApp) hold them. The scheduler asks the app to send held messages every 15 minutes (`/api/jobs/dispatch`), so they go out at 08:00. Nothing is sent twice.
- **Backups:** saved nightly in `~/fitron/deploy/backups` and kept for 14 days. Copy them off the server now and then, for example from your computer:
  `scp -i key ubuntu@YOUR_SERVER_IP:fitron/deploy/backups/*.dump .`
  For extra safety, turn on a free boot-volume backup in Oracle under **Block Storage › Boot Volumes › Backups**.
- **Backup restore test:** every Sunday at 02:30 India time the scheduler asks the app (`/api/jobs/weekly`) to take each gym's newest backup out of storage, check it against its checksum and restore it inside a transaction that is always rolled back. It proves the file reads, passes the restore's checks and still fits the database after any update; nothing is changed. The result shows in Settings › Backup (the "Restore test" line). If it fails, the gym's Super Admins get an email (when email is set up) and a notice in the app. While it runs, the gym's rows are held for a few seconds, which is why it runs at night. This tests the gym backups the app takes itself; it does not test the nightly server dump, which you check with `restore.sh` on a spare machine now and then.
- **Restore a backup:** `bash deploy/restore.sh deploy/backups/fitron-YYYYMMDD-HHMM.dump`
- **See what's running:** `cd ~/fitron/deploy && docker compose ps`
- **See errors:** `cd ~/fitron/deploy && docker compose logs --tail 100 app`
- **Find one error:** when something goes wrong, the page shows a short **reference** (and every response carries an `X-Request-Id` header). Search the log for it: `docker compose logs app | grep REFERENCE`. Each error is one JSON line with the page, the kind of error and the first lines of where it happened; `grep request.error` lists them all and `grep client.error` lists the ones that happened in a browser.
- **Money records cannot be deleted:** the database refuses to delete an invoice, payment, expense, purchase, asset or membership sale, and refuses to change or delete the audit log, whether the request comes from the app or from a query you type. A wrong entry is voided or reversed in the app, so the books keep both. Only **Clear demo data** (and only for a gym still flagged as demo) and **Restore from file** remove them. If you ever must remove a record by hand (for example to repair a data-entry mistake with your accountant), take a backup first, then in one transaction run `SELECT set_config('fitron.allow_delete', 'restore', true);` followed by your `DELETE`. That leaves no entry in the audit log, so write down what you did and why. The audit log itself cannot be edited this way.
- **Two-step sign-in:** everyone on the team can turn it on in **My profile › Two-step sign-in** (an authenticator app such as Google Authenticator or Authy, and ten recovery codes to keep safe). It applies to Google sign-in too. If someone loses their phone and their recovery codes, a Super Admin turns it off for them in **Staff** (the shield button on their card); they are signed out everywhere and can set it up again. The secrets are stored encrypted with `BIOMETRIC_KEY` from `deploy/.env`: **keep that key and back it up with your other settings; if it changes, everyone has to set two-step up again** (and any biometric templates become unreadable).
- **Content-Security-Policy:** every page carries a policy that says what the browser may load and run, so a script someone manages to slip into a page is not run. It starts in **report-only** mode: nothing is blocked, and anything that would have been is logged. After a few days of normal use (sign in, take a payment, scan a QR code, open the AI Trainer), run `docker compose logs app | grep csp.violation`. If it lists nothing you use, set `CSP_MODE=enforce` in `deploy/.env` and run `docker compose up -d`. If something legitimate shows up, tell us what it is; set `CSP_MODE=report` to go back at any time.
- **Get an email when something breaks:** set `ERROR_ALERT_TO` in `deploy/.env` (the installer sets it to your admin email) and set up SMTP as described above. You get at most one email per kind of error per hour, and ten an hour in all. Without SMTP the errors are still in the log. Run `docker compose up -d` after changing `.env`.
- **Health check** for an uptime monitor such as UptimeRobot (free): `https://your-address/api/health`

## How much it can handle

A 2-core, 12 GB server runs Fitron comfortably for 100 staff using it at the same time, and for tens of thousands of members. When you outgrow it, raise the server to 4 cores and 24 GB in Oracle. That's still free.
