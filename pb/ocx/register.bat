@echo off
rem ASCII only: cmd misparses non-ASCII batch files when the console code page differs (CP949 vs UTF-8).
rem PB 12.1 is 32-bit, so this uses the 32-bit regasm. Needs .NET Framework 4.8 (Release 528040 or later) and admin rights.
setlocal
set RC=1
set "DLL=%~dp0HwpxEditorOcx.dll"
if not exist "%DLL%" (
  echo.
  echo [ERROR] HwpxEditorOcx.dll not found next to this file: "%~dp0"
  echo         Extract the whole zip to a folder first, e.g. C:\hwpxpb, then run register.bat there.
  goto end
)

fltmc >nul 2>&1
if errorlevel 1 (
  echo Requesting administrator rights...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >nul 2>&1
  if errorlevel 1 (
    echo.
    echo [ERROR] Administrator rights are required.
    echo         Right-click register.bat and choose "Run as administrator".
    goto end
  )
  exit /b 0
)

set REL=0
for /f "tokens=3" %%a in ('reg query "HKLM\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" /v Release 2^>nul') do set /a REL=%%a
if %REL% LSS 528040 (
  echo.
  echo [ERROR] .NET Framework 4.8 is not installed. Current Release value: %REL%
  echo         Install ".NET Framework 4.8 Runtime", restart the PC, then run register.bat again.
  echo         https://dotnet.microsoft.com/download/dotnet-framework/net48
  echo         Or use HwpxEditor-native.zip, which does not need .NET.
  goto end
)

set "REGASM=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\regasm.exe"
"%REGASM%" /codebase /tlb "%DLL%"
set RC=%errorlevel%
if not "%RC%"=="0" (
  echo.
  echo [ERROR] Registration failed. Check that you ran it as administrator.
) else (
  echo.
  echo [OK] Registered. The /codebase warning RA0000 can be ignored.
)

:end
echo.
pause
exit /b %RC%
