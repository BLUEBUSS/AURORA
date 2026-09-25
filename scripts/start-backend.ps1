[CmdletBinding()]
param(
  [string]$SourceRoot = '',
  [string]$RuntimeRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Antlyst\dev'),
  [ValidateRange(10, 600)][int]$TimeoutSeconds = 300
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
if (-not $SourceRoot) { $SourceRoot = Join-Path (Split-Path -Parent $projectRoot) 'ANTLYST' }
$sourcePath = [IO.Path]::GetFullPath($SourceRoot)
$runtimePath = [IO.Path]::GetFullPath($RuntimeRoot)
$configPath = Join-Path $runtimePath 'openclaw.json'
$entryPath = Join-Path $sourcePath 'dist\entry.js'
$trackingDir = Join-Path $projectRoot '.runtime'
$recordPath = Join-Path $trackingDir 'backend.json'
$port = 18789
foreach ($requiredPath in @($entryPath, $configPath, (Join-Path $sourcePath 'extensions\fin-core\index.js'))) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) { throw "Required existing backend file is missing: $requiredPath" }
}
$configText = Get-Content -LiteralPath $configPath -Raw
$config = $configText | ConvertFrom-Json
if ($config.gateway.mode -ne 'local' -or $config.gateway.bind -ne 'loopback' -or $config.gateway.port -ne $port) {
  throw 'Existing gateway configuration does not match local/loopback/18789. No configuration was changed.'
}
if ($config.gateway.auth.mode -notin @('token', 'password', 'trusted-proxy')) {
  throw 'Existing gateway authentication is not enabled. No authentication settings were changed.'
}
$beforeHash = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash
$listener = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
if ($listener.Count -gt 0) {
  if (-not (Test-Path -LiteralPath $recordPath)) { throw 'Port 18789 already has a listener not tracked by AURORA. Nothing was stopped.' }
  $saved = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener[0].OwningProcess)"
  if ($saved.pid -ne $listener[0].OwningProcess -or -not $owner.CommandLine.Contains($entryPath)) {
    throw 'Port 18789 ownership differs from the AURORA process record. Nothing was stopped.'
  }
  Write-Host "Research backend already running on 127.0.0.1:$port (PID $($saved.pid))."
  return
}
if (Test-Path -LiteralPath $recordPath) {
  $saved = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
  $initializing = Get-CimInstance Win32_Process -Filter "ProcessId=$($saved.pid)" -ErrorAction SilentlyContinue
  if ($initializing -and $initializing.CommandLine.Contains($entryPath) -and $initializing.CreationDate.ToUniversalTime().ToString('o') -eq $saved.createdAt) {
    [pscustomobject]@{ status='initializing'; pid=$saved.pid; port=$port; processRetained=$true; alreadyRunning=$true } | ConvertTo-Json -Compress
    return
  }
}

$environmentBefore = @{}
function Set-ChildEnvironment([string]$Name, [AllowNull()][string]$Value) {
  if (-not $environmentBefore.ContainsKey($Name)) { $environmentBefore[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process') }
  [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}
$process = $null
try {
  $envFile = @((Join-Path $sourcePath '.config.env'), (Join-Path $sourcePath '.env')) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $envFile) { throw 'Existing backend environment file was not found.' }
  foreach ($rawLine in Get-Content -LiteralPath $envFile) {
    $line = $rawLine.Trim()
    if (-not $line -or $line.StartsWith('#')) { continue }
    if ($line.StartsWith('export ')) { $line = $line.Substring(7).Trim() }
    $separator = $line.IndexOf('=')
    if ($separator -lt 1) { continue }
    $name = $line.Substring(0, $separator).Trim()
    $value = $line.Substring($separator + 1).Trim()
    if ($value.Length -ge 2) {
      $first = $value[0]; $last = $value[$value.Length - 1]
      if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) { $value = $value.Substring(1, $value.Length - 2) }
    }
    if ($name -match '^[A-Za-z_][A-Za-z0-9_]*$') { Set-ChildEnvironment $name $value }
  }
  # Reuse this one existing launcher default without executing the old startup workflow.
  if (-not [Environment]::GetEnvironmentVariable('OPEN_VIKING_URL', 'Process')) {
    $launcherText = Get-Content -LiteralPath (Join-Path $sourcePath 'build\LocalDev.Common.ps1') -Raw
    $match = [regex]::Match($launcherText, '\$env:OPEN_VIKING_URL\s*=\s*"([^"]+)"')
    if ($match.Success) { Set-ChildEnvironment 'OPEN_VIKING_URL' $match.Groups[1].Value }
  }
  $references = @([regex]::Matches($configText, '\$\{([A-Za-z_][A-Za-z0-9_]*)\}') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
  $missing = @($references | Where-Object { -not [Environment]::GetEnvironmentVariable($_, 'Process') })
  if ($missing.Count -gt 0) { throw "Required environment fields are missing: $($missing -join ', '). Values were not printed." }
  Set-ChildEnvironment 'FINCLAW_ROOT' $sourcePath
  Set-ChildEnvironment 'FINCLAW_SKILLS_DIR' (Join-Path $sourcePath 'skills-fin')
  Set-ChildEnvironment 'FINCLAW_PLUGIN_DIR' (Join-Path $sourcePath 'extensions\fin-core')
  Set-ChildEnvironment 'FINCLAW_WEIXIN_DIR' (Join-Path $sourcePath 'extensions\openclaw-weixin')
  Set-ChildEnvironment 'FINCLAW_OPENVIKING_DIR' (Join-Path $sourcePath 'extensions\memory-openviking')
  Set-ChildEnvironment 'FINCLAW_MONITOR_DIR' (Join-Path $sourcePath 'extensions\fin-eval-monitor')
  Set-ChildEnvironment 'OPENCLAW_STATE_DIR' $runtimePath
  Set-ChildEnvironment 'OPENCLAW_CONFIG_PATH' $configPath
  Set-ChildEnvironment 'OPENCLAW_PROFILE' $null
  Set-ChildEnvironment 'OPENCLAW_DISABLE_BONJOUR' '1'
  Set-ChildEnvironment 'OPENCLAW_DISABLE_MDNS' '1'
  Set-ChildEnvironment 'OPENCLAW_NO_RESPAWN' '1'

  New-Item -ItemType Directory -Force -Path $trackingDir | Out-Null
  $nodePath = (Get-Command node -ErrorAction Stop).Source
  $stdoutPath = Join-Path $trackingDir 'backend.out.log'
  $stderrPath = Join-Path $trackingDir 'backend.err.log'
  $process = Start-Process -FilePath $nodePath -ArgumentList @(('"' + $entryPath + '"'), 'gateway', 'run', '--port', [string]$port, '--bind', 'loopback') -WorkingDirectory $sourcePath -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)"
  [pscustomobject]@{
    pid = $process.Id; createdAt = $processInfo.CreationDate.ToUniversalTime().ToString('o')
    sourceRoot = $sourcePath; entry = $entryPath; port = $port
    configPath = $configPath; configSha256 = $beforeHash
    runtimeRoot = $runtimePath; stdout = $stdoutPath; stderr = $stderrPath
  } | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding utf8
  $process.Id | Set-Content -LiteralPath (Join-Path $trackingDir 'backend.pid')

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $ready = $false; $httpStatus = 0; $hasCurrentUser = $false; $agentCount = 0
  while ([DateTime]::UtcNow -lt $deadline) {
    $process.Refresh()
    if ($process.HasExited) { throw "Backend exited with code $($process.ExitCode). Inspect the local backend log files with credential redaction." }
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/fin-core/api/bootstrap" -UseBasicParsing -TimeoutSec 2
      $httpStatus = [int]$response.StatusCode
      if ($httpStatus -eq 200) {
        $bootstrap = $response.Content | ConvertFrom-Json
        $hasCurrentUser = $null -ne $bootstrap.currentUser
        $agentCount = @($bootstrap.agentNameMap.PSObject.Properties).Count
        $ready = $true; break
      }
    } catch {
      if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) { $httpStatus = 401; $ready = $true; break }
    }
    Start-Sleep -Milliseconds 400
  }
  if (-not $ready) {
    # Cold plugin loading can remain CPU-active for several minutes. Keep the owned
    # process alive instead of throwing away its initialization when a health wait ends.
    [pscustomobject]@{ status='initializing'; pid=$process.Id; port=$port; bootstrapHttpStatus=$httpStatus; processRetained=$true; logsDirectory=$trackingDir } | ConvertTo-Json -Compress
    return
  }
  $owner = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
  if ($owner.Count -eq 0 -or $owner[0].OwningProcess -ne $process.Id) { throw 'Backend port owner does not match the launched process.' }
  $afterHash = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash
  if ($afterHash -ne $beforeHash) { throw 'The backend changed its runtime configuration during startup; stopped for inspection.' }
  [pscustomobject]@{ status='ready'; pid=$process.Id; port=$port; bootstrapHttpStatus=$httpStatus; currentUserPresent=$hasCurrentUser; agentCount=$agentCount; runtimeConfigUnchanged=$true; logsDirectory=$trackingDir } | ConvertTo-Json -Compress
} catch {
  if ($process -and -not $process.HasExited) {
    $owned = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)" -ErrorAction SilentlyContinue
    if ($owned -and $owned.CommandLine.Contains($entryPath)) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
  }
  throw
} finally {
  foreach ($name in $environmentBefore.Keys) { [Environment]::SetEnvironmentVariable($name, $environmentBefore[$name], 'Process') }
}
