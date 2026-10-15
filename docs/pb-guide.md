# PowerBuilder 12.1 연동 가이드 (서버 없이)

PB 창 안에 HWPX 에디터를 OLE 컨트롤로 넣고, 누름틀·체크박스·라디오·드롭다운 값을 넣고 뺍니다.
에디터는 PC 안에서만 돌며 서버나 네트워크가 필요 없습니다.

## 1. 구성
```
PB 12.1 창 ── OLE 컨트롤 "Hwpxpb.Editor" (pb/ocx, 32비트 ActiveX)
                 └─ Microsoft Edge WebView2 ── 설치 폴더\web\ (pb/dist)
                      ├─ rhwp-studio (HWP/HWPX 편집기, WASM)
                      └─ bridge.js + 값 대입/추출 엔진(engine/)
```

## 2. 빌드와 설치 (Windows)
1. 에디터 화면 빌드 (Linux/WSL/macOS 어디서나): `scripts/build-pb-web.sh` → `pb/dist`
2. OCX 빌드 (Windows, Visual Studio 2022 또는 .NET SDK): `dotnet build pb/ocx -c Release`
   → `pb/ocx/bin/Release/net48/` 에 `HwpxEditorOcx.dll`, `Microsoft.Web.WebView2.*.dll`, `web\` 가 생깁니다.
3. 각 PC에 위 폴더를 복사하고 **관리자 권한**으로 `register.bat` 실행 (32비트 regasm 사용)
4. WebView2 런타임: Windows 10/11 은 대부분 기본 설치. 없으면 Microsoft "Evergreen Bootstrapper" 로 설치.

## 3. PB 화면에 넣기
창 페인터 → Insert → OLE → **Insert Control** 탭 → `HwpxEditorControl` (ProgID `Hwpxpb.Editor`) 선택.
컨트롤 이름을 `ole_hwp` 로 둡니다. 이벤트 목록에 `ready`, `loaded`, `erroroccurred` 가 생깁니다.

## 4. 메서드

| 메서드 | 설명 |
|---|---|
| `Open(path, mode)` | 파일 열기. mode = `form`(값만 입력, 기본) / `edit`(자유 편집) / `view` |
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
| `SetMode(mode)` | 모드 바꾸기 |
| `LastError` | 마지막 오류 메시지 |
| `IsReady` | 에디터 준비 여부 (`ready` 이벤트 이후 true) |

`comboSep` 은 드롭다운 항목의 코드 구분자입니다. 빈 문자열이면 `:` 를 씁니다.
항목이 `01:서울` 이면 값은 `01`, 넣을 때도 `01` 만 주면 됩니다.

## 5. 값 규칙 (양식 만들 때)
- 테이블명: [파일 > 문서 정보] 키워드 또는 설명에 `dbtable=TB_PRESCRIPTION`
- 누름틀·드롭다운·단독 체크박스: 개체 이름 = 컬럼명. 단독 체크박스 값은 `Y`/`N`
- 다중 체크박스: 이름 `컬럼__코드` (밑줄 두 개). 값은 체크된 코드들 `01,02`
- 라디오: 그룹 이름 = 컬럼, 선택된 버튼의 이름 = 값 (`컬럼__값` 도 허용)
- 목록에 없는 드롭다운 코드, 맞는 버튼이 없는 라디오 값은 넣지 않고 `rejected` 로 알려 줌

## 6. PowerScript 예시

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
```

드롭다운 구분자가 `|` 인 양식이면 마지막 인자로 `"|"` 를 넘깁니다.
```powerscript
ole_hwp.object.SetFieldValue("REGION_CD", "02", "|")
```

## 7. 알아 둘 점
- 호출은 동기식입니다. OCX 가 내부에서 메시지를 돌리며 결과를 기다리고, `TimeoutSeconds`(기본 60초) 를 넘으면 실패합니다.
- 큰 문서는 `Open`/`SaveAs` 처럼 파일 경로로 주고받는 쪽이 빠릅니다.
- `ready` 이벤트 전에 부르면 실패합니다 (`IsReady` 로 확인).
- WebView2 사용자 데이터는 `%LOCALAPPDATA%\hwpxpb\WebView2` 에 저장됩니다.
