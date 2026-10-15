# hwpxpb

HWPX(한글) 양식의 **누름틀·체크박스·라디오·드롭다운 값만** 넣고 빼는 도구입니다.
양식의 서식·표·배치는 건드리지 않습니다.

| 구성 | 위치 | 용도 |
|---|---|---|
| 엔진 | `engine/` | 값 대입/추출 (브라우저·Node 공용 JavaScript) |
| Unix 서버 | `server/`, `Dockerfile` | 브라우저 없이 HTTP API·명령행으로 HWPX/PDF 생성 → [서버 가이드](docs/server-guide.md) |
| PB 연동 | `pb/` | PowerBuilder 12.1 창 안에 에디터를 넣는 WebView2 OCX, 서버 불필요 → [PB 가이드](docs/pb-guide.md) |

에디터 화면과 PDF 변환은 오픈소스 [rhwp](https://github.com/edwardkim/rhwp) (MIT, v0.8.7 고정)를 씁니다.

## 값 규칙

| 개체 | 이름 짓는 법 | 값 |
|---|---|---|
| 테이블 | [파일 > 문서 정보] 키워드나 설명에 `dbtable=테이블명` | |
| 누름틀 | 필드 이름 = 컬럼명 | 글자 |
| 체크박스 (하나) | 이름 = 컬럼명 | `Y` / `N` |
| 체크박스 (여러 개 중 선택) | 이름 = `컬럼__코드` | 체크된 코드 `01,02` |
| 라디오 | 그룹 이름 = 컬럼명, 버튼 이름 = 값 | 선택된 버튼 이름 |
| 드롭다운 | 이름 = 컬럼명, 항목 = `코드:표시` | 코드. 넣을 때도 코드만 주면 됨. 구분자는 호출할 때 지정 (기본 `:`) |

추출 결과 예: `{"table":"TB_PRESCRIPTION","values":{"PT_NM":"홍길동","AGREE_YN":"Y","ITEM_CD":"01,02"}}`

## 개발

```bash
npm ci
npm test          # engine + server 테스트
```

## 라이선스
이 저장소의 라이선스는 아직 정하지 않았습니다. 함께 쓰는 rhwp 는 MIT (Copyright Edward Kim) 이며, 배포본에 그 고지를 포함합니다.
이 프로젝트는 한글과컴퓨터와 관련이 없습니다.
