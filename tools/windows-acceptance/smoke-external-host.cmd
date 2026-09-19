@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0smoke-external-host.ps1" %*
exit /b %ERRORLEVEL%
