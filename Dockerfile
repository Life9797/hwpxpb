# Unix 서버용 이미지: 브라우저 없이 HWPX 값 대입/추출 + PDF 출력,
# 그리고 서버 주소(http://서버:8080/)로 접속하면 웹 에디터(열기·편집·저장·인쇄)
#   docker build -t hwpxpb-server .
#   docker run -p 8080:8080 -v hwpxpb-data:/data hwpxpb-server

# 1) rhwp 명령행 도구 (PDF 변환). rhwp 는 태그로 고정한다.
FROM rust:1.93.1-bookworm AS rhwp
ARG RHWP_REF=v0.8.7
RUN git clone --depth 1 --branch ${RHWP_REF} https://github.com/edwardkim/rhwp.git /src
WORKDIR /src
# 표 칸 안 체크박스 등 그리기 보완 (patches/rhwp/README.md)
COPY patches/rhwp /patches
RUN git apply /patches/*.patch
RUN cargo build --release --bin rhwp && strip target/release/rhwp

# 2) 웹 에디터 화면 (rhwp WASM + rhwp-studio + 연결 스크립트). PB 용 pb/dist 와 같은 결과물
FROM rust:1.93.1-bookworm AS web
COPY --from=node:22-bookworm /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && rustup target add wasm32-unknown-unknown \
 && cargo install wasm-pack --locked
ARG RHWP_REF=v0.8.7
WORKDIR /repo
COPY package.json package-lock.json ./
COPY engine engine
COPY server/package.json server/
COPY pb/web pb/web
COPY patches patches
COPY scripts/build-pb-web.sh scripts/
RUN RHWP_REF=${RHWP_REF} bash scripts/build-pb-web.sh

# 3) 실행 이미지
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-nanum fonts-noto-cjk fontconfig \
 && rm -rf /var/lib/apt/lists/*
COPY --from=rhwp /src/target/release/rhwp /usr/local/bin/rhwp
WORKDIR /app
COPY package.json package-lock.json ./
COPY engine/package.json engine/
COPY server/package.json server/
RUN npm ci --omit=dev --workspaces --include-workspace-root
COPY engine/src engine/src
COPY server/src server/src
COPY --from=web /repo/pb/dist pb/dist
RUN ln -s /app/server/src/cli.js /usr/local/bin/hwpxpb && chmod +x server/src/cli.js \
 && mkdir -p /data/templates && chown -R node:node /data
ENV PORT=8080 TEMPLATE_DIR=/data/templates RHWP_BIN=/usr/local/bin/rhwp FONT_PATHS=/usr/share/fonts
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/src/main.js"]
