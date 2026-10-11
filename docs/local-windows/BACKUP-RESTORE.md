# FITRON Local Windows Edition: backup and restore (Phase 10)

Settings › Backup on FITRON for Windows. Super Admin only: a backup holds every record and login on the computer.

## The .fitronbackup file

One file holds the whole installation:

| Entry | What |
| --- | --- |
| `manifest.json` (first) | format and version, FITRON version, schema (migrations applied), when, kind, gyms, row counts, and the size and SHA-256 of every other entry |
| `data/fitron.db` | a consistent snapshot of the database, taken with SQLite's online backup while FITRON runs |
| `documents/…` | every stored file: member documents and photos, staff photos, logos |
| `keys/biometric.key` | the key that seals two-step secrets, so staff two-step codes keep working on a new computer |

The file is a gzip-compressed tar. Without a password, Windows 10/11's built-in `tar -xzf` or 7-Zip opens it, so the
data can be read even without FITRON. With a password it is AES-256-GCM encrypted under a scrypt-derived key
(`FITRONENC1` header). The authentication tag means a wrong password and a damaged file are both refused before
anything is used. FITRON cannot recover a forgotten backup password.

Files live in the data folder, by kind:

```
%LOCALAPPDATA%\FITRON\backups\manual\FITRON-Backup-2026-10-11.fitronbackup
                              auto\   FITRON-Backup-2026-10-11.fitronbackup   (daily, newest 14 kept)
                              safety\ FITRON-Backup-2026-10-11.fitronbackup   (before each restore, newest 10)
```

The history is read from these folders, not from the database, so it survives a lost database. Manual backups are
never deleted automatically. Every backup is written to a temporary file and renamed into place, so a half-written
backup never appears under a backup's name.

## Screens

- **Backup now**, with an optional password (typed twice).
- **Automatic backup**: on or off, how many to keep. It runs a couple of minutes after FITRON opens and then hourly
  checks whether a day has passed (a laptop is off at night, so there is no fixed time).
- **Backup history**: when, kind, gyms and counts (or "Locked with a password"), size, Download, Restore.
- **Restore from file**: a .fitronbackup from a pen drive or another computer, streamed to the data folder (not
  held in memory).
- **Export data**: members, invoices, payments and expenses as CSV, for Excel or the accountant. These are not backups.
- **This computer**: data folder, last automatic backup, files present and missing (the Phase 9 inventory).

## Restore, step by step

1. Unpack into a temporary folder and check every entry against the manifest (size and SHA-256). Anything missing,
   extra or different refuses the file.
2. Refuse a backup made by a newer FITRON (unknown migrations or a newer format).
3. Check the backup's database integrity.
4. **Safety backup** of what is on the computer now (`backups\safety\`).
5. Bring the backup's database up to this FITRON's schema, on the temporary copy. A failed migration changes nothing.
6. Copy the data into the live database **in one transaction** on a connection of its own: every table emptied and
   refilled, triggers re-created from the backup (the financial-row guard and append-only audit log stay in force),
   all sessions cleared. A failure rolls back everything.
7. Swap the documents folder (old folder moved aside, backup's moved in, old one removed; start-up moves it back if
   FITRON stopped in between), and put back the two-step key.
8. Check integrity and that row counts match the manifest.
9. Write `backup.local.restore` into each restored gym's audit log, then **reload**: every database connection of
   FITRON is closed and reopened.
10. Everyone signs in again.

Restore is refused while more than one gym is on the computer, because it would replace all of them.

## Bugs found and fixed while building this

- **Two SQLite libraries in one process.** Prisma's adapter brought its own `better-sqlite3` (12.x) while FITRON's
  code used 13.x. Two copies of SQLite on one file break its locking: closing the file in one copy drops the other's
  locks. After a restore, the app kept serving old data and new connections failed with "disk I/O error". It is now
  pinned to the adapter's version, and `src/lib/runtime/single-sqlite.test.ts` fails if a second copy returns. **This
  must hold in the Windows build (Phase 14).**
- The restore-from-file button could be pressed before the page's script loaded. The browser then sent the form the
  plain way, with the password in the address. The button now stays disabled until the page is ready, and the
  fallback is a POST.

## Tests

| Test | Covers |
| --- | --- |
| `src/lib/runtime/fitron-backup.test.ts` (11) | tar round-trip; contents and hashes; opens with plain `tar`; password (none, wrong, right); damaged and non-backup files; restore with open connections (writer and reader) seeing the result; safety backup contents; newer version refused with nothing changed and no safety backup; older backup migrated; failed migration changes nothing; guard still active after restore; documents folder recovery; history and pruning; safe file lookup |
| `src/lib/runtime/single-sqlite.test.ts` | one SQLite library |
| `e2e/local/backup.spec.ts` (4) | on its own Local server: back up with and without a password, history, download; restore from the list (later work undone, safety backup listed, signed out, audit entry); restore from a downloaded file (junk refused, wrong password refused with nothing changed, right password restores); restart opens on the restored data |
