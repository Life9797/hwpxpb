@echo off
set REGASM=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\regasm.exe
"%REGASM%" /unregister /tlb "%~dp0HwpxEditorOcx.dll"
