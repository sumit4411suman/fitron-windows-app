<#
.SYNOPSIS
  Signs FITRON's Windows files (the program, the installer) with Authenticode, SHA-256, using a certificate in a Windows
  certificate store, then checks the signature. docs/WINDOWS-TEST-CODE-SIGNING.md.

.DESCRIPTION
  Made for the free self-signed test certificate (scripts/create-fitron-test-certificate.ps1), and works with any
  code-signing certificate whose private key this Windows user can use. It:

    1. finds SignTool (Windows SDK), or says how to install it;
    2. checks the certificate: present, within its validity dates, for code signing, private key usable;
    3. signs each file with SHA-256, with an RFC 3161 timestamp when a timestamp service is given;
    4. checks the result with scripts/verify-fitron-signature.ps1 and fails unless the signature is intact and made by
       this certificate.

  Tauri runs it for every file it signs when the build adds src-tauri/tauri.test-sign.conf.json
  (npm run desktop:build:test-signed). Production releases keep their own signing (fitron-sign.cmd, desktop-release.yml).

  It changes nothing about what Windows trusts: no store, registry, SmartScreen or Defender setting is touched.

.PARAMETER Path
  The file(s) to sign: .exe, .dll or .msi.

.PARAMETER Thumbprint
  The certificate's SHA-1 thumbprint. Default: FITRON_TEST_SIGN_THUMBPRINT from the environment.

.PARAMETER TimestampUrl
  An RFC 3161 timestamp service (http or https). Default: FITRON_SIGN_TIMESTAMP_URL from the environment; none if unset
  (the signature then stops being verifiable once the certificate expires).

.PARAMETER SignToolPath
  SignTool's full path, when it is not on PATH or in the Windows SDK's usual folder.

.PARAMETER Description
  The description Windows shows for the signed file. Default: FITRON Gym Accounting.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\sign-fitron-windows.ps1 -Path dist\desktop\FITRON-Gym-Accounting-Setup-0.1.1.exe -Thumbprint <40-character thumbprint>
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string[]]$Path,
  [string]$Thumbprint = $env:FITRON_TEST_SIGN_THUMBPRINT,
  [string]$TimestampUrl = $env:FITRON_SIGN_TIMESTAMP_URL,
  [string]$SignToolPath = "",
  [string]$Description = "FITRON Gym Accounting"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Windows PowerShell started from PowerShell 7 (a CI step, the build) inherits a module path it cannot load the security
# cmdlets from: load them from this PowerShell's own folder.
Import-Module (Join-Path $PSHOME "Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1") -ErrorAction SilentlyContinue

$CodeSigningOid = "1.3.6.1.5.5.7.3.3"

function Fail([string]$message) {
  Write-Host "ERROR: $message" -ForegroundColor Red
  exit 1
}

if ([System.Environment]::OSVersion.Platform -ne "Win32NT") { Fail "Signing runs on Windows only." }

# The certificate
$thumb = ("$Thumbprint" -replace '\s', '').ToUpperInvariant()
if (-not $thumb) { Fail "No certificate given. Pass -Thumbprint, or set FITRON_TEST_SIGN_THUMBPRINT (scripts\create-fitron-test-certificate.ps1 prints it)." }
if ($thumb -notmatch '^[0-9A-F]{40}$') { Fail "The thumbprint must be 40 hexadecimal characters (a SHA-1 thumbprint): '$Thumbprint'." }

$cert = $null
$machineStore = $false
foreach ($store in @("Cert:\CurrentUser\My", "Cert:\LocalMachine\My")) {
  $found = Get-ChildItem $store | Where-Object { $_.Thumbprint -eq $thumb } | Select-Object -First 1
  if ($found) { $cert = $found; $machineStore = $store -like "*LocalMachine*"; break }
}
if (-not $cert) { Fail "No certificate with thumbprint $thumb in this user's or this computer's personal store (Cert:\CurrentUser\My, Cert:\LocalMachine\My)." }

$now = Get-Date
if ($cert.NotBefore -gt $now) { Fail "The certificate $thumb is not valid until $($cert.NotBefore)." }
if ($cert.NotAfter -le $now) { Fail "The certificate $thumb expired on $($cert.NotAfter). Make a new one (scripts\create-fitron-test-certificate.ps1 -Force)." }
if (-not ($cert.EnhancedKeyUsageList | Where-Object { $_.ObjectId -eq $CodeSigningOid })) { Fail "The certificate $thumb is not for code signing (no Code Signing extended key usage)." }
if (-not $cert.HasPrivateKey) { Fail "The certificate $thumb has no private key here, so it cannot sign." }
try {
  $key = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
  if (-not $key) { $key = [System.Security.Cryptography.X509Certificates.ECDsaCertificateExtensions]::GetECDsaPrivateKey($cert) }
  if (-not $key) { throw "no RSA or ECDSA key" }
  $key.Dispose()
} catch {
  Fail "The private key of certificate $thumb cannot be used by this Windows user: $($_.Exception.Message)"
}
if ($cert.Subject -eq $cert.Issuer) {
  Write-Host "Signing with a SELF-SIGNED certificate ($($cert.Subject)): for development and internal testing only. It is not" -ForegroundColor Yellow
  Write-Host "publicly trusted; Windows and SmartScreen still warn on other computers." -ForegroundColor Yellow
}

# The timestamp service, when given
$tsa = "$TimestampUrl".Trim()
if ($tsa) {
  $u = $null
  if (-not [System.Uri]::TryCreate($tsa, [System.UriKind]::Absolute, [ref]$u) -or ($u.Scheme -ne "http" -and $u.Scheme -ne "https")) { Fail "The timestamp URL must be an http or https address: '$tsa'." }
} else {
  Write-Host "No timestamp service set (FITRON_SIGN_TIMESTAMP_URL or -TimestampUrl): signing without a timestamp." -ForegroundColor Yellow
}

# SignTool
$signtool = $null
if ($SignToolPath) {
  if (-not (Test-Path -LiteralPath $SignToolPath -PathType Leaf)) { Fail "SignTool not found at $SignToolPath." }
  $signtool = $SignToolPath
} else {
  $onPath = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($onPath) { $signtool = $onPath.Source }
  else {
    $kits = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
    $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    $candidate = Get-ChildItem -Path $kits -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.Directory.Name -eq $arch } | Sort-Object FullName -Descending | Select-Object -First 1
    if ($candidate) { $signtool = $candidate.FullName }
  }
}
if (-not $signtool) {
  Fail "SignTool (signtool.exe) was not found. Install the Windows SDK's 'Windows SDK Signing Tools for Desktop Apps' (https://developer.microsoft.com/windows/downloads/windows-sdk/), or pass -SignToolPath."
}

# Sign, then check
$verify = Join-Path $PSScriptRoot "verify-fitron-signature.ps1"
foreach ($p in $Path) {
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { Fail "No such file: $p" }
  $file = (Resolve-Path -LiteralPath $p).Path
  if ([System.IO.Path]::GetExtension($file) -notin @(".exe", ".dll", ".msi")) { Fail "Only .exe, .dll and .msi files are signed here: $file" }

  $signArgs = @("sign", "/sha1", $thumb, "/s", "My", "/fd", "SHA256", "/d", $Description)
  if ($machineStore) { $signArgs += "/sm" }
  if ($tsa) { $signArgs += @("/tr", $tsa, "/td", "SHA256") }
  $signArgs += $file
  Write-Host ""
  Write-Host "Signing $file"
  & $signtool @signArgs
  if ($LASTEXITCODE -ne 0) { Fail "SignTool failed (exit $LASTEXITCODE) signing $file." }

  & $verify -Path $file -ExpectedThumbprint $thumb
  if ($LASTEXITCODE -ne 0) { Fail "The signature on $file did not verify (see above)." }
}

Write-Host ""
Write-Host "Signed and verified: $($Path.Count) file(s) with $($cert.Subject) ($thumb)." -ForegroundColor Green
exit 0
