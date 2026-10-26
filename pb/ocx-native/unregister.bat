@echo off
set RS=%WINDIR%\System32\regsvr32.exe
if exist "%WINDIR%\SysWOW64\regsvr32.exe" set RS=%WINDIR%\SysWOW64\regsvr32.exe
"%RS%" /u "%~dp0HwpxEditor.ocx"
