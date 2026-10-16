HwpxEditorOcx - PowerBuilder 12.1 용 HWPX 에디터 OLE 컨트롤 (빌드된 배포본)

빌드 없이 이 zip 만으로 설치합니다.

1. 압축을 원하는 폴더에 풉니다. 예: C:\hwpxpb
   (설치 후에는 폴더를 옮기지 마세요. 옮겼다면 unregister.bat → 새 위치에서 register.bat)
2. register.bat 을 마우스 오른쪽 → "관리자 권한으로 실행"
   32비트 regasm 으로 ProgID "Hwpxpb.Editor" 를 등록합니다.
   .NET Framework 4.8 이 필요합니다 (Windows 10 1903 이후·11 은 기본 포함, Windows 7 SP1 이상 설치 가능).
   없으면 register.bat 이 알려 주며, 아래에서 "Runtime" 을 받아 설치하고 재부팅한 뒤 다시 실행합니다.
     https://dotnet.microsoft.com/download/dotnet-framework/net48
   "AsyncStateMachineAttribute 형식을 로드할 수 없습니다" 오류도 4.8 이 없을 때 나는 오류입니다.
   등록할 때 나오는 경고 RA0000 (/codebase, 서명되지 않은 어셈블리) 은 무시해도 됩니다.
3. Microsoft Edge WebView2 런타임이 필요합니다. Windows 10/11 은 대부분 이미 설치되어 있고,
   없으면 Microsoft 의 "WebView2 Evergreen Bootstrapper" 로 설치합니다.
4. PB 창 페인터 → Insert → OLE → Insert Control 탭 → HwpxEditorControl (Hwpxpb.Editor) 선택.

Windows 7 에서 쓸 때
  - Windows 7 SP1 이어야 합니다. .NET Framework 4.8 은 Windows 7 SP1 에 설치됩니다.
  - WebView2 런타임은 Windows 7 에서 109 버전이 마지막입니다. 이 에디터는 109 에서 쓰는 기능만 씁니다.
    PC 에 런타임을 설치하는 대신, 109 "고정 버전(Fixed Version)" 런타임(x86)을 받아 이 폴더 안의
    webview2\ 폴더에 풀어 두면 그것을 씁니다 (webview2\msedgewebview2.exe 가 있어야 함).
  - Windows 7 은 Microsoft 지원이 끝난 OS 라 보안 업데이트가 없습니다.

들어 있는 파일
  HwpxEditorOcx.dll, HwpxEditorOcx.tlb(등록 시 생성)   OLE 컨트롤
  Microsoft.Web.WebView2.*.dll, WebView2Loader.dll     WebView2
  web\                                                  에디터 화면 (rhwp-studio + 브리지)
  register.bat / unregister.bat                         등록 / 해제

사용법(메서드, 이벤트, PB 예제): https://github.com/Life9797/hwpxpb/blob/feat/initial-scaffold/docs/pb-guide.md (병합 후에는 main)
라이선스: MIT (LICENSE). 에디터 엔진 rhwp 는 MIT, Copyright Edward Kim (web\studio\RHWP-LICENSE.txt).
