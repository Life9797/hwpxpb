@echo off
rem ASCII only: cmd misparses non-ASCII batch files when the console code page differs (CP949 vs UTF-8).
rem Registers the 32-bit OCX for PB 12.1 with the 32-bit regsvr32. Needs admin rights; asks for them itself.
setlocal
set RC=1
set "OCX=%~dp0HwpxEditor.ocx"
if not exist "%OCX%" (
  echo.
  echo [ERROR] HwpxEditor.ocx not found next to this file: "%~dp0"
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

set "RS=%WINDIR%\System32\regsvr32.exe"
if exist "%WINDIR%\SysWOW64\regsvr32.exe" set "RS=%WINDIR%\SysWOW64\regsvr32.exe"

rem WebView2 runtime check (skipped when a fixed-version runtime is in webview2\ next to this file)
if exist "%~dp0webview2\msedgewebview2.exe" goto register
set WV=
for %%k in ("HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "HKCU\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}") do (
  reg query %%k /v pv >nul 2>&1 && set WV=1
)
if not defined WV (
  echo.
  echo [WARNING] Microsoft Edge WebView2 Runtime does not seem to be installed.
  echo           Install "WebView2 Runtime", or extract a fixed-version runtime into webview2\
  echo           See README.txt. Registration continues.
  echo.
)

:register
echo Registering "%OCX%"
"%RS%" /s "%OCX%"
set RC=%errorlevel%
if "%RC%"=="0" (
  echo.
  echo [OK] HwpxEditor.ocx registered. ProgID: Hwpxpb.Editor
  goto end
)
echo.
echo [ERROR] regsvr32 failed with code %RC%.
if "%RC%"=="3" echo         Could not load the OCX. Check that the file is complete and not blocked by antivirus.
if "%RC%"=="5" echo         DllRegisterServer failed. Run as administrator; unregister the .NET edition first if it was registered.
echo         Showing the regsvr32 message...
"%RS%" "%OCX%"

:end
echo.
pause
exit /b %RC%
