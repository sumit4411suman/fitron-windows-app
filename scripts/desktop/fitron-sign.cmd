@echo off
rem FITRON Gym Accounting: Authenticode signing of the program and installer (Phase 19, SECURITY.md; finished in Phase 25).
rem Tauri runs this for every file to sign, with the file as %1, when the release build adds src-tauri/tauri.sign.conf.json.
rem Set FITRON_SIGN_THUMBPRINT to the SHA-1 thumbprint of FITRON's code-signing certificate in the current user's store
rem (a hardware token or a cloud HSM presents its certificate there), or replace this file with the signing service's own
rem command. Never put a certificate's private key or password in the repository.
if "%FITRON_SIGN_THUMBPRINT%"=="" (
  echo FITRON_SIGN_THUMBPRINT is not set: the build is not signed. 1>&2
  exit /b 1
)
signtool sign /sha1 %FITRON_SIGN_THUMBPRINT% /fd SHA256 /td SHA256 /tr http://timestamp.digicert.com /d "FITRON Gym Accounting" %1
