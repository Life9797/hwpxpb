HwpxEditorOcx - PowerBuilder 12.1 용 HWPX 에디터 OLE 컨트롤 (빌드된 배포본)

빌드 없이 이 zip 만으로 설치합니다.

1. 압축을 원하는 폴더에 풉니다. 예: C:\hwpxpb
   (설치 후에는 폴더를 옮기지 마세요. 옮겼다면 unregister.bat → 새 위치에서 register.bat)
2. register.bat 을 마우스 오른쪽 → "관리자 권한으로 실행"
   32비트 regasm 으로 ProgID "Hwpxpb.Editor" 를 등록합니다. (.NET Framework 4.8 필요, Windows 10/11 기본 포함)
3. Microsoft Edge WebView2 런타임이 필요합니다. Windows 10/11 은 대부분 이미 설치되어 있고,
   없으면 Microsoft 의 "WebView2 Evergreen Bootstrapper" 로 설치합니다.
4. PB 창 페인터 → Insert → OLE → Insert Control 탭 → HwpxEditorControl (Hwpxpb.Editor) 선택.

들어 있는 파일
  HwpxEditorOcx.dll, HwpxEditorOcx.tlb(등록 시 생성)   OLE 컨트롤
  Microsoft.Web.WebView2.*.dll, WebView2Loader.dll     WebView2
  web\                                                  에디터 화면 (rhwp-studio + 브리지)
  register.bat / unregister.bat                         등록 / 해제

사용법(메서드, 이벤트, PB 예제): https://github.com/Life9797/hwpxpb/blob/main/docs/pb-guide.md
라이선스: MIT (LICENSE). 에디터 엔진 rhwp 는 MIT, Copyright Edward Kim (web\studio\RHWP-LICENSE.txt).
