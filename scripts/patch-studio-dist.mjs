// rhwp-studio 빌드 결과(dist)에 속도 보완을 넣는다. build-pb-web.sh 가 studio 를 복사한 뒤 부른다.
//   node scripts/patch-studio-dist.mjs <studio 폴더>
//
// 1) 캔버스 글꼴 설정 캐시
//    studio 는 CanvasRenderingContext2D.font setter 를 감싸 글꼴 대체 이름을 매번 계산한다.
//    한 쪽을 그릴 때 글자 묶음마다 불려 문서 열기 시간의 1/4 가량을 쓴다.
//    같은 작업(동기 그리기) 안에서는 결과가 같으므로 문자열별로 기억했다가 다음 마이크로태스크에서 비운다.
//    글꼴 감지·로드는 비동기로 끝나므로 그 사이 결과가 바뀌는 일은 없다.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(process.argv[2] ?? 'pb/dist/studio', 'assets');
const SETTER = /set\(e\)\{t\.set\.call\(this,(\w+)\(String\(e\)\)\?\?(\w+)\(String\(e\)\)\)\}/;
let patched = 0;
for (const f of fs.readdirSync(dir).filter((n) => /^index-.*\.js$/.test(n))) {
  const p = path.join(dir, f);
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes('__hwpxpbFontCache')) {
    patched++;
    continue;
  }
  const m = s.match(SETTER);
  if (!m) continue;
  const [, resolve, fallback] = m;
  s = s.replace(
    SETTER,
    `set(e){e=String(e);let c=globalThis.__hwpxpbFontCache;if(!c){c=globalThis.__hwpxpbFontCache=new Map;queueMicrotask(()=>{globalThis.__hwpxpbFontCache=null})}let v=c.get(e);if(v===void 0){v=${resolve}(e)??${fallback}(e);c.set(e,v)}t.set.call(this,v)}`,
  );
  fs.writeFileSync(p, s);
  patched++;
  console.log(`글꼴 setter 캐시: ${f}`);
}
if (!patched) {
  console.error('rhwp-studio 의 글꼴 setter 를 찾지 못했습니다 (rhwp 버전이 바뀌었으면 이 스크립트를 고치세요)');
  process.exit(1);
}
