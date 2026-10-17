#!/usr/bin/env bash
# PB(OCX)용 로컬 에디터 화면을 pb/dist 에 만든다. 결과 폴더를 OCX 설치본에 같이 넣는다.
#
# 필요: git, Rust(+ wasm32-unknown-unknown 타깃), wasm-pack, Node 20+
# 사용: scripts/build-pb-web.sh            (rhwp 는 RHWP_REF 태그로 고정)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RHWP_REF="${RHWP_REF:-v0.8.7}"
BUILD="$ROOT/.build"
RHWP="$BUILD/rhwp"
OUT="$ROOT/pb/dist"

mkdir -p "$BUILD"
if [ ! -d "$RHWP/.git" ]; then
  git clone --depth 1 --branch "$RHWP_REF" https://github.com/edwardkim/rhwp.git "$RHWP"
  # 표 칸 안 체크박스 등 그리기 보완 (patches/rhwp/README.md)
  ( cd "$RHWP" && git apply "$ROOT"/patches/rhwp/*.patch )
fi

# 1) rhwp WASM + rhwp-studio (외부 웹폰트 끔: 폐쇄망·상업 환경)
( cd "$RHWP" && wasm-pack build --target web --release )
cp "$RHWP/pkg/rhwp_bg.wasm" "$RHWP/pkg/rhwp.js" "$RHWP/rhwp-studio/public/"
( cd "$RHWP/rhwp-studio" && npm ci && RHWP_DISABLE_EXTERNAL_WEBFONTS=1 npx vite build --base=/studio/ )

# 2) 결과 폴더 구성
rm -rf "$OUT"
mkdir -p "$OUT/vendor/engine" "$OUT/vendor/fflate" "$OUT/vendor/rhwp-editor"
cp "$ROOT/pb/web/index.html" "$ROOT/pb/web/bridge.js" "$ROOT/pb/web/standalone.js" "$OUT/"
cp "$ROOT/engine/src/index.js" "$OUT/vendor/engine/"
( cd "$ROOT" && npm install --no-audit --no-fund >/dev/null )
cp "$ROOT/node_modules/fflate/esm/browser.js" "$OUT/vendor/fflate/"
cp "$RHWP/npm/editor/index.js" "$RHWP/npm/editor/transport.js" "$RHWP/npm/editor/document-agent-contract.js" "$OUT/vendor/rhwp-editor/"
cp -r "$RHWP/rhwp-studio/dist" "$OUT/studio"
rm -rf "$OUT/studio/samples"   # rhwp 예제 문서 (필요 없음)
node "$ROOT/scripts/patch-studio-dist.mjs" "$OUT/studio"   # 속도 보완 (글꼴 setter 캐시)
cp "$RHWP/LICENSE" "$OUT/studio/RHWP-LICENSE.txt"

echo "완료: $OUT"
