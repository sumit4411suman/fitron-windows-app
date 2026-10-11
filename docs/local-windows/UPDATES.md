# FITRON Local Windows Edition: updates (Phase 18)

FITRON updates itself safely, and only with the gym's say-so. An update never touches the gym's data without a
backup of it first, and a failed update puts the database back exactly as it was.

```
new version           FITRON looks once a minute after it opens, then every 12 hours, while it is open
   ↓
"Install now" / "Later"   the desk decides; nothing happens on its own
   ↓
download              the installer, from FITRON's own download address
   ↓
verify                FITRON's signature over the installer, with the public key built into this FITRON. A file that
                      is not signed by FITRON, or whose signature names another version, is refused and deleted
   ↓
back up               a safety backup of the gym's data (Settings › Backup › safety), made by the running FITRON
   ↓
install               FITRON closes (its server writes everything into fitron.db), the installer replaces the
                      program's files only, then starts the new FITRON
   ↓
migrate               the new FITRON finds the database needs updating: another safety backup, then the update
   ↓
verify the database   SQLite's integrity check
   ↓
open                  FITRON as usual, with every record
```

If the database update fails, or the updated database fails its check, FITRON puts the database back from the
safety backup it just made, does not serve from it, and says so on its start-up page: nothing is lost, install the
previous version again (Settings › Apps & features: uninstall FITRON, which keeps the data, then run the previous
installer), or call FITRON support. Nothing between the backup and the failed update could have been written, so
putting it back loses nothing.

If the download or its verification fails, or the backup before installing fails, nothing is installed and FITRON
says so. An update that was declined is offered again at the next check.

## What leaves the computer

The check is one request for a small file (`latest.json`) from FITRON's download address, and the download of the
installer. Nothing about the gym goes with them: no member, payment, invoice, expense, GST, attendance or accounting
record, and no licence or installation id. A FITRON built without an update address never checks at all. The Node
server inside FITRON does not take part: the desktop program does the checking (`src-tauri/src/update.rs`), and it
asks the server for the safety backup over a secret the two share for that one start (`/api/local/shell/backup`,
which no page can call).

## For FITRON: keys, builds and releases

Once:

```
npx tauri signer generate -w <a safe place>/fitron-update.key
```

Keep the private key and its password offline and backed up (they are what lets FITRON, and only FITRON, publish
updates). The printed public key is built into every release.

Every release, on Windows:

```
set FITRON_UPDATE_URL=https://<downloads>/windows/latest.json
set FITRON_UPDATE_PUBKEY=<the public key>
set TAURI_SIGNING_PRIVATE_KEY=<the private key, or its path>
set TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<its password>
npm run desktop:bundle
npx tauri build --config src-tauri/tauri.bundle.conf.json --config src-tauri/tauri.release.conf.json
npm run desktop:release -- --notes-file RELEASE-NOTES.md
```

`dist\desktop\` then holds the installer under its customer name, its `.sha256`, and `latest.json`:

```json
{
  "version": "1.1.0",
  "notes": "Receipts on thermal printers.",
  "pub_date": "2026-10-11T16:00:00Z",
  "platforms": { "windows-x86_64": { "url": "https://<downloads>/windows/FITRON-Gym-Accounting-Setup-1.1.0.exe", "signature": "…" } }
}
```

Upload all three to where `FITRON_UPDATE_URL` is served (https only). The installer is served beside the feed, so
the two cannot point at different places. Replacing `latest.json` is what publishes a release; keeping the previous
installer online lets a gym go back by hand.

| | |
| --- | --- |
| `src-tauri/src/update.rs` | the check, the question, download and verification, the backup, the install |
| `src-tauri/tauri.conf.json` › `plugins.updater` | `requireSignedVersion`: a signature must name the version it was made for, so an old installer cannot be served as a new one; Windows installs in passive mode |
| `src-tauri/tauri.release.conf.json` | makes the signed updater artifacts (release builds only; a CI build without the key does not need them) |
| `scripts/desktop-release.ts`, `scripts/desktop/update-feed.ts` | the customer-named installer, its checksum and `latest.json` |
| `src/app/api/local/shell/backup/route.ts` | the safety backup the desktop program asks for before installing |
| `src/lib/runtime/local-start.ts` | the safety backup before a migration, the integrity check after it, and putting the database back when either fails |

Downgrades: the installer refuses to install an older version over a newer one without uninstalling first; the
uninstall keeps the data (INSTALLER.md), so going back is deliberate, never silent.

## Tests

| Test | What it proves |
| --- | --- |
| `src/lib/runtime/local-update.test.ts` | a gym's books (members, sales, payments, expenses made through FITRON's services) through 1.0.0 → 1.1.0 (safety backup, every record and amount as before, integrity ok) → 1.2.0 whose migration fails (nothing of it stays, the database put back from the safety backup, the reason says what to do) → 1.2.1 (applies on the data put back). Also: no backup on a first start; nothing migrated when the backup fails |
| `src/lib/runtime/update-feed.test.ts` | the feed names the installer beside it and FITRON's signature; https only; an empty signature or a bad version is refused |
| `src-tauri` `cargo test` | a build without an update address and key never checks; the health check's words for a failed update |
| `npm run desktop:installer-test` (Windows CI) | an installer run over a running FITRON closes it cleanly, replaces the program only, leaves every record, and FITRON starts again (INSTALLER.md) |

Not covered by a test: the download and signature check themselves are Tauri's updater, which has its own tests;
FITRON's part is what happens before and after. The first signed release is checked by hand: install 1.0.0, publish
1.0.1, accept the update, and see the safety backup and the records.
