' Run NetPulse agent in the background (no console window).
' Stop it with stop.bat. Data stays in the "data" folder next to this file.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
If Not fso.FileExists(dir & "\.venv\Scripts\pythonw.exe") Then
  sh.Run """" & dir & "\setup.bat""", 1, True
End If
sh.Environment("Process")("PYTHONNOUSERSITE") = "1"
sh.Run """" & dir & "\.venv\Scripts\pythonw.exe"" """ & dir & "\backend\run.py""", 0, False
