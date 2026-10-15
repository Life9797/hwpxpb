# rhwp 보완 패치

rhwp v0.8.7 에 적용해서 빌드합니다 (`Dockerfile`, `scripts/build-pb-web.sh` 가 자동 적용).

## 0001-render-floating-form-objects-in-table-cells
표 칸 안에 "글자처럼 취급"이 꺼진(떠 있는) 양식 개체(체크박스·라디오·드롭다운 등)가 화면·PDF 에
전혀 그려지지 않던 문제를 고칩니다. 본문에 떠 있는 양식 개체용 배치(`form_object_origin`)를
칸 안쪽 영역 기준으로 그대로 씁니다.

실제 처방전 양식(체크박스 7개·41개, 모두 칸 안에 떠 있음)에서 확인했습니다.
upstream(edwardkim/rhwp) 에 반영되면 이 패치는 지웁니다.

## 0002-keyboard-navigation-for-form-objects
양식 모드에서 체크박스·라디오·드롭다운·입력 상자를 키보드로 고를 수 있게 합니다
(원래는 마우스로만 조작됨).
- WASM `getFormObjectsOnPage(page)`: 쪽 안의 양식 개체 목록 (`getFormObjectAt` 결과 모양)
- 에디터 `moveToAdjacentFormObject(±1)`: 다음/이전 개체를 파란 테두리로 고름 (쪽 → 위 → 왼쪽 순,
  처음에는 커서 다음 개체부터). Space/Enter 로 체크·선택·목록 열기, 목록은 ↑↓·Enter·Esc, Esc 로 고르기 해제
- `window.rhwpStudio.formNavigation` (`moveObject`, `moveField`, `focusedObject`, `clear`): 같은 출처 호스트가 부르는 진입점
- 어떤 키로 옮길지는 이 패치가 정하지 않습니다. hwpxpb 화면(`pb/web/bridge.js`)이 키를 받아 부릅니다 (기본 Ctrl+Tab)

같이 고친 것 (마우스 클릭에도 해당):
- 표 칸 안의 라디오·드롭다운을 눌러도 아무 일이 없던 문제. 개체 정보 조회가 본문 개체만 찾았음
  → WASM `getFormObjectInfoInCell` 추가, 값 쓰기도 칸 경로로
- HWPX 드롭다운 목록이 비어 열리지 않던 문제. 항목을 HWP 스크립트에서만 읽었음 → `<hp:listItem>` 값도 씀
- HWPX 라디오가 같은 그룹의 다른 버튼을 끄지 않던 문제. 그룹 이름을 `GroupName` 으로만 찾았고 같은 문단만 봤음
  → `RadioGroupName` 도 보고, 같은 구역의 모든 쪽에서 찾음
