# Cloud sync: deployment, migration, recovery and rollback (S10)

How to put cloud sync (docs/local-windows/SYNC.md) live on fitron.in and in FITRON for Windows, how to look after it, and
how to undo it. Everything here is additive: no table or column is dropped, and no gym's records change because sync
was deployed.

## 1. What ships

| Side | Change | Effect on deploy |
| --- | --- | --- |
| fitron.in (PostgreSQL) | migration `20261011200000_cloud_sync`: tables `SyncChange`, `SyncDevice`, `SyncApplied`, `SyncConflict` (and the computer-only `SyncState`, `SyncVersion`, unused here); a trigger `fitron_sync` on each of the 36 synced tables | From that moment every change to a synced record also writes one `SyncChange` row in the same transaction |
| fitron.in (app) | routes `/api/sync/{link,register,changes,push,snapshot,events,unlink}`, Settings › Cloud sync (linked computers, Unlink) | Nothing happens until a gym owner links a computer |
| FITRON for Windows | local migration `0003_cloud_sync` (same tables; triggers that record nothing until the computer is linked), the worker, Settings › Cloud sync, the header badge | The update's first start takes the usual safety backup, migrates, and runs exactly as before until someone links |

## 2. Deploying fitron.in

1. Merge to `main`; the host builds as usual.
2. Run the migration before the new app serves traffic: `npx prisma migrate deploy` (the Vercel build runs it in
   `scripts/vercel-build.ts`; on a Docker host, the container's start does). It needs PostgreSQL 13 or newer
   (`gen_random_uuid()`); Supabase and the Docker image are 15+.
3. Check: `SELECT count(*) FROM "SyncChange"` grows as the website is used; `/api/sync/changes` answers 401 without a
   token, 426 without the `X-Fitron-Sync` header.
4. Hosting notes:
   - `/api/sync/events` streams for up to 270 seconds (`maxDuration = 300`). On a host with a shorter limit the stream
     ends sooner and the computer reconnects; on a host that buffers responses, computers still sync by polling
     (every 10 s while they have changes, every minute otherwise).
   - `/api/sync/push` may take up to `maxDuration = 300` seconds for a batch of 100 changes.
   - Rate limits (`src/lib/rate-limit.ts`) are per server instance: 240 requests a minute per address for sync,
     10 per 10 minutes for linking.
   - The sync routes are outside the sign-in proxy (`src/lib/public-paths.ts`): they check the device token themselves.

Storage: one `SyncChange` row per change to a synced record, with the record's data (about 0.5 to 2 KB). A busy gym
writes a few hundred a day. The weekly job "sync.trim" (with the restore test, `/api/jobs/weekly`) keeps the table
small: a change goes once it is older than 90 days, every linked computer has pulled past it, and a newer change of
the same record exists, so each record's newest change always stays. A computer not heard from for 180 days no longer
holds the log back; it is told to download the gym again when it is back. Upload receipts (`SyncApplied`) go after 90
days once their computer has uploaded since. On the computer, uploaded changes go after 30 days; waiting, refused and
conflicting ones stay until settled. Settings › Jobs shows each run's counts.

## 3. Releasing FITRON for Windows

Ship it as any update (UPDATES.md). Nothing is needed on the computer: `0003_cloud_sync` applies on the first start
after the safety backup, and the worker starts and stops by itself. A computer that is never linked records nothing and
sends nothing (ONLINE-SERVICES.md). `FITRON_CLOUD_URL` is only for tests; a release talks to `https://fitron.in`.

## 4. Linking a gym (for support)

On the computer, a Super Admin opens Settings › Cloud sync and picks one of:

| The gym is… | Choose | What happens |
| --- | --- | --- |
| on fitron.in already | Use the gym that is on fitron.in | Safety backup; the gym is downloaded into a new database and copied in; everyone is signed out; the owner signs in with the fitron.in email and password and gets a new recovery key. A computer that already has members, invoices or payments asks for REPLACE first. |
| on this computer only | Put this gym on fitron.in | A new fitron.in account with the computer's own ids (the owner picks a fitron.in password; the email is confirmed as for any sign-up); every record is queued and uploaded. |
| on both, with separate books | (neither, yet) | Two separate sets of books cannot be merged. Pick the one to keep: take a backup of the other, then link with the option above that keeps the chosen one. |

Linking needs the gym's Super Admin on fitron.in (password and, when on, the two-step code). The device token is shown
to nobody: fitron.in keeps its hash, the computer keeps it sealed with the installation's key.

A linked computer:
- numbers invoices, payments and members from its own range (computer N: N × 1,000,000 upward), the website from its
  own counter, so the two never issue the same number;
- leaves the daily jobs (reminders, autopay, risk scores, retention) to fitron.in, so each member gets each message
  once. Backups stay on the computer as before.

## 5. Looking after it

| Look at | Where |
| --- | --- |
| A computer's state | its Settings › Cloud sync: Connected / Syncing / Offline, waiting, refused, conflicts, last sync |
| The gym's computers | Settings › Cloud sync on fitron.in: each computer, who linked it, last seen; Unlink |
| What went up and was refused | audit log actions `sync.upload` (one per batch, with counts and the first reasons), `sync.refused_foreign`, `sync.link`, `sync.register`, `sync.unlink`, `sync.conflict_settled` |
| Answers given per change | `SyncApplied.result` (fitron.in), by change id |
| Conflicts | `SyncConflict` on both sides; settled on the computer's screen |

Nothing in these logs holds record contents except `SyncConflict` (both versions, for the owner) and `SyncChange.data`.

## 6. Recovery

| Situation | What to do |
| --- | --- |
| The computer was offline for days | Nothing: it uploads what waited, then downloads from its checkpoint. |
| A backup was restored on the computer | Nothing: the restore marks the computer to download the whole gym first; changes still waiting go up after, from the versions it brought. |
| A backup was restored on fitron.in, or Clear demo data ran | Nothing: every linked computer is told to download the whole gym again. Records the computer has that fitron.in no longer has: removable ones (leads, plans' prices…) go; money records stay and are listed under Conflicts as "only on this computer". |
| A change keeps being refused | The computer's Settings › Cloud sync shows the reason. Fix the cause (for example a phone number another member already has on fitron.in), then Send again; or Keep here only. |
| A record changed on both sides | Both versions are under Conflicts on the computer; pick one, or Dismiss. Money records keep the website's version: re-enter a payment or reversal if it is still needed. |
| A computer is lost or stolen | Unlink it on fitron.in (Settings › Cloud sync). Its token stops working at its next request. |
| A token may have leaked | Unlink that computer on fitron.in, then link it again from the computer (a new token). |
| A download batch cannot be applied | The computer applies the batch change by change, keeps the ones it cannot take under Conflicts ("could not be applied here"), and carries on; nothing is skipped silently. |

## 7. Known limits of this release

- **Files** (member documents and photos, staff photos, the logo) follow their records after each round that moved
  records, and every 10 minutes otherwise, 20 a pass each way, in 3 MB pieces (`/api/sync/files`; the host takes
  about 4.5 MB a request). Only a file a record of the same gym points to moves, only up to 10 MB, only the types an
  upload accepts (checked by content), never a backup. A file whose last record went away through sync (an erasure,
  a replaced photo) is removed on the other side too; a whole-gym download after a restore never removes files, so
  their bytes stay in the storage folder if the restore dropped their records.
- **Staff passwords** never sync: staff who arrive on the other side sign in once a Super Admin sets their password
  there.
- **WhatsApp** transport settings (Meta keys, the connector) stay on each side; messages and templates sync.
- **One gym per computer** for linking.

## 8. Rollback

The migration is additive, so rolling the app back to a version without sync leaves the new tables and triggers in
place, and the triggers keep writing `SyncChange` rows. To stop capturing without dropping anything:

```sql
-- fitron.in: stop recording sync changes (records stay as they are; computers stop receiving changes)
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT event_object_table FROM information_schema.triggers WHERE trigger_name = 'fitron_sync' LOOP
    EXECUTE format('ALTER TABLE %I DISABLE TRIGGER fitron_sync', t);
  END LOOP;
END $$;
-- …and refuse every computer
UPDATE "SyncDevice" SET "revokedAt" = now() WHERE "revokedAt" IS NULL;
```

`ENABLE TRIGGER` undoes the first step; computers must then download the gym again (set `"resyncAt" = now()` on their
`SyncDevice` rows before re-linking, or link them afresh). On a computer, Unlink stops sending at once; a FITRON version
without sync ignores the tables.

## 9. Tests to run before a release

| Command | What it proves |
| --- | --- |
| `npm test` (PostgreSQL) incl. `src/lib/sync/server.db.test.ts` | linking, idempotent uploads, money rules, tenant isolation, conflicts, deletes, failed transactions, snapshot and resync |
| `npm run test:local` incl. `src/lib/sync/client.db.test.ts` | capture only when linked, number ranges, one upload per record, refused and conflicting changes, checkpointed downloads, transaction failures, jobs on fitron.in, resync first |
| `npm run e2e:sync` (after `npm run build`; CI runs it after the other browser tests) | two real servers, linked as an owner links them: a gym coming down whole, website → computer within seconds, computer → website, offline with a restart, a connection cut mid-upload, the same member changed on both sides |
