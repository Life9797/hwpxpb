# rhwp 보완 패치

rhwp v0.8.7 에 적용해서 빌드합니다 (`Dockerfile`, `scripts/build-pb-web.sh` 가 자동 적용).

## 0001-render-floating-form-objects-in-table-cells
표 칸 안에 "글자처럼 취급"이 꺼진(떠 있는) 양식 개체(체크박스·라디오·드롭다운 등)가 화면·PDF 에
전혀 그려지지 않던 문제를 고칩니다. 본문에 떠 있는 양식 개체용 배치(`form_object_origin`)를
칸 안쪽 영역 기준으로 그대로 씁니다.

실제 처방전 양식(체크박스 7개·41개, 모두 칸 안에 떠 있음)에서 확인했습니다.
upstream(edwardkim/rhwp) 에 반영되면 이 패치는 지웁니다.
