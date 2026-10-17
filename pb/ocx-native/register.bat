@echo off
rem 관리자 권한으로 실행. .NET 은 필요 없다. PB 12.1 은 32비트이므로 32비트 regsvr32 로 등록한다.
set RS=%WINDIR%\System32\regsvr32.exe
if exist "%WINDIR%\SysWOW64\regsvr32.exe" set RS=%WINDIR%\SysWOW64\regsvr32.exe

rem WebView2 런타임 확인 (설치 폴더의 webview2\ 고정 버전 런타임이 있으면 건너뜀)
if exist "%~dp0webview2\msedgewebview2.exe" goto register
set WV=
for %%k in ("HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "HKCU\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}") do (
  reg query %%k /v pv >nul 2>&1 && set WV=1
)
if not defined WV (
  echo.
  echo [주의] WebView2 런타임이 설치되어 있지 않은 것 같습니다.
  echo        Microsoft "WebView2 Runtime" 을 설치하거나, 고정 버전 런타임을 webview2\ 폴더에 풀어 두세요.
  echo        README.txt 를 참고하세요. 등록은 계속합니다.
  echo.
)

:register
"%RS%" "%~dp0HwpxEditor.ocx"
