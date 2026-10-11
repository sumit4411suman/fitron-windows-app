# Fitron WhatsApp connector on a Windows computer that stays on (the gym PC). Needs Docker Desktop running.
# Run from this folder:  powershell -ExecutionPolicy Bypass -File install-windows.ps1
# Safe to run again: it keeps an existing .env (and so every gym's WhatsApp link).
# Docker prints progress on stderr; Windows PowerShell 5.1 would treat that as an error under "Stop", so exit codes are
# checked by hand instead.
$ErrorActionPreference = "Continue"
Set-Location -Path $PSScriptRoot

function Say($text) { Write-Host ""; Write-Host $text -ForegroundColor Yellow }
function RandomHex($bytes) {
  $b = New-Object byte[] $bytes
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return (($b | ForEach-Object { $_.ToString("x2") }) -join "")
}
$EnvFile = Join-Path $PSScriptRoot ".env"
$ExampleFile = Join-Path $PSScriptRoot ".env.example"
function EnvValue($name) {
  foreach ($line in [IO.File]::ReadAllLines($EnvFile)) {
    if ($line.StartsWith("$name=")) { return $line.Substring($name.Length + 1).Trim('"') }
  }
  return ""
}

cmd /c "docker info >nul 2>&1"
if ($LASTEXITCODE -ne 0) {
  Say "Docker Desktop is not running."
  Write-Host "Install it from https://www.docker.com/products/docker-desktop/ , open it, wait until it says 'Engine running', then run this again."
  exit 1
}

if (-not (Test-Path $EnvFile)) {
  Say "Creating the settings file (.env) with new secret keys..."
  $db = RandomHex 24
  $values = @{
    "WA_CONNECTOR_MASTER_KEY" = (RandomHex 32)
    "SESSION_ENCRYPTION_KEY"  = (RandomHex 32)
    # Not used on a gym PC (no nginx), but docker-compose.yml requires a value.
    "DOMAIN"                  = "localhost"
    "PUBLIC_URL"              = "http://localhost:3000"
  }
  $out = foreach ($line in [IO.File]::ReadAllLines($ExampleFile)) {
    $line = $line.Replace("CHANGE_ME_DB_PASSWORD", $db)
    $key = ($line -split "=", 2)[0]
    if ($values.ContainsKey($key)) { "$key=$($values[$key])" } else { $line }
  }
  # UTF-8 without a byte-order mark, LF line endings: what docker compose reads cleanly.
  [IO.File]::WriteAllText($EnvFile, (($out -join "`n") + "`n"), (New-Object Text.UTF8Encoding $false))
  Write-Host "Saved .env. Keep this file: it unlocks the WhatsApp logins."
}

Say "Building and starting the connector (10-20 minutes the first time)..."
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build app worker postgres redis
if ($LASTEXITCODE -ne 0) { Say "Docker could not start the connector. Send the text above to whoever helps you."; exit 1 }

Say "Waiting for it to answer..."
$health = $null
for ($i = 0; $i -lt 60; $i++) {
  try {
    $health = Invoke-RestMethod -TimeoutSec 5 -Uri "http://127.0.0.1:3000/health"
    break
  } catch { }
  Start-Sleep -Seconds 5
}
if ($null -eq $health) { Say "The connector did not answer on http://127.0.0.1:3000/health. Run: docker compose logs app worker"; exit 1 }
Write-Host "Health: $($health.status)"

Say "The connector is running on this computer."
Write-Host "Next: give it a public address with Tailscale Funnel (free):"
Write-Host "  1. Install Tailscale from https://tailscale.com/download/windows and sign in."
Write-Host "  2. In PowerShell run:   tailscale funnel --bg 3000"
Write-Host "     (the first time it prints a link to switch Funnel on: open it, approve, run the command again)"
Write-Host "  3. It shows an address like https://your-pc.tail1234.ts.net"
Write-Host ""
Write-Host "Then in Vercel (Fitron project > Settings > Environment Variables, Production) add:"
Write-Host "  WA_CONNECTOR_URL = (the https://....ts.net address from step 3)"
Write-Host "  WA_CONNECTOR_KEY = $(EnvValue 'WA_CONNECTOR_MASTER_KEY')"
Write-Host "and Redeploy. Keep the key secret: it is the connector's admin key."
