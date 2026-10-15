@echo off
rem 관리자 권한으로 실행. PB 12.1 은 32비트이므로 32비트 regasm 을 쓴다.
set REGASM=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\regasm.exe
"%REGASM%" /codebase /tlb "%~dp0HwpxEditorOcx.dll"
