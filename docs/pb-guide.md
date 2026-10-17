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

## 3. PB 화면에 넣기
창 페인터 → Insert → OLE → **Insert Control** 탭 → `HwpxEditorControl` (ProgID `Hwpxpb.Editor`) 선택.
컨트롤 이름을 `ole_hwp` 로 둡니다. 이벤트 목록에 `ready`, `loaded`, `erroroccurred` 가 생깁니다.

## 4. 메서드

| 메서드 | 설명 |
|---|---|
| `Open(path, mode)` | 파일 열기. mode = `form`(작성: 값만 입력, 기본) / `edit`(편집: 문서 전체, **AllowEdit 필요**) / `view` |
| `AllowEdit` (속성) | 문서 전체 편집 권한. 기본 `false` = 작성만. PB 의 사용자 권한에 따라 `true` 로 둠 (아래 "편집 권한") |
| `ShowMenu` (속성) | 원래 에디터 메뉴·도구 모음 표시. 권한 없는 사용자에게는 항상 숨김. 권한자는 편집 모드에서 보이고, `true` 면 작성 모드에서도 보임. 기본 `false` |
| `GetColumns(order)` | DB 컬럼 이름을 탭으로 이어서. `order` = `"document"`(문서에 나오는 순서) / `"created"`(한글에서 개체를 넣은 순서: 누름틀 다음 양식 개체) |
| `StartupTimes` (속성, C++ 판) | 시작에 걸린 시간: 런타임(WebView2 시작) / 화면(페이지 열기) / 에디터(엔진 준비) / 합계. 준비되면 `Status` 에도 함께 나옴 |
| `OpenBase64(b64, fileName, mode)` | DB BLOB 등에서 읽은 내용을 base64 로 열기 |
| `SetFieldValue(column, value, comboSep)` | 값 하나 넣기. 성공하면 true |
| `GetFieldValue(column, comboSep)` | 값 하나 읽기 |
| `GetFieldsTsv(comboSep)` | 모든 값 `컬럼<TAB>값` 줄 목록 → DataWindow `ImportString` |
| `SetFields(json, comboSep)` | 여러 값을 JSON 으로 한 번에. 결과 JSON `{applied, unknown, rejected}` |
| `GetFields(comboSep)` | 모든 값 JSON `{"table":..,"values":{..}}` |
| `GetTable()` | 문서 정보에 적은 `dbtable=` 값 |
| `GetSchema()` | 개체 목록 JSON |
| `SaveAs(path, comboSep)` | HWPX 로 저장. form 모드에서는 원본 양식에 값만 다시 넣어 저장하므로 서식이 바뀌지 않음 |
| `SavePdf(path)` | PDF 로 저장 |
| `Print()` | 인쇄 대화상자(미리보기)를 띄움. 프린터·매수·쪽 범위는 사용자가 고름 |
| `PrintTo(printerName, copies)` | 대화상자 없이 바로 인쇄. `printerName` 이 `""` 이면 기본 프린터 |
| `GetPrinters()` | 설치된 프린터 이름 (줄마다 하나) |
| `GetDefaultPrinter()` | 기본 프린터 이름 |
| `SetKeys(nextObject, prevObject, nextField, prevField)` | 양식 입력에서 옮겨 다닐 키. `""` 는 그대로, `"none"` 은 끔 (아래 8절) |
| `MoveObject(delta)` | 다음(1)/이전(-1) 선택 개체로 이동. 버튼 등에서 부를 때 |
| `SetMode(mode)` | 모드 바꾸기 (`edit` 는 AllowEdit 가 true 일 때만) |
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
```

## 5. 값 규칙 (양식 만들 때)
- 테이블명: [파일 > 문서 정보] 키워드 또는 설명에 `dbtable=TB_PRESCRIPTION`
- 누름틀·드롭다운·단독 체크박스: 개체 이름 = 컬럼명. 단독 체크박스 값은 `Y`/`N`
- 다중 체크박스: 이름 `컬럼__코드` (밑줄 두 개). 값은 체크된 코드들 `01,02`
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
