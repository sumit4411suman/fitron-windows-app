@echo off
rem FITRON Gym Accounting: Authenticode signing of the program and installer (Phase 19, SECURITY.md; finished in Phase 25).
rem Tauri runs this for every file to sign, with the file as %1, when the release build adds src-tauri/tauri.sign.conf.json.
rem Set FITRON_SIGN_THUMBPRINT to the SHA-1 thumbprint of FITRON's code-signing certificate in a Windows certificate
rem store. A cloud signing service (SSL.com eSigner, DigiCert KeyLocker) or a hardware token presents its certificate
rem there through its own key storage provider; the release workflow sets this up (docs/local-windows/RELEASE.md).
rem FITRON_SIGN_TIMESTAMP_URL picks the RFC 3161 timestamp server (DigiCert's by default; any works with any certificate).
rem Never put a certificate's private key or password in the repository.
if "%FITRON_SIGN_THUMBPRINT%"=="" (
  echo FITRON_SIGN_THUMBPRINT is not set: the build is not signed. 1>&2
  exit /b 1
)
set "FITRON_TSA=%FITRON_SIGN_TIMESTAMP_URL%"
if "%FITRON_TSA%"=="" set "FITRON_TSA=http://timestamp.digicert.com"
signtool sign /sha1 %FITRON_SIGN_THUMBPRINT% /fd SHA256 /td SHA256 /tr %FITRON_TSA% /d "FITRON Gym Accounting" %1
