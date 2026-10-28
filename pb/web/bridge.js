// PB(OCX) ↔ 웹 에디터 다리. 서버 없이 PC 안에서만 동작한다.
//
// OCX 가 WebView2 의 ExecuteScriptAsync 로 window.hwpBridge.* 를 부르고,
// 이 페이지는 window.chrome.webview.postMessage 로 OCX 에 이벤트를 보낸다.
// 모든 함수는 JSON 으로 직렬화 가능한 값을 돌려준다(오류는 {ok:false, error}).
//
// 양식 모드(form)에서는 문서를 저장·추출할 때 "원본 양식 + 추출한 값" 으로 다시 만든다.
// 그래서 에디터가 문서를 다시 쓰더라도 결과 파일의 서식은 원본 양식 그대로다.
//
// 권한: 편집 권한(setPermission(true))이 있어야 자유 편집(edit)으로 바꿀 수 있다. 기본은 권한 없음.
// 권한이 없으면 어떤 모드에서든 결과 문서는 "원본 양식 + 값" 이라 본문을 고쳐도 반영되지 않는다.
import { createStudio } from './vendor/rhwp-editor/index.js';
import { HwpxDocument } from './vendor/engine/index.js';

const STUDIO_URL = new URL('./studio/', location.href).href;

const state = {
  studio: null,
  template: null, // 원본 양식 바이트 (Uint8Array)
  fileName: 'document.hwpx',
  mode: 'form', // form | edit | view
  allowEdit: false, // 문서 전체 편집 권한 (PB 는 OCX AllowEdit, 브라우저는 서버 /api/permission)
  showMenu: false, // 편집 권한자에게 작성 모드에서도 원래 메뉴·도구 모음을 보여 줄지 (OCX ShowMenu)
  resetInProgress: false,
};

/** 메뉴·도구 모음: 권한 없는 사용자는 항상 숨김. 권한자는 편집 모드에서, ShowMenu 면 작성 모드에서도 보인다 */
async function applyChrome() {
  if (!state.studio) return;
  const on = state.allowEdit && (state.mode === 'edit' || (state.showMenu && state.mode === 'form'));
  await state.studio.chrome.set({ menu: on, toolbar: on });
}

const MODES = ['form', 'edit', 'view'];
function checkMode(mode) {
  if (!MODES.includes(mode)) throw new Error(`모드는 ${MODES.join(', ')} 중 하나입니다: ${mode}`);
  if (mode === 'edit' && !state.allowEdit) throw new Error('편집 권한이 없습니다 (작성만 할 수 있습니다)');
  return mode;
}
/** 원본 양식에 값만 다시 넣어 결과를 만드는지 (자유 편집 결과를 쓰지 않음) */
const rebuildFromTemplate = () => Boolean(state.template) && (state.mode === 'form' || !state.allowEdit);

// ---- 양식 모드의 이동 키 -------------------------------------------------------
// nextObject/prevObject: 선택 개체(체크박스·라디오·드롭다운) 사이 이동. 고른 개체는 Space/Enter 로 체크·선택
// nextField/prevField:   누름틀 사이 이동
// 키 이름 예: "Ctrl+Tab", "Ctrl+Shift+Tab", "F8", "Alt+N". 빈 문자열이면 그 기능을 끈다.
export const DEFAULT_KEYS = Object.freeze({
  nextObject: 'Ctrl+Tab',
  prevObject: 'Ctrl+Shift+Tab',
  nextField: 'Tab',
  prevField: 'Shift+Tab',
});
const keys = { ...DEFAULT_KEYS };

const MOD_ORDER = ['ctrl', 'alt', 'shift', 'meta'];
const MOD_ALIAS = { control: 'ctrl', ctl: 'ctrl', option: 'alt', cmd: 'meta', command: 'meta', win: 'meta' };

/** "ctrl + tab" → "ctrl+tab" (비교용) */
function normalizeKey(text) {
  const parts = String(text ?? '')
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .map((p) => MOD_ALIAS[p] ?? p);
  if (parts.length === 0) return '';
  const key = parts.pop();
  const mods = MOD_ORDER.filter((m) => parts.includes(m));
  return [...mods, key === 'spacebar' ? 'space' : key].join('+');
}

/** 키 이벤트 → "ctrl+shift+tab" */
export function eventKey(e) {
  let key = e.key === ' ' ? 'space' : String(e.key).toLowerCase();
  if (['control', 'shift', 'alt', 'meta', 'process', 'dead', 'unidentified'].includes(key)) return '';
  // 한글 입력 중이거나 Shift 로 글자가 바뀌어도 같은 키로 보이게 물리 키 이름을 쓴다
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase();
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  return [e.ctrlKey && 'ctrl', e.altKey && 'alt', e.shiftKey && 'shift', e.metaKey && 'meta', key].filter(Boolean).join('+');
}

function onEditorKey(e) {
  if (state.mode !== 'form') return;
  // 바깥 화면의 입력 칸(키 설정 창 등)에서 누른 키는 건드리지 않는다
  if (e.target?.ownerDocument === document && e.target.closest?.('input, select, textarea, dialog')) return;
  const pressed = eventKey(e);
  if (!pressed) return;
  const action = Object.keys(keys).find((k) => keys[k] && normalizeKey(keys[k]) === pressed);
  if (!action) return;
  const nav = formNav();
  if (!nav) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (action === 'nextObject') nav.moveObject(1);
  else if (action === 'prevObject') nav.moveObject(-1);
  else if (action === 'nextField') nav.moveField(1);
  else if (action === 'prevField') nav.moveField(-1);
}

/** 에디터(rhwp-studio)의 양식 이동 기능 (patches/rhwp/0002) */
const formNav = () => studioWindow()?.rhwpStudio?.formNavigation ?? null;

function studioWindow() {
  try {
    return document.querySelector('#editor iframe')?.contentWindow ?? null;
  } catch {
    return null; // 다른 출처
  }
}

function hookEditorKeys() {
  window.addEventListener('keydown', onEditorKeyOnce, true);
  const frame = document.querySelector('#editor iframe');
  const attach = () => {
    const w = studioWindow();
    if (w && !w.__hwpxpbKeys) {
      w.__hwpxpbKeys = true;
      w.addEventListener('keydown', onEditorKeyOnce, true);
    }
  };
  attach();
  frame?.addEventListener('load', attach);
}
// 같은 이벤트가 바깥·안쪽 창에서 두 번 처리되지 않게
const seen = new WeakSet();
function onEditorKeyOnce(e) {
  if (seen.has(e)) return;
  seen.add(e);
  onEditorKey(e);
}

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
  if (!rebuildFromTemplate()) return currentBytes();
  const { values } = await readValues(comboSep);
  const doc = new HwpxDocument(state.template);
  doc.fill(values, { comboSep });
  return doc.toBytes();
}

async function load(bytes, keepMode = true) {
  await state.studio.loadFile(bytes, state.fileName, { suppressDialogs: true, skipUnsavedGuard: true });
  if (keepMode) await setFormMode(state.mode === 'form');
}

/** 출력용 쪽 SVG 목록. 에디터에 출력용 문서를 잠시 열어 그리고, 보던 문서로 되돌린다 */
async function renderPrintPages(comboSep) {
  const shown = await buildDocument(comboSep);
  const printDoc = new HwpxDocument(shown).hideGuides().toBytes();
  const editor = document.getElementById('editor');
  editor.style.visibility = 'hidden';
  try {
    await load(printDoc, false);
    const pages = [];
    const n = await state.studio.pageCount();
    for (let p = 0; p < n; p++) pages.push(await state.studio.getPageSvg(p));
    return pages;
  } finally {
    await load(shown);
    editor.style.visibility = '';
  }
}

const api = {
  /** 문서 열기. b64 = HWPX 파일 내용, mode = form | edit | view */
  async open(b64, fileName = 'document.hwpx', mode = 'form') {
    checkMode(mode);
    state.template = fromB64(b64);
    state.fileName = fileName;
    state.mode = mode;
    new HwpxDocument(state.template); // HWPX 인지 먼저 확인
    await load(state.template);
    await applyChrome();
    const doc = new HwpxDocument(state.template);
    emit('loaded', { fileName, table: doc.dbTable });
    return { ok: true, table: doc.dbTable };
  },

  async setMode(mode) {
    state.mode = checkMode(mode);
    await setFormMode(mode === 'form');
    await applyChrome();
    return { ok: true };
  },

  /** 편집 권한자에게 작성 모드에서도 원래 메뉴·도구 모음을 보여 준다(true) / 숨긴다(false) */
  async setShowMenu(show) {
    state.showMenu = show === true || show === 'true' || show === '1';
    await applyChrome();
    return { ok: true, showMenu: state.showMenu };
  },

  /** 문서 전체 편집 권한을 준다(true)/뺀다(false). 빼면 자유 편집 중이던 화면은 작성(form)으로 돌아간다 */
  async setPermission(canEdit) {
    state.allowEdit = canEdit === true || canEdit === 'true' || canEdit === '1';
    if (!state.allowEdit && state.mode === 'edit' && state.studio) await api.setMode('form');
    else await applyChrome();
    emit('permission', { canEdit: state.allowEdit });
    return { ok: true, canEdit: state.allowEdit, mode: state.mode };
  },

  async getPermission() {
    return { ok: true, canEdit: state.allowEdit, mode: state.mode };
  },

  /** 에디터에 열지 않고 파일(base64)의 테이블명만 읽는다 */
  async tableOf(b64) {
    return { ok: true, table: new HwpxDocument(fromB64(b64)).dbTable };
  },

  /**
   * 화면을 처음 상태로 되돌린다. OCX 가 창을 닫을 때 부르고, 이 화면을 다음 창에서 다시 쓴다.
   * 이전 문서·권한·메뉴·키 설정을 모두 비우고 에디터를 새로 만든다 (이전 문서가 남지 않는다).
   */
  async reset() {
    // Reset is a single lifecycle transition; do not allow overlapping teardown/recreation.
    if (state.resetInProgress) throw new Error('에디터 초기화가 이미 진행 중입니다');
    state.resetInProgress = true;
    try {
      try {
        state.studio?.destroy();
      } catch {
        // The previous editor may already have been destroyed.
      }
      state.studio = null;
      window.__hwpxReady = false;
      window.hwpBridgeReady = false;
      window.__hwpxErrs = [];
      state.template = null;
      state.fileName = 'document.hwpx';
      state.mode = 'form';
      state.allowEdit = false;
      state.showMenu = false;
      Object.assign(keys, DEFAULT_KEYS);
      const root = document.querySelector('#editor');
      if (!root) throw new Error('#editor 요소를 찾을 수 없습니다');
      root.replaceChildren();
      await startStudio();
      if (!state.studio) throw new Error('에디터 생성 결과가 없습니다');
      return { ok: true };
    } catch (error) {
      try {
        state.studio?.destroy();
      } catch {
        // Best-effort cleanup after a failed recreation.
      }
      state.studio = null;
      const root = document.querySelector('#editor');
      root?.replaceChildren();
      throw error;
    } finally {
      state.resetInProgress = false;
    }
  },

  /** 개체 목록과 테이블명 */
  async getSchema() {
    const doc = new HwpxDocument(state.template ?? (await currentBytes()));
    return { ok: true, table: doc.dbTable, schema: doc.schema() };
  },

  /** DB 컬럼 이름 목록. order = 'document'(문서 순서, 기본) | 'created'(개체를 넣은 순서) */
  async getColumns(order = 'document') {
    const doc = new HwpxDocument(state.template ?? (await currentBytes()));
    return { ok: true, table: doc.dbTable, columns: doc.columns(order) };
  },

  /** 값 대입. values = {컬럼: 값}. 결과 {applied, unknown, rejected} */
  async setFields(values, comboSep = ':') {
    if (typeof values === 'string') values = JSON.parse(values || '{}');
    const base = rebuildFromTemplate() ? state.template : await currentBytes();
    const doc = new HwpxDocument(base);
    if (rebuildFromTemplate()) {
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

  /**
   * 인쇄·PDF 준비: 출력용 문서(빈 칸 안내문 제외)의 모든 쪽을 SVG 로 #print-area 에 깐다.
   * 이후 OCX 는 WebView2 인쇄/PrintToPdf 를, 브라우저는 window.print() 를 부른다.
   */
  async preparePrint(comboSep = ':') {
    const pages = await renderPrintPages(comboSep);
    const area = document.getElementById('print-area');
    area.replaceChildren(
      ...pages.map((svg) => {
        const div = document.createElement('div');
        div.className = 'print-page';
        div.innerHTML = svg;
        return div;
      }),
    );
    return { ok: true, pages: pages.length };
  },

  /**
   * 양식 모드의 이동 키를 바꾼다. 예: {nextObject:"F8", prevObject:"Shift+F8"}
   * 빠진 항목은 그대로, 빈 문자열은 끔, null 이면 기본값. 결과: 지금 키 설정
   */
  async setKeys(map) {
    if (typeof map === 'string') map = JSON.parse(map || '{}');
    for (const [k, v] of Object.entries(map ?? {})) {
      if (!(k in DEFAULT_KEYS)) throw new Error(`알 수 없는 키 항목: ${k} (${Object.keys(DEFAULT_KEYS).join(', ')})`);
      if (v != null && v !== '' && !normalizeKey(v)) throw new Error(`키 이름이 잘못됐습니다: ${v}`);
      keys[k] = v == null ? DEFAULT_KEYS[k] : String(v);
    }
    return { ok: true, keys: { ...keys } };
  },

  async getKeys() {
    return { ok: true, keys: { ...keys }, defaults: { ...DEFAULT_KEYS } };
  },

  /** 다음(+1)/이전(-1) 선택 개체로 이동 (키 대신 버튼 등에서 부를 때) */
  async moveObject(delta = 1) {
    const nav = formNav();
    if (!nav) throw new Error('에디터가 키보드 이동을 지원하지 않습니다 (rhwp 패치 0002 필요)');
    return { ok: Boolean(nav.moveObject(Number(delta) < 0 ? -1 : 1)) };
  },

  /** 인쇄 대화상자(미리보기)를 연다. 브라우저·WebView2 공통 */
  async print(comboSep = ':') {
    const r = await api.preparePrint(comboSep);
    setTimeout(() => window.print(), 0); // 대화상자가 떠 있는 동안 호출이 끝나지 않도록 다음 틱에
    return r;
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

async function startStudio() {
  state.studio = await createStudio('#editor', {
    studioUrl: STUDIO_URL,
    plugins: ['hwpctrl'],
    chrome: { menu: false, toolbar: false, statusbar: false },
  });
  hookEditorKeys();
  // 에디터 원래 화면(메뉴·도구 모음)이 잠깐 보였다 사라지지 않게, 숨긴 상태로 만든 뒤 보인다
  document.querySelector('#editor').style.visibility = 'visible';
}

await startStudio();
window.hwpBridgeReady = true;
emit('ready');
