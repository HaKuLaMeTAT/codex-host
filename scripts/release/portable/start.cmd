@echo off
setlocal
set "ROOT=%~dp0"
set "NODE=%ROOT%runtime\node.exe"
if not exist "%NODE%" (
  powershell.exe -NoProfile -WindowStyle Hidden -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('便携包缺少 runtime\\node.exe','codexhost light') | Out-Null"
  exit /b 1
)
start "" /b "%NODE%" "%ROOT%app\portable-launcher.mjs"
exit /b 0
