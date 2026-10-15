// PB(OCX) ↔ 웹 에디터 다리. 서버 없이 PC 안에서만 동작한다.
//
// OCX 가 WebView2 의 ExecuteScriptAsync 로 window.hwpBridge.* 를 부르고,
// 이 페이지는 window.chrome.webview.postMessage 로 OCX 에 이벤트를 보낸다.
// 모든 함수는 JSON 으로 직렬화 가능한 값을 돌려준다(오류는 {ok:false, error}).
//
// 양식 모드(form)에서는 문서를 저장·추출할 때 "원본 양식 + 추출한 값" 으로 다시 만든다.
// 그래서 에디터가 문서를 다시 쓰더라도 결과 파일의 서식은 원본 양식 그대로다.
import { createStudio } from './vendor/rhwp-editor/index.js';
import { HwpxDocument } from './vendor/engine/index.js';

const STUDIO_URL = new URL('./studio/', location.href).href;

const state = {
  studio: null,
  template: null, // 원본 양식 바이트 (Uint8Array)
  fileName: 'document.hwpx',
  mode: 'form', // form | edit | view
};

const toB64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

function emit(event, data = {}) {
  window.chrome?.webview?.postMessage(JSON.stringify({ event, ...data }));
}

async function setFormMode(on) {
  const ctx = await state.studio.commands.context();
  if (Boolean(ctx.isFormMode) !== on) await state.studio.commands.execute('view:form-mode');
}

async function currentBytes() {
  return state.studio.exportHwpx();
}

/** 에디터 화면에 보이는 값 (DB 컬럼 기준) */
async function readValues(comboSep) {
  return new HwpxDocument(await currentBytes()).extract({ comboSep });
}

/** 결과 문서: 양식 모드면 원본 양식에 값만 다시 넣고, 편집 모드면 에디터가 쓴 그대로 */
async function buildDocument(comboSep) {
  if (state.mode !== 'form' || !state.template) return currentBytes();
  const { values } = await readValues(comboSep);
  const doc = new HwpxDocument(state.template);
  doc.fill(values, { comboSep });
  return doc.toBytes();
}

async function load(bytes, keepMode = true) {
  await state.studio.loadFile(bytes, state.fileName, { suppressDialogs: true, skipUnsavedGuard: true });
  if (keepMode) await setFormMode(state.mode === 'form');
}

const api = {
  /** 문서 열기. b64 = HWPX 파일 내용, mode = form | edit | view */
  async open(b64, fileName = 'document.hwpx', mode = 'form') {
    state.template = fromB64(b64);
    state.fileName = fileName;
    state.mode = mode;
    new HwpxDocument(state.template); // HWPX 인지 먼저 확인
    await load(state.template);
    const doc = new HwpxDocument(state.template);
    emit('loaded', { fileName, table: doc.dbTable });
    return { ok: true, table: doc.dbTable };
  },

  async setMode(mode) {
    state.mode = mode;
    await setFormMode(mode === 'form');
    await state.studio.chrome.set({ menu: mode === 'edit', toolbar: mode === 'edit' });
    return { ok: true };
  },

  /** 개체 목록과 테이블명 */
  async getSchema() {
    const doc = new HwpxDocument(state.template ?? (await currentBytes()));
    return { ok: true, table: doc.dbTable, schema: doc.schema() };
  },

  /** 값 대입. values = {컬럼: 값}. 결과 {applied, unknown, rejected} */
  async setFields(values, comboSep = ':') {
    if (typeof values === 'string') values = JSON.parse(values || '{}');
    const base = state.mode === 'form' && state.template ? state.template : await currentBytes();
    const doc = new HwpxDocument(base);
    if (state.mode === 'form' && state.template) {
      // 화면에서 이미 입력한 값은 살리고, 새 값만 덮어쓴다
      const shown = await readValues(comboSep);
      doc.fill(shown.values, { comboSep });
    }
    const result = doc.fill(values, { comboSep });
    await load(doc.toBytes());
    return { ok: true, ...result };
  },

  /** 값 추출. {table, values:{컬럼: 값}} */
  async getFields(comboSep = ':') {
    return { ok: true, ...(await readValues(comboSep)) };
  },

  /** 결과 문서(HWPX)를 base64 로 */
  async getDocument(comboSep = ':') {
    return { ok: true, hwpx: toB64(await buildDocument(comboSep)) };
  },

  /** PDF 인쇄용으로 모든 쪽을 SVG 로 깔아 둔다. 이후 OCX 가 WebView2 PrintToPdf 를 부른다 */
  async preparePrint() {
    const area = document.getElementById('print-area');
    area.replaceChildren();
    const pages = await state.studio.pageCount();
    for (let p = 0; p < pages; p++) {
      const div = document.createElement('div');
      div.innerHTML = await state.studio.getPageSvg(p);
      area.append(div);
    }
    return { ok: true, pages };
  },
};

// OCX 는 문자열만 주고받으므로 결과를 JSON 문자열로 감싼다
window.hwpBridge = new Proxy(api, {
  get(target, name) {
    const fn = target[name];
    if (typeof fn !== 'function') return undefined;
    return async (...args) => {
      try {
        return JSON.stringify(await fn(...args));
      } catch (e) {
        return JSON.stringify({ ok: false, error: String(e?.message ?? e) });
      }
    };
  },
});

state.studio = await createStudio('#editor', {
  studioUrl: STUDIO_URL,
  plugins: ['hwpctrl'],
  chrome: { menu: false, toolbar: false, statusbar: false },
});
window.hwpBridgeReady = true;
emit('ready');
