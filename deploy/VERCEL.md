# Run FITRON on Vercel (with Supabase)

This is the setup for hosting FITRON on **Vercel**, with the database and the uploaded files in **Supabase**, and **GitHub** running the timed jobs. The other way, one server with Docker, is in [README.md](README.md).

| Part | Does |
|---|---|
| Vercel | the website and the app (fitron.in) |
| Supabase | the database, and the member documents, logos and backups |
| GitHub | the timed jobs: reminders, autopay, WhatsApp sending (`.github/workflows/jobs.yml`) |

If sign-up or sign-in shows **"This page hit a problem on our side"**, the database is not set up yet. Do the steps below in order, then see "If something goes wrong" at the end.

## 1. Supabase

1. **Make the project in Mumbai (`ap-south-1`) if you can.** The region can't be changed later, and every page makes several trips to the database, so a far region makes everything slower. The app runs in the same region as the database, set by `regions` in `vercel.json`. It is currently Seoul (`icn1`), because FITRON's Supabase project was created there. For a project in Mumbai, change it to `bom1` (Singapore is `sin1`). Keep the two together: an app in one region and a database in another pays the distance on every query.
2. **Turn the Data API off** (project API settings). FITRON talks to the database directly and never uses Supabase's web API; leaving it on puts every table behind a public address. FITRON also switches row-level security on for all of its tables, as a second lock.
3. Click **Connect** at the top of the project and copy two addresses:
   - **Transaction pooler** (port 6543) is `DATABASE_URL`. Supabase recommends it for hosts like Vercel, where many short-lived copies of the app share the database's limited connections.
   - **Session pooler** (port 5432) is `DIRECT_URL`. It is used only by the build, to apply database changes.

   Not "Direct connection": it needs IPv6, and Vercel connects over IPv4 only. Use a database password of only letters and numbers, or write other characters as `%40` for `@`, `%23` for `#` and so on.

   FITRON has not yet been run through Supabase's transaction pooler. If sign-in then shows an error that mentions a *prepared statement*, put the session pooler address in `DATABASE_URL` as well and set `DATABASE_POOL_MAX` to `2` until it is looked at.
4. **The certificate.** Supabase's connections use its own certificate authority, so a plain `sslmode=require` is refused ("unable to verify the first certificate"). In the project's database settings (SSL configuration) download the certificate, open the file in a text editor, and copy **all** of its text, including the `BEGIN CERTIFICATE` and `END CERTIFICATE` lines. That text is `DATABASE_CA`.
5. **Files.** Vercel has no disk to keep uploads on, so connect a bucket. Until one is set, FITRON keeps backups, photos and documents in the database (a file of at most 50 MB each), which works but makes the database grow: **Storage › New bucket**, for example `fitron-files`, kept **private**. Under **Storage › S3 Configuration** note the region and make an access key. See step 11 of [README.md](README.md) for what each setting is.

## 2. Vercel settings

Project **Settings › Environment Variables**, for **Production** only. Mark the secrets "Sensitive".

| Name | Value |
|---|---|
| `DATABASE_URL` | the transaction pooler address (step 1.3) |
| `DIRECT_URL` | the session pooler address (step 1.3) |
| `DATABASE_CA` | the certificate text (step 1.4) |
| `DATABASE_POOL_MAX` | `3`. Connections one running copy of the app may hold |
| `AUTH_SECRET`, `CRON_SECRET`, `BIOMETRIC_KEY` | a different long random value for each: run `openssl rand -hex 32` three times |
| `APP_URL` | `https://fitron.in`. Used in the links inside emails |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | the bucket from step 1.5. `S3_REGION` must be the project's own region; the default `auto` does not work with Supabase |

Then everything in step 8 of [README.md](README.md) that you use: email (`SMTP_*`), the `FITRON_RAZORPAY_*` keys (gyms and AI Trainer members can't pay without them, and Razorpay needs its webhook pointing at `https://fitron.in/api/webhooks/fitron-billing`; see step 10 of that README), `FITRON_ADMIN_EMAILS`, `ANTHROPIC_API_KEY`, the Google sign-in keys, `VAPID_*` for the AI Trainer's push reminders. Do not set `STORAGE_DIR`.

**Do not give Preview deployments the production database.** Leave these variables on Production only. A preview of a branch then shows the error screen on pages that need the database, which is expected, and the build never changes the live database.

## 3. GitHub (the timed jobs)

In the repository: **Settings › Secrets and variables › Actions › New repository secret** named `CRON_SECRET`, with the **same value** as in Vercel. Optionally a variable `SITE_URL` if the site is not at `https://fitron.in`.

To check it: **Actions › Scheduled jobs › Run workflow**, job `dispatch`. The log should say `dispatch -> HTTP 200`. The log is public, so it only ever shows that status, never the answer.

Without the secret the workflow does nothing, and reminders, autopay and WhatsApp sending do not run.

## 4. Deploy

Merge to `main`, or press **Redeploy** on the latest Production deployment. The build log of a Production build starts with:

```
[vercel-build] Production build: applying database migrations through DIRECT_URL.
```

That creates the tables the first time and applies new ones later. If it can't apply them, the build **fails** and Vercel keeps serving the previous deployment. If no database address is set at all, the build carries on and prints a `WARNING` in the same place, so the pages that need no database still deploy.

Then open `https://fitron.in/login?tab=up` and create the first account: the first account becomes Super Admin. Sign up with the email you put in `FITRON_ADMIN_EMAILS` if you want to open the FITRON team console at `/fitron-admin/trainer`.

After the two sign-up steps the new gym lands on a short setup (billing and GST, branch, plans, team, WhatsApp reminders, opening balances, how to start). It can be skipped with "I'll finish this later" and finished from the dashboard reminder. The team members it asks for need a first password, which is used once to create their account and is never kept in the saved answers.

## If something goes wrong

The error screen shows a **Reference**. In Vercel open the project's **Logs** and search for it. The line says what happened:

| The log says | It means |
|---|---|
| `Can't reach database server at 127.0.0.1:5432` | `DATABASE_URL` is not set for Production |
| ``The table `public.User` does not exist`` | the database changes were not applied: look in the build log for the `[vercel-build]` line |
| `unable to verify the first certificate` | `DATABASE_CA` is missing, incomplete, or from another project |
| `password authentication failed` or `Tenant or user not found` | the password or the project part of the address is wrong |
| `Max client connections reached` | too many connections: lower `DATABASE_POOL_MAX` |
| `prepared statement … already exists` | the transaction pooler does not suit this setup: see the note under step 1.3 |

Anything else: send the line, with the reference, to whoever looks after the site.

## What is different from the Docker server

- **Backups.** The Docker server dumps the database every night. Here nothing does. Supabase's own daily backups are on its paid plans, and they do **not** include files in Storage, so keep your own copy of the bucket (for example a scheduled `rclone sync` to another provider). Settings › Backup inside the app still works, and its files go to the same bucket.
- **Upload size.** Vercel limits how large a request to the app can be (about 4.5 MB when this was written; check Vercel's current figure). The app accepts documents up to 10 MB, data imports and backup files up to 60 MB, so larger ones may fail here. Not tested.
- **Login rate limits are per running copy.** The limit on sign-in and sign-up attempts is kept in memory (`src/lib/rate-limit.ts`). On Vercel there are many copies, so an attacker gets that many times the limit. Passwords are still checked slowly and staff can use two-step sign-in, but this is weaker than on one server. A shared counter (in the database) would fix it.
- **Time of the timed jobs.** GitHub starts scheduled runs a few minutes late at busy times, so reminders can go out a little late. Every job is safe to run twice. Vercel has its own cron, but its limits depend on the plan (check the current ones before relying on it for the every-15-minutes job); the GitHub workflow works on any plan.
- **Time limits.** The daily jobs can run for up to 5 minutes. Your Vercel plan sets how long a function may actually run; if a job is cut off, the next call carries on.
- **Door devices (ZKTeco / eSSL)** call the server over plain HTTP on port 80, and Vercel sends plain HTTP on to HTTPS. Whether a device follows that is not tested.
- **The linked-phone WhatsApp connector** is a separate program that has to stay running, so it can't run on Vercel. Run it on any always-on server (the `whatsapp-connector/` service, see its README; one connector serves every gym) and set `WA_CONNECTOR_URL` and `WA_CONNECTOR_KEY` in Vercel; without them Vercel looks for it on its own machine and finds nothing. **The official WhatsApp Business route needs no server:** each gym connects its own number with a button (see `docs/WHATSAPP-BUSINESS.md` for the one-time Meta app setup).
