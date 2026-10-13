# FITRON Local Windows Edition: security (Phase 19)

FITRON for Windows keeps a gym's books on one computer, under one Windows account, with no server of FITRON's in
the loop. What that means in practice, piece by piece, and what checks it.

## Least privilege: the desktop program

| Concern | How FITRON for Windows behaves | Where, checked by |
| --- | --- | --- |
| What a page may ask the program for | Nothing. The window carries no Tauri capabilities and no global Tauri object, so no page can reach files, programs, settings or the shell's own functions. There are no Tauri commands. | `src-tauri/tauri.conf.json` (`capabilities: []`, `withGlobalTauri: false`); `cargo test hardening` fails if either changes or a `capabilities/` folder appears |
| Shell access, process execution | The program starts exactly one child, the bundled Node.js with the bundled server, with a fixed, cleaned environment (no `NODE_OPTIONS`, no `DATABASE_URL`, no `FITRON_*` from the computer). Nothing else is ever executed. | `src-tauri/src/server.rs` (`removed_variable`, tests) |
| Filesystem access | The program writes only in the data folder (`%LOCALAPPDATA%\FITRON`) and never in its own folder; it runs from a read-only Program Files-style folder. Pages have no file access at all. | `desktop:smoke`, `desktop:installer-test` |
| Where the window may go | FITRON's own pages (127.0.0.1 on this start's port, and the start-up page). `https`, `mailto` and `tel` links open in the computer's own browser or mail program. Everything else (`file:`, `javascript:`, other `http` addresses, other local ports) is refused. New windows follow the same rules. | `src-tauri/src/nav.rs` and its tests |
| The start-up page | Static, no scripts beyond its own, and a policy that allows it no connections at all. | `tauri.conf.json` `app.security.csp`; `cargo test hardening` |
| Second copies | One FITRON per Windows user and per data folder (lock file), so two servers never open one database. | `src-tauri/src/main.rs` |
| Ending | Closing stops the server cleanly; a crash still ends it (job object), so no orphaned server keeps the port. | DESKTOP.md |

## Localhost-only server, secure IPC

| Concern | Behaviour | Where, checked by |
| --- | --- | --- |
| Listening | `127.0.0.1` only, on a port chosen at each start. Never a network address. | `server_variables`; `desktop:smoke` tries every network address |
| Requests from elsewhere on the computer | Any program on the computer could reach 127.0.0.1, so every page and action needs a signed-in FITRON session, as on the website. | `src/proxy.ts`, `requirePermission` |
| A website pointed at 127.0.0.1 (DNS rebinding) | Refused: the Local Edition answers only requests whose Host is `127.0.0.1` or `localhost` (421 otherwise). | `src/lib/runtime/loopback.ts`, `proxy.test.ts`, `desktop:bundle` |
| Shell ↔ server | The shell's own requests (a safety backup before an update) carry a 256-bit secret made for that start and handed to the server in its environment; the server compares it in constant time; no page sees it. The health check carries an instance id, so the shell never mistakes another program for its server. | `src/app/api/local/shell/backup/route.ts`, `src-tauri/src/server.rs` |
| Content-Security-Policy | The console's policy, enforced, with a nonce per request; on FITRON for Windows the browser may not reach Razorpay or any other site from the console. | `src/lib/csp.ts`, `csp.test.ts` |

## Authentication and authorization

| Concern | Behaviour | Where |
| --- | --- | --- |
| Passwords | Argon2id (19 MiB, 2 passes); never echoed, never logged. | `src/lib/auth/password.ts` |
| Sessions | Server-side: the cookie holds a random 256-bit token, the database its SHA-256; httpOnly, SameSite=Lax, Secure (127.0.0.1 counts as secure); rotated on every sign-in; idle sign-out (30 minutes by default, Settings › Go live). | `src/lib/auth/session.ts` |
| Guessing | Per account: 5 wrong passwords in 15 minutes lock the account, unknown emails included. Per address: 30 a minute on one shared computer. | `src/lib/auth/lockout.ts` |
| Forgotten owner password | The recovery key shown once at setup (100 bits, stored as an Argon2id hash); using it signs the owner out everywhere, ends a lockout, is audited and replaces the key. | `src/lib/services/local-setup.ts` |
| Two-step sign-in | TOTP, offline; secrets sealed with BIOMETRIC_KEY. | `src/lib/services/two-step.ts` |
| Built-in WhatsApp link | The link's keys (as WhatsApp Web keeps them) are files in `whatsapp/<gym>/session`, each encrypted with AES-256-GCM under a key derived (HKDF) from this installation's BIOMETRIC_KEY, never stored. Baileys' log is silenced, since it can contain message text and keys. Unlink (or unlinking FITRON on the phone) deletes the files. | `src/lib/integrations/whatsapp/embedded.ts`, `embedded.test.ts` |
| WhatsApp connector key | The master key a gym enters under Settings › WhatsApp › Connector is sealed with BIOMETRIC_KEY, never shown again, left out of the audit entry, backups and cloud sync (`whatsapp_connector` is a computer-only setting). The address must be http(s) with nothing but host, port and path. | `src/lib/services/wa-connector-store.ts`, `wa-connector-local.db.test.ts` |
| Authorization | Every page and every server action calls `requirePermission(...)` for the signed-in user's role; branch scope is applied in the services. | `src/lib/auth/permissions.ts`, `src/lib/auth/current.ts` |
| Input validation | Every form and action input is parsed with a zod schema before any service runs; amounts are whole paise; the database refuses deletes of financial rows. | `src/lib/validation/*`, the services' tests |
| Online sign-in | Google, emailed links and codes, and fitron.in sign-up are not offered and their routes redirect. | `src/proxy.ts` |

## Secure storage

| What | Where it lives | How it is protected |
| --- | --- | --- |
| The gym's database, documents, backups, logs | `%LOCALAPPDATA%\FITRON` | The Windows user's own profile permissions: other standard users on the computer cannot read it. Never in the program folder. |
| The installation's secrets (installation id, BIOMETRIC_KEY, AUTH_SECRET, CRON_SECRET) | `secrets.dpapi` | **Sealed with Windows DPAPI for this Windows user** (`CryptProtectData`, user scope, with a FITRON-specific purpose). The file is useless copied to another computer or read by another account. The desktop program unseals it when FITRON opens and hands the values to the server in its environment, the way a hosted FITRON gets them; the server never writes them. An older installation's plain `secrets.json`, or the plain file a restore writes with the backup's key, is sealed at the next start and the plain file removed. (Linux and macOS, development only: the plain file, readable by this user only.) `src-tauri/src/secrets.rs`, `src/lib/runtime/local-secrets.ts`. |
| The shell's secret for the server | the server's environment only | New at every start, never on disk. |
| The licence | `licence.fitronlicence` | Signed by FITRON; the clock guard in `licence-state.json` (LICENSING.md). |
| Backups | `backups\` | Optional password (AES-256-GCM, BACKUP-RESTORE.md); a backup carries BIOMETRIC_KEY so a replacement laptop can read two-step secrets. |
| The window's cache and cookie | WebView2's folder for FITRON | Per user, removed by the uninstaller's optional box only. |

Not encrypted at rest: `fitron.db` itself. Anyone who can read the Windows user's files can read it (and would equally
read a backup). Encrypting the database (SQLCipher with a DPAPI-held key) is possible later; it is not in 1.0.

## Cloud sync (when a gym links the computer to fitron.in)

| Concern | Behaviour | Where, checked by |
| --- | --- | --- |
| Who may link | The gym's Super Admin on fitron.in, with password and two-step code, and the same lockout as the sign-in page. Only a Super Admin on the computer can start it. | `src/lib/sync/server.ts` (`owner`), `server.db.test.ts` |
| The computer's credential | A 256-bit device token, shown to nobody: fitron.in keeps its SHA-256, the computer keeps it sealed with the installation's key. Every request carries it; fitron.in finds the gym from it, never from the request. Unlinking (either side) stops it at the next request; so does the linking person losing Super Admin. | `authDevice`, `server.db.test.ts` |
| Tenant isolation | A change naming another gym's record, or a new record naming another gym, is refused and written to the gym's audit log. | `server.db.test.ts` |
| No direct database access | The computer has no database credentials for fitron.in and never connects to PostgreSQL: it sends changes over HTTPS and fitron.in checks and stores each one (types, whole paise, what a money record may change, closed months, balances). | `checkWrite`, `codec.ts` |
| Replays | Every upload carries a change id; one already applied is answered from the record, never applied again. | `SyncApplied`, `e2e/sync/sync.spec.ts` |
| What never syncs | Passwords, two-step secrets, sessions, recovery keys, WhatsApp keys, this computer's own settings. | `entities.ts` (`omit`, `LOCAL_ONLY_SETTINGS`), `codec.test.ts` |
| Transport | HTTPS to fitron.in only (plain HTTP to 127.0.0.1 for tests). Every connection is in `src/lib/integrations/sync/` (the egress rule). | `cloudUrl`, `egress.test.ts` |

## Audit logging

Every financial and administrative action writes an entry in the audit log inside the same transaction, hash-chained
per gym (`src/lib/services/audit.ts`, `src/lib/domain/audit-chain.ts`): a changed or removed entry breaks the chain,
which Settings › Audit verifies. Sign-ins, sign-outs, idle sign-outs, lockouts, the recovery key, restores and licence
imports are audited. The desktop program keeps its own `shell.log` (start, port, ready, stop, updates, secrets
handling), with nothing about the gym in it.

## Code signing and signed updates

- Updates are signed with FITRON's update key and verified before anything is installed; a signature must name the
  version it was made for (UPDATES.md).
- FITRON releases without an Authenticode certificate for now (RELEASE.md §2.1): Windows shows Unknown publisher on
  the first install, and the release page gives the installer's SHA-256 to check first. Updates do not depend on it:
  they must carry FITRON's update-key signature. When FITRON adds a certificate, the program, its Node.js runtime, the
  installer and the uninstaller are signed with it in a release build (`.github/workflows/desktop-release.yml`, RELEASE.md): `src-tauri/tauri.sign.conf.json`
  runs `scripts/desktop/fitron-sign.cmd` for every file (SHA-256, RFC 3161 timestamp), and
  `npm run desktop:signature -- --require` fails the release unless Windows reports every file as signed by FITRON,
  valid and timestamped. Windows then shows FITRON as the verified publisher. The certificate's private key stays in
  its cloud signing service (SSL.com eSigner or DigiCert KeyLocker); the build machine only asks it for signatures. A
  release with a certificate set up makes one test signature before building and fails on any unsigned file;
  development builds are unsigned and the check says so. FITRON never asks a
  customer to turn SmartScreen or any Windows protection off.
  Test builds can be signed with a free self-signed certificate (`docs/WINDOWS-TEST-CODE-SIGNING.md`): opt-in, never
  in a release, never added to a trusted store by any script, and not publicly trusted.

## What leaves the computer

Nothing, unless a user turns a feature on (ONLINE-SERVICES.md): WhatsApp, email, Fitron AI's model, Razorpay autopay.
The update check sends the request for a small file and nothing about the gym (UPDATES.md). The licence is checked on
the computer (LICENSING.md). `src/lib/integrations/egress.test.ts` fails if any other code opens a connection.

## Known limits

- Lockout counts live in memory: restarting FITRON clears them (a restart needs someone at the computer).
- The database is not encrypted at rest (above).
- The desktop program honours `FITRON_DATA_DIR` from its environment (for tests); a person who can set a Windows
  user's environment already has that user's files.
- Two-step codes depend on the computer's clock (OFFLINE.md).

## Tests

| Test | What it proves |
| --- | --- |
| `cargo test` (`hardening`, `nav`, `secrets`, `server`) | no capabilities, no global Tauri, the start-up page's policy; where links may go; secrets sealed and unsealed for this user (Windows), kept and filled; the server's cleaned environment; the health check is ours only |
| `src/lib/runtime/loopback.test.ts`, `src/proxy.test.ts` | only this computer's names are answered; the shell's backup route needs no session but the shell's secret |
| `src/lib/auth/*.test.ts` | lockout, two-step, permissions |
| `src/lib/integrations/egress.test.ts` | no connection outside the integrations |
| `desktop:smoke`, `desktop:installer-test` | 127.0.0.1 only, nothing written in the program folder, normal-user rights, `secrets.dpapi` present and no plain `secrets.json` on Windows |
