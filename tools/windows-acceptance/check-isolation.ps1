[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$CodexHostRoot
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path $CodexHostRoot).Path
$desktop = Get-Process -Name 'Codex','codex' -ErrorAction SilentlyContinue
if (-not $desktop) { throw 'Codex Desktop process was not found.' }

$hostRuntime = Join-Path $root 'app\host-runtime.mjs'
$hostProcesses = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and $_.CommandLine -match [regex]::Escape($hostRuntime)
}

Write-Host "Codex Desktop PID: $($desktop.Id -join ', ')"
if ($hostProcesses) {
  Write-Host 'External Host processes:'
  $hostProcesses | Select-Object ProcessId, ParentProcessId, CommandLine | Format-List
}

$officialProxy = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and $_.CommandLine -match 'codexhost.*(app-server|remote-control|remote-host)'
}
if ($officialProxy) {
  $officialProxy | Select-Object ProcessId, ParentProcessId, CommandLine | Format-List
  throw 'Found a codexhost official app-server or remote proxy process.'
}

Write-Host 'PASS: no codexhost official proxy process was found.'
