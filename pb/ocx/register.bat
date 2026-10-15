@echo off
rem 관리자 권한으로 실행. PB 12.1 은 32비트이므로 32비트 regasm 을 쓴다.
rem 이 OCX 는 .NET Framework 4.8 이 필요하다 (Release 값 528040 이상).
set REL=0
for /f "tokens=3" %%a in ('reg query "HKLM\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" /v Release 2^>nul') do set /a REL=%%a
if %REL% LSS 528040 (
  echo.
  echo [오류] .NET Framework 4.8 이 설치되어 있지 않습니다. ^(현재 Release 값: %REL%^)
  echo        Microsoft ".NET Framework 4.8 Runtime" 을 설치하고 PC 를 다시 시작한 뒤
  echo        이 파일을 다시 관리자 권한으로 실행하세요.
  echo        https://dotnet.microsoft.com/download/dotnet-framework/net48
  echo.
  pause
  exit /b 1
)
set REGASM=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\regasm.exe
"%REGASM%" /codebase /tlb "%~dp0HwpxEditorOcx.dll"
if errorlevel 1 (
  echo.
  echo [오류] 등록에 실패했습니다. 관리자 권한으로 실행했는지 확인하세요.
) else (
  echo.
  echo 등록했습니다. /codebase 경고 RA0000 은 무시해도 됩니다.
)
pause
