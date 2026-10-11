# FITRON Local Windows Edition: the installer (Phase 15)

The customer downloads `FITRON-Gym-Accounting-Setup-<version>.exe`, runs it, and opens FITRON from the Start Menu.
Nothing else is installed: Node.js, the database and the server ship inside FITRON (DESKTOP.md). No terminal, no
administrator password.

## What it does

| | |
| --- | --- |
| Installs | For the signed-in Windows user, into `%LOCALAPPDATA%\FITRON Gym Accounting`. No administrator needed, so it works on a desk computer where staff are not administrators. |
| Shortcuts | Start Menu, always. Desktop: a checkbox on the last page (on by default). A silent install makes both unless `/NS` is given. |
| Apps & features | Listed as "FITRON Gym Accounting" by FITRON, with its version and uninstaller. |
| WebView2 | Windows 10 and 11 have it. If a computer does not, the installer's small Microsoft bootstrapper installs it, which needs the internet once. |
| Older versions | Refused: an older FITRON must never open data a newer one has updated. |

## The gym's data

FITRON keeps the gym's data in `%LOCALAPPDATA%\FITRON` (database, backups, documents, logs, licence). The installer
never writes, moves or deletes anything there.

- **Install, reinstall, update.** If FITRON is open, the installer first closes it the way its close button does, so
  its server finishes what it is doing and writes everything into `fitron.db`. Only if FITRON is still open after 30
  seconds is it ended; a payment being saved at that moment is saved completely or not at all. Then only the program's
  files are replaced.
- **The first start after an update.** If the new version changes the database, FITRON first makes a safety backup
  of it (`backups\safety\`, listed in Settings › Backup), then updates it. If the backup cannot be made, the database
  is not touched and FITRON says it could not start.
- **Uninstall.** Removes the program, its shortcuts and its Apps & features entry. The data folder stays, and the
  uninstaller says where it is: installing FITRON again opens it as it was. Removing it for good is a deliberate act:
  copy a backup somewhere safe, then delete the folder. The uninstaller's "Also clear FITRON's window settings" box
  removes only the window's own cache and sign-in cookie (`%LOCALAPPDATA%\in.fitron.gymaccounting`).

## Building

On Windows, after `npm ci` (see DESKTOP.md for what each step checks):

```
npm run desktop:build
```

It packages the server, builds the program and its installer, and writes to `dist\desktop\`:

```
FITRON-Gym-Accounting-Setup-<version>.exe
FITRON-Gym-Accounting-Setup-<version>.exe.sha256
```

The version is `package.json`'s. Every pull request's Windows job builds the installer and keeps it for 14 days as the
`FITRON-Gym-Accounting-Setup` download of that run.

The installer is not code-signed yet, so Windows SmartScreen warns "Windows protected your PC" on first run. Signing is
part of the release work (Phases 19 and 25); FITRON never asks customers to turn SmartScreen off.

| File | |
| --- | --- |
| `src-tauri/tauri.conf.json` › `bundle.windows` | per-user NSIS installer, English, WebView2 bootstrapper, no downgrades |
| `src-tauri/nsis/hooks.nsh` | closes FITRON cleanly before installing or uninstalling; the message after an uninstall |
| `src-tauri/nsis/English.nsh` | Tauri's installer text with FITRON's wording for "FITRON is open" and the data checkbox |
| `scripts/desktop-installer.ts` | names the installer and writes its SHA-256 |

## Tests

| Test | What it proves |
| --- | --- |
| `src/lib/runtime/local-update.test.ts` | no safety backup on a first start; a safety backup of the old database before an update migrates it; nothing migrated if that backup fails |
| `npm run desktop:installer-test` (Windows CI) | silent install: program, Start Menu and Desktop shortcuts, Apps & features entry, no data folder yet; FITRON starts and makes its data; reinstall while FITRON is open closes it cleanly and leaves every record as it was; FITRON starts again; uninstall removes program, shortcuts and entry and keeps the data folder with every record, backups and documents |

The installer test uses the real `%LOCALAPPDATA%\FITRON`, so it refuses to run where that folder exists.
