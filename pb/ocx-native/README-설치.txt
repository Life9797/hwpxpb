HwpxEditor (C++) - PowerBuilder 12.1 용 HWPX 에디터 OLE 컨트롤

.NET Framework 가 필요 없습니다 (.NET 4.0 만 있는 PC, Windows 7 SP1 에서 쓰는 판).
.NET 판(HwpxEditorOcx.dll)과 ProgID·메서드·이벤트가 같아 PB 코드는 그대로 씁니다.

설치
1. 압축을 원하는 폴더에 풉니다. 예: C:\hwpxpb
   (등록 후에는 폴더를 옮기지 마세요. 옮겼다면 unregister.bat → 새 위치에서 register.bat)
2. .NET 판을 등록했던 PC 라면 먼저 그 폴더의 unregister.bat 을 실행합니다.
3. register.bat 을 마우스 오른쪽 → "관리자 권한으로 실행". "DllRegisterServer 성공" 이 뜨면 됩니다.
4. Microsoft Edge WebView2 런타임이 필요합니다.
   - Windows 10/11: 대부분 이미 설치되어 있습니다.
   - Windows 7 SP1: WebView2 는 109 버전이 마지막입니다. 109 런타임을 설치하거나,
     109 "고정 버전(Fixed Version)" x86 런타임을 이 폴더의 webview2\ 에 풀어 둡니다
     (webview2\msedgewebview2.exe 가 있으면 PC 에 설치된 런타임 대신 그것을 씁니다).
     HwpxEditor-native-win7.zip 에는 이 webview2\ 폴더가 이미 들어 있어 따로 설치할 것이 없습니다.
     (최신 런타임 설치기는 Windows 7 에서 "PackageIdFromFullName" 오류로 실행되지 않습니다)
5. PB 창 페인터 → Insert → OLE → Insert Control 탭 → HwpxEditorControl (Hwpxpb.Editor) 선택.

권한
  AllowEdit 속성(기본 false)이 true 일 때만 문서 전체 편집(edit)이 됩니다. false 면 작성(form)만 합니다.

들어 있는 파일
  HwpxEditor.ocx                   OLE 컨트롤 (C++, 32비트. VC++ 런타임도 안에 들어 있음)
  web\                             에디터 화면 (rhwp-studio + 브리지)
  register.bat / unregister.bat    등록 / 해제

사용법(메서드, 이벤트, PB 예제): https://github.com/Life9797/hwpxpb/blob/feat/initial-scaffold/docs/pb-guide.md (병합 후에는 main)
라이선스: MIT (LICENSE). 에디터 엔진 rhwp 는 MIT, Copyright Edward Kim (web\studio\RHWP-LICENSE.txt).
