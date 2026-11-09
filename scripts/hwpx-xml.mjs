// HWPX 를 일반 편집기(VS Code 등)로 고칠 수 있게 폴더로 풀고, 고친 폴더를 다시 HWPX 로 묶는다.
//
//   node scripts/hwpx-xml.mjs unpack <파일.hwpx> [폴더]     폴더 기본값: <파일>.hwpx.d
//   node scripts/hwpx-xml.mjs pack   <폴더> [파일.hwpx]     파일 기본값: <원래 이름>-edited.hwpx (원본을 덮어쓰지 않음)
//   옵션  --raw   풀 때 XML 을 줄 맞춤하지 않는다 (원본 그대로)
//
// 풀 때 XML 은 태그마다 줄을 바꾸고 들여 쓴다. 글자가 들어 있는 요소(<hp:t>, xml:space="preserve")
// 안쪽은 건드리지 않는다. 묶을 때 그 줄바꿈·들여쓰기를 다시 지워서 한글이 읽는 모양으로 되돌린다.
// 묶을 때 mimetype 을 맨 앞에 압축 없이 넣고, 나머지는 원래 ZIP 순서를 따른다 (.hwpx-xml.json 에 기록).
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync, zipSync } from 'fflate';

const META = '.hwpx-xml.json';
const TEXT_EXT = /\.(xml|hpf|rdf)$/i;
const enc = new TextEncoder();
const dec = new TextDecoder();

/** 줄 맞춤을 하면 안 되는 요소: 안의 공백이 그대로 글자다 */
const isPreserve = (tag, name) => name === 'hp:t' || /\bxml:space="preserve"/.test(tag);

/**
 * 태그 사이(">" 와 "<" 사이) 공백만 있는 자리를 찾아 fn(공백, 깊이) 의 결과로 바꾼다.
 * 글자 요소 안쪽은 그대로 둔다.
 */
function mapGaps(xml, fn) {
  const TAG = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/?([^\s/>]+)[^>]*?(\/?)>/g;
  let out = '';
  let last = 0;
  let depth = 0;
  let preserve = 0; // 글자 요소 안쪽 깊이
  let prevEnd = -1;
  for (const m of xml.matchAll(TAG)) {
    const between = xml.slice(last, m.index);
    if (prevEnd >= 0 && preserve === 0 && /^\s*$/.test(between)) {
      const closing = m[0].startsWith('</');
      out += fn(between, closing ? depth - 1 : depth);
    } else out += between;
    out += m[0];
    const name = m[1];
    if (name) {
      if (m[0].startsWith('</')) {
        depth--;
        if (preserve > 0) preserve--;
      } else if (!m[2]) {
        depth++;
        if (preserve > 0 || isPreserve(m[0], name)) preserve++;
      }
    }
    last = m.index + m[0].length;
    prevEnd = last;
  }
  return out + xml.slice(last);
}

const pretty = (xml) => mapGaps(xml, (_, depth) => '\n' + '  '.repeat(Math.max(depth, 0)));
// 줄바꿈이 들어 있는 공백만 지운다 (원래 있던 한 칸 공백 등은 둔다)
const compact = (xml) => mapGaps(xml, (gap) => (/[\r\n]/.test(gap) ? '' : gap)).replace(/\s+$/, '');

function unpack(file, dir, { raw }) {
  const entries = unzipSync(fs.readFileSync(file));
  if (!entries.mimetype) throw new Error(`HWPX 파일이 아닙니다 (mimetype 없음): ${file}`);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`폴더가 비어 있지 않습니다: ${dir}`);
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    const p = path.join(dir, ...name.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, !raw && TEXT_EXT.test(name) ? enc.encode(pretty(dec.decode(data))) : data);
  }
  fs.writeFileSync(path.join(dir, META), JSON.stringify({ order: Object.keys(entries), pretty: !raw }, null, 2) + '\n');
  console.log(`풀었습니다: ${dir} (파일 ${Object.keys(entries).length}개${raw ? '' : ', XML 줄 맞춤'})`);
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...listFiles(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

function pack(dir, file) {
  const metaPath = path.join(dir, META);
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : { order: [], pretty: false };
  const files = listFiles(dir).filter((n) => n !== META && !/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/.test(n));
  if (!files.includes('mimetype')) throw new Error(`mimetype 파일이 없습니다: ${dir}`);
  // mimetype 먼저, 그다음 원래 순서, 새로 생긴 파일은 끝에
  const known = meta.order.filter((n) => n !== 'mimetype' && files.includes(n));
  const order = ['mimetype', ...known, ...files.filter((n) => n !== 'mimetype' && !known.includes(n)).sort()];
  const zip = {};
  for (const name of order) {
    let data = fs.readFileSync(path.join(dir, ...name.split('/')));
    if (name === 'mimetype') {
      zip[name] = [data, { level: 0 }];
      continue;
    }
    if (TEXT_EXT.test(name)) {
      let text = dec.decode(data).replace(/^﻿/, ''); // 편집기가 붙인 BOM 제거
      if (meta.pretty) text = compact(text);
      data = enc.encode(text);
    }
    zip[name] = [data, { level: 9 }];
  }
  fs.writeFileSync(file, zipSync(zip));
  console.log(`묶었습니다: ${file} (파일 ${order.length}개)`);
}

const args = process.argv.slice(2);
const raw = args.includes('--raw');
const [cmd, src, dst] = args.filter((a) => !a.startsWith('--'));
try {
  if (cmd === 'unpack' && src) unpack(src, dst ?? `${src}.d`, { raw });
  else if (cmd === 'pack' && src) {
    const dir = src.replace(/[\\/]+$/, '');
    pack(dir, dst ?? `${dir.replace(/\.d$/, '').replace(/\.hwpx$/i, '')}-edited.hwpx`);
  } else {
    console.log('사용법:\n  node scripts/hwpx-xml.mjs unpack <파일.hwpx> [폴더] [--raw]\n  node scripts/hwpx-xml.mjs pack <폴더> [파일.hwpx]');
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
