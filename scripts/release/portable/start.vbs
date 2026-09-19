Option Explicit
Dim shell, root, node, launcher
Set shell = CreateObject("WScript.Shell")
root = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
node = root & "\runtime\node.exe"
launcher = root & "\app\portable-launcher.mjs"
shell.Run Chr(34) & node & Chr(34) & " " & Chr(34) & launcher & Chr(34), 0, False
