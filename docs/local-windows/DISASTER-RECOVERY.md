# FITRON Local Windows Edition: disaster recovery (Phase 21)

What happens to a gym's books when something goes wrong on the computer, how FITRON notices, how the gym gets back,
and what it finds afterwards. Each case is tested; the tests are listed at the end. The rule behind all of them: a
gym's accounting records are never lost silently and never left half-written, and nothing FITRON finds damaged is
deleted.

What every case relies on:

- **One transaction per business action.** A payment is written with its audit entry; a sale with its invoice, items,
  membership, payment and audit entries; each in one database transaction. Numbers (invoice, payment, member) are
  taken inside the same transaction, so a transaction that never commits takes no number.
- **SQLite in WAL mode with `synchronous=FULL`** (`src/lib/runtime/sqlite-adapter.ts`). A committed transaction is
  on disk before FITRON says "saved"; one that did not commit leaves nothing.
- **Backups**: an automatic one every day FITRON is open (newest 14 kept), one by hand at any time, and a safety
  backup before every update and every restore (`BACKUP-RESTORE.md`). The data folder is never inside Program Files
  and is never removed by the uninstaller (`STORAGE.md`, `INSTALLER.md`).

## 1. Power failure during a payment

| | |
| --- | --- |
| Failure | The computer loses power (or FITRON is killed) while a desk presses Record payment. |
| Detection | None needed: SQLite rolls back an unfinished transaction the next time the database opens. |
| Recovery | Open FITRON again. The desk looks at the invoice: the payment is either there with its receipt number, or not there at all, and is entered again. |
| Expected result | Every payment is whole (with its audit entry and number) or absent. No payment twice, no invoice paid past its total, payment numbers without gaps. |

## 2. Crash during invoice creation

| | |
| --- | --- |
| Failure | FITRON stops (power cut, Windows update restart, a crash) while a membership is being sold. |
| Detection | As above: the unfinished sale is rolled back when the database opens. |
| Recovery | Open FITRON; the sale is either complete or absent. An absent one is made again. |
| Expected result | No invoice without its items, membership or audit entry; no membership or payment without its invoice; invoice numbers consecutive, and the counter continues after the last saved invoice. |

## 3. Database corruption

| | |
| --- | --- |
| Failure | The database file is damaged: a failing disk, a write the disk lost in a power cut, something outside FITRON writing over it. |
| Detection | Every start runs SQLite's `integrity_check` on the database (the same check a backup makes) before anything opens it for work (about a second on five years of records), and a file that is not a database at all counts too (`src/lib/runtime/local-damage.ts`). A damaged database is never written to: FITRON marks it (`data\DAMAGED.json`), starts no jobs, backups or sync, and answers every page with Recovery. |
| Recovery | The window opens on **Recovery**: what happened, and the backups on this computer, newest first (a backup from a pen drive is copied into `backups\manual` first). A Super Admin of the gym in the chosen backup enters their email and the password they had then (and the backup's password, if it has one). FITRON checks the backup, brings it up to this version, moves the damaged files into `data\damaged-<time>\` with a note, puts the backup's database in, brings back document files the folder lost, signs everyone out and carries on without a restart. A computer linked to fitron.in downloads the gym again before it uploads anything. |
| Expected result | FITRON works on the backup's records. Anything entered after the backup is not in it (Recovery says so, with the backup's time); the damaged files are kept for FITRON support. A wrong password or a damaged backup changes nothing. |

## 4. Failed migration

| | |
| --- | --- |
| Failure | The first start after an update cannot bring the database up to the new version (a migration fails, or the database fails its check afterwards). |
| Detection | Start-up applies migrations only after a safety backup, then runs SQLite's `integrity_check` (`src/lib/runtime/local-start.ts`). |
| Recovery | FITRON puts the database back from that safety backup by itself and shows why it could not update, with what to do (install the previous version again: uninstalling keeps the data). |
| Expected result | The database exactly as it was before the update; nothing of the failed migration remains. |

## 5. Failed update

| | |
| --- | --- |
| Failure | Downloading or installing a new version fails, or the new version does not start. |
| Detection | The update is checked against its signature before it is installed; the desktop program waits for the new server's health check (`UPDATES.md`). |
| Recovery | A backup is made before the update is installed; a failed migration is undone as in 4. Installing the previous version again opens the same data folder. |
| Expected result | The gym's data untouched; FITRON as it was before, or the new version on the same data. |

## 6. Accidental deletion

| | |
| --- | --- |
| Failure | A record is deleted by mistake, or the data folder (or a file in it) is deleted outside FITRON. |
| Detection | Inside FITRON: money records cannot be deleted at all (the database refuses: `_fitron_guard` triggers). Invoices are cancelled, payments reversed and expenses voided, each with a reason and an audit entry. A deleted member is listed under Members › Deleted. Outside FITRON: a missing database means first-run setup; a missing document shows as "not found" (Settings › Backup checks every file). |
| Recovery | A member: Members › Deleted › Restore. A wrong cancellation or reversal: enter the sale or payment again (the audit log shows both). The data folder: install or open FITRON, then Settings › Backup › Restore from file with the latest backup (from the pen drive, or from `backups\` if only the database was lost), or link the computer to fitron.in again and download the gym. |
| Expected result | Nothing of the books is lost beyond what was entered after the last backup, and the audit log shows who did what. |

## 7. Laptop replacement

| | |
| --- | --- |
| Failure | The computer is lost, stolen, broken, or replaced. |
| Detection | Not FITRON's: the gym moves to another computer. |
| Recovery | Before, if possible: Settings › Backup › Back up now (a password is recommended), copy the file to a pen drive. On the new computer: install FITRON, do the first-run setup (any name; it is replaced), then Settings › Backup › Restore from file. Staff two-step codes keep working (the backup carries the key that seals them). With cloud sync: link the new computer to fitron.in and download the gym; unlink the old one on fitron.in (Settings › Cloud sync), which stops its token at once. |
| Expected result | The new computer holds the gym as the backup (or fitron.in) had it: members, invoices, payments, expenses, documents, settings, staff and their passwords. |

## Tests

| Test | What it shows |
| --- | --- |
| `src/lib/runtime/power-cut.test.ts` | a separate process killed (SIGKILL) mid-transaction leaves nothing; killed right after a commit keeps everything; the database passes `integrity_check` |
| `e2e/local/crash.spec.ts` | the production server killed while four desks take payments, then while four desks make sales: database whole, every payment and invoice with its audit entry, every invoice with its items and membership, numbers consecutive, nothing paid past its total, FITRON starts normally |
| `src/lib/runtime/local-damage.test.ts` | damaged pages and a destroyed header are found; a wrong password or someone else changes nothing; a Super Admin of the backup restores it; the damaged file is kept byte for byte with a note; sessions emptied |
| `e2e/local/recovery.spec.ts` | a database damaged while FITRON was closed: the health check opens the window on Recovery, every page and API answers Recovery, a wrong password is refused, the owner restores the latest backup, FITRON carries on without a restart with the backup's records, and new records save |
| `src/lib/runtime/local-update.test.ts` | a failed migration is undone from the safety backup; the next version applies on the data put back |
| `src/lib/runtime/fitron-backup.test.ts`, `e2e/local/backup.spec.ts` | backup and restore, with and without a password, from the list and from a file; damaged and foreign files refused |
| `npm run desktop:installer-test` (Windows CI) | install, update and uninstall as a customer does; the data folder survives the uninstall |
