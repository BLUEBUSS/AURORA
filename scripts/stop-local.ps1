[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$pidFile = Join-Path $projectRoot '.runtime\frontend.pid'
$viteEntry = Join-Path $projectRoot 'node_modules\vite\bin\vite.js'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Host 'No AURORA frontend process recorded.'; return }
$savedPid = 0
if (-not [int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(),[ref]$savedPid)) { throw 'Invalid process record.' }
$ownerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$savedPid" -ErrorAction SilentlyContinue
if (-not $ownerProcess) { Write-Host 'AURORA frontend is already stopped.'; return }
if (-not $ownerProcess.CommandLine.Contains($viteEntry)) { throw 'Process identity does not match AURORA; no process was stopped.' }
$listener = @(Get-NetTCPConnection -State Listen -LocalPort 5174 -ErrorAction SilentlyContinue)
if ($listener.Count -gt 0 -and $listener[0].OwningProcess -ne $savedPid) { throw 'Port ownership differs; no process was stopped.' }
Stop-Process -Id $savedPid -ErrorAction Stop
Write-Host 'AURORA frontend stopped. The research backend was not changed.'
