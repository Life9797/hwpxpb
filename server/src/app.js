// 브라우저 없이 동작하는 HTTP API. 프레임워크 없이 node:http 만 쓴다.
//
//   GET  /health
//   GET  /api/templates                     등록된 템플릿 목록
//   PUT  /api/templates/:id                 템플릿 등록/교체 (본문: HWPX 바이트)
//   GET  /api/templates/:id                 템플릿 파일 내려받기
//   GET  /api/templates/:id/schema          개체 목록 + 테이블명
//   POST /api/fill                          값 대입 → HWPX 또는 PDF
//   POST /api/extract?comboSep=:            본문 HWPX 에서 값 추출
//   POST /api/schema                        본문 HWPX 의 개체 목록
//   POST /api/pdf                           본문 HWPX → PDF
//   GET  /                                  웹 에디터 (webDir 이 있을 때. 열기·저장·인쇄)
//   GET  /?template=rx01                    등록된 양식을 에디터로 열기
import { createServer } from 'node:http';
import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { HwpxDocument } from 'hwpx-form-engine';
import { hwpxToPdf } from './pdf.js';

const ID_RE = /^[A-Za-z0-9가-힣_.-]{1,100}$/;
const HWPX_TYPE = 'application/hwp+zip';
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createApp({ templateDir, webDir = '', apiKey = '', maxBodyBytes = 50 * 1024 * 1024, pdf = {} } = {}) {
  const templatePath = (id) => {
    if (!ID_RE.test(id) || id.startsWith('.')) throw new HttpError(400, '템플릿 ID 는 영문·숫자·한글·_ . - 만 쓸 수 있습니다');
    return join(templateDir, `${id}.hwpx`);
  };

  const loadTemplate = async (id) => {
    try {
      return await readFile(templatePath(id));
    } catch (e) {
      if (e.code === 'ENOENT') throw new HttpError(404, `템플릿이 없습니다: ${id}`);
      throw e;
    }
  };

  const openDoc = (bytes) => {
    try {
      return new HwpxDocument(bytes);
    } catch (e) {
      throw new HttpError(400, `HWPX 파일을 열 수 없습니다: ${e.message}`);
    }
  };

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    const comboSep = url.searchParams.get('comboSep') ?? ':';

    if (path === '/health') return sendJson(res, 200, { ok: true });
    // 웹 에디터 화면은 인증 없이 연다 (화면 파일만. 양식·API 는 아래에서 키 확인)
    if (webDir && (req.method === 'GET' || req.method === 'HEAD') && !path.startsWith('/api/')) {
      return sendStatic(res, webDir, path.slice(1));
    }
    if (apiKey && req.headers['x-api-key'] !== apiKey) throw new HttpError(401, 'X-API-Key 가 필요합니다');

    if (req.method === 'GET' && path === '/api/templates') {
      await mkdir(templateDir, { recursive: true });
      const names = (await readdir(templateDir)).filter((n) => n.endsWith('.hwpx')).sort();
      const list = [];
      for (const n of names) {
        const bytes = await readFile(join(templateDir, n));
        const st = await stat(join(templateDir, n));
        let table = null;
        try {
          table = new HwpxDocument(bytes).dbTable;
        } catch {}
        list.push({ id: n.slice(0, -5), size: st.size, modified: st.mtime.toISOString(), table });
      }
      return sendJson(res, 200, list);
    }

    let m = /^\/api\/templates\/([^/]+)(\/schema)?$/.exec(path);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (req.method === 'PUT' && !m[2]) {
        const bytes = await readBody(req, maxBodyBytes);
        const doc = openDoc(bytes);
        await mkdir(templateDir, { recursive: true });
        await writeFile(templatePath(id), bytes);
        return sendJson(res, 200, { id, table: doc.dbTable, schema: doc.schema() });
      }
      if (req.method === 'GET' && m[2]) {
        const doc = openDoc(await loadTemplate(id));
        return sendJson(res, 200, { id, table: doc.dbTable, schema: doc.schema() });
      }
      if (req.method === 'GET') return sendBytes(res, await loadTemplate(id), HWPX_TYPE, `${id}.hwpx`);
    }

    if (req.method === 'POST' && path === '/api/fill') {
      const body = JSON.parse((await readBody(req, maxBodyBytes)).toString('utf8') || '{}');
      const src = body.templateId
        ? await loadTemplate(String(body.templateId))
        : body.template
          ? Buffer.from(String(body.template), 'base64')
          : null;
      if (!src) throw new HttpError(400, 'templateId 또는 template(base64) 가 필요합니다');
      const doc = openDoc(src);
      const result = doc.fill(body.values ?? {}, { comboSep: body.comboSep ?? ':' });
      if (body.strict && (result.unknown.length || result.rejected.length)) {
        return sendJson(res, 422, { error: '대입하지 못한 값이 있습니다', ...result });
      }
      const hwpx = Buffer.from(doc.toBytes());
      const format = body.format ?? 'hwpx';
      res.setHeader('X-Fill-Result', encodeURIComponent(JSON.stringify(result)));
      if (format === 'hwpx') return sendBytes(res, hwpx, HWPX_TYPE, 'filled.hwpx');
      // PDF 에는 빈 칸 안내문을 찍지 않는다 (한글 인쇄와 같게)
      const pdfBytes = await hwpxToPdf(Buffer.from(openDoc(hwpx).hideGuides().toBytes()), pdf);
      if (format === 'pdf') return sendBytes(res, pdfBytes, 'application/pdf', 'filled.pdf');
      if (format === 'both') {
        return sendJson(res, 200, { ...result, hwpx: hwpx.toString('base64'), pdf: pdfBytes.toString('base64') });
      }
      throw new HttpError(400, 'format 은 hwpx, pdf, both 중 하나입니다');
    }

    if (req.method === 'POST' && path === '/api/extract') {
      return sendJson(res, 200, openDoc(await readBody(req, maxBodyBytes)).extract({ comboSep }));
    }
    if (req.method === 'POST' && path === '/api/schema') {
      const doc = openDoc(await readBody(req, maxBodyBytes));
      return sendJson(res, 200, { table: doc.dbTable, schema: doc.schema() });
    }
    if (req.method === 'POST' && path === '/api/pdf') {
      const doc = openDoc(await readBody(req, maxBodyBytes));
      const printable = Buffer.from(doc.hideGuides().toBytes());
      return sendBytes(res, await hwpxToPdf(printable, pdf), 'application/pdf', 'document.pdf');
    }
    throw new HttpError(404, '없는 경로입니다');
  }

  return createServer((req, res) => {
    handle(req, res).catch((e) => {
      const status = e.status ?? (e instanceof SyntaxError ? 400 : 500);
      if (status === 500) console.error(e);
      if (!res.headersSent) sendJson(res, status, { error: e.message });
      else res.end();
    });
  });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, '파일이 너무 큽니다'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function sendStatic(res, root, rel) {
  let p = normalize(decodeURIComponent(rel || 'index.html'));
  if (p.endsWith(sep) || p === '.') p = join(p, 'index.html');
  const file = join(root, p);
  if (p.startsWith('..') || !file.startsWith(join(root, sep))) throw new HttpError(404, '없는 경로입니다');
  let bytes;
  try {
    bytes = await readFile(file);
  } catch {
    throw new HttpError(404, '없는 경로입니다');
  }
  res.writeHead(200, {
    'Content-Type': STATIC_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': bytes.length,
    'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'max-age=3600',
  });
  res.end(bytes);
}

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length });
  res.end(body);
}

function sendBytes(res, bytes, type, filename) {
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': bytes.length,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
  });
  res.end(bytes);
}
