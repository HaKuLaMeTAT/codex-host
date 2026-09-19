$ErrorActionPreference = "Stop"
$root = (Resolve-Path $PSScriptRoot).Path
$shortcutPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "codexhost light.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "$env:SystemRoot\System32\wscript.exe"
$shortcut.Arguments = "`"$root\start.vbs`""
$shortcut.WorkingDirectory = $root
$shortcut.WindowStyle = 7
$shortcut.Description = "codexhost light"
$shortcut.Save()
Write-Output $shortcutPath
