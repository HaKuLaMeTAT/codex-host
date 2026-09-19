[CmdletBinding()]
param(
  [string]$CodexHostRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path $CodexHostRoot).Path
$matches = @(Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and
  $_.CommandLine -match '--codexhost-external-host' -and
  $_.CommandLine -match [regex]::Escape($root)
})

if ($matches.Count -eq 0) {
  Write-Host 'PASS: no codexhost External Host process remains for this checkout.'
  exit 0
}

Write-Host 'FOUND: codexhost External Host process(es) for this checkout:'
$matches | Select-Object ProcessId, ParentProcessId, CommandLine | Format-List
exit 1
