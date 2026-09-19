[CmdletBinding()]
param(
  [string]$HostRuntime,
  [int]$Port = 0
)

$ErrorActionPreference = 'Stop'
$candidateRuntimes = @()
if ($HostRuntime) { $candidateRuntimes += $HostRuntime }
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$candidateRuntimes += @(
  (Join-Path $repoRoot 'app\host-runtime.mjs'),
  (Join-Path $repoRoot 'packages\host-runtime\dist\main.js'),
  (Join-Path $repoRoot 'packages\host-runtime\dist\release-main.js')
)
$runtimePath = $candidateRuntimes | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $runtimePath) {
  throw 'Host runtime was not found. Build first with: npm run typecheck (or provide -HostRuntime pointing to app\host-runtime.mjs).'
}
$runtime = (Resolve-Path $runtimePath).Path
$token = ("$([Guid]::NewGuid().ToString('N'))$([Guid]::NewGuid().ToString('N'))").ToLowerInvariant()
$env:CODEXHOST_EXTERNAL_HOST_TOKEN = $token
if ($Port -gt 0) { $env:CODEXHOST_EXTERNAL_HOST_PORT = "$Port" }

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else {
  Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (-not (Test-Path $nodePath)) {
  throw 'node.exe was not found. Install Node 24 or add node.exe to PATH.'
}
$stderrPath = [IO.Path]::GetTempFileName()
$process = Start-Process -FilePath $nodePath `
  -ArgumentList @($runtime, '--codexhost-external-host') `
  -PassThru -RedirectStandardError $stderrPath
try {
  $deadline = (Get-Date).AddSeconds(10)
  $endpoint = $null
  do {
    Start-Sleep -Milliseconds 100
    $stderr = Get-Content $stderrPath -Raw -ErrorAction SilentlyContinue
    $line = if ($stderr) { $stderr -split "`r?`n" | Where-Object { $_ } | Select-Object -Last 1 } else { $null }
    if ($process.HasExited) {
      throw "External Host exited with code $($process.ExitCode):`n$stderr"
    }
    if ($stderr -match 'listening at (http://127\.0\.0\.1:\d+/rpc)') { $endpoint = $Matches[1] }
  } while (-not $endpoint -and (Get-Date) -lt $deadline)
  if (-not $endpoint) { throw "External Host did not start within 10 seconds:`n$stderr" }
  $body = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
  $response = Invoke-RestMethod -Method Post -Uri $endpoint -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body
  if ($response.result.serverInfo.name -ne 'codexhost-external') {
    throw "Unexpected initialize response: $($response | ConvertTo-Json -Compress)"
  }
  Write-Host "PASS: External Host $endpoint returned codexhost-external."
}
finally {
  if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
  Remove-Item Env:CODEXHOST_EXTERNAL_HOST_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:CODEXHOST_EXTERNAL_HOST_PORT -ErrorAction SilentlyContinue
  Remove-Item $stderrPath -Force -ErrorAction SilentlyContinue
}
