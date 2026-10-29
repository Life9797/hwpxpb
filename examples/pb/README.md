# PB 12.1 예제: 파일 열기 · 값 대입 · 값 추출 → DW

`w_hwpx_demo.srw` 창 하나로 다음을 보여 줍니다.

| 버튼 | 하는 일 | 쓰는 OCX 메서드 |
|---|---|---|
| `...` / 열기 | HWPX 파일을 골라 연다. 창을 열 때 파일을 넘기면 준비되자마자 연다 | `Open(path, mode)` |
| 편집 권한 / 작성·편집 | 권한이 있을 때만 문서 전체 편집 | `AllowEdit`, `SetMode` |
| DW → 문서 (값 대입) | DW 1행의 모든 컬럼 값을 문서에 한 번에 넣는다 | `SetFields(json, sep)` |
| 문서 → DW (값 추출) | 문서의 모든 값을 DW 1행에 넣는다 (DW 에 있는 컬럼만, 형식 맞춰서) | `GetFieldsTsv(sep)`, `GetTable()` |
| DW 만들기 | 연 양식의 개체 이름으로 DW 를 만든다 (DW 없이 시험할 때) | `GetFieldsTsv` |
| 닫기 | 연 문서를 닫는다 (빈 화면) | `CloseDocument()` |
| 저장 | 작성한 문서를 HWPX 로 저장 | `SaveAs` |
| 프린터 목록 / 프린터 선택... | 설치된 프린터 목록(기본 프린터 선택됨). 버튼은 Windows 프린터 선택 창 | `GetPrinters`, `GetDefaultPrinter`, `SelectPrinter` |
| 인쇄 | 목록에서 고른 프린터로 바로 인쇄. 목록이 비어 있으면 인쇄 대화상자(미리보기) | `PrintTo(printer, copies)`, `Print` |

## 넣는 방법
1. OCX 를 등록합니다 ([Releases](https://github.com/Life9797/hwpxpb/releases) 의 `HwpxEditor-native.zip` → `register.bat` 관리자 권한).
2. PB 에서 예제용 PBL 을 열고 **Import** 로 `w_hwpx_demo.srw` 를 가져옵니다.
3. 창 페인터에서 `w_hwpx_demo` 를 열고 **Insert → OLE → Insert Control** 탭 → `HwpxEditorControl` 을 골라 창 아무 곳에 놓습니다.
   이름·위치는 상관없습니다 (창이 열릴 때 찾아서 왼쪽에 크게 놓습니다). 컨트롤에 스크립트를 넣지 않아도 됩니다.
4. 저장하고 실행합니다.

```powerscript
// 파일을 지정해서 열기
OpenWithParm(w_hwpx_demo, "C:\forms\처방전.hwpx")

// 또는 실행 인수: myapp.exe "C:\forms\처방전.hwpx"  (창이 CommandParm() 을 읽음)
Open(w_hwpx_demo)
```

## 업무 화면에 옮길 때
- **DW**: 예제는 `DW 만들기` 로 임시 DW 를 만들지만, 실제로는 DB 테이블 DW 를 그대로 씁니다.
  DW 컬럼 이름 = 양식 개체 이름이면 됩니다 (대소문자 무관. 대입할 때 대문자로 맞춥니다).
  테이블 이름은 `GetTable()` (양식의 문서 정보에 적은 `dbtable=`) 로 알 수 있습니다.
- **값 대입**은 `SetFields` 로 한 번에 넣습니다. `SetFieldValue` 를 컬럼마다 부르면 그때마다 화면을 다시 그려서 느립니다.
  결과 JSON 의 `unknown` 은 문서에 없는 컬럼, `rejected` 는 드롭다운·라디오 목록에 없는 값입니다.
- **값 추출** 후 `dw_1.Update()` 로 DB 에 저장합니다.
- **편집 권한**은 예제의 체크박스 대신 사용자 권한으로 정합니다: `iole.object.AllowEdit = (gs_user_role = "ADMIN")`
- 준비 확인은 `ready` 이벤트 대신 타이머로 `IsReady` 를 봅니다. `ready` 이벤트를 쓰려면 컨트롤의 ready 이벤트에 `Parent.PostEvent("ue_ready")` 를 넣고 타이머를 빼면 됩니다.

## Windows 7 / Windows 10 에 맞는 OCX 쓰기
Windows 7 과 Windows 10/11 PC 가 섞여 있을 때, 프로그램과 함께 두 판을 배포하고 PC 에 맞는 것을 등록해 씁니다.

| PC | 폴더 | zip | WebView2 |
|---|---|---|---|
| Windows 7 SP1 / 8.1 | `C:\hwpxpb\win7\` | `HwpxEditor-native-win7.zip` | 함께 든 109 고정 버전 (`webview2\`) |
| Windows 10 / 11 | `C:\hwpxpb\win10\` | `HwpxEditor-native.zip` | PC 에 설치된 최신 런타임 |

두 판은 CLSID·ProgID(`Hwpxpb.Editor`)·메서드가 같습니다. 그래서 **PB 화면과 코드는 하나**이고, 한 PC 에는 둘 중 하나만 등록됩니다.
어느 OCX 가 불리는지는 등록된 경로로 정해집니다.

Windows 판별: `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion` 에 `CurrentMajorVersionNumber` 가 있으면 Windows 10/11, 없으면 Windows 7/8.1 입니다.
(PB 12.1 의 `GetEnvironment()` 는 Windows 10 도 6.2 로 보여 주므로 쓰지 않습니다.)

### 방법 1. 설치할 때 등록: `install-by-os.bat`
`C:\hwpxpb\install-by-os.bat` 로 두고 실행하면 Windows 판을 보고 `win7\register.bat` 또는 `win10\register.bat` 을 부릅니다.
`install-by-os.bat win7` 처럼 판을 직접 줄 수도 있습니다.

### 방법 2. 프로그램이 확인: `n_hwpx_ocx.sru`
Import 로 `n_hwpx_ocx.sru` 를 가져오고, **OCX 가 든 창을 열기 전에** 부릅니다.
맞는 OCX 가 등록되어 있지 않으면 그 폴더의 `register.bat` 을 실행하고(UAC 확인), 등록될 때까지 기다립니다.

```powerscript
// application open 이벤트 또는 창을 여는 버튼에서
n_hwpx_ocx lnv_ocx
lnv_ocx.is_root = "C:\hwpxpb"   // win7\, win10\ 이 있는 폴더 (기본값)

If lnv_ocx.of_ensure_registered() <> 1 Then
	MessageBox("HWPX 에디터", lnv_ocx.is_error, StopSign!)
	Return
End If
// lnv_ocx.of_os_name()        → "win7" / "win10"
// lnv_ocx.of_registered_path() → 지금 등록된 OCX 경로
Open(w_hwpx_demo)
```

| 함수 | 돌려주는 값 |
|---|---|
| `of_is_win7()` | Windows 7/8.1 이면 true |
| `of_os_name()` | `"win7"` / `"win10"` |
| `of_ocx_path()` | 이 PC 에 맞는 OCX 경로 (`is_root\win7\HwpxEditor.ocx` 등) |
| `of_registered_path()` | 지금 등록된 OCX 경로 (없으면 `""`) |
| `of_ensure_registered()` | `1` 맞는 OCX 가 등록됨, `-1` 폴더·파일 없음, `-2` 등록 실패·시간 초과 (`is_error`) |

참고
- 창이 열린 뒤에 등록을 바꾸면 그 창에는 반영되지 않습니다. 반드시 창을 열기 전에 확인합니다.
- 프로그램 폴더 아래에 두려면 `is_root = GetCurrentDirectory() + "\hwpxpb"` 처럼 바꿉니다. 등록 후에는 폴더를 옮기지 마세요.
- .NET 판(`HwpxEditorOcx.zip`)을 등록했던 PC 는 먼저 그 폴더의 `unregister.bat` 을 실행합니다.

## 값 규칙 (요약)
- 누름틀·드롭다운·단독 체크박스: 개체 이름 = 컬럼. 체크박스 값 `Y`/`N`
- 다중 체크박스 `컬럼__코드` → 값 `01,02`, 라디오 그룹 = 컬럼, 고른 버튼 이름 = 값
- 드롭다운 항목 `01:서울` → 값 `01` (구분자는 `is_sep`, "" 이면 `:`)

자세한 메서드 설명은 [PB 가이드](../../docs/pb-guide.md).

`.srw`·`.sru` 파일은 손으로 작성한 PB 내보내기 형식(cp949)입니다. 가져오기에서 오류가 나면 메시지를 알려 주세요.
