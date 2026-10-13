Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
root = fs.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
exe = root & "\node_modules\electron\dist\electron.exe"
If Not fs.FileExists(exe) Or Not fs.FileExists(root & "\dist\index.html") Then
  MsgBox "Please run npm install and npm run build first.", 48, "zemiCC"
Else
  sh.Run Chr(34) & exe & Chr(34) & " " & Chr(34) & root & Chr(34), 1, False
End If
