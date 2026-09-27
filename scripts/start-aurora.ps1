[CmdletBinding()]
param([switch]$NoBrowser, [switch]$Quiet)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$entry = Join-Path $projectRoot 'dist-runtime\main.mjs'
$runtimeDir = Join-Path $projectRoot '.runtime'
$url = 'http://127.0.0.1:5174/'
$mutex = New-Object Threading.Mutex($false, 'Local\AuroraDesktopLauncher5174')
$locked = $false

function Get-AuroraListener {
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 5174 -ErrorAction SilentlyContinue)
  if ($listeners.Count -eq 0) { return $null }
  foreach ($listener in $listeners) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    # Only adopt the exact independent runtime entry. Never terminate a port occupant.
    $entryPattern = '(?i)(?:"' + [regex]::Escape($entry) + '"|(?<=\s)' + [regex]::Escape($entry) + '(?=\s|$))'
    if (-not $owner -or $owner.Name -ne 'node.exe' -or $owner.CommandLine -notmatch $entryPattern -or $listener.LocalAddress -ne '127.0.0.1') {
      throw 'Port 5174 belongs to another service. Close it before launching AURORA. No process was stopped.'
    }
  }
  return $owner
}

try {
  try { $locked = $mutex.WaitOne(45000) } catch [Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { throw 'Another AURORA launch is still in progress. Try again shortly.' }
  if (-not (Test-Path -LiteralPath $entry) -or -not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist\index.html'))) {
    throw 'AURORA build is missing. Run pnpm install --frozen-lockfile and pnpm build in the project folder.'
  }
  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
  $owner = Get-AuroraListener
  if (-not $owner) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $nodePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:ProgramFiles 'nodejs\node.exe' }
    if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js 22.13 or newer is required.' }
    $process = Start-Process -FilePath $nodePath -ArgumentList @(('"' + $entry + '"'), '--port', '5174') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir 'aurora.out.log') -RedirectStandardError (Join-Path $runtimeDir 'aurora.err.log') -PassThru
    @{ pid = $process.Id; createdAt = $process.StartTime.ToUniversalTime().ToString('o'); entry = $entry; port = 5174 } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDir 'independent-runtime.json') -Encoding UTF8
  }
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
      $health = Invoke-RestMethod -Uri ($url + 'healthz') -TimeoutSec 2
      if ($health.ok -and $health.service -eq 'aurora-runtime' -and $health.researchReady) {
        $owner = Get-AuroraListener
        if ($owner) { $ready = $true; break }
      }
    } catch { }
    if ($process) { $process.Refresh(); if ($process.HasExited) { break } }
    Start-Sleep -Milliseconds 400
  }
  if (-not $ready) { throw "AURORA did not become ready. See $runtimeDir\aurora.err.log" }
  if (-not $NoBrowser) { Start-Process $url | Out-Null }
  Write-Output "AURORA ready: $url (PID $($owner.ProcessId))"
} catch {
  if ($Quiet) {
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'AURORA could not start', 'OK', 'Error') | Out-Null
  } else { Write-Error $_ }
  exit 1
} finally {
  if ($locked) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
