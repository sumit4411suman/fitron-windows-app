# FITRON Local Windows Edition: releasing (Phase 25)

How a version of FITRON Gym Accounting for Windows goes from this repository to a gym's computer: what must pass
first, how it is built and signed, what is checked on the signed files, and how it is published. For FITRON only;
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

## 2. Signing: what FITRON needs once

- **A code-signing certificate** in FITRON's legal name, from a certificate authority Windows trusts. Since June
  2023 the private key must live on hardware (a USB token, or a cloud HSM such as Azure Key Vault, DigiCert KeyLocker
  or SSL.com eSigner). With a token or HSM, replace `scripts/desktop/fitron-sign.cmd` with the service's own sign
  command; it receives each file as `%1`. A `.pfx` file, where the authority still issues one, goes into the
  `release` environment's secrets (below).
- **The update key** (`UPDATES.md`): `npx tauri signer generate`. Its public half is built into every release; its
  private half signs each update, and is what lets FITRON, and only FITRON, publish one.

Neither is ever committed. Both live in the repository's **Settings › Environments › release**, protected so that only
the people allowed to release can run it:

| Kind | Name | What |
| --- | --- | --- |
| secret | `FITRON_SIGN_PFX_BASE64` | the certificate (.pfx), base64 (not needed with a token or HSM command) |
| secret | `FITRON_SIGN_PFX_PASSWORD` | its password |
| secret | `TAURI_SIGNING_PRIVATE_KEY` | the update key |
| secret | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password, if it has one |
| variable | `FITRON_UPDATE_URL` | where `latest.json` is published (https) |
| variable | `FITRON_UPDATE_PUBKEY` | the update key's public half |
| variable | `FITRON_PUBLISHER` | the publisher name on the certificate (default `FITRON`) |

## 3. Building a signed release

Actions › **Desktop release (Windows, signed)** › Run workflow, with the release notes
(`.github/workflows/desktop-release.yml`). It:

1. stops at once, naming what is missing, if the certificate, the update key or the update address is not set: a
   release is never built unsigned;
2. imports the certificate into the runner's own user store (removed again at the end, whatever happens) and puts the
   Windows SDK's `signtool` on the path;
3. builds with `tauri.bundle.conf.json` (the packaged server), `tauri.release.conf.json` (signed update files) and
   `tauri.sign.conf.json`, which runs `fitron-sign.cmd` on every file: the program, the bundled runtime, the
   installer and the uninstaller, SHA-256 with an RFC 3161 timestamp;
4. **checks the signatures as Windows sees them** (`npm run desktop:signature -- --require`): the installer, the
   program and the bundled runtime each signed,
   valid, timestamped, by `FITRON_PUBLISHER` (the bundled Node.js runtime may instead keep the OpenJS Foundation's own
   signature). Anything else fails the release;
5. runs the same start, install, update, empty-PATH and uninstall tests as every build, on the signed files;
6. writes the update feed (`latest.json`) and keeps the installer, its `.sha256` and the feed as the run's files.

On a computer with the certificate instead of the workflow, the same steps by hand:

```
set FITRON_SIGN_THUMBPRINT=<certificate thumbprint>
set FITRON_UPDATE_URL=…  FITRON_UPDATE_PUBKEY=…  TAURI_SIGNING_PRIVATE_KEY=…  TAURI_SIGNING_PRIVATE_KEY_PASSWORD=…
npm run desktop:bundle
npx tauri build --config src-tauri/tauri.bundle.conf.json --config src-tauri/tauri.release.conf.json --config src-tauri/tauri.sign.conf.json
npm run desktop:installer
npm run desktop:signature -- --require
npm run desktop:release -- --notes-file RELEASE-NOTES.md
```

## 4. What a customer then sees

- The installer, FITRON in Apps & features and its Start Menu entry show **FITRON** as the verified publisher.
- SmartScreen judges a download by the reputation of its signing certificate. A new certificate may still show a
  SmartScreen notice for the first releases while its reputation builds; it fades as gyms install it. FITRON never
  tells a customer to turn SmartScreen, Defender or any other Windows protection off, and support never does it for
  them. If a gym sees "Unknown publisher" on an installer said to be FITRON's, it is not FITRON's: they should not run
  it, and should download it again from FITRON.
- Installing needs no administrator (per-user install, `INSTALLER.md`); the data folder is never in Program Files.

## 5. Publishing

Upload the installer, its `.sha256` and `latest.json` to where `FITRON_UPDATE_URL` is served (https only); replacing
`latest.json` is what publishes the release to every installed FITRON (`UPDATES.md`). Keep the previous release's
files: a gym that needs to go back installs the previous installer over the new one, and its data stays.

The first signed release is checked by hand on a clean Windows 10 and a clean Windows 11 (no developer tools):
download the installer from the published address, check the publisher in the download and install prompts, install,
run the acceptance steps (`e2e/local/acceptance.spec.ts` lists them), then let the previous version update itself to
it.

## 6. Files

| File | What |
| --- | --- |
| `.github/workflows/desktop.yml` | every build: shell tests, packaged server, program, installer, clean PATH, signatures reported |
| `.github/workflows/desktop-release.yml` | a signed release |
| `src-tauri/tauri.sign.conf.json`, `scripts/desktop/fitron-sign.cmd` | Authenticode signing of every file |
| `scripts/desktop-signature.ts`, `src/lib/domain/authenticode.ts` | what Windows reports for each file, and whether a release may ship with it (`authenticode.test.ts`) |
| `scripts/desktop-release.ts`, `scripts/desktop/update-feed.ts` | the customer-named installer, its checksum and the update feed |
