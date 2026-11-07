// rhwp-studio 빌드 결과(dist)에 속도 보완을 넣는다. build-pb-web.sh 가 studio 를 복사한 뒤 부른다.
//   node scripts/patch-studio-dist.mjs <studio 폴더>
//
// 1) 캔버스 글꼴 설정 캐시
//    studio 는 CanvasRenderingContext2D.font setter 를 감싸 글꼴 대체 이름을 매번 계산한다.
//    한 쪽을 그릴 때 글자 묶음마다 불려 문서 열기 시간의 1/4 가량을 쓴다.
//    같은 작업(동기 그리기) 안에서는 결과가 같으므로 문자열별로 기억했다가 다음 마이크로태스크에서 비운다.
//    글꼴 감지·로드는 비동기로 끝나므로 그 사이 결과가 바뀌는 일은 없다.
//
// 2) 호스트(bridge.js)용 진입점 window.rhwpStudio.hwpxpb
//    studio 안쪽 상태는 모듈 변수라 바깥에서 닿지 않는다. 같은 출처의 bridge.js 가 쓸 함수만 내보낸다.
//    - fitBodyWidth(): 좌우 여백을 뺀 본문 폭을 화면 폭에 맞추고, 본문 왼쪽 끝이 화면 왼쪽에 오게 스크롤
//    - bodyAt():       화면 가운데 쪽의 본문 위치·폭 (구역이 바뀌어 여백이 달라졌는지 보는 용도)
//    - zoom():         지금 배율
//    - isDirty():      사용자가 문서를 고쳤는지 (저장 여부 묻기)
//    - setRecovery(on): 복구용 자동 저장 켜기/끄기 (설정 저장 + 일정 바로 반영)
//    - clearDrafts():  남아 있는 복구본을 모두 지운다
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(process.argv[2] ?? 'pb/dist/studio', 'assets');
const SETTER = /set\(e\)\{t\.set\.call\(this,(\w+)\(String\(e\)\)\?\?(\w+)\(String\(e\)\)\)\}/;

/** 압축된 변수 이름을 코드 모양으로 찾는다. 못 찾으면 null */
function hostNames(s) {
  const ctx = s.match(
    /zoom:(\w+)\?\.getViewportManager\(\)\.getZoom\(\)\?\?1,showControlCodes:(\w+)\.getShowControlCodes\(\),showParagraphMarks:\w+\.getShowParagraphMarks\(\),isDirty:(\w+)\.isDirty\(\)/,
  );
  const settings = s.match(/(\w+)\.updateAutosaveSettings\(\{recoveryEnabled:this\.recoveryEnabledCheck/);
  const bus = s.match(/(\w+)\.on\(`autosave-settings-changed`,\(\)=>\{\w+\.updateSchedule\(\w+\(\)\)\}\)/);
  // 복구본 저장소(`drafts`)를 비우는 함수. 같은 모양의 "최근 문서" 함수와 저장소 이름으로 구분한다
  let clear = null;
  const CLEAR =
    /async function (\w+)\(\)\{\w+\.clear\(\),await \w+\(async e=>new Promise\(\(t,n\)=>\{let r=e\.transaction\((\w+),`readwrite`\);r\.objectStore\(\2\)\.clear\(\)/g;
  for (const m of s.matchAll(CLEAR)) if (s.includes(`${m[2]}=\`drafts\``)) clear = m[1];
  if (!ctx || !settings || !bus || !clear) return null;
  return { view: ctx[1], wasm: ctx[2], dirty: ctx[3], settings: settings[1], bus: bus[1], clear };
}

function hostApi({ view: X, wasm: J, dirty: D, settings: I, bus: Y, clear: C }) {
  return (
    'hwpxpb:{' +
    `zoom:()=>${X}?.getViewportManager().getZoom()??1,` +
    `isDirty:()=>${D}.isDirty(),` +
    `setRecovery:e=>{e=!!e;${I}.updateAutosaveSettings({recoveryEnabled:e,idleSaveEnabled:e});${Y}.emit(\`autosave-settings-changed\`)},` +
    `clearDrafts:()=>${C}(),` +
    // 화면 가운데에 보이는 쪽의 본문 (구역마다 여백이 다를 수 있음)
    `bodyAt:()=>{let v=${X},w=${J},c=document.getElementById(\`scroll-container\`);` +
    `if(!v||!c||!(w.pageCount>0))return null;let p=v.virtualScroll.getPageAtY?.(c.scrollTop+c.clientHeight/2)??0;` +
    `if(!(p>=0&&p<w.pageCount))p=0;let i=w.getPageInfo(p),l=i.bodyLeft??i.marginLeft,r=i.bodyRight??i.width-i.marginRight;` +
    `return{page:p,bodyLeft:l,bodyWidth:r-l}},` +
    // 본문 폭 맞춤
    `fitBodyWidth:()=>{let v=${X},c=document.getElementById(\`scroll-container\`),a=window.rhwpStudio.hwpxpb.bodyAt();` +
    `if(!a||!(a.bodyWidth>0)||!(c.clientWidth>0))return null;let m=v.getViewportManager(),s=v.virtualScroll,p=a.page,l=a.bodyLeft;` +
    `m.setZoom(c.clientWidth/a.bodyWidth,void 0,\`none\`);` +
    `let z=m.getZoom();return new Promise(e=>requestAnimationFrame(()=>{` +
    `m.setScrollLeft(s.getPageLeftResolved(p,s.getTotalWidth())+l*z);e({zoom:z,page:p,bodyLeft:l,bodyWidth:a.bodyWidth})}))}` +
    '},'
  );
}

let patched = 0;
let hosted = 0;
for (const f of fs.readdirSync(dir).filter((n) => /^index-.*\.js$/.test(n))) {
  const p = path.join(dir, f);
  let s = fs.readFileSync(p, 'utf8');
  let changed = false;
  if (s.includes('__hwpxpbFontCache')) patched++;
  else {
    const m = s.match(SETTER);
    if (m) {
      const [, resolve, fallback] = m;
      s = s.replace(
        SETTER,
        `set(e){e=String(e);let c=globalThis.__hwpxpbFontCache;if(!c){c=globalThis.__hwpxpbFontCache=new Map;queueMicrotask(()=>{globalThis.__hwpxpbFontCache=null})}let v=c.get(e);if(v===void 0){v=${resolve}(e)??${fallback}(e);c.set(e,v)}t.set.call(this,v)}`,
      );
      patched++;
      changed = true;
      console.log(`글꼴 setter 캐시: ${f}`);
    }
  }
  if (s.includes('window.rhwpStudio={hwpxpb:')) hosted++;
  else if (s.includes('window.rhwpStudio={')) {
    const names = hostNames(s);
    if (names) {
      s = s.replace('window.rhwpStudio={', `window.rhwpStudio={${hostApi(names)}`);
      hosted++;
      changed = true;
      console.log(`호스트 진입점(rhwpStudio.hwpxpb): ${f} ${JSON.stringify(names)}`);
    }
  }
  if (changed) fs.writeFileSync(p, s);
}
if (!patched) {
  console.error('rhwp-studio 의 글꼴 setter 를 찾지 못했습니다 (rhwp 버전이 바뀌었으면 이 스크립트를 고치세요)');
  process.exit(1);
}
if (!hosted) {
  console.error('rhwp-studio 에 rhwpStudio.hwpxpb 를 넣지 못했습니다 (rhwp 버전이 바뀌었으면 이 스크립트를 고치세요)');
  process.exit(1);
}
