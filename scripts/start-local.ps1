[CmdletBinding()]
param([switch]$NoBrowser,[switch]$FrontendOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$runtimeDir = Join-Path $projectRoot '.runtime'
$pidFile = Join-Path $runtimeDir 'frontend.pid'
$viteEntry = Join-Path $projectRoot 'node_modules\vite\bin\vite.js'
$url = 'http://127.0.0.1:5174/'
if (-not (Test-Path -LiteralPath $viteEntry)) { throw 'Dependencies missing. Run pnpm install --frozen-lockfile first.' }
if (-not $FrontendOnly) { & (Join-Path $PSScriptRoot 'start-backend.ps1') }
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$listener = @(Get-NetTCPConnection -State Listen -LocalPort 5174 -ErrorAction SilentlyContinue)
if ($listener.Count -gt 0) {
  $ownerPid = $listener[0].OwningProcess
  $ownerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerPid"
  $savedPid = if (Test-Path -LiteralPath $pidFile) { (Get-Content -LiteralPath $pidFile -Raw).Trim() } else { '' }
  if ($savedPid -ne [string]$ownerPid -or -not $ownerProcess.CommandLine.Contains($viteEntry)) {
    throw 'Port 5174 is occupied by another process. Close that frontend before starting AURORA.'
  }
  Write-Host "AURORA is already running: $url"
} else {
  $nodePath = (Get-Command node -ErrorAction Stop).Source
  $process = Start-Process -FilePath $nodePath -ArgumentList @(('"' + $viteEntry + '"'), '--host', '127.0.0.1', '--port', '5174', '--strictPort') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir 'frontend.out.log') -RedirectStandardError (Join-Path $runtimeDir 'frontend.err.log') -PassThru
  $process.Id | Set-Content -LiteralPath $pidFile
  $ready = $false
  for ($attempt=0; $attempt -lt 30; $attempt++) {
    try { $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2; if ($response.StatusCode -eq 200) { $ready=$true; break } } catch { Start-Sleep -Milliseconds 300 }
  }
  if (-not $ready) { throw "AURORA did not start. Inspect logs in $runtimeDir" }
  Write-Host "AURORA is ready: $url"
}
if (-not $NoBrowser) { Start-Process $url -WindowStyle Hidden | Out-Null }
