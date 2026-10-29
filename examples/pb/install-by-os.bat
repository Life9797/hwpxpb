@echo off
rem ASCII only (see register.bat). Registers the OCX that fits this Windows version.
rem Layout next to this file:
rem   win7\    HwpxEditor-native-win7.zip  (includes WebView2 109 fixed-version runtime)
rem   win10\   HwpxEditor-native.zip       (uses the WebView2 runtime installed on the PC)
rem Only Windows 10/11 have CurrentMajorVersionNumber. Without it: Windows 7 / 8.1 (WebView2 109 is the last).
setlocal
set ED=win7
reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion" /v CurrentMajorVersionNumber >nul 2>&1 && set ED=win10
if "%~1"=="win7" set ED=win7
if "%~1"=="win10" set ED=win10
set "DIR=%~dp0%ED%"
echo Windows edition: %ED%
echo OCX folder     : "%DIR%"
if not exist "%DIR%\register.bat" (
  echo.
  echo [ERROR] "%DIR%\register.bat" not found.
  if "%ED%"=="win7" echo         Extract HwpxEditor-native-win7.zip into the win7 folder.
  if "%ED%"=="win10" echo         Extract HwpxEditor-native.zip into the win10 folder.
  echo.
  pause
  exit /b 1
)
call "%DIR%\register.bat"
exit /b %errorlevel%
