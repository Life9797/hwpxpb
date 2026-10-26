# Unix 서버용 이미지 (Python): 브라우저 없이 HWPX 값 대입/추출 + PDF 출력,
# 그리고 서버 주소(http://서버:8080/)로 접속하면 웹 에디터(열기·편집·저장·인쇄)
#   docker build -t hwpxpb-server .
#   docker run -p 8080:8080 -v hwpxpb-data:/data hwpxpb-server

# 1) rhwp 명령행 도구 (PDF 변환). rhwp 는 태그로 고정한다.
FROM rust:1.93.1-bookworm AS rhwp
ARG RHWP_REF=v0.8.7
RUN git clone --depth 1 --branch ${RHWP_REF} https://github.com/edwardkim/rhwp.git /src
WORKDIR /src
# 표 칸 안 체크박스 그리기 등 보완 (patches/rhwp/README.md)
COPY patches/rhwp /patches
RUN git apply /patches/*.patch
RUN cargo build --release --bin rhwp && strip target/release/rhwp

# 2) 실행 이미지. 서버는 Python 표준 라이브러리만 쓴다 (pip 설치 패키지 없음)
FROM python:3.12-slim-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-nanum fonts-noto-cjk fontconfig \
 && rm -rf /var/lib/apt/lists/*
COPY --from=rhwp /src/target/release/rhwp /usr/local/bin/rhwp
WORKDIR /app
COPY server/pyproject.toml server/
COPY server/hwpxpb server/hwpxpb
RUN pip install --no-cache-dir ./server
# 웹 에디터 화면: 저장소에 들어 있는 빌드 결과 (scripts/build-pb-web.sh 로 다시 만듦)
COPY pb/dist /app/web
RUN useradd --system --create-home hwpxpb && mkdir -p /data/templates && chown -R hwpxpb /data
ENV PORT=8080 TEMPLATE_DIR=/data/templates WEB_DIR=/app/web RHWP_BIN=/usr/local/bin/rhwp FONT_PATHS=/usr/share/fonts \
    PYTHONUNBUFFERED=1
USER hwpxpb
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ['PORT'])"
CMD ["hwpxpb", "serve"]
