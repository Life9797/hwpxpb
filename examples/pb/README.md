# PB 12.1 예제: 파일 열기 · 값 대입 · 값 추출 → DW

`w_hwpx_demo.srw` 창 하나로 다음을 보여 줍니다.

| 버튼 | 하는 일 | 쓰는 OCX 메서드 |
|---|---|---|
| `...` / 열기 | HWPX 파일을 골라 연다. 창을 열 때 파일을 넘기면 준비되자마자 연다 | `Open(path, mode)` |
| 편집 권한 / 작성·편집 | 권한이 있을 때만 문서 전체 편집 | `AllowEdit`, `SetMode` |
| DW → 문서 (값 대입) | DW 1행의 모든 컬럼 값을 문서에 한 번에 넣는다 | `SetFields(json, sep)` |
| 문서 → DW (값 추출) | 문서의 모든 값을 DW 1행에 넣는다 (DW 에 있는 컬럼만, 형식 맞춰서) | `GetFieldsTsv(sep)`, `GetTable()` |
| DW 만들기 | 연 양식의 개체 이름으로 DW 를 만든다 (DW 없이 시험할 때) | `GetFieldsTsv` |
| 저장 / 인쇄 | 작성한 문서를 HWPX 로 저장 / 인쇄 대화상자 | `SaveAs`, `Print` |

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

## 값 규칙 (요약)
- 누름틀·드롭다운·단독 체크박스: 개체 이름 = 컬럼. 체크박스 값 `Y`/`N`
- 다중 체크박스 `컬럼__코드` → 값 `01,02`, 라디오 그룹 = 컬럼, 고른 버튼 이름 = 값
- 드롭다운 항목 `01:서울` → 값 `01` (구분자는 `is_sep`, "" 이면 `:`)

자세한 메서드 설명은 [PB 가이드](../../docs/pb-guide.md).

이 파일은 손으로 작성한 PB 내보내기 형식(cp949)입니다. 가져오기에서 오류가 나면 메시지를 알려 주세요.
