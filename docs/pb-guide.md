# PowerBuilder 12.1 연동 가이드 (서버 없이)

PB 창 안에 HWPX 에디터를 OLE 컨트롤로 넣고, 누름틀·체크박스·라디오·드롭다운 값을 넣고 뺍니다.
에디터는 PC 안에서만 돌며 서버나 네트워크가 필요 없습니다.

## 1. 구성
```
PB 12.1 창 ── OLE 컨트롤 "Hwpxpb.Editor" (pb/ocx-native C++ 판 또는 pb/ocx .NET 판, 32비트 ActiveX)
                 └─ Microsoft Edge WebView2 ── 설치 폴더\web\ (pb/dist)
                      ├─ rhwp-studio (HWP/HWPX 편집기, WASM)
                      └─ bridge.js + 값 대입/추출 엔진(engine/)
```

## 2. 빌드와 설치 (Windows)
OCX 는 두 가지가 있습니다. ProgID(`Hwpxpb.Editor`)·메서드·이벤트가 같아 PB 코드는 어느 쪽이든 그대로 씁니다. **한 PC 에는 하나만 등록하세요.**

| | C++ 판 (`pb/ocx-native`) | .NET 판 (`pb/ocx`) |
|---|---|---|
| 필요한 것 | WebView2 런타임만 | .NET Framework **4.8** + WebView2 런타임 |
| 맞는 PC | .NET 4.0 만 있는 PC, Windows 7 SP1 포함 **(권장)** | .NET 4.8 을 깔 수 있는 PC |
| 파일 | `HwpxEditor.ocx` 하나 + `web\` | `HwpxEditorOcx.dll` + WebView2 DLL + `web\` |
| 등록 | `register.bat` (32비트 regsvr32) | `register.bat` (32비트 regasm) |

**빌드 없이 쓰려면** [Releases](https://github.com/Life9797/hwpxpb/releases) 에서 `HwpxEditor-native.zip`(C++ 판) 또는 `HwpxEditorOcx.zip`(.NET 판)을 받아 풀고,
**관리자 권한**으로 `register.bat` 을 실행합니다. 이 zip 은 GitHub Actions(`ocx` 작업)가 Windows 에서 빌드합니다.

직접 빌드할 때:
1. 에디터 화면 `pb/dist` 는 저장소에 들어 있습니다. 에디터를 고쳤을 때만 `scripts/build-pb-web.sh` 로 다시 만듭니다 (Linux/WSL/macOS)
2. C++ 판: Visual Studio 2022 (C++ 데스크톱 + ATL 구성 요소)
   ```
   cd pb\ocx-native
   nuget install Microsoft.Web.WebView2 -Version 1.0.4078.44 -OutputDirectory packages
   msbuild HwpxEditor.vcxproj /p:Configuration=Release /p:Platform=Win32
   ```
   → `bin\HwpxEditor.ocx`. 같은 폴더에 `pb/dist` 를 `web\` 로 복사해 둡니다.
3. .NET 판: `dotnet build pb/ocx -c Release` → `pb/ocx/bin/Release/net48/` 에 `HwpxEditorOcx.dll`, `Microsoft.Web.WebView2.*.dll`, `web\`
   - **.NET Framework 4.8** 이 필요합니다. 없으면 `register.bat` 이 알려 줍니다. regasm 이 `AsyncStateMachineAttribute 형식을 로드할 수 없습니다` 로 실패하는 것도 4.8 이 없어서입니다. 4.8 을 깔 수 없으면 C++ 판을 쓰세요.
   - 경고 `RA0000` (/codebase, 서명되지 않은 어셈블리) 은 무시해도 됩니다.
4. WebView2 런타임: Windows 10/11 은 대부분 기본 설치. 없으면 Microsoft "Evergreen Bootstrapper" 로 설치.

### Windows 7
- Windows 7 **SP1** 이 필요합니다. C++ 판은 .NET 이 필요 없고, .NET 판을 쓰려면 4.8 을 설치합니다 (Windows 7 SP1 에 설치됨).
- WebView2 런타임은 Windows 7 에서 **109** 가 마지막 버전입니다. 에디터 화면은 109 에서 쓰는 기능만 씁니다 (배포본의 JS 를 검사함, 실제 Win7 시험은 아직 안 함).
- 런타임을 PC 마다 설치하지 않으려면 109 **고정 버전(Fixed Version) x86** 런타임을 설치 폴더의 `webview2\` 에 풀어 둡니다. OCX 는 `webview2\msedgewebview2.exe` 가 있으면 그것을 씁니다.

### Windows 7 과 Windows 10 PC 가 섞여 있을 때
`win7\`(HwpxEditor-native-win7.zip)과 `win10\`(HwpxEditor-native.zip)을 함께 배포하고, PC 의 Windows 에 맞는 쪽을 등록합니다.
설치 때는 `examples/pb/install-by-os.bat`, 프로그램 안에서는 `examples/pb/n_hwpx_ocx.sru` 의 `of_ensure_registered()` 를 씁니다.
두 판은 ProgID·메서드가 같아 PB 코드는 하나입니다. 자세한 내용은 [예제 README](../examples/pb/README.md#windows-7--windows-10-에-맞는-ocx-쓰기).

## 3. PB 화면에 넣기
창 페인터 → Insert → OLE → **Insert Control** 탭 → `HwpxEditorControl` (ProgID `Hwpxpb.Editor`) 선택.
컨트롤 이름을 `ole_hwp` 로 둡니다. 이벤트 목록에 `ready`, `loaded`, `erroroccurred` 가 생깁니다.

## 4. 메서드

| 메서드 | 설명 |
|---|---|
| `Open(path, mode)` | 파일 열기. mode = `form`(작성: 값만 입력, 기본) / `edit`(편집: 문서 전체, **AllowEdit 필요**) / `view` |
| `AllowEdit` (속성) | 문서 전체 편집 권한. 기본 `false` = 작성만. PB 의 사용자 권한에 따라 `true` 로 둠 (아래 "편집 권한") |
| `GroupSep` (속성) | 누름틀 묶음(이름 `컬럼__x`) 값을 잇고 나누는 구분자. 기본 `"\|"`, `""` 이면 기본값. 아래 5절 |
| `ShowMenu` (속성) | 원래 에디터 메뉴·도구 모음 표시. 권한 없는 사용자에게는 항상 숨김. 권한자는 편집 모드에서 보이고, `true` 면 작성 모드에서도 보임. 기본 `false` |
| `GetColumns(order)` | DB 컬럼 이름을 탭으로 이어서. `order` = `"document"`(문서에 나오는 순서) / `"created"`(한글에서 개체를 넣은 순서: 누름틀 다음 양식 개체) / `"keep:"+이전 목록`(이전 목록 순서 그대로, 새 컬럼만 맨 뒤. 중간에 누름틀을 넣어도 기존 위치가 안 밀림. 예: `GetColumns("keep:" + ls_prev)`, `ls_prev` 는 지난번 결과를 저장해 둔 값) |
| `StartupTimes` (속성, C++ 판) | 시작에 걸린 시간: 런타임(WebView2 시작) / 화면(페이지 열기) / 에디터(엔진 준비) / 합계. 준비되면 `Status` 에도 함께 나옴 |
| `CloseDocument(askSave)` | 문서 닫기. 빈 화면이 되고, 다시 `Open` 하기 전까지 값 읽기·저장·인쇄는 false/`""` (`LastError` "열린 문서가 없습니다"). 편집 권한·모드·키 설정은 그대로. `askSave` 를 빼거나 `false` 면 묻지 않고 저장 없이 닫고, `true` 면 고친 문서일 때 저장할지 묻습니다 (아래 9절) |
| `IsModified()` | 사용자가 문서를 고쳤는지. 값 대입(`SetFields` 등)은 고침으로 치지 않음 |
| `CloseResult` (속성) | 마지막 `CloseDocument` 결과: `"save"`(예) / `"nosave"`(아니오·묻지 않음·고치지 않음) / `"cancel"`(취소) |
| `ClosedDocumentBase64` (속성) | `CloseResult` 가 `"save"` 일 때 닫은 문서(HWPX) base64. DB BLOB 저장용. 다음 `Open` 때 비워짐 |
| `SaveClosedDocument(path)` | `CloseResult` 가 `"save"` 일 때 닫은 문서를 파일로 저장 |
| `FitWidth()` | 좌우 여백을 뺀 본문 폭을 화면 폭에 꽉 차게 맞춤. 세로는 스크롤 (아래 10절) |
| `AutoFit` (속성) | `true` 면 문서를 열거나 값 대입·모드·창 크기가 바뀔 때, 쪽을 넘겨 여백이 다른 구역에 왔을 때마다 `FitWidth`. 기본 `false` |
| `SetShortcutLockModes(on, allow)` | 에디터 단축키 잠금 켜기/끄기. 모든 모드(작성·편집·보기)에 적용. `allow` = 잠금 중에도 허용할 키 (예: `"Ctrl+C,Ctrl+V"`, 빼면 없음) (아래 11절) |
| `GetShortcutLockModes()` | 단축키 잠금 상태 |
| `SetOcclusionDetection(on)` | 창 가림 감지 켜기/끄기 (기본 켜짐). PC 에 저장되고 **다음 실행부터** 적용. PB 디버거로 멈추거나 한 줄씩 진행할 때 에디터 화면이 비면 `False` 로 |
| `GetOcclusionDetection()` | 저장된 창 가림 감지 설정 |
| `RecoveryEnabled` (속성) | 복구용 자동 저장. 기본 `true`. 값은 PC 에 저장되어 다음 실행에도 쓰임 (아래 12절) |
| `OpenBase64(b64, fileName, mode)` | DB BLOB 등에서 읽은 내용을 base64 로 열기 |
| `SetFieldValue(column, value, comboSep)` | 값 하나 넣기. 성공하면 true |
| `GetFieldValue(column, comboSep)` | 값 하나 읽기 |
| `GetFieldsTsv(comboSep)` | 모든 값 `컬럼<TAB>값` 줄 목록 → DataWindow `ImportString` |
| `SetFields(json, comboSep)` | 여러 값을 JSON 으로 한 번에. 결과 JSON `{applied, unknown, rejected}` |
| `GetFields(comboSep)` | 모든 값 JSON `{"table":..,"values":{..}}` |
| `GetTable()` | 열려 있는 문서의 문서 정보에 적은 `dbtable=` 값 |
| `GetTableFromFile(path)` | 에디터에 열지 않고 파일의 `dbtable=` 값만 읽기. 열려 있는 문서는 그대로. 읽지 못하면 `""` 와 `LastError` |
| `GetSchema()` | 개체 목록 JSON |
| `SaveAs(path, comboSep)` | HWPX 로 저장. form 모드에서는 원본 양식에 값만 다시 넣어 저장하므로 서식이 바뀌지 않음 |
| `SavePdf(path)` | PDF 로 저장 |
| `Print()` | 인쇄 대화상자(미리보기)를 띄움. 프린터·매수·쪽 범위는 사용자가 고름 |
| `PrintTo(printerName, copies)` | 대화상자 없이 바로 인쇄. `printerName` 이 `""` 이면 기본 프린터 |
| `SelectPrinter()` | Windows 프린터 선택 창을 띄워 고른 프린터 이름을 돌려줌. 취소하면 `""`. 고른 이름을 `PrintTo` 에 넘김 |
| `PrintDialog()` | 프린터 선택 창에서 프린터·매수를 고르게 한 뒤 바로 인쇄. 취소하면 false (`LastError` 는 빈 문자열) |
| `GetPrinters()` | 설치된 프린터 이름 (줄마다 하나) |
| `GetDefaultPrinter()` | 기본 프린터 이름 |
| `SetKeys(nextObject, prevObject, nextField, prevField)` | 양식 입력에서 옮겨 다닐 키. `""` 는 그대로, `"none"` 은 끔 (아래 8절) |
| `MoveObject(delta)` | 다음(1)/이전(-1) 선택 개체로 이동. 버튼 등에서 부를 때 |
| `SetMode(mode)` | 모드 바꾸기 (`edit` 는 AllowEdit 가 true 일 때만) |
| `SetEditMode(edit)` | `true` 면 편집(`edit`, **AllowEdit 필요**), `false` 면 작성(`form`). 성공하면 true |
| `GetMode()` | 지금 모드 `form` / `edit` / `view` |
| `LastError` | 마지막 오류 메시지 |
| `IsReady` | 에디터 준비 여부 (`ready` 이벤트 이후 true) |
| `Status` | (C++ 판) 지금 단계. `IsReady` 가 계속 false 일 때 어디서 멈췄는지 보여 줌 (런타임 없음, web 폴더 없음, 화면 오류 등) |
| `BrowserVersion` | (C++ 판) 쓰는 WebView2 런타임 버전 |

`comboSep` 은 드롭다운 항목의 코드 구분자입니다. 빈 문자열이면 `:` 를 씁니다.
항목이 `01:서울` 이면 값은 `01`, 넣을 때도 `01` 만 주면 됩니다.

### 편집 권한 (작성 / 편집)
- **작성**(`form`): 누름틀·체크박스·라디오·드롭다운 값만 넣습니다. 저장 파일은 항상 "원본 양식 + 입력값" 이라 본문·서식은 바뀌지 않습니다.
- **편집**(`edit`): 문서 전체(본문, 표, 서식)를 고칩니다. 메뉴와 도구 상자가 보입니다.
- `AllowEdit` 가 `false`(기본)면 `Open(..., "edit")`, `SetMode("edit")` 는 false 를 돌려주고 `LastError` 에 "편집 권한이 없습니다" 가 들어갑니다. 이때는 어떤 모드든 저장 결과가 "원본 양식 + 입력값" 입니다.
- 편집 중에 `AllowEdit = false` 로 바꾸면 작성으로 돌아갑니다.
- 시작할 때는 에디터 화면을 숨겨 두었다가 메뉴 설정이 끝난 뒤 보여 주므로, 원래 메뉴가 잠깐 보였다 사라지지 않습니다.

```powerscript
// 사용자 권한에 따라 (권한 확인은 PB 앱의 사용자 테이블 등에서)
ole_hwp.object.AllowEdit = (gs_user_role = "ADMIN")
// 권한이 있으면 작성/편집을 고르게: ddlb_mode 에 "작성"(form), "편집"(edit)
ddlb_mode.Visible = ole_hwp.object.AllowEdit
...
ole_hwp.object.SetMode("edit")    // 권한이 없으면 false
ole_hwp.object.SetEditMode(true)  // 위와 같음. false 면 작성으로
ls_mode = string(ole_hwp.object.GetMode())   // form / edit / view
```

## 5. 값 규칙 (양식 만들 때)
- 테이블명: [파일 > 문서 정보] 키워드 또는 설명에 `dbtable=TB_PRESCRIPTION`
- 누름틀·드롭다운·단독 체크박스: 개체 이름 = 컬럼명. 단독 체크박스 값은 `Y`/`N`
- 다중 체크박스: 이름 `컬럼__코드` (밑줄 두 개). 값은 체크된 코드들 `01,02`
- 누름틀 묶음: 이름 `컬럼__아무거나` (예: `ADDR__1`, `ADDR__2`, `ADDR__3`). 문서에 나오는 순서대로 값을 `|` 로 이어 컬럼 하나로 추출 (`서울시|강남구|역삼동`). 넣을 때는 `|` 로 나눠 차례로 넣고, 조각이 모자라면 남은 칸은 비우고 남으면 마지막 칸에 나머지를 그대로 넣음. 같은 이름 누름틀이 여러 개면 한 칸으로 셈. 구분자는 `ole_hwp.object.GroupSep = ","` 처럼 바꿀 수 있음
- `__` 는 처음 나오는 곳에서 자르므로 컬럼명에는 `__` 를 쓰지 않습니다
- 라디오: 그룹 이름 = 컬럼, 선택된 버튼의 이름 = 값 (`컬럼__값` 도 허용)
- 목록에 없는 드롭다운 코드, 맞는 버튼이 없는 라디오 값은 넣지 않고 `rejected` 로 알려 줌

## 6. PowerScript 예시

바로 가져와 쓸 수 있는 예제 창은 [`examples/pb`](../examples/pb/) 에 있습니다 (파일 열기, DW → 문서 값 대입, 문서 → DW 값 추출, 저장, 인쇄).

```powerscript
// 창 open 이벤트: 에디터가 준비되면 ready 이벤트가 온다
// (ole_hwp 는 화면에 놓인 OLE 컨트롤)

// ole_hwp.ready 이벤트
// 이벤트 안에서 바로 무거운 호출을 하지 말고 post 로 넘긴다
Post Event ue_open()

// ue_open (창 사용자 이벤트)
string ls_path
ls_path = "C:\forms\처방전.hwpx"
If Not ole_hwp.object.Open(ls_path, "form") Then
	MessageBox("열기 실패", string(ole_hwp.object.LastError))
	Return
End If

// DB 값 → 문서
ole_hwp.object.SetFieldValue("PT_NM", dw_1.GetItemString(1, "pt_nm"), "")
ole_hwp.object.SetFieldValue("AGREE_YN", "Y", "")
ole_hwp.object.SetFieldValue("ITEM_CD", "01,02", "")   // 다중 체크박스
ole_hwp.object.SetFieldValue("SEX_CD", "F", "")        // 라디오
ole_hwp.object.SetFieldValue("REGION_CD", "02", "")    // 드롭다운: 코드만

// 저장 버튼: 문서 → DB
string ls_tsv, ls_table
ls_table = string(ole_hwp.object.GetTable())           // 예: TB_PRESCRIPTION
ls_tsv = string(ole_hwp.object.GetFieldsTsv(""))
dw_values.Reset()
dw_values.ImportString(ls_tsv)                         // 컬럼 2개(col, val) 외부 DataWindow
// 또는 하나씩
string ls_name
ls_name = string(ole_hwp.object.GetFieldValue("PT_NM", ""))

// 파일 저장
ole_hwp.object.SaveAs("C:\out\처방전_홍길동.hwpx", "")
ole_hwp.object.SavePdf("C:\out\처방전_홍길동.pdf")

// 출력: 대화상자를 띄우거나, 바로 기본 프린터로 2부
ole_hwp.object.Print()
If Not ole_hwp.object.PrintTo("", 2) Then MessageBox("인쇄 실패", string(ole_hwp.object.LastError))
// 특정 프린터로
ole_hwp.object.PrintTo("\\print01\진료실", 1)
```

출력(`Print`, `PrintTo`, `SavePdf`)에는 값이 비어 있는 누름틀의 안내문(빨간 글씨)이 찍히지 않습니다.
한글에서 인쇄할 때와 같습니다. 화면에는 계속 보입니다. 가로 용지 양식은 `PdfLandscape = true` 로 둡니다.

드롭다운 구분자가 `|` 인 양식이면 마지막 인자로 `"|"` 를 넘깁니다.
```powerscript
ole_hwp.object.SetFieldValue("REGION_CD", "02", "|")
```

## 7. 알아 둘 점
- 호출은 동기식입니다. OCX 가 내부에서 메시지를 돌리며 결과를 기다리고, `TimeoutSeconds`(기본 60초) 를 넘으면 실패합니다.
- 큰 문서는 `Open`/`SaveAs` 처럼 파일 경로로 주고받는 쪽이 빠릅니다.
- `ready` 이벤트 전에 부르면 실패합니다 (`IsReady` 로 확인).
- WebView2 사용자 데이터는 `%LOCALAPPDATA%\hwpxpb\WebView2` 에 저장됩니다.
- **창을 닫았다 다시 열 때 빨라집니다 (C++ 판).** 같은 PB 프로그램 안에서 WebView2 환경(브라우저 프로세스)을 컨트롤마다 새로 시작하지 않고 나눠 쓰고, 창을 닫을 때 에디터를 새로 초기화해 숨겨 둔 화면 1개를 다음 창이 가져다 씁니다.
  - 이전 문서·편집 권한·`ShowMenu`·키 설정은 초기화되어 이어지지 않습니다. 새 창에서 `AllowEdit`·`ShowMenu` 를 다시 적용한 뒤 `Ready` 가 옵니다.
  - 가져다 쓴 화면은 `Status`/`StartupTimes` 가 "재사용" 으로 시작합니다.
  - 안 쓰고 남겨 두는 시간은 환경 변수 `HWPXPB_KEEP_SECONDS` (초, 기본 600) 로 정합니다. 이 시간이 지나면 숨겨 둔 화면과 브라우저 프로세스를 닫습니다. `0` 이면 재사용하지 않고 이전처럼 매번 새로 시작합니다. 메모리가 부족한 PC 는 값을 줄이거나 0 으로 두세요.
  - `WebFolder` 가 다르면(숨겨 둔 화면과 다른 폴더) 재사용하지 않고 새로 시작합니다. .NET 판은 이 재사용이 없습니다.
  - 재사용 환경은 같은 UI 스레드와 같은 WebView2 런타임·사용자 데이터 폴더 설정을 전제로 합니다. 설정이 맞지 않으면 초기화 오류를 내며, 해당 컨트롤은 새 환경으로 임의 전환하지 않습니다.
  - 화면 초기화가 실패하면 오류 상태를 지우고 재생성을 시도합니다. 실패·시간 초과 시에는 보관 화면을 폐기하고 새 화면으로 복구합니다.

## 8. 키보드로 옮겨 다니기 (양식 입력 모드)

| 키 (기본) | 동작 |
|---|---|
| Tab / Shift+Tab | 다음/이전 누름틀 |
| Ctrl+Tab / Ctrl+Shift+Tab | 다음/이전 선택 개체 (체크박스·라디오·드롭다운). 고른 개체에 파란 테두리 |
| Space 또는 Enter | 고른 체크박스 켜기/끄기, 라디오 선택, 드롭다운 목록 열기 |
| ↑ ↓, Enter, Esc | 열린 드롭다운 목록에서 고르기, 정하기, 닫기 |
| Esc | 선택 개체 고르기 해제 |

선택 개체는 쪽 → 위에서 아래 → 왼쪽에서 오른쪽 순서로 옮겨 가고, 처음에는 커서 다음 개체부터 고릅니다.

키는 사용자가 바꿀 수 있습니다. 화면을 열 때(ready 이벤트 뒤) 부르고, 사용자별 값은 PB 쪽(INI·DB)에 두면 됩니다.
```powerscript
// 선택 개체 이동을 F8 / Shift+F8 로, 누름틀은 그대로
ole_hwp.object.SetKeys("F8", "Shift+F8", "", "")
// 누름틀 이동을 Enter 로 (Tab 도 계속 됨)
ole_hwp.object.SetKeys("", "", "Enter", "Shift+Enter")
```
키 이름: `Ctrl`, `Alt`, `Shift` 와 키를 `+` 로 잇습니다. 예: `Ctrl+Tab`, `F8`, `Alt+N`, `Ctrl+Down`, `PageDown`.

## 9. 닫을 때 저장 여부 묻기

```powerscript
// 묻지 않고 저장 없이 닫기 (이전과 같음)
ole_hwp.object.CloseDocument(false)      // 또는 CloseDocument()

// 고친 문서면 에디터 화면에 "변경 내용을 저장할까요?" (예 / 아니오 / 취소)
If Not ole_hwp.object.CloseDocument(true) Then
	If string(ole_hwp.object.CloseResult) = "cancel" Then Return 1   // 취소: 문서는 그대로 열려 있음
	MessageBox("닫기 실패", string(ole_hwp.object.LastError))
	Return 1
End If
If string(ole_hwp.object.CloseResult) = "save" Then
	ole_hwp.object.SaveClosedDocument("C:\out\처방전_홍길동.hwpx")
	// DB BLOB 이면: ls_b64 = string(ole_hwp.object.ClosedDocumentBase64)
End If
```
- 사용자가 고치지 않았으면 묻지 않고 닫습니다 (`CloseResult` = `"nosave"`). 값 대입(`SetFields` 등)은 고침으로 치지 않습니다. 미리 확인하려면 `IsModified()`.
- 창은 PB 가 아니라 에디터 화면 안에 뜹니다. Enter = 예, Esc = 취소.
- 사용자가 답할 때까지 기다리므로 이 호출에는 `TimeoutSeconds` 가 적용되지 않습니다.
- 창이 떠 있는 동안 PB 단추 등으로 부른 다른 메서드는 실행하지 않고 실패합니다 (`LastError` "저장 확인 창이 열려 있습니다"). 상태만 읽는 `IsModified`·`GetShortcutLockModes` 등은 됩니다. PB 창을 닫으면 확인 창은 취소로 닫힙니다.
- "예" 의 문서는 `SaveAs` 와 같습니다 (작성 모드면 원본 양식 + 입력값). 드롭다운 코드 구분자는 `:` 입니다.
- 닫힌 뒤 `closed` 이벤트가 옵니다 (인자 `result` = `"save"` / `"nosave"`, 취소하면 오지 않음). 이벤트 목록에 안 보이면 컨트롤을 지웠다 다시 넣습니다.
- `ClosedDocumentBase64` 는 다음 `Open`/`OpenBase64` 때 비워집니다.

## 10. 본문 폭에 맞추기

`FitWidth()` 는 좌우 여백을 뺀 본문 폭이 화면 폭에 꽉 차도록 배율을 정하고, 본문 왼쪽 끝을 화면 왼쪽에 맞춥니다. 세로는 스크롤합니다.
여백은 화면 가운데에 보이는 쪽의 것을 씁니다. `AutoFit` 이면 쪽을 넘기다 여백(또는 용지)이 다른 구역에 왔을 때 다시 맞춥니다.
```powerscript
ole_hwp.object.FitWidth()          // 지금 한 번
ole_hwp.object.AutoFit = True      // 열기·값 대입·모드 변경·창 크기 변경 때마다 자동으로
```

## 11. 단축키 잠금

```powerscript
ole_hwp.object.SetShortcutLockModes(True)    // 잠금
ole_hwp.object.SetShortcutLockModes(False)   // 풀기 (기본)
lb_locked = ole_hwp.object.GetShortcutLockModes()
// 잠그되 복사·붙여넣기·되돌리기는 허용
ole_hwp.object.SetShortcutLockModes(True, "Ctrl+C,Ctrl+V,Ctrl+Z")
```
- 막는 키: Ctrl·Alt 조합 (Ctrl+S/O/N/P/Z/C/V, Ctrl+G 등)과 F1~F24. 작성·편집·보기 모든 모드에 적용됩니다.
- 그대로 되는 키: 글자 입력(한글 포함), 방향키, Tab, Enter, Backspace, Delete, Esc, `SetKeys` 로 정한 양식 이동 키, 그리고 `allow` 에 적은 키.
- `allow` 는 부를 때마다 새로 정합니다 (빼면 허용 키 없음). 키 이름은 `SetKeys` 와 같습니다.
- 마우스 오른쪽 메뉴, `ShowMenu` 로 보이는 메뉴·도구 모음은 막지 않습니다.

## 12. 복구용 자동 저장

에디터는 편집 중 복구본을 자동 저장하고(10분마다, 10초 쉴 때), 프로그램이 비정상 종료된 뒤 다시 시작하면
"저장되지 않은 문서 복구본이 있습니다" 라고 묻습니다.
```powerscript
ole_hwp.object.RecoveryEnabled = False   // 끄기: 복구본을 만들지 않고, 남은 복구본도 지움 → 시작할 때 묻지 않음
ole_hwp.object.RecoveryEnabled = True    // 켜기 (기본)
```
- 에디터는 시작하자마자 복구를 묻습니다. **컨트롤을 만든 직후(창 open 이벤트 등, `ready` 전)에 정하면** OCX 가 화면을 열 때 값을 넘겨 그 실행부터 묻지 않습니다. `ready` 뒤에 정하면 이번 실행에는 이미 물었을 수 있고, 다음 실행부터 적용됩니다.
- 값은 PC(WebView2 사용자 데이터 `%LOCALAPPDATA%\hwpxpb\WebView2`)에 저장되어 다음 실행에도 쓰입니다. 이 OCX 를 쓰는 그 PC 의 모든 PB 프로그램이 같은 값을 씁니다.
- `CloseDocument` 로 닫거나 PB 창을 닫은 문서의 복구본은 지웁니다 (다음에 묻지 않음). 복구를 묻는 것은 프로그램이 비정상 종료됐을 때뿐입니다.
