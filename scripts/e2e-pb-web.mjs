// pb/dist (scripts/build-pb-web.sh 결과)를 헤드리스 Chromium 으로 열어 hwpBridge 를 시험한다.
// OCX 대신 이 스크립트가 window.hwpBridge.* 를 부른다.
//
//   node scripts/e2e-pb-web.mjs <양식.hwpx> '<값 JSON>' [스크린샷.png]
// playwright 가 필요하다 (npm i -D playwright).
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
import { HwpxDocument } from '../engine/src/index.js';

const [file, valuesJson = '{}', shot] = process.argv.slice(2);
const DIST = new URL('../pb/dist/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
const events = [];
await page.exposeFunction('__hostMessage', (m) => events.push(JSON.parse(m)));
await page.addInitScript(() => {
  window.chrome = window.chrome || {};
  window.chrome.webview = { postMessage: (m) => window.__hostMessage(m) };
});
page.on('pageerror', (e) => console.error('pageerror:', e.message));
await page.goto(base + 'index.html');
await page.waitForFunction(() => window.hwpBridgeReady === true, null, { timeout: 60000 });

const call = async (method, ...args) =>
  JSON.parse(await page.evaluate(([m, a]) => window.hwpBridge[m](...a), [method, args]));

const bytes = await readFile(file);
const b64 = bytes.toString('base64');
const out = {};
out.open = await call('open', b64, 'test.hwpx', 'form');
out.setFields = await call('setFields', valuesJson, ':');
out.getFields = await call('getFields', ':');
const doc = await call('getDocument', ':');
out.documentValues = doc.ok ? new HwpxDocument(Buffer.from(doc.hwpx, 'base64')).extract().values : doc;
out.preparePrint = await call('preparePrint');
out.events = events.map((e) => e.event);
if (shot) {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot });
  if (doc.ok) await writeFile(shot.replace(/\.png$/, '.hwpx'), Buffer.from(doc.hwpx, 'base64'));
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
server.close();
