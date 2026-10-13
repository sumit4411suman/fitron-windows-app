<#
.SYNOPSIS
  Checks the Authenticode signature of FITRON's Windows files as Windows sees them. docs/WINDOWS-TEST-CODE-SIGNING.md.

.DESCRIPTION
  For each file it prints the signature status, the signer, the certificate thumbprint and the timestamp, and says which
  of these it is:

    TRUSTED     signed, intact, and the signer's certificate chains to a root this computer trusts (a publicly trusted
                certificate, or a test certificate this machine was told to trust)
    UNTRUSTED   signed and intact (not changed since signing), but the signer is not trusted here: what a self-signed test
                certificate gives on any computer that has not been told to trust it
    INVALID     signed, but the file was changed after signing, the signature is broken, or the certificate is unusable
    NOT SIGNED  no signature at all

  A valid signature shows the file is unchanged since it was signed, and by which certificate. It does not make the
  publisher trusted: only a certificate from a publicly trusted authority (or a trust decision made on that computer)
  does that, and SmartScreen judges reputation separately.

  Exit code: 0 when every file is TRUSTED or UNTRUSTED (1 with -RequireTrusted when any is UNTRUSTED); 1 when any file is
  INVALID, NOT SIGNED or missing, or signed by another certificate than -ExpectedThumbprint.

.PARAMETER Path
  One or more files (.exe, .dll, .msi).

.PARAMETER ExpectedThumbprint
  The thumbprint the signer's certificate must have.

.PARAMETER RequireTrusted
  Also fail when a signature is intact but its signer is not trusted on this computer.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify-fitron-signature.ps1 -Path dist\desktop\FITRON-Gym-Accounting-Setup-0.1.1.exe
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string[]]$Path,
  [string]$ExpectedThumbprint = "",
  [switch]$RequireTrusted
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Windows PowerShell started from PowerShell 7 (a CI step, the build) inherits a module path it cannot load the security
# cmdlets from: load them from this PowerShell's own folder.
Import-Module (Join-Path $PSHOME "Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1") -ErrorAction SilentlyContinue

if ([System.Environment]::OSVersion.Platform -ne "Win32NT") { Write-Host "ERROR: signatures are checked on Windows." -ForegroundColor Red; exit 1 }

$expected = ($ExpectedThumbprint -replace '\s', '').ToUpperInvariant()
if ($expected -and $expected -notmatch '^[0-9A-F]{40}$') { Write-Host "ERROR: -ExpectedThumbprint must be 40 hexadecimal characters." -ForegroundColor Red; exit 1 }

# Why the signer is not trusted, from the certificate chain (revocation is not checked: a self-signed certificate has none).
function Chain-Problems($cert) {
  $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
  $chain.ChainPolicy.RevocationMode = [System.Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
  [void]$chain.Build($cert)
  $flags = @(@($chain.ChainStatus) | ForEach-Object { [string]$_.Status } | Sort-Object -Unique)
  $chain.Reset()
  return , $flags
}

$worst = 0
foreach ($p in $Path) {
  Write-Host ""
  Write-Host "File: $p"
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) {
    Write-Host "  Result     : MISSING (no such file)" -ForegroundColor Red
    $worst = 1
    continue
  }
  $sig = Get-AuthenticodeSignature -LiteralPath $p
  $status = [string]$sig.Status
  $signer = $sig.SignerCertificate
  Write-Host "  Status     : $status"
  if ($signer) {
    Write-Host "  Signer     : $($signer.Subject)"
    Write-Host "  Thumbprint : $($signer.Thumbprint)"
    Write-Host "  Issuer     : $($signer.Issuer)$(if ($signer.Subject -eq $signer.Issuer) { ' (self-signed)' })"
  }
  Write-Host "  Timestamp  : $(if ($sig.TimeStamperCertificate) { $sig.TimeStamperCertificate.Subject } else { 'none' })"

  $result = "INVALID"
  $why = $sig.StatusMessage
  if ($status -eq "NotSigned" -or -not $signer) {
    $result = "NOT SIGNED"
  } elseif ($status -eq "Valid") {
    $result = "TRUSTED"
  } elseif ($status -eq "UnknownError") {
    # Windows could check the signature but did not trust where the certificate leads. The signature is intact when the
    # chain's only problem is an untrusted root (a self-signed certificate nobody here was told to trust).
    $problems = @(Chain-Problems $signer)
    if ($problems.Count -gt 0 -and @($problems | Where-Object { $_ -ne "UntrustedRoot" }).Count -eq 0) {
      $result = "UNTRUSTED"
      $why = "The file is intact and signed by this certificate, but the certificate is not trusted on this computer (untrusted root)."
    } else {
      $why = "$($sig.StatusMessage) Chain: $($problems -join ', ')"
    }
  }

  if ($expected -and $signer -and $signer.Thumbprint.ToUpperInvariant() -ne $expected) {
    $result = "INVALID"
    $why = "Signed by $($signer.Thumbprint), not by the expected certificate $expected."
  }

  switch ($result) {
    "TRUSTED" { Write-Host "  Result     : TRUSTED (valid signature, publisher trusted on this computer)" -ForegroundColor Green }
    "UNTRUSTED" {
      Write-Host "  Result     : UNTRUSTED (valid, intact signature by a certificate this computer does not trust)" -ForegroundColor Yellow
      Write-Host "               $why"
      if ($RequireTrusted) { $worst = [Math]::Max($worst, 1) }
    }
    default {
      Write-Host "  Result     : $result" -ForegroundColor Red
      if ($why) { Write-Host "               $why" }
      $worst = 1
    }
  }
}

Write-Host ""
Write-Host "Note: a valid signature shows the file is unchanged since signing and which certificate signed it. It does not"
Write-Host "make the publisher publicly trusted, and it does not stop SmartScreen warnings on other computers."
exit $worst
