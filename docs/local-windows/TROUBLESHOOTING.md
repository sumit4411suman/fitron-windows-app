# FITRON Local Windows Edition: troubleshooting

What a gym (or FITRON support on the phone with one) sees when something is wrong with FITRON Gym Accounting for
Windows, and what to do. The first rule in every case: **do not delete anything in the FITRON data folder**
(`%LOCALAPPDATA%\FITRON`), and never turn off SmartScreen, Defender or any other Windows protection to make FITRON work.

Where things are:

| What | Where |
| --- | --- |
| The gym's data | `%LOCALAPPDATA%\FITRON\data\fitron.db` (one file, with `-wal` beside it while FITRON is open) |
| Backups | `%LOCALAPPDATA%\FITRON\backups\` (`auto`, `manual`, `safety`) |
| Documents and photos | `%LOCALAPPDATA%\FITRON\documents\` |
| Logs | `%LOCALAPPDATA%\FITRON\logs\shell.log` (the program) and `server.log` (FITRON itself); nothing about members in either |

## FITRON does not open

| What you see | What to do |
| --- | --- |
| The start-up page says FITRON could not update its database to this version, and that it was put back from a safety backup | Nothing was lost. Install the previous version of FITRON again (uninstalling keeps the data) and tell FITRON support the version that failed. (`UPDATES.md`) |
| The start-up page says the update could not be undone by itself | Do nothing else with the data folder; call FITRON support. The safety backup named on the page holds everything as it was. |
| The window opens on **"FITRON's database is damaged"** | The database file was damaged (a failing disk, a power cut the disk did not survive). FITRON has not changed it. Pick the newest backup in the list; a Super Admin of the gym in that backup enters their email and the password they had then. The damaged files are kept in `data\damaged-<time>\` for FITRON support; anything entered after the backup is not in it. A backup on a pen drive: copy the `.fitronbackup` file into `backups\manual`, then open the page again. (`DISASTER-RECOVERY.md`) |
| The start-up page waits for minutes after an update | The first start after an update may change the database (up to 5 minutes on years of records). Leave it. |
| Starting FITRON again only brings its window forward | It is already open. One FITRON runs per Windows user, so two never write to one database. |
| "Windows protected your PC" and **Unknown publisher** when installing FITRON | Expected: FITRON's installer is not code-signed. Download it only from FITRON's release page, and compare its SHA-256 (PowerShell: `Get-FileHash <file>`) with the one on that page. If it matches, choose More info › Run anyway. If it does not, or the file came from anywhere else, do not run it. Never turn SmartScreen off. (`RELEASE.md`) |

## Signing in

| What you see | What to do |
| --- | --- |
| "Too many wrong passwords for this account. Try again in … minutes" | Wait the minutes it says, or a Super Admin resets the password from Staff. Restarting FITRON also clears it. |
| The owner forgot their password | Sign-in › "Forgot password?": the recovery key shown when FITRON was set up resets it, and a new key is shown. Staff passwords are reset by a Super Admin from Staff. |
| Everyone was signed out | Normal after a restore or after linking the computer to fitron.in: sign in again. |

## Backups and restores

| What you see | What to do |
| --- | --- |
| "The database failed its integrity check, so it was not backed up" | Close FITRON and open it again: it checks the database as it starts and offers to restore the latest good backup. |
| "This is not a FITRON backup file." | The file picked is not a backup (or was renamed from something else). Pick the `.fitronbackup` file. |
| "This backup has a password." / "The password is wrong, or the backup file is damaged." | Enter the password set when the backup was made. FITRON support cannot recover it. |
| "This backup file is damaged…" | The file was changed or cut short on its way (a pen drive pulled out early). Use another copy or an older backup; nothing was changed. |
| "This backup was made by a newer FITRON" | Update FITRON on this computer first, then restore. |
| Restore is refused because more than one gym is on the computer | A restore replaces the whole computer's data; ask FITRON support. |
| Moving to a new computer | Old computer: Settings › Backup › Back up now (with a password), copy the file. New computer: install FITRON, do the first-run setup with any name, then Settings › Backup › Restore from file. (`DISASTER-RECOVERY.md` §7) |

## Saving files

| What you see | What to do |
| --- | --- |
| "Could not save the file: the disk is full, or the FITRON data folder is not writable." | Free space on the drive (old downloads, the recycle bin). FITRON keeps 14 automatic and 10 safety backups and removes older ones by itself; manual backups are kept until someone deletes them. |
| A member's document shows as "not found" | Its file was removed outside FITRON (or the documents folder was not copied to a new computer). Settings › Backup lists missing files. Restore a backup that has them, or upload the document again. |

## WhatsApp

| What you see | What to do |
| --- | --- |
| "WhatsApp is not linked (demo mode)" | Messages are saved in FITRON, not sent. Link WhatsApp in Settings › WhatsApp. |
| "…needs the FITRON WhatsApp connector. Enter its address and key…" | For a linked gym phone: Settings › WhatsApp › Connector: the address of the computer or server where the connector runs, and its key. Or use WhatsApp Business through Meta. |
| "Nothing is answering at http://…" | The connector is not running, or the address is wrong: check the computer it runs on, and the address under Connector. |
| Sending through Meta says the computer is offline | WhatsApp Business needs the internet. The message is kept as Failed: send it again when the computer is online. Everything else in FITRON works offline. |

## Cloud sync (computers linked to fitron.in)

| What you see | What to do |
| --- | --- |
| The header badge says **Offline** | Nothing is lost: changes wait on the computer and go up when the internet is back. |
| "Refused by fitron.in" items in Settings › Cloud sync | Each says why (a closed month, a payment past an invoice's total, a record fitron.in no longer has). Correct it and press Retry, or Dismiss to keep it on this computer only. |
| Conflicts in Settings › Cloud sync | The same record was changed on both sides while apart; both versions are kept. Pick the one to keep. Money records keep fitron.in's version: enter the payment or reversal again if it is still needed. |
| "This computer is not linked to fitron.in any more" | It was unlinked on fitron.in. Changes are still recorded here; link it again in Settings › Cloud sync to send them. |

(`DEPLOY-SYNC.md` has the operator's side.)

## Printing

| What you see | What to do |
| --- | --- |
| The invoice or receipt is cut or tiny | Pick the paper beside Print (A4, A5, 80 mm or 58 mm thermal); the choice is kept for the next one. In Windows' print dialog, choose "Actual size", not "Fit". (`PRINTING.md`) |

## For FITRON support

- Ask for `shell.log` and `server.log` from the logs folder: they hold the program's steps and errors, nothing about
  members.
- The health check, from the computer itself: the port is in `shell.log` ("ready: FITRON … at http://127.0.0.1:<port>"),
  and `http://127.0.0.1:<port>/api/health` says whether the database is ready, damaged (`"recovery": true`) or failed
  to update (`"detail"` says why).
- Never ask a gym to delete the data folder, `fitron.db-wal`, or a `damaged-…` folder. Copy them first if they need to
  be looked at.
