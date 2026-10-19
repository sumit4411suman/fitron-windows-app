# FITRON Local Windows Edition: releasing (Phase 25)

How a version of FITRON Gym Accounting for Windows goes from this repository to a gym's computer: what must pass
first, how it is built and signed (always with FITRON's update key; with a code-signing certificate only if FITRON buys
one, §2.1), what is checked, and how it is published. For FITRON only;
gyms never build anything.

## 1. Before a release

Everything below runs on every pull request (`.github/workflows/ci.yml`, `desktop.yml`); a release is made only from a
commit where all of it is green.

| Check | What it proves | Doc |
| --- | --- | --- |
| `npm run lint`, `npm run typecheck` | the code compiles, no unused or unsafe constructs | |
| `npm test` (PostgreSQL) and `npm run test:local` (SQLite) | every service and rule, on both databases | `DATABASE-MIGRATION.md` |
| `npm run e2e`, `npm run e2e:local` | every screen in a browser, on the production build, on both editions; on Windows' edition also start-up, database, crash, recovery, update, restore, offline and the 25-step acceptance test | `OFFLINE.md`, `DISASTER-RECOVERY.md` |
| `npm run e2e:sync` | fitron.in and a computer as two servers: sync both ways, offline, a cut connection, conflicts, documents | `DEPLOY-SYNC.md` |
| `npm run perf:local` | every daily screen within its budget on 5,000 members and 100,000 payments | `PERFORMANCE.md` |
| Desktop (Windows) job | the shell's tests, the packaged server, the real program started and closed, the installer installed, updated over a running FITRON, started with nothing on the PATH (no Node.js, PostgreSQL, Docker or developer tools to be found), from a read-only program folder, and uninstalled with the data kept | `DESKTOP.md`, `INSTALLER.md` |

`npm run perf:local` and `npm run e2e:sync` take minutes; run them before every release, not only when their areas
changed.

The version is `package.json`'s `version` (the program, the installer and the update feed all read it). Raise it in
the release's own commit.

## 2. Set up once

Nothing here is ever committed: the update key stays on FITRON's own computer and in the `release` environment (and a
certificate's key, if FITRON buys one, in its signing service).

### 2.1 The code-signing certificate (optional; FITRON releases without one)

**FITRON releases without a code-signing certificate** (`FITRON_SIGN_PROVIDER` unset, or `none`). What that means:

- Windows shows **Unknown publisher**, and SmartScreen says "Windows protected your PC" when a gym first runs the
  downloaded installer. The gym chooses **More info › Run anyway** for that one file; SmartScreen stays on. The release
  page says so, with the installer's SHA-256 for the gym (or FITRON support on the phone) to compare first.
- Updates are not affected: FITRON downloads them itself, checks FITRON's update-key signature (§2.2), and installs
  only an update that passes. No one without the update key can send an update to a gym.
- The protection a certificate adds is on the **first download**: Windows itself would vouch that the installer is
  FITRON's. Without it, the gym relies on downloading from FITRON's release page and the SHA-256.

To add a certificate later, set `FITRON_SIGN_PROVIDER` and its settings below; nothing else changes.

An OV (organisation validated) code-signing certificate in FITRON's registered legal name. Since June 2023 a
certificate's private key must live on hardware, so a certificate bought today comes on a USB token or in a cloud
signing service, not as a file. A USB token cannot be plugged into GitHub's build machine; buy one of these two cloud
services, which sign from the workflow with nothing to plug in:

| `FITRON_SIGN_PROVIDER` | Service | Notes |
| --- | --- | --- |
| `esigner` | SSL.com eSigner (OV code signing with eSigner) | Enable automated signing (the TOTP secret) on the eSigner account. Each signature counts against the eSigner plan. |
| `keylocker` | DigiCert KeyLocker (OV code signing in KeyLocker) | Make an API key and a client authentication certificate in DigiCert ONE. KeyLocker plans have a yearly signature limit. |
| `pfx` | a `.pfx` file | Only where a certificate authority still issues one. |

Before paying, ask the provider that it validates an Indian private limited company, which documents it needs, and how
many signatures the plan includes. A release makes about six signatures (the test signature, the program, the
runtime, the installer, the uninstaller), so a plan of N signatures a year covers about N / 6 releases.

### 2.2 The update key

On FITRON's own Windows computer (not a shared or cloud machine), in this repository's folder:

```
npx tauri signer generate -w %USERPROFILE%\.tauri\fitron-update.key
```

It asks for a password, then writes the private key to `fitron-update.key` and the public key to
`fitron-update.key.pub`. Copy both files and the password to two safe offline places (a pen drive kept in a safe, a
password manager). **Losing the private key or its password means no installed FITRON can ever be updated again**:
each would have to be uninstalled and installed by hand. Anyone holding both could send an update to every gym.

### 2.3 The `release` environment

Repository › Settings › Environments › New environment › `release`. Under *Deployment protection rules*, add yourself
as a required reviewer, and under *Deployment branches*, allow only `main`. Then add:

| Kind | Name | Value |
| --- | --- | --- |
| variable | `FITRON_SIGN_PROVIDER` | leave unset (no certificate), or `esigner`, `keylocker` or `pfx` |
| variable | `FITRON_PUBLISHER` | with a certificate only: the organisation name on it, exactly, e.g. `FITRON Technologies Private Limited` |
| secret | `TAURI_SIGNING_PRIVATE_KEY` | the whole content of `fitron-update.key` |
| secret | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password |
| variable | `FITRON_UPDATE_PUBKEY` | the whole content of `fitron-update.key.pub` |
| variable | `FITRON_UPDATE_URL` | leave unset to publish on this repository's GitHub Releases (below) |

and, only with a certificate, for its signing service:

| Provider | Kind | Name | Value |
| --- | --- | --- | --- |
| `esigner` | secret | `ESIGNER_USERNAME` | the eSigner account's username |
| | secret | `ESIGNER_PASSWORD` | its password |
| | secret | `ESIGNER_TOTP_SECRET` | the secret behind the account's authenticator code (shown when automated signing is enabled) |
| `keylocker` | secret | `SM_API_KEY` | the DigiCert ONE API key |
| | secret | `SM_CLIENT_CERT_FILE_B64` | the client authentication certificate (`.p12`), base64: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("client.p12"))` in PowerShell |
| | secret | `SM_CLIENT_CERT_PASSWORD` | its password |
| | secret | `SM_CODE_SIGNING_CERT_SHA1_HASH` | the code-signing certificate's SHA-1 thumbprint, from KeyLocker |
| | variable | `SM_HOST` | only if DigiCert gives another address than `https://clientauth.one.digicert.com` |
| `pfx` | secret | `FITRON_SIGN_PFX_BASE64` | the `.pfx`, base64 |
| | secret | `FITRON_SIGN_PFX_PASSWORD` | its password |

### 2.4 Where updates are published

By default, this repository's GitHub Releases: every installed FITRON reads
`https://github.com/<owner>/<repo>/releases/latest/download/latest.json`, which GitHub serves from the newest
**published** release. The repository must stay public for gyms to download from it. To serve updates from FITRON's
own website instead, set `FITRON_UPDATE_URL` to its `…/latest.json` address and upload the release's three files there
by hand (`UPDATES.md`). The address is built into each release, so choose before the first one: changing it later
needs one release that still reads the old address.

Releases are built from `main`: make `main` the repository's default branch (Settings › General), so Actions offers it
first.

## 3. Building a signed release

For development and internal testing without a purchased certificate, a free self-signed test certificate can sign a
local build instead (`npm run desktop:build:test-signed`, `docs/WINDOWS-TEST-CODE-SIGNING.md`). It is not publicly
trusted, does not stop SmartScreen warnings, and is never used by the release workflow.

Raise `version` in `package.json` on `main` (each release needs a new one). Then Actions › **Desktop release (Windows)**
 › Run workflow, on `main`, with the release notes (`.github/workflows/desktop-release.yml`). It:

1. stops at once, naming each missing setting, if anything in §2.3 is not set, if it was started on another branch, or
   if the version already has a release;
2. with a certificate: connects the signing service, so FITRON's certificate appears in the runner's Windows store while its key stays in
   the service, and makes **one test signature**, checked as Windows sees it, so a wrong setting fails within minutes;
3. builds with `tauri.bundle.conf.json` (the packaged server), `tauri.release.conf.json` (signed update files) and
   `tauri.sign.conf.json`, which runs `fitron-sign.cmd` on every file: the program, the bundled runtime, the
   installer and the uninstaller, SHA-256 with an RFC 3161 timestamp;
4. **checks the signatures as Windows sees them** (`npm run desktop:signature`). Without a certificate it reports the
   files as not signed. With one (`-- --require`): the installer, the program and the bundled runtime each signed,
   valid, timestamped, by `FITRON_PUBLISHER` (the bundled Node.js runtime may instead keep the OpenJS Foundation's own
   signature), and anything else fails the release;
5. runs the same start, install, update, empty-PATH and uninstall tests as every build, on the signed files;
6. writes the update feed (`latest.json`) and puts the installer, its `.sha256` and the feed in a **draft** GitHub
   release `v<version>`, whose page tells a gym how to check and install it, and removes any signing setup from the
   runner.

A draft reaches no gym. On a computer with the certificate instead of the workflow, the same build by hand:

```
set FITRON_SIGN_THUMBPRINT=<certificate thumbprint>
set FITRON_UPDATE_URL=…  FITRON_UPDATE_PUBKEY=…  TAURI_SIGNING_PRIVATE_KEY=…  TAURI_SIGNING_PRIVATE_KEY_PASSWORD=…
npm run desktop:bundle
echo {"plugins":{"updater":{"pubkey":"%FITRON_UPDATE_PUBKEY%"}}} > updater-key.conf.json
npx tauri build --config src-tauri/tauri.bundle.conf.json --config src-tauri/tauri.release.conf.json --config updater-key.conf.json --config src-tauri/tauri.sign.conf.json
npm run desktop:installer
npm run desktop:signature -- --require
npm run desktop:release -- --notes-file RELEASE-NOTES.md
```

## 4. Checking the draft, then publishing

1. Download the installer from the draft release (Releases › the draft › Assets).
2. On a clean Windows 10 and a clean Windows 11 (no developer tools): check the installer's SHA-256 against the
   release page (`Get-FileHash` in PowerShell) and install it as a gym would. Without a certificate, SmartScreen warns
   and **More info › Run anyway** installs it; with one, right-click › Properties › Digital Signatures shows
   `FITRON_PUBLISHER` and installing shows it as the verified publisher. Run the acceptance steps
   (`e2e/local/acceptance.spec.ts` lists them).
3. From the second release on, also install the previous release first, publish the new one, and let FITRON update
   itself (within 12 hours, or at its next start a minute after opening).
4. Press **Publish release** on the draft. That is what sends the update: GitHub now serves its `latest.json` to every
   installed FITRON. Something wrong? Delete the draft, fix, raise the version, run again.

Never delete a published release: a gym that needs to go back installs the previous installer over the new one, and
its data stays.

## 5. What a customer then sees

- **Without a certificate** (FITRON's releases now): downloading and first running the installer shows "Windows
  protected your PC" and **Unknown publisher**. The gym checks the SHA-256 on the release page, then chooses More info ›
  Run anyway for that file. Updates afterwards install without that notice, checked against FITRON's update key.
- **With a certificate**: the installer, FITRON in Apps & features and its Start Menu entry show FITRON's legal name as
  the verified publisher. SmartScreen judges a download by the reputation of its signing certificate, so a new
  certificate may still show a notice for the first releases; it fades as gyms install it. An installer showing
  "Unknown publisher" is then not FITRON's.
- Either way, FITRON never tells a customer to turn SmartScreen, Defender or any other Windows protection off, and
  support never does it for them. An installer from anywhere but FITRON's release page, or whose SHA-256 does not
  match it, is not FITRON's: do not run it.
- Installing needs no administrator (per-user install, `INSTALLER.md`); the data folder is never in Program Files.

## 6. The download link for websites

**https://fitron.in/download/windows** always downloads the newest published installer. Use it for every "Download
for Windows" button, on fitron.in or any other website. It reads the same `latest.json` every installed FITRON reads
(`src/app/download/windows/route.ts`, `latestWindowsInstaller` in `src/lib/integrations/updates`), so it moves to a new
version the moment that release is published, and the button never needs changing. It only ever leads to an `.exe` on
the feed's own site. If the feed cannot be read, it opens the newest release's page instead. `FITRON_WINDOWS_FEED`
moves it, if `FITRON_UPDATE_URL` (§2.4) ever does.

## 7. Files

| File | What |
| --- | --- |
| `.github/workflows/desktop.yml` | every build: shell tests, packaged server, program, installer, clean PATH, signatures reported |
| `.github/workflows/desktop-release.yml` | a signed release, as a draft GitHub release |
| `src-tauri/tauri.sign.conf.json`, `scripts/desktop/fitron-sign.cmd` | Authenticode signing of every file |
| `scripts/desktop-signature.ts`, `src/lib/domain/authenticode.ts` | what Windows reports for each file, and whether a release may ship with it (`authenticode.test.ts`) |
| `src/app/download/windows/route.ts` | fitron.in's link to the newest installer (§6) |
| `scripts/desktop-release.ts`, `scripts/desktop/update-feed.ts` | the customer-named installer, its checksum and the update feed (on GitHub Releases, each installer named in its own release; `update-feed.test.ts`) |
