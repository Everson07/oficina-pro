Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\Everson\Downloads\oficina"
WshShell.Run "node server.js", 0, False
