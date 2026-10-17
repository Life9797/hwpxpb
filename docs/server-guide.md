# Unix 서버 가이드

양식(HWPX)에 값을 넣어 HWPX·PDF 를 만들거나, 작성된 HWPX 에서 값을 뽑습니다.
서버에는 브라우저도 한글 프로그램도 필요 없습니다. 같은 일을 HTTP API 와 명령행 도구 두 가지로 할 수 있고,
서버 주소로 접속하면 브라우저에서 쓰는 웹 에디터도 열립니다.

## 1. 실행

```bash
docker compose up -d --build          # http://서버:8080
# API 키를 쓰려면
API_KEY=비밀값 docker compose up -d --build
```

Docker 없이:
```bash
pip install ./server                     # Python 3.9 이상. 다른 패키지는 설치하지 않음
RHWP_BIN=/경로/rhwp TEMPLATE_DIR=./templates hwpxpb serve
# 설치 없이: cd server && python3 -m hwpxpb serve
```
저장소에서 실행하면 `pb/dist` 의 에디터 화면을 자동으로 씁니다.
PDF 출력에는 rhwp 명령행 도구(`cargo build --release --bin rhwp`, rhwp v0.8.7)와 한글 글꼴(`fonts-nanum` 등)이 필요합니다.

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | 8080 | |
| `TEMPLATE_DIR` | `./templates` (도커: `/data/templates`) | 등록한 양식 보관 폴더 |
| `API_KEY` | (없음) | 설정하면 모든 `/api` 요청에 `X-API-Key` 헤더 필요 |
| `RHWP_BIN` | `rhwp` | PDF 변환기 경로 |
| `FONT_PATHS` | | PDF 글꼴 폴더 (`:` 로 여러 개) |
| `EDIT_KEYS` | (없음) | 문서 전체 편집 권한을 주는 키 (쉼표로 여러 개). `?key=` 또는 `X-API-Key` 로 받음. `*` 는 모두 허용 |
| `EDIT_USERS` | (없음) | 편집 권한을 줄 사용자 이름 (쉼표). `AUTH_USER_HEADER` 와 함께 씀 |
| `AUTH_USER_HEADER` | (없음) | 앞단 인증 프록시(SSO 등)가 로그인 사용자 이름을 넣는 헤더. 예: `X-Remote-User` |
| `WEB_DIR` | 저장소의 `pb/dist` (도커: `/app/web`) | 웹 에디터 화면 폴더. 빈 문자열이면 화면 없이 API 만 |
| `PDF_FALLBACK_SANS` / `_SERIF` / `_MONO` | Noto CJK KR | 문서 글꼴이 서버에 없을 때 쓸 글꼴 이름 (예: `NanumGothic`). 한글 글꼴이 하나도 없으면 PDF 에 글자가 빈칸으로 나옵니다 |

## 2. 웹 에디터 (브라우저로 접속)

서버 주소(`http://서버:8080/`)로 접속하면 에디터 화면이 열립니다. 위쪽 버튼으로 다음을 합니다.

| 버튼 | 하는 일 |
|---|---|
| 열기 | PC 의 HWPX 파일 열기 |
| 작성 / 편집 | 작성: 값만 넣음. 편집: 문서 전체를 고침. **편집 권한이 있을 때만 보임** (아래 "편집 권한") |
| 저장 (Ctrl+S) | 연 PC 파일에 그대로 저장 |
| 다른 이름으로 저장 | 새 파일로 저장 |
| 값 저장(JSON) | 입력값을 DB 컬럼 기준 JSON 으로 저장 |
| 인쇄 / PDF (Ctrl+P) | 인쇄 대화상자. 프린터 또는 "PDF로 저장" 선택. 빈 칸 안내문은 찍지 않음 |
| 이동 키 설정 | 양식 입력에서 누름틀·선택 개체(체크박스·라디오·드롭다운) 사이를 옮길 키. 이 브라우저에 저장됨 |

양식 입력에서는 Tab 으로 누름틀, Ctrl+Tab 으로 선택 개체를 옮겨 다니고 Space/Enter 로 체크·선택합니다
(자세한 키는 [PB 가이드 8절](pb-guide.md#8-키보드로-옮겨-다니기-양식-입력-모드)).
Chrome·Edge 에서는 Ctrl+Tab 이 탭 전환에 먼저 쓰여 화면까지 오지 않으므로, 브라우저에서는 "이동 키 설정"에서 F8 같은 키로 바꿔 쓰세요.

- 연 파일에 바로 저장하는 기능은 Chrome·Edge 에서, **https 주소나 localhost** 로 접속했을 때만 됩니다.
  `http://서버주소` 로 접속하면 저장 버튼이 파일 내려받기로 바뀝니다. 사내에서는 앞단 웹서버(nginx 등)에 https 를 붙여 쓰기를 권합니다.
- 등록한 양식을 바로 열기: `http://서버:8080/?template=rx01` (`&mode=edit` 자유 편집, `&comboSep=|` 드롭다운 구분자)
- `API_KEY` 를 설정한 서버에서는 에디터 화면 파일은 키 없이 열리고, 양식을 불러올 때만 키가 필요합니다: `?template=rx01&key=비밀값`
- 파일은 브라우저 안에서만 처리되고 서버로 올라가지 않습니다.

### 편집 권한
- 화면은 열릴 때 `GET /api/permission` 으로 편집 권한을 묻습니다. 권한이 없으면 "작성 전용" 표시가 뜨고 작성만 됩니다.
  `&mode=edit` 도 무시하고, 저장 파일은 항상 "원본 양식 + 입력값" 입니다.
- 권한은 둘 중 하나로 줍니다. **아무것도 설정하지 않으면 아무도 편집할 수 없습니다.**
  - 키: `EDIT_KEYS=관리자키` 로 띄우고 `http://서버:8080/?template=rx01&key=관리자키` 로 접속
  - 사내 로그인: 앞단 프록시가 로그인 사용자를 헤더로 넘기면 `AUTH_USER_HEADER=X-Remote-User EDIT_USERS=kim,lee`
    (이 헤더는 누구나 꾸며 보낼 수 있으므로, 서버에 프록시를 거쳐서만 접속할 수 있을 때만 쓰세요)
- 편집 제한은 화면과 저장 결과에서 겁니다. 파일을 PC 에서 다른 프로그램(한글 등)으로 고치는 것까지 막지는 않습니다.
- 에디터 화면은 저장소의 `pb/dist` 를 씁니다 (도커 이미지에도 들어 있음). 다른 위치는 `WEB_DIR` 로 지정합니다.

## 3. HTTP API

```bash
H='X-API-Key: 비밀값'

# 양식 등록 (ID: 영문·숫자·한글·_ . -)
curl -H "$H" -X PUT --data-binary @처방전.hwpx http://srv:8080/api/templates/rx01

# 개체 목록 + 테이블명
curl -H "$H" http://srv:8080/api/templates/rx01/schema

# 값 넣어 HWPX 받기 (결과 요약은 X-Fill-Result 헤더, URL 인코딩된 JSON)
curl -H "$H" -H 'Content-Type: application/json' -o out.hwpx http://srv:8080/api/fill \
  -d '{"templateId":"rx01","values":{"PT_NM":"홍길동","AGREE_YN":"Y","REGION_CD":"02"}}'

# PDF 로 받기
curl -H "$H" -o out.pdf http://srv:8080/api/fill \
  -d '{"templateId":"rx01","values":{"PT_NM":"홍길동"},"format":"pdf"}'

# 작성된 문서에서 값 뽑기
curl -H "$H" --data-binary @작성본.hwpx 'http://srv:8080/api/extract?comboSep=:'
```

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/health` | 상태 확인 (인증 없음) |
| GET | `/api/templates` | 양식 목록 `[{id,size,modified,table}]` |
| PUT | `/api/templates/{id}` | 양식 등록/교체 (본문: HWPX) |
| GET | `/api/templates/{id}` | 양식 파일 |
| GET | `/api/templates/{id}/schema` | `{table, schema:[{name,type,guide,group,items}]}` |
| POST | `/api/fill` | 값 대입. 아래 본문 참고 |
| POST | `/api/extract?comboSep=:` | 본문 HWPX → `{table, values}` |
| POST | `/api/schema` | 본문 HWPX → `{table, schema}` |
| POST | `/api/pdf` | 본문 HWPX → PDF |

`/api/fill` 본문:
```json
{
  "templateId": "rx01",          // 또는 "template": "<HWPX base64>"
  "values": { "PT_NM": "홍길동", "ITEM_CD": "01,02" },
  "comboSep": ":",               // 드롭다운 코드 구분자 (기본 ":")
  "format": "hwpx",              // hwpx | pdf | both (both 는 JSON 에 base64 둘 다)
  "strict": false                // true 면 대입 못 한 값이 있을 때 422
}
```
PDF 에는 값이 비어 있는 누름틀의 안내문이 찍히지 않습니다 (한글 인쇄와 같음).

결과 요약 `{applied, unknown, rejected}`: 넣은 컬럼 / 양식에 없는 컬럼 / 양식에는 있지만 넣지 못한 컬럼(목록에 없는 코드 등).

## 4. 명령행 도구 (배치·쉘)

```bash
hwpxpb schema  양식.hwpx
hwpxpb extract 작성본.hwpx [--combo-sep :]
hwpxpb fill    양식.hwpx 값.json -o 결과.hwpx [--pdf 결과.pdf] [--combo-sep :] [--strict]
echo '{"PT_NM":"홍길동"}' | hwpxpb fill 양식.hwpx - -o 결과.hwpx
hwpxpb pdf     문서.hwpx -o 문서.pdf
```
도커 안에서: `docker compose exec server hwpxpb fill /data/templates/rx01.hwpx - -o /data/out.hwpx`
