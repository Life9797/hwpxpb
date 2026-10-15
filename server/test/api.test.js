import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { makeHwpx } from '../../engine/test/fixture.js';

let server, base, dir;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hwpxpb-test-'));
  // 실제 rhwp 대신 쓰는 가짜 PDF 변환기: -o 다음 경로에 PDF 머리말만 쓴다
  const fake = join(dir, 'fake-rhwp');
  await writeFile(fake, '#!/bin/sh\nwhile [ "$1" != "-o" ]; do shift; done\nprintf "%%PDF-1.7 fake" > "$2"\n');
  await chmod(fake, 0o755);
  const web = join(dir, 'web');
  await mkdir(join(web, 'studio'), { recursive: true });
  await writeFile(join(web, 'index.html'), '<!doctype html><title>editor</title>');
  await writeFile(join(web, 'studio', 'a.js'), 'export {}');
  await writeFile(join(dir, 'secret.txt'), 'no');
  server = createApp({ templateDir: join(dir, 'templates'), webDir: web, apiKey: 'k', pdf: { rhwpBin: process.env.RHWP_BIN || fake } });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

const call = (path, init = {}) => fetch(base + path, { ...init, headers: { 'X-API-Key': 'k', ...init.headers } });

test('API 키가 없으면 401', async () => {
  const r = await fetch(base + '/api/templates');
  assert.equal(r.status, 401);
});

test('템플릿 등록 → 스키마 → 값 대입 → 추출', async () => {
  let r = await call('/api/templates/rx01', { method: 'PUT', body: makeHwpx() });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).table, 'TB_TEST');

  r = await call('/api/templates');
  assert.deepEqual((await r.json()).map((t) => [t.id, t.table]), [['rx01', 'TB_TEST']]);

  r = await call('/api/templates/rx01/schema');
  assert.equal((await r.json()).schema.length, 9);

  r = await call('/api/fill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId: 'rx01', values: { PT_NM: '홍길동', REGION_CD: '03', SEX_CD: 'F' }, comboSep: '|' }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/hwp+zip');
  assert.deepEqual(JSON.parse(decodeURIComponent(r.headers.get('x-fill-result'))).applied, ['PT_NM', 'REGION_CD', 'SEX_CD']);
  const filled = new Uint8Array(await r.arrayBuffer());

  r = await call('/api/extract?comboSep=|', { method: 'POST', body: filled });
  const ex = await r.json();
  assert.equal(ex.values.PT_NM, '홍길동');
  assert.equal(ex.values.REGION_CD, '03');
  assert.equal(ex.values.SEX_CD, 'F');
});

test('strict 모드는 대입하지 못한 값이 있으면 422', async () => {
  const r = await call('/api/fill', {
    method: 'POST',
    body: JSON.stringify({ template: Buffer.from(makeHwpx()).toString('base64'), values: { NOPE: 1 }, strict: true }),
  });
  assert.equal(r.status, 422);
  assert.deepEqual((await r.json()).unknown, ['NOPE']);
});

test('PDF 출력', async () => {
  const r = await call('/api/fill', {
    method: 'POST',
    body: JSON.stringify({ template: Buffer.from(makeHwpx()).toString('base64'), values: { PT_NM: '홍길동' }, format: 'pdf' }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
});

test('잘못된 템플릿 ID 와 HWPX 가 아닌 파일은 400', async () => {
  assert.equal((await call('/api/templates/..%2Fetc/schema')).status, 400);
  assert.equal((await call('/api/extract', { method: 'POST', body: 'not a zip' })).status, 400);
  assert.equal((await call('/api/templates/none/schema')).status, 404);
});

test('명령행 도구: fill → extract', async () => {
  const { execFileSync } = await import('node:child_process');
  const cli = new URL('../src/cli.js', import.meta.url).pathname;
  const tpl = join(dir, 'tpl.hwpx');
  const out = join(dir, 'out.hwpx');
  await writeFile(tpl, makeHwpx());
  const fill = JSON.parse(execFileSync('node', [cli, 'fill', tpl, '-', '-o', out], { input: '{"PT_NM":"김철수","ITEM_CD":"01,02"}' }));
  assert.deepEqual(fill.applied, ['ITEM_CD', 'PT_NM']);
  const ex = JSON.parse(execFileSync('node', [cli, 'extract', out]));
  assert.equal(ex.values.PT_NM, '김철수');
  assert.equal(ex.values.ITEM_CD, '01,02');
});

test('서버 주소로 접속하면 웹 에디터가 열린다 (화면 파일은 키 없이)', async () => {
  let r = await fetch(base + '/?template=rx01');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  r = await fetch(base + '/studio/a.js');
  assert.match(r.headers.get('content-type'), /javascript/);
  r = await fetch(base + '/..%2fsecret.txt');
  assert.equal(r.status, 404);
  r = await fetch(base + '/api/templates'); // API 는 여전히 키 필요
  assert.equal(r.status, 401);
});
