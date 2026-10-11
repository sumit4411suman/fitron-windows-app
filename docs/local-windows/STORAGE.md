# FITRON Local Windows Edition: where things are kept (Phase 16)

FITRON keeps its program and the gym's data in separate places, and needs no administrator for either. A normal
Windows user installs it, runs it, updates it and backs it up.

| | Where | Written by | Replaced by an update | Removed by uninstall |
| --- | --- | --- | --- | --- |
| **Program** | `%LOCALAPPDATA%\FITRON Gym Accounting\` (`fitron.exe`, `fitron-node.exe`, `server\`) | the installer only | yes | yes |
| **Gym's data** | `%LOCALAPPDATA%\FITRON\` | FITRON | never | never |
| Window's cache and sign-in cookie | `%LOCALAPPDATA%\in.fitron.gymaccounting\` (WebView2) | the window | no | only if "Also clear FITRON's window settings" is ticked |
| Temporary files | `%TEMP%` | FITRON while working | | |

The gym's data folder:

```
%LOCALAPPDATA%\FITRON\
├── data\fitron.db            the database (members, payments, invoices, expenses, books, GST, attendance)
├── backups\auto|manual|safety\  .fitronbackup files (Settings › Backup)
├── documents\                member documents, photos, logos, invoice and receipt PDFs
├── logs\shell.log, server.log
├── secrets.json              this installation's id and keys
├── licence.fitronlicence, licence-state.json
└── settings.json, fitron.lock
```

## The rules, and what checks them

| Rule | How it holds | Checked by |
| --- | --- | --- |
| The program folder is never written to while FITRON runs | No image resizing and no page cache on disk in the server (`next.config.ts`); logs, database, backups and documents go to the data folder; the window's cache goes to WebView2's own folder | `desktop:bundle` (server folder unchanged), `desktop:smoke` (program folder unchanged), `desktop:installer-test` (program folder made read-only, as Program Files is: FITRON still starts and works) |
| No administrator, ever | Per-user install (`installMode: currentUser`); the installer, FITRON and its uninstaller ask Windows for a normal user's rights (`asInvoker`) | `desktop:installer-test` reads each program's manifest |
| The data folder is found, never assumed | The shell asks Windows for the user's Local AppData folder (`FOLDERID_LocalAppData`) and hands it to the server; nothing names a drive, a user or `C:\Users` | `src/lib/runtime/paths.ts` tests; `desktop:smoke` runs with a data folder named with spaces and non-English letters (`Rāhul Sharmā ₹ डेटा`) |
| Updates and uninstalls leave the data alone | INSTALLER.md | `desktop:installer-test`, `local-update.test.ts` |

Only the Windows user it belongs to (and the computer's administrators) can open the data folder: it inherits the
permissions of the user's own profile.

## Things to know

- **One Windows user, one FITRON.** The data folder belongs to the Windows user who runs FITRON. If the gym's computer
  has several Windows accounts, each gets its own, separate FITRON. Staff should sign in to FITRON with their own
  FITRON logins under the one Windows account the gym uses for it.
- **Local, not roaming.** `%LOCALAPPDATA%` stays on this computer even on a network with roaming profiles, and OneDrive
  does not sync it. Moving to a new computer is done with a backup (Settings › Backup › Create, then Restore on the new
  computer).
- **Program Files.** FITRON installs for the current user so that no administrator is needed. The program is built to
  run from a read-only folder, which is what Program Files is for a normal user, so an all-users install can be added
  later without changing FITRON itself.
