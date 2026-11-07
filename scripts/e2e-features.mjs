// pb/dist 의 에디터 기능을 헤드리스 Chromium 으로 시험한다 (CI: npm run e2e).
//   본문 폭 맞춤 · 닫을 때 저장 확인 · 단축키 잠금 · 복구용 자동 저장 켜기/끄기
// 시험 문서는 따로 두지 않고, 에디터가 처음 띄운 빈 문서를 HWPX 로 받아 쓴다 (실제 쪽이 그려지는 문서).
//
//   node scripts/e2e-features.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const DIST = new URL('../pb/dist/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '');
  if (p === '' || p.endsWith('/')) p += 'index.html';
  try {
    const body = await readFile(join(DIST, p));
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail && !ok ? `  ${detail}` : ''}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
// OCX 대신. 그리고 쉴 때 자동 저장을 가장 짧게(5초) 해서 시험 시간을 줄인다
await ctx.addInitScript(() => {
  window.chrome = window.chrome || {};
  window.chrome.webview = { postMessage() {} };
  if (window === window.top) {
    try {
      const s = JSON.parse(localStorage.getItem('rhwp-settings') || '{}');
      s.autosave = { ...(s.autosave ?? {}), idleDelaySeconds: 5 };
      localStorage.setItem('rhwp-settings', JSON.stringify(s));
    } catch {}
  }
});

/** 새 탭으로 에디터를 연다. prompt = 에디터가 시작하자마자 복구를 물었는지 */
async function openEditor(query = '') {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  await page.goto(base + 'index.html' + query);
  await page.waitForFunction(() => window.hwpBridgeReady === true, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  const call = async (m, ...a) => JSON.parse(await page.evaluate(([m, a]) => window.hwpBridge[m](...a), [m, a]));
  const prompt = await page.evaluate(() => document.querySelector('#editor iframe').contentDocument.body.innerText.includes('복구본'));
  return { page, call, prompt };
}
const inFrame = (page, fn) =>
  page.evaluate((f) => new Function('w', `return (${f})(w)`)(document.querySelector('#editor iframe').contentWindow), fn.toString());
const drafts = (page) =>
  page.evaluate(
    () =>
      new Promise((res) => {
        const q = indexedDB.open('rhwpStudioAutosave');
        q.onsuccess = () => {
          const db = q.result;
          if (!db.objectStoreNames.contains('drafts')) return db.close(), res(0);
          const r = db.transaction('drafts').objectStore('drafts').count();
          r.onsuccess = () => (db.close(), res(r.result));
        };
        q.onerror = () => res(-1);
      }),
  );

let { page, call } = await openEditor();
const b64 = (await call('getDocument')).hwpx; // 빈 문서
const editAndType = async (pg, c, text, name = 'e.hwpx') => {
  await c('setPermission', true);
  await c('open', b64, name, 'edit');
  const box = await pg.locator('#editor iframe').boundingBox();
  await pg.mouse.click(box.x + 300, box.y + 200);
  await pg.keyboard.type(text);
  await pg.waitForTimeout(300);
};
const viewGeometry = () =>
  inFrame(page, (w) => {
    const sc = w.document.getElementById('scroll-container');
    const r = sc.getBoundingClientRect();
    const c = sc.querySelector('canvas.document-page-canvas').getBoundingClientRect();
    return { cw: sc.clientWidth, x: c.left - r.left, zoom: w.rhwpStudio.hwpxpb.zoom() };
  });

// ---- 1. 본문 폭 맞춤 (빈 문서: A4, 본문 566.9px, 왼쪽 여백 113.4px) -------------------------
{
  const BODY = 566.9;
  const LEFT = 113.4;
  await call('open', b64, 'a.hwpx', 'form');
  const fw = await call('fitWidth');
  const g = await viewGeometry();
  check('fitWidth: 배율 = 화면 폭 / 본문 폭', fw.ok && Math.abs(fw.zoom - g.cw / BODY) < 0.01, JSON.stringify({ fw, g }));
  check('fitWidth: 본문 왼쪽 끝 = 화면 왼쪽', Math.abs(g.x + LEFT * g.zoom) < 2, JSON.stringify(g));
  check('fitWidth: 본문 오른쪽 끝 = 화면 오른쪽', Math.abs(g.x + (LEFT + BODY) * g.zoom - g.cw) < 2, JSON.stringify(g));
  await call('setAutoFit', true);
  await page.setViewportSize({ width: 700, height: 800 });
  await page.waitForTimeout(1500);
  let z = await viewGeometry();
  check('AutoFit: 창 크기가 바뀌면 다시 맞춤', Math.abs(z.zoom - z.cw / BODY) < 0.01, JSON.stringify(z));
  await call('open', b64, 'a.hwpx', 'form');
  z = await viewGeometry();
  check('AutoFit: 문서를 열면 맞춤', Math.abs(z.zoom - z.cw / BODY) < 0.01, JSON.stringify(z));
  await call('setAutoFit', false);
  await page.setViewportSize({ width: 1000, height: 800 });
}

// ---- 1b. 구역마다 여백이 다를 때 (AutoFit 이 쪽을 넘기면 다시 맞춤) -----------------------------
// 빈 문서의 구역을 하나 더 붙이고, 둘째 구역의 여백을 왼쪽 60mm / 오른쪽 15mm 로 (본문 510.2px, 왼쪽 226.8px)
function twoSections(src) {
  const files = unzipSync(Buffer.from(src, 'base64'));
  const sec = strFromU8(files['Contents/section0.xml']);
  const sec1 = sec.replace(/(<hp:margin [^>]*?)left="\d+" right="\d+"/, '$1left="17008" right="4252"');
  if (sec1 === sec) throw new Error('시험 문서: 여백을 바꾸지 못했습니다');
  files['Contents/section1.xml'] = strToU8(sec1);
  let hpf = strFromU8(files['Contents/content.hpf']);
  hpf = hpf
    .replace(/(<opf:item id="section0"[^>]*\/>)/, '$1<opf:item id="section1" href="Contents/section1.xml" media-type="application/xml"/>')
    .replace(/(<opf:itemref idref="section0"[^>]*\/>)/, '$1<opf:itemref idref="section1" linear="yes"/>');
  files['Contents/content.hpf'] = strToU8(hpf);
  return Buffer.from(zipSync(files)).toString('base64');
}
{
  const BODY0 = 566.9;
  const BODY1 = 510.2;
  const LEFT1 = 226.8;
  await call('setAutoFit', true);
  await call('open', twoSections(b64), 'two.hwpx', 'form');
  let g = await viewGeometry();
  check('두 구역 문서: 첫 구역 본문에 맞춤', Math.abs(g.zoom - g.cw / BODY0) < 0.01, JSON.stringify(g));
  const pages = await inFrame(page, (w) => w.rhwpStudio.hwpxpb.bodyAt() && w.document.querySelectorAll('canvas.document-page-canvas').length);
  await inFrame(page, (w) => {
    const sc = w.document.getElementById('scroll-container');
    sc.scrollTop = sc.scrollHeight;
  });
  await page.waitForTimeout(2000);
  const g1 = await inFrame(page, (w) => {
    const sc = w.document.getElementById('scroll-container');
    const r = sc.getBoundingClientRect();
    const mid = r.top + sc.clientHeight / 2;
    // 화면 가운데 높이에 걸린 쪽 (둘째 구역)
    const c = [...sc.querySelectorAll('canvas.document-page-canvas')].map((e) => e.getBoundingClientRect()).find((b) => b.top <= mid && b.bottom >= mid) ??
      [...sc.querySelectorAll('canvas.document-page-canvas')].map((e) => e.getBoundingClientRect()).pop();
    return { cw: sc.clientWidth, x: c.left - r.left, zoom: w.rhwpStudio.hwpxpb.zoom(), body: w.rhwpStudio.hwpxpb.bodyAt() };
  });
  check('두 구역 문서: 쪽이 2개 이상', pages >= 1 && g1.body?.page >= 1, JSON.stringify({ pages, g1 }));
  check('쪽을 넘겨 여백이 다른 구역에 오면 다시 맞춤', Math.abs(g1.zoom - g1.cw / BODY1) < 0.01, JSON.stringify(g1));
  check('왼쪽·오른쪽 여백이 달라도 본문 왼쪽 끝 = 화면 왼쪽', Math.abs(g1.x + LEFT1 * g1.zoom) < 2, JSON.stringify(g1));
  await call('setAutoFit', false);
  await call('close');
}

// ---- 2. 닫을 때 저장 확인 -------------------------------------------------------------------
{
  check('열자마자는 고치지 않음', (await call('isModified')).modified === false);
  await editAndType(page, call, 'hello');
  check('글자를 치면 고침', (await call('isModified')).modified === true);
  const answer = async (how) => {
    const p = call('close', true);
    await page.waitForSelector('#save-dialog[open]', { timeout: 5000 });
    if (how.startsWith('key:')) await page.keyboard.press(how.slice(4));
    else await page.click(`#save-dialog button[value="${how}"]`);
    return p;
  };
  // 창이 떠 있는 동안 다른 호출은 거절, 읽기 함수는 됨
  {
    const p = call('close', true);
    await page.waitForSelector('#save-dialog[open]', { timeout: 5000 });
    const second = await call('close', true);
    const write = await call('setFields', '{}');
    const read = await call('isModified');
    check('창이 떠 있을 때 두 번째 close 는 busy', second.ok === false && second.busy === true, JSON.stringify(second));
    check('창이 떠 있을 때 다른 호출도 busy', write.ok === false && write.busy === true, JSON.stringify(write));
    check('창이 떠 있어도 읽기 함수는 됨', read.ok === true && read.modified === true, JSON.stringify(read));
    await page.click('#save-dialog button[value="cancel"]');
    const r = await p;
    check('취소: 닫지 않음', r.closed === false && r.cancelled === true, JSON.stringify(r));
    check('창이 닫히면 다시 호출됨', (await call('getSchema')).ok === true);
  }
  let r = await answer('no');
  check('아니오: 저장 없이 닫음', r.closed === true && r.save === false && !r.document, JSON.stringify(r));
  check('닫은 뒤 getDocument 실패', (await call('getDocument')).ok === false);
  await editAndType(page, call, 'world');
  r = await answer('yes');
  const files = r.document ? unzipSync(Buffer.from(r.document, 'base64')) : {};
  const xml = Object.entries(files)
    .filter(([k]) => /section/i.test(k))
    .map(([, v]) => strFromU8(v))
    .join('');
  check('예: 문서를 돌려줌 (친 글자 포함)', r.closed === true && r.save === true && xml.includes('world'));
  await editAndType(page, call, 'x');
  r = await answer('key:Escape');
  check('Esc = 취소', r.closed === false);
  r = await answer('key:Enter');
  check('Enter = 예', r.closed === true && r.save === true);
  await call('open', b64, 'd.hwpx', 'form');
  r = await call('close', true);
  check('고치지 않았으면 묻지 않음', r.closed === true && r.save === false);
  await editAndType(page, call, 'y');
  r = await call('close');
  check('close() 는 묻지 않음', r.closed === true && r.save === false);
  await editAndType(page, call, 'z');
  await call('preparePrint');
  check('인쇄 준비(다시 불러오기) 뒤에도 고침 유지', (await call('isModified')).modified === true);
  check('인쇄 준비 뒤 에디터가 보임', (await page.evaluate(() => getComputedStyle(document.getElementById('editor')).visibility)) === 'visible');
  await call('close');
}

// ---- 3. 단축키 잠금 -------------------------------------------------------------------------
{
  await call('setPermission', true);
  await call('open', b64, 'g.hwpx', 'edit');
  await inFrame(page, (w) => {
    w.__seen = [];
    w.addEventListener('keydown', (e) => w.__seen.push(e.key + (e.ctrlKey ? '+ctrl' : '')), true);
  });
  const box = await page.locator('#editor iframe').boundingBox();
  await page.mouse.click(box.x + 300, box.y + 200);
  const seen = () => inFrame(page, (w) => w.__seen.splice(0));
  check('잠금 켜기', (await call('setShortcutLockModes', true)).locked === true);
  for (const k of ['Control+b', 'F5', 'Alt+x', 'a', 'ArrowLeft']) await page.keyboard.press(k);
  let s = await seen();
  check('잠금: Ctrl·F·Alt 막고 글자·방향키는 통과', !s.includes('b+ctrl') && !s.includes('F5') && !s.includes('x') && s.includes('a') && s.includes('ArrowLeft'), JSON.stringify(s));
  await call('setMode', 'form');
  await page.keyboard.press('Control+b');
  s = await seen();
  check('잠금: 작성 모드에서도', !s.includes('b+ctrl'), JSON.stringify(s));
  await call('setMode', 'edit');
  check('잠금 끄기', (await call('setShortcutLockModes', false)).locked === false && (await call('getShortcutLockModes')).locked === false);
  await page.keyboard.press('Control+b');
  s = await seen();
  check('잠금을 끄면 Ctrl+B 가 에디터에 감', s.includes('b+ctrl'), JSON.stringify(s));
  // 허용 키
  const r = await call('setShortcutLockModes', true, 'Ctrl+B, ctrl + shift + z');
  check('허용 키 지정', r.locked === true && r.allow.includes('ctrl+b') && r.allow.includes('ctrl+shift+z'), JSON.stringify(r));
  for (const k of ['Control+b', 'Control+i', 'Control+Shift+z']) await page.keyboard.press(k);
  s = await seen();
  check('허용 키만 통과 (Ctrl+B, Ctrl+Shift+Z), Ctrl+I 는 막힘', s.includes('b+ctrl') && s.filter((k) => k.toLowerCase() === 'z+ctrl').length === 1 && !s.includes('i+ctrl'), JSON.stringify(s));
  check('잘못된 허용 키는 오류', (await call('setShortcutLockModes', true, 'Ctrl+')).ok === false);
  check('allow 를 빼면 목록 유지', (await call('setShortcutLockModes', true)).allow.length === 2);
  check('allow "" 이면 비움', (await call('setShortcutLockModes', false, '')).allow.length === 0);
  await call('close');
}

// ---- 4. 복구용 자동 저장 -------------------------------------------------------------------
const IDLE = 7000; // 쉴 때 자동 저장(5초) + 여유
{
  check('복구 기본값 켬', (await call('getRecovery')).recovery === true);
  // 정상 종료(close)는 복구본을 지운다
  await editAndType(page, call, 'normal');
  await page.waitForTimeout(IDLE);
  const before = await drafts(page);
  await call('close');
  await page.waitForTimeout(300);
  check('close() 는 복구본을 지움', before > 0 && (await drafts(page)) === 0, `before=${before}`);
  // 창 재사용 초기화(reset)도 복구본을 지운다
  await editAndType(page, call, 'reset');
  await page.waitForTimeout(IDLE);
  const beforeReset = await drafts(page);
  check('reset', (await call('reset')).ok === true);
  check('reset 은 복구본을 지움', beforeReset > 0 && (await drafts(page)) === 0, `before=${beforeReset}`);
  // 비정상 종료: 복구본이 남고 다음 시작에 묻는다
  ({ page, call } = await openEditor());
  await editAndType(page, call, 'crash');
  await page.waitForTimeout(IDLE);
  check('편집 중 복구본 저장', (await drafts(page)) > 0);
  await page.close(); // beforeunload 없이 닫힘 = 비정상 종료
  let e = await openEditor();
  check('켬: 비정상 종료 뒤 시작하면 복구를 물음', e.prompt === true);
  await e.page.close();
  // 주소로 끈 값을 넘기면(OCX 가 화면을 열기 전에 RecoveryEnabled=False) 이번 시작부터 묻지 않는다
  e = await openEditor('?recovery=0');
  check('?recovery=0: 시작할 때 묻지 않음', e.prompt === false);
  check('?recovery=0: 남은 복구본 지움', (await drafts(e.page)) === 0);
  check('?recovery=0: getRecovery = false', (await e.call('getRecovery')).recovery === false);
  await editAndType(e.page, e.call, 'off');
  await e.page.waitForTimeout(IDLE);
  check('끔: 복구본을 만들지 않음', (await drafts(e.page)) === 0);
  await e.page.close();
  e = await openEditor();
  check('끈 값은 다음 실행에도 유지', e.prompt === false && (await e.call('getRecovery')).recovery === false);
  // 실행 중에 다시 켜기
  check('setRecovery(true)', (await e.call('setRecovery', true)).recovery === true);
  await editAndType(e.page, e.call, 'on');
  await e.page.waitForTimeout(IDLE);
  check('다시 켜면 바로 복구본 저장', (await drafts(e.page)) > 0);
  await e.page.close();
  e = await openEditor();
  check('다시 켠 뒤 비정상 종료하면 물음', e.prompt === true);
  check('setRecovery(false) 는 남은 복구본을 지움', (await e.call('setRecovery', false)).ok && (await drafts(e.page)) === 0);
  await e.page.close();
  e = await openEditor('?recovery=1');
  check('?recovery=1: 켜짐', (await e.call('getRecovery')).recovery === true);
}

await browser.close();
server.close();
console.log(failed ? `\n${failed} 개 실패` : '\n모두 통과');
process.exit(failed ? 1 : 0);
