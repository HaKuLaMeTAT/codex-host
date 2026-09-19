[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = 'Stop'
$processes = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and $_.CommandLine -match '--codexhost-external-host'
}
foreach ($process in $processes) {
  $target = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
  if ($target -and $PSCmdlet.ShouldProcess("PID $($process.ProcessId)", 'Stop External Host')) {
    Stop-Process -Id $process.ProcessId -Force
    Write-Host "Stopped codexhost External Host PID $($process.ProcessId)."
  }
}
if (-not $processes) { Write-Host 'No codexhost External Host process found.' }

# The acceptance scripts only create this per-process environment state. Remove
# variables in this PowerShell process if the script is dot-sourced.
Remove-Item Env:CODEXHOST_EXTERNAL_HOST_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:CODEXHOST_EXTERNAL_HOST_PORT -ErrorAction SilentlyContinue
