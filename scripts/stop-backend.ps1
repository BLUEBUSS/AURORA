[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$recordPath = Join-Path $projectRoot '.runtime\backend.json'
if (-not (Test-Path -LiteralPath $recordPath)) { Write-Host 'No AURORA backend process is recorded.'; return }
$saved = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
$savedPid = 0
if (-not [int]::TryParse([string]$saved.pid, [ref]$savedPid) -or $savedPid -lt 1) { throw 'Invalid backend process record.' }
$owner = Get-CimInstance Win32_Process -Filter "ProcessId=$savedPid" -ErrorAction SilentlyContinue
if (-not $owner) { Write-Host 'Recorded backend process has already stopped.'; return }
if (-not $owner.CommandLine.Contains([string]$saved.entry) -or $owner.CommandLine -notmatch '\bgateway\s+run\b' -or $owner.CreationDate.ToUniversalTime().ToString('o') -ne $saved.createdAt) {
  throw 'Backend process identity differs from the recorded launch. Nothing was stopped.'
}
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort ([int]$saved.port) -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0 -and $listeners[0].OwningProcess -ne $savedPid) { throw 'Port ownership differs from the backend record. Nothing was stopped.' }
Stop-Process -Id $savedPid -ErrorAction Stop
Write-Host 'AURORA-managed research backend stopped. Frontend and configuration were not changed.'
