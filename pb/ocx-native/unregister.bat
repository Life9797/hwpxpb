@echo off
rem ASCII only (see register.bat). Needs admin rights; asks for them itself.
setlocal
fltmc >nul 2>&1
if errorlevel 1 (
  echo Requesting administrator rights...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >nul 2>&1
  if errorlevel 1 (
    echo [ERROR] Right-click unregister.bat and choose "Run as administrator".
    pause
  )
  exit /b
)
set "RS=%WINDIR%\System32\regsvr32.exe"
if exist "%WINDIR%\SysWOW64\regsvr32.exe" set "RS=%WINDIR%\SysWOW64\regsvr32.exe"
"%RS%" /s /u "%~dp0HwpxEditor.ocx"
if errorlevel 1 (
  echo [ERROR] regsvr32 /u failed with code %errorlevel%.
) else (
  echo [OK] HwpxEditor.ocx unregistered.
)
echo.
pause
endlocal
