# Unix 서버 가이드 (브라우저 없이)

양식(HWPX)에 값을 넣어 HWPX·PDF 를 만들거나, 작성된 HWPX 에서 값을 뽑습니다.
브라우저도 한글 프로그램도 필요 없습니다. 같은 일을 HTTP API 와 명령행 도구 두 가지로 할 수 있습니다.

## 1. 실행

```bash
docker compose up -d --build          # http://서버:8080
# API 키를 쓰려면
API_KEY=비밀값 docker compose up -d --build
```

Docker 없이:
```bash
npm ci && RHWP_BIN=/경로/rhwp TEMPLATE_DIR=./templates node server/src/main.js
```
PDF 출력에는 rhwp 명령행 도구(`cargo build --release --bin rhwp`, rhwp v0.8.7)와 한글 글꼴(`fonts-nanum` 등)이 필요합니다.

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | 8080 | |
| `TEMPLATE_DIR` | `./templates` (도커: `/data/templates`) | 등록한 양식 보관 폴더 |
| `API_KEY` | (없음) | 설정하면 모든 `/api` 요청에 `X-API-Key` 헤더 필요 |
| `RHWP_BIN` | `rhwp` | PDF 변환기 경로 |
| `FONT_PATHS` | | PDF 글꼴 폴더 (`:` 로 여러 개) |
| `PDF_FALLBACK_SANS` / `_SERIF` / `_MONO` | Noto CJK KR | 문서 글꼴이 서버에 없을 때 쓸 글꼴 이름 (예: `NanumGothic`). 한글 글꼴이 하나도 없으면 PDF 에 글자가 빈칸으로 나옵니다 |

## 2. HTTP API

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
결과 요약 `{applied, unknown, rejected}`: 넣은 컬럼 / 양식에 없는 컬럼 / 양식에는 있지만 넣지 못한 컬럼(목록에 없는 코드 등).

## 3. 명령행 도구 (배치·쉘)

```bash
hwpxpb schema  양식.hwpx
hwpxpb extract 작성본.hwpx [--combo-sep :]
hwpxpb fill    양식.hwpx 값.json -o 결과.hwpx [--pdf 결과.pdf] [--combo-sep :] [--strict]
echo '{"PT_NM":"홍길동"}' | hwpxpb fill 양식.hwpx - -o 결과.hwpx
hwpxpb pdf     문서.hwpx -o 문서.pdf
```
도커 안에서: `docker compose exec server hwpxpb fill /data/templates/rx01.hwpx - -o /data/out.hwpx`
