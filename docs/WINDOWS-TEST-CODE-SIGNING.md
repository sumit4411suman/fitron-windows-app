# FITRON for Windows: free self-signed test code signing

Sign FITRON's Windows program and installer with a free, self-signed certificate, for development and internal testing,
and check the signatures.

> **What a self-signed certificate does not do.** It is not publicly trusted. Files signed with it are intact (nobody
> changed them after signing) and say which certificate signed them, but on any computer that was not told to trust that
> certificate Windows still reports an unknown publisher, **SmartScreen still warns, and "Windows protected your PC"
> still appears**. Distributing the certificate does not change that. Only a certificate from a publicly trusted
> authority (and, for SmartScreen, the reputation that builds up over downloads) or the Microsoft Store does. See
> [Production](#production-a-publicly-trusted-certificate).

Nothing here changes Windows' security settings: no SmartScreen, Defender or registry setting is touched, and no
certificate is added to Trusted Root or Trusted Publishers by any script.

## What is signed, and how

| File | Signed by |
| --- | --- |
| The program, `src-tauri\target\release\<name>.exe` | Tauri, through the signing hook |
| The bundled Node.js runtime, `fitron-node.exe` | Tauri, through the signing hook |
| The installer, and the uninstaller inside it | Tauri, through the signing hook |
| `dist\desktop\FITRON-Gym-Accounting-Setup-<version>.exe` | a copy of the signed installer (`npm run desktop:installer`) |

Tauri calls a signing command for every file it signs. Production releases use `src-tauri/tauri.sign.conf.json`
(`scripts\desktop\fitron-sign.cmd`). Test signing uses `src-tauri/tauri.test-sign.conf.json`, which runs
`scripts\sign-fitron-windows.ps1` instead, and **only when that config is added to the build** (opt-in). The update
files' own signatures (Tauri updater, minisign) are made after Authenticode signing, as before, and are unaffected.

| Script | Does |
| --- | --- |
| `scripts\create-fitron-test-certificate.ps1` | Makes (or reuses) `CN=FITRON Test Signing` in your own store, `Cert:\CurrentUser\My`: RSA 3072, SHA-256, code signing only, private key non-exportable. Exports the public certificate (`.cer`) only. |
| `scripts\sign-fitron-windows.ps1` | Finds SignTool, checks the certificate (present, in date, code signing, private key usable), signs with SHA-256 (+ timestamp if configured), then verifies. |
| `scripts\verify-fitron-signature.ps1` | Says, per file, TRUSTED / UNTRUSTED (intact, signer not trusted here) / INVALID / NOT SIGNED. Exit code 0 only for TRUSTED or UNTRUSTED (TRUSTED only with `-RequireTrusted`). |

## 1. Create the test certificate

On the Windows computer you build on, in **Windows PowerShell** (no administrator rights needed):

```powershell
cd C:\path\to\fitron-windows-app
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\create-fitron-test-certificate.ps1
```

(`-ExecutionPolicy Bypass` applies to that one PowerShell only; it changes no setting.)

It prints the certificate's **thumbprint**, validity dates and intended use (Code Signing), and writes
`fitron-test-signing.cer` (public certificate only; Git ignores it). Running it again reuses the same certificate while it
has more than 30 days left. Options: `-ValidityYears 1..5` (default 2), `-ExportPath`, `-Force` (make a new one).

## 2. Install SignTool (once)

Install the Windows SDK and, in its installer, tick **Windows SDK Signing Tools for Desktop Apps**:
https://developer.microsoft.com/windows/downloads/windows-sdk/. The signing script finds `signtool.exe` on PATH or in
`C:\Program Files (x86)\Windows Kits\10\bin\<version>\x64\`, or takes `-SignToolPath`.

## 3. Build FITRON, test-signed

Prerequisites as for any FITRON for Windows build (`docs/local-windows/DESKTOP.md`: Node.js 22, Rust, `npm ci`). Then:

```powershell
$env:FITRON_TEST_SIGN_THUMBPRINT = "<thumbprint from step 1>"
# Optional: an RFC 3161 timestamp service you have checked works, e.g. your certificate vendor's.
# $env:FITRON_SIGN_TIMESTAMP_URL = "http://timestamp.example.com"
npm run desktop:build:test-signed
```

Every file Tauri signs is signed and verified as it is built; the build stops at the first that fails. Without the
thumbprint the signing script stops with a clear message. `npm run desktop:build` (no test signing) is unchanged.

Without a timestamp, signatures stop verifying once the certificate expires; with one, they stay valid. No timestamp
service is assumed: set `FITRON_SIGN_TIMESTAMP_URL` (or `-TimestampUrl`) to one you trust.

## 4. Sign a single file (instead of, or after, a build)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\sign-fitron-windows.ps1 `
  -Path dist\desktop\FITRON-Gym-Accounting-Setup-0.1.1.exe -Thumbprint <thumbprint>
```

Several files at once, from a PowerShell prompt: `& .\scripts\sign-fitron-windows.ps1 -Path a.exe, b.exe -Thumbprint <thumbprint>`.

## 5. Verify

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify-fitron-signature.ps1 `
  -Path dist\desktop\FITRON-Gym-Accounting-Setup-0.1.1.exe -ExpectedThumbprint <thumbprint>
```

A test-signed file reads **UNTRUSTED (valid, intact signature by a certificate this computer does not trust)**: the
signature is good, the publisher is simply not trusted. A changed file reads **INVALID** (hash mismatch); an unsigned one
**NOT SIGNED**; both exit with 1. `npm run desktop:signature` reports the same files the way the release check does.

You can also look in Explorer: right-click the file › Properties › **Digital Signatures**.

## 6. Trusting the test certificate on a controlled test machine (optional, by hand)

To see a test-signed FITRON as "trusted" on a **test computer you control**, import `fitron-test-signing.cer` there into
**Current User › Trusted Root Certification Authorities** (and, for some checks, Trusted Publishers): double-click the
`.cer` › Install Certificate › Current User › Place all certificates in › Trusted Root Certification Authorities.

Do this only on machines you own and test with, and remove it afterwards. A trusted root can vouch for anything signed
with its key: never ask a gym, a customer or anyone else to install it, and never install it machine-wide. Even then,
SmartScreen judges downloaded files by reputation and may still warn.

To remove it from a test machine: `certmgr.msc` › Trusted Root Certification Authorities › Certificates › FITRON Test
Signing › Delete (and the same under Trusted Publishers, if you added it there).

## 7. Remove the test certificate from your store

```powershell
Get-ChildItem Cert:\CurrentUser\My | Where-Object Subject -eq "CN=FITRON Test Signing"
Remove-Item Cert:\CurrentUser\My\<thumbprint> -DeleteKey
```

`-DeleteKey` deletes its private key too. Files already signed keep their signature.

## How it is tested

Every Windows build (`.github/workflows/desktop.yml`) makes a throwaway `CN=FITRON Test Signing (CI throwaway)`
certificate in the runner's own user store, then, on **copies** of that build's real installer and program: signs them,
verifies them (UNTRUSTED, intact, by that certificate), checks that `-RequireTrusted` refuses them, that a copy with one
changed byte is INVALID and that an unsigned copy is NOT SIGNED, and removes the certificate. The installer the build
keeps is not signed by it. **Run workflow › test_sign** builds with `tauri.test-sign.conf.json` instead, so Tauri signs
every file through the hook, and verifies all of them. The runner never trusts the certificate.

## Production: a publicly trusted certificate

Gyms should get installers signed with a publicly trusted **OV code-signing certificate** in FITRON's legal name (from
SSL.com, Sectigo, DigiCert, …; since 2023 the key is held in a hardware token or a cloud signing service). The release
workflow already supports them (`docs/local-windows/RELEASE.md`):

1. Buy the certificate and complete the vendor's business verification.
2. Prefer a cloud signing service the workflow knows: SSL.com **eSigner** (`FITRON_SIGN_PROVIDER=esigner`) or DigiCert
   **KeyLocker** (`keylocker`); or a `.pfx` (`pfx`) only if your vendor allows exporting it.
3. In GitHub › Settings › Environments › `release`, set `FITRON_SIGN_PROVIDER` and the secrets RELEASE.md lists for it,
   and `FITRON_PUBLISHER` to the certificate's organisation name. Never put them in the repository.
4. Run **Desktop release (Windows)**. It makes a test signature first, signs every file through
   `tauri.sign.conf.json`, and fails unless every file is signed by `FITRON_PUBLISHER`, valid and timestamped.

The test certificate and `tauri.test-sign.conf.json` are never used by the release workflow. With a trusted certificate
Windows names FITRON as the publisher; SmartScreen may still warn for new releases until they build reputation. The
Microsoft Store is the way to install with no such warning at all.
