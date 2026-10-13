<#
.SYNOPSIS
  Creates (or reuses) a free, self-signed code-signing certificate for signing FITRON for Windows in development and
  internal testing. docs/WINDOWS-TEST-CODE-SIGNING.md.

.DESCRIPTION
  The certificate is made in the current Windows user's own store (Cert:\CurrentUser\My) with New-SelfSignedCertificate
  -Type CodeSigningCert: RSA 3072, SHA-256, a non-exportable private key that never leaves this computer's store. Only the
  public certificate is exported, as a .cer file, so a controlled test machine can be told to trust it by hand.

  A self-signed certificate is NOT publicly trusted. Files signed with it are intact and attributable to it, but Windows
  does not trust it, SmartScreen still warns, and "Windows protected your PC" still appears on other computers. This
  script never adds the certificate to Trusted Root or Trusted Publishers, on this computer or any other.

  Run it again: a valid certificate with the same subject (and at least 30 days left) is reused, not duplicated.

.PARAMETER Subject
  The certificate's subject. Must start with "CN=" and say it is a test certificate. Default: CN=FITRON Test Signing.

.PARAMETER ValidityYears
  How long the certificate is valid, 1 to 5 years. Default: 2.

.PARAMETER ExportPath
  Where to write the public certificate (.cer). Default: fitron-test-signing.cer in the current folder (ignored by Git).

.PARAMETER Force
  Make a new certificate even if a valid one exists. The old one is kept; remove it as the documentation shows.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\create-fitron-test-certificate.ps1
#>
[CmdletBinding()]
param(
  [ValidatePattern('^CN=.*[Tt]est')]
  [string]$Subject = "CN=FITRON Test Signing",
  [ValidateRange(1, 5)]
  [int]$ValidityYears = 2,
  [string]$ExportPath = (Join-Path (Get-Location) "fitron-test-signing.cer"),
  [switch]$Force
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

function Show-Certificate($cert, [string]$heading) {
  $eku = ($cert.EnhancedKeyUsageList | ForEach-Object { "$($_.FriendlyName) ($($_.ObjectId))" }) -join ", "
  Write-Host ""
  Write-Host $heading -ForegroundColor Green
  Write-Host "  Subject      : $($cert.Subject)"
  Write-Host "  Thumbprint   : $($cert.Thumbprint)"
  Write-Host "  Valid from   : $($cert.NotBefore.ToString('yyyy-MM-dd HH:mm'))"
  Write-Host "  Valid until  : $($cert.NotAfter.ToString('yyyy-MM-dd HH:mm'))"
  Write-Host "  Intended use : $eku"
  Write-Host "  Signature    : $($cert.SignatureAlgorithm.FriendlyName)"
  Write-Host "  Store        : Cert:\CurrentUser\My"
}

if ([System.Environment]::OSVersion.Platform -ne "Win32NT") { Fail "This script runs on Windows only." }
$pki = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\Modules\PKI\PKI.psd1"
if (Test-Path -LiteralPath $pki) {
  try {
    # -SkipEditionCheck exists only in PowerShell 7, where the PKI module is otherwise refused.
    if ($PSVersionTable.PSEdition -eq "Core") { Import-Module $pki -SkipEditionCheck } else { Import-Module $pki }
  } catch {
    Write-Verbose "PKI module: $($_.Exception.Message)"
  }
}
if (-not (Get-Command New-SelfSignedCertificate -ErrorAction SilentlyContinue)) {
  Fail "New-SelfSignedCertificate is not available. Run this in Windows PowerShell (powershell.exe) on Windows 10 or later."
}

$exportFull = [System.IO.Path]::GetFullPath($ExportPath)
if ([System.IO.Path]::GetExtension($exportFull) -ne ".cer") { Fail "ExportPath must end in .cer (only the public certificate is exported): $exportFull" }

# A valid one already: reuse it, so running this twice does not fill the store with copies.
$now = Get-Date
$existing = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
  Where-Object { $_.Subject -eq $Subject -and $_.HasPrivateKey -and $_.NotBefore -le $now -and $_.NotAfter -gt $now.AddDays(30) } |
  Sort-Object NotAfter -Descending | Select-Object -First 1

if ($existing -and -not $Force) {
  $cert = $existing
  Show-Certificate $cert "Using the existing test certificate (run with -Force to make a new one):"
} else {
  try {
    $cert = New-SelfSignedCertificate `
      -Type CodeSigningCert `
      -Subject $Subject `
      -FriendlyName "FITRON test signing (self-signed, not publicly trusted)" `
      -CertStoreLocation Cert:\CurrentUser\My `
      -KeyAlgorithm RSA -KeyLength 3072 `
      -HashAlgorithm SHA256 `
      -KeyUsage DigitalSignature `
      -KeyExportPolicy NonExportable `
      -NotAfter $now.AddYears($ValidityYears)
  } catch {
    Fail "Could not create the certificate: $($_.Exception.Message)"
  }
  Show-Certificate $cert "Created a new self-signed test certificate:"
}

if (-not ($cert.EnhancedKeyUsageList | Where-Object { $_.ObjectId -eq $CodeSigningOid })) { Fail "The certificate $($cert.Thumbprint) is not for code signing." }
if (-not $cert.HasPrivateKey) { Fail "The certificate $($cert.Thumbprint) has no private key in this store." }

# Only the public half leaves the store. The private key is non-exportable and is never written anywhere.
try {
  $dir = Split-Path -Parent $exportFull
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  Export-Certificate -Cert $cert -FilePath $exportFull -Type CERT -Force | Out-Null
} catch {
  Fail "Could not export the public certificate to ${exportFull}: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "Public certificate (no private key): $exportFull"
Write-Host ""
Write-Host "To sign with it:" -ForegroundColor Cyan
Write-Host "  `$env:FITRON_TEST_SIGN_THUMBPRINT = `"$($cert.Thumbprint)`""
Write-Host "  npm run desktop:build:test-signed"
Write-Host ""
Write-Host "This certificate is NOT publicly trusted. Windows and SmartScreen will still warn on other computers." -ForegroundColor Yellow
Write-Host "It was not added to Trusted Root or Trusted Publishers. Trust it only on controlled test machines, by hand"
Write-Host "(docs/WINDOWS-TEST-CODE-SIGNING.md)."
exit 0
