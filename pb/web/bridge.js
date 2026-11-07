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
//
// 에디터 안쪽 기능(폭 맞춤·고침 여부·복구 설정)은 window.rhwpStudio.hwpxpb 를 쓴다
// (scripts/patch-studio-dist.mjs 가 studio 빌드 결과에 넣는다).
import { createStudio } from './vendor/rhwp-editor/index.js';
import { GROUP_SEP, HwpxDocument } from './vendor/engine/index.js';

const STUDIO_URL = new URL('./studio/', location.href).href;

const state = {
  studio: null,
  template: null, // 원본 양식 바이트 (Uint8Array)
  fileName: 'document.hwpx',
  mode: 'form', // form | edit | view
  allowEdit: false, // 문서 전체 편집 권한 (PB 는 OCX AllowEdit, 브라우저는 서버 /api/permission)
  showMenu: false, // 편집 권한자에게 작성 모드에서도 원래 메뉴·도구 모음을 보여 줄지 (OCX ShowMenu)
  groupSep: GROUP_SEP, // 누름틀 묶음(컬럼__x) 값을 잇는 구분자 (OCX GroupSep)
  resetInProgress: false,
  closed: false, // CloseDocument 로 닫은 뒤 다시 열기 전까지
  autoFit: false, // 문서를 열거나 화면 크기가 바뀔 때마다 본문 폭 맞춤 (setAutoFit)
  userEdited: false, // 문서를 다시 불러오기(값 대입·인쇄 준비) 전에 사용자가 고친 적이 있는지
  shortcutLock: false, // 에디터 단축키 막기 (setShortcutLockModes)
  shortcutAllow: new Set(), // 잠금 중에도 허용할 키 ("ctrl+c" 꼴)
  lastFit: null, // 마지막으로 맞춘 본문 {bodyLeft, bodyWidth} (구역이 바뀌어 여백이 달라지면 다시 맞춤)
  recovery: true, // 복구용 자동 저장 (setRecovery). PC 에 저장해 다음 실행에도 쓴다 (시작할 때 읽음)
  saveDialogOpen: false, // 닫기 저장 확인 창이 떠 있는 동안 (그동안 다른 호출은 거절)
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
function requireDocument() {
  if (state.closed) throw new Error('열린 문서가 없습니다 (닫은 뒤 다시 열지 않음)');
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
  // 바깥 화면의 입력 칸·대화상자(키 설정 창, 저장 확인 창 등)에서 누른 키는 건드리지 않는다
  if (e.target?.ownerDocument === document && e.target.closest?.('input, select, textarea, dialog')) return;
  if (state.mode === 'form' && onFormNavKey(e)) return;
  if (state.shortcutLock && isShortcut(e) && !state.shortcutAllow.has(eventKey(e))) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}

/** 양식 이동 키면 처리하고 true */
function onFormNavKey(e) {
  const pressed = eventKey(e);
  if (!pressed) return false;
  const action = Object.keys(keys).find((k) => keys[k] && normalizeKey(keys[k]) === pressed);
  if (!action) return false;
  const nav = formNav();
  if (!nav) return false;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (action === 'nextObject') nav.moveObject(1);
  else if (action === 'prevObject') nav.moveObject(-1);
  else if (action === 'nextField') nav.moveField(1);
  else if (action === 'prevField') nav.moveField(-1);
  return true;
}

/**
 * 단축키 잠금에서 막는 키: Ctrl·Alt·Meta 조합과 F1~F24.
 * 글자 입력, 방향키, Tab, Enter, Backspace, Delete, Esc 와 양식 이동 키(setKeys)는 그대로 둔다.
 */
export function isShortcut(e) {
  if (e.isComposing || e.key === 'Process') return false; // 한글 입력 중
  if (/^F([1-9]|1\d|2[0-4])$/.test(e.key)) return true;
  if (!(e.ctrlKey || e.altKey || e.metaKey)) return false;
  // AltGr(Ctrl+Alt 로 들어옴)로 치는 글자는 입력이다
  if (e.getModifierState?.('AltGraph') && String(e.key).length === 1) return false;
  return true;
}

/** 에디터(rhwp-studio)의 양식 이동 기능 (patches/rhwp/0002) */
const formNav = () => studioWindow()?.rhwpStudio?.formNavigation ?? null;
/** 에디터 안쪽 기능 (scripts/patch-studio-dist.mjs) */
const studioHost = () => studioWindow()?.rhwpStudio?.hwpxpb ?? null;
function requireHost() {
  const h = studioHost();
  if (!h) throw new Error('에디터가 이 기능을 지원하지 않습니다 (scripts/patch-studio-dist.mjs 로 만든 studio 가 필요)');
  return h;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const truthy = (v) => v === true || v === 'true' || v === '1' || v === 1;

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

// ---- 본문 폭 맞춤 ----------------------------------------------------------------
// 좌우 여백을 뺀 본문 폭이 화면 폭에 꽉 차게 배율을 정하고, 본문 왼쪽 끝을 화면 왼쪽에 맞춘다. 세로는 스크롤.
// 에디터가 문서를 연 직후에는 쪽 배치·자체 배율 조정이 비동기로 이어지므로, 배율이 자리 잡을 때까지 다시 맞춘다.
let fitSeq = 0;
async function fitWidthNow() {
  const seq = ++fitSeq;
  const host = requireHost();
  watchSections(); // 에디터가 늦게 화면을 만든 경우를 위해 여기서도
  let result = null;
  for (let i = 0; i < 40 && seq === fitSeq; i++) {
    result = await host.fitBodyWidth();
    if (result) {
      state.lastFit = { bodyLeft: result.bodyLeft, bodyWidth: result.bodyWidth };
      await sleep(120);
      if (Math.abs(host.zoom() - result.zoom) < 1e-3) break; // 에디터가 배율을 다시 바꾸지 않았다
    } else await sleep(50); // 아직 쪽이 없다
  }
  if (!result) throw new Error('맞출 쪽이 없습니다');
  return result;
}
/** 자동 맞춤이 켜져 있으면 맞춘다 (실패해도 호출한 작업은 계속) */
async function autoFit() {
  if (!state.autoFit || !state.studio) return;
  try {
    await fitWidthNow();
  } catch {
    // 쪽이 없거나 에디터가 바뀌는 중
  }
}
/**
 * 쪽을 넘기다 여백이 다른 구역에 오면 다시 맞춘다 (AutoFit). 에디터를 새로 만들 때마다(reset) 다시 붙인다.
 */
let scrollTimer = null;
function watchSections() {
  const sc = studioWindow()?.document?.getElementById('scroll-container');
  if (!sc || sc.__hwpxpbFit) return;
  sc.__hwpxpbFit = true;
  sc.addEventListener(
    'scroll',
    () => {
      if (!state.autoFit) return;
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const now = studioHost()?.bodyAt?.();
        const last = state.lastFit;
        if (!now || !last) return;
        if (Math.abs(now.bodyWidth - last.bodyWidth) > 0.5 || Math.abs(now.bodyLeft - last.bodyLeft) > 0.5) autoFit();
      }, 200);
    },
    { passive: true },
  );
}
let resizeTimer = null;
function watchResize() {
  const root = document.querySelector('#editor');
  if (!root || typeof ResizeObserver !== 'function') return;
  new ResizeObserver(() => {
    if (!state.autoFit) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(autoFit, 150);
  }).observe(root);
}

// ---- 고침 여부 -------------------------------------------------------------------
/** 에디터가 지금 들고 있는 문서를 사용자가 고쳤는지 */
const studioDirty = () => Boolean(studioHost()?.isDirty?.());
/** 문서를 다시 불러오면 에디터의 고침 표시가 지워지므로, 그 전에 기억해 둔다 */
function rememberEdits() {
  if (studioDirty()) state.userEdited = true;
}
const isModified = () => !state.closed && (state.userEdited || studioDirty());

// ---- 저장 확인 창 (웹 모달) --------------------------------------------------------
/** "변경 내용을 저장할까요?" 예 = 'yes', 아니오 = 'no', 취소·Esc = 'cancel' */
function askSaveDialog(fileName) {
  const dlg = document.getElementById('save-dialog');
  if (!dlg?.showModal) return Promise.resolve(window.confirm(`${fileName} 의 변경 내용을 저장할까요?`) ? 'yes' : 'no');
  dlg.querySelector('[data-name]').textContent = fileName;
  dlg.returnValue = 'cancel';
  state.saveDialogOpen = true;
  return new Promise((resolve) => {
    dlg.addEventListener(
      'close',
      () => {
        state.saveDialogOpen = false;
        resolve(['yes', 'no'].includes(dlg.returnValue) ? dlg.returnValue : 'cancel');
      },
      { once: true },
    );
    dlg.showModal();
    dlg.querySelector('[value="yes"]')?.focus();
  });
}

// ---- 복구용 자동 저장 ---------------------------------------------------------------
// 에디터(rhwp-studio)는 편집 중 복구본을 IndexedDB 에 자동 저장하고, 비정상 종료 뒤 다시 시작하면 복구할지 묻는다.
// 켜고 끄는 값은 PC 에 저장하고, 에디터를 띄우기 전에 에디터 설정에 반영한다 (시작할 때 묻는 창이 설정을 보지 않으므로
// 끌 때는 남은 복구본도 지운다).
const RECOVERY_STORE = 'hwpxpb-recovery';
const STUDIO_SETTINGS = 'rhwp-settings';
const DRAFTS_DB = 'rhwpStudioAutosave';
/**
 * 시작할 때의 복구 설정. OCX 가 주소에 ?recovery=0|1 을 붙였으면(PB 가 RecoveryEnabled 를 화면을 열기 전에 정함)
 * 그 값을 쓰고 저장한다. 에디터가 시작하자마자 복구를 묻기 때문에, 열린 뒤에 정하면 이번 실행에는 늦다.
 */
function startupRecovery() {
  const q = new URLSearchParams(location.search).get('recovery');
  if (q === '0' || q === '1') {
    saveRecovery(q === '1');
    return q === '1';
  }
  return loadRecovery();
}
function loadRecovery() {
  try {
    return localStorage.getItem(RECOVERY_STORE) !== '0'; // 기본: 켬
  } catch {
    return true;
  }
}
function saveRecovery(on) {
  try {
    localStorage.setItem(RECOVERY_STORE, on ? '1' : '0');
  } catch {
    // 저장소를 못 쓰면 이번 실행에만 적용
  }
}
function deleteDatabase(name) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
      setTimeout(resolve, 2000);
    } catch {
      resolve();
    }
  });
}
/** 에디터를 띄우기 전에: 에디터 설정의 자동 저장을 켜고/끄고, 끌 때는 남은 복구본을 지운다 */
async function applyRecoveryBeforeStart(on) {
  try {
    const s = JSON.parse(localStorage.getItem(STUDIO_SETTINGS) || '{}');
    s.autosave = { ...(s.autosave ?? {}), recoveryEnabled: on, idleSaveEnabled: on };
    localStorage.setItem(STUDIO_SETTINGS, JSON.stringify(s));
  } catch {
    // 설정을 못 쓰면 에디터 기본값(켬)
  }
  if (!on) await deleteDatabase(DRAFTS_DB);
}
/** 일부러 닫는 문서의 복구본은 지우고 고침 표시를 없앤다 (다음 실행에 복구를 묻지 않게) */
async function discardDraft() {
  try {
    await studioWindow()?.rhwpStudio?.notifySaved?.();
  } catch {
    // 이전 studio
  }
}

/** 에디터 화면에 보이는 값 (DB 컬럼 기준) */
async function readValues(comboSep) {
  return new HwpxDocument(await currentBytes()).extract({ comboSep, groupSep: state.groupSep });
}

/** 화면에 보이는 값을 개체 단위 그대로 doc 에 옮긴다 (컬럼 값으로 바꾸지 않아 묶음 누름틀의 "," 등도 안 깨진다) */
async function restoreShown(doc, comboSep) {
  doc.fillRaw(new HwpxDocument(await currentBytes()).extractRaw(), { comboSep });
}

/** 결과 문서: 양식 모드면 원본 양식에 값만 다시 넣고, 편집 모드면 에디터가 쓴 그대로 */
async function buildDocument(comboSep) {
  if (!rebuildFromTemplate()) return currentBytes();
  const doc = new HwpxDocument(state.template);
  await restoreShown(doc, comboSep);
  return doc.toBytes();
}

async function load(bytes, keepMode = true) {
  rememberEdits();
  await state.studio.loadFile(bytes, state.fileName, { suppressDialogs: true, skipUnsavedGuard: true });
  if (keepMode) await setFormMode(state.mode === 'form');
}

/** 출력용 쪽 SVG 목록. 에디터에 출력용 문서를 잠시 열어 그리고, 보던 문서로 되돌린다 */
async function renderPrintPages(comboSep) {
  const shown = await buildDocument(comboSep);
  const printDoc = new HwpxDocument(shown).hideGuides().toBytes();
  const editor = document.getElementById('editor');
  // 원래 값으로 되돌린다. '' 로 지우면 index.html 의 #editor { visibility: hidden } 이 적용돼 에디터가 사라진다
  const shownVisibility = editor.style.visibility;
  editor.style.visibility = 'hidden';
  try {
    await load(printDoc, false);
    const pages = [];
    const n = await state.studio.pageCount();
    for (let p = 0; p < n; p++) pages.push(await state.studio.getPageSvg(p));
    return pages;
  } finally {
    await load(shown);
    editor.style.visibility = shownVisibility;
    await autoFit();
  }
}

const api = {
  /** 문서 열기. b64 = HWPX 파일 내용, mode = form | edit | view */
  async open(b64, fileName = 'document.hwpx', mode = 'form') {
    checkMode(mode);
    state.template = fromB64(b64);
    state.fileName = fileName;
    state.closed = false;
    state.mode = mode;
    new HwpxDocument(state.template); // HWPX 인지 먼저 확인
    await load(state.template);
    state.userEdited = false;
    await applyChrome();
    await autoFit();
    const doc = new HwpxDocument(state.template);
    emit('loaded', { fileName, table: doc.dbTable });
    return { ok: true, table: doc.dbTable };
  },

  async setMode(mode) {
    state.mode = checkMode(mode);
    await setFormMode(mode === 'form');
    await applyChrome();
    await autoFit();
    return { ok: true };
  },

  /** 편집 권한자에게 작성 모드에서도 원래 메뉴·도구 모음을 보여 준다(true) / 숨긴다(false) */
  async setShowMenu(show) {
    state.showMenu = show === true || show === 'true' || show === '1';
    await applyChrome();
    return { ok: true, showMenu: state.showMenu };
  },

  /** 누름틀 묶음(컬럼__x) 값을 잇고 나누는 구분자. "" 이면 기본값 "|" */
  async setGroupSep(sep) {
    state.groupSep = sep == null || sep === '' ? GROUP_SEP : String(sep);
    return { ok: true, groupSep: state.groupSep };
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

  /**
   * 문서 닫기: 빈 문서로 바꾸고 열었던 양식을 잊는다. 권한·모드·키 설정은 그대로.
   * askSave = false(기본): 묻지 않고 저장 없이 닫는다.
   * askSave = true: 사용자가 문서를 고쳤으면 "저장할까요?" 를 웹 모달로 묻는다.
   *   예     → {closed:true, save:true, document:<HWPX base64>}  (파일 저장은 호출한 쪽이 한다)
   *   아니오 → {closed:true, save:false}
   *   취소   → {closed:false, cancelled:true}  (문서는 그대로)
   * 고치지 않았으면 묻지 않고 {closed:true, save:false}.
   */
  async close(askSave = false, comboSep = ':') {
    let save = false;
    let hwpx;
    if (truthy(askSave) && isModified()) {
      const choice = await askSaveDialog(state.fileName);
      if (choice === 'cancel') return { ok: true, closed: false, cancelled: true, save: false };
      if (choice === 'yes') {
        hwpx = toB64(await buildDocument(comboSep || ':'));
        save = true;
      }
    }
    await discardDraft();
    await state.studio.commands.execute('file:new-doc');
    await discardDraft(); // 빈 문서도 고침 표시 없이
    state.template = null;
    state.fileName = 'document.hwpx';
    state.closed = true;
    state.userEdited = false;
    await setFormMode(state.mode === 'form');
    await applyChrome();
    emit('closed', { save });
    return save ? { ok: true, closed: true, save, document: hwpx } : { ok: true, closed: true, save };
  },

  /** 사용자가 문서를 고쳤는지 (값 대입 setFields 는 고침으로 치지 않는다) */
  async isModified() {
    return { ok: true, modified: isModified() };
  },

  /** 좌우 여백을 뺀 본문 폭을 화면 폭에 맞춘다. 세로는 스크롤 */
  async fitWidth() {
    const r = await fitWidthNow();
    return { ok: true, zoom: r.zoom };
  },

  /** true 면 문서를 열거나 모드·화면 크기가 바뀔 때마다 본문 폭에 맞춘다. 켜면 바로 한 번 맞춘다 */
  async setAutoFit(on) {
    state.autoFit = truthy(on);
    if (state.autoFit) await autoFit();
    return { ok: true, autoFit: state.autoFit };
  },

  async getAutoFit() {
    return { ok: true, autoFit: state.autoFit };
  },

  /**
   * 에디터 단축키 잠금. true 면 Ctrl·Alt 조합과 F1~F24 를 모든 모드(form/edit/view)에서 막는다.
   * 글자 입력·방향키·Tab·Enter·Backspace·Delete 와 양식 이동 키(setKeys)는 그대로 된다.
   * allow: 잠금 중에도 허용할 키를 쉼표로. 예: "Ctrl+C,Ctrl+V,Ctrl+Z". 빼면(또는 null) 지금 목록 그대로, "" 이면 비움
   */
  async setShortcutLockModes(on, allow) {
    if (allow != null) {
      const list = String(allow)
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
      // 수식 키만 있는 이름(예: "Ctrl+")은 키가 아니다
      const bad = list.find((k) => ['', ...MOD_ORDER].includes(normalizeKey(k).split('+').pop()));
      if (bad) throw new Error(`키 이름이 잘못됐습니다: ${bad}`);
      state.shortcutAllow = new Set(list.map(normalizeKey));
    }
    state.shortcutLock = truthy(on);
    return { ok: true, locked: state.shortcutLock, allow: [...state.shortcutAllow] };
  },

  async getShortcutLockModes() {
    return { ok: true, locked: state.shortcutLock, allow: [...state.shortcutAllow] };
  },

  /**
   * 복구용 자동 저장 켜기(true, 기본)/끄기(false). 값은 PC 에 저장되어 다음 실행에도 쓰인다.
   * 끄면 남아 있는 복구본을 지워, 다음에 시작할 때 복구할지 묻지 않는다.
   */
  async setRecovery(on) {
    state.recovery = truthy(on);
    saveRecovery(state.recovery);
    await applyRecoveryBeforeStart(state.recovery).catch(() => {}); // 다음 시작용 설정
    const host = studioHost();
    if (host) {
      host.setRecovery(state.recovery); // 지금 실행 중인 에디터에도 바로
      if (!state.recovery) await host.clearDrafts();
    }
    return { ok: true, recovery: state.recovery };
  },

  async getRecovery() {
    return { ok: true, recovery: state.recovery };
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
      // 창을 닫는 중이므로 떠 있는 저장 확인 창은 취소로 닫는다
      if (state.saveDialogOpen) document.getElementById('save-dialog')?.close('cancel');
      // 창을 닫아 일부러 버리는 문서다. 복구본을 남기면 다음 창(같은 화면 재사용)이 복구를 묻는다
      await discardDraft();
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
      state.closed = false;
      state.mode = 'form';
      state.allowEdit = false;
      state.showMenu = false;
      state.groupSep = GROUP_SEP;
      state.autoFit = false;
      state.userEdited = false;
      state.shortcutLock = false;
      state.shortcutAllow = new Set();
      state.lastFit = null;
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
    requireDocument();
    const doc = new HwpxDocument(state.template ?? (await currentBytes()));
    return { ok: true, table: doc.dbTable, schema: doc.schema() };
  },

  /** DB 컬럼 이름 목록. order = 'document'(문서 순서, 기본) | 'created'(개체를 넣은 순서) */
  async getColumns(order = 'document') {
    requireDocument();
    const doc = new HwpxDocument(state.template ?? (await currentBytes()));
    return { ok: true, table: doc.dbTable, columns: doc.columns(order) };
  },

  /** 값 대입. values = {컬럼: 값}. 결과 {applied, unknown, rejected} */
  async setFields(values, comboSep = ':') {
    requireDocument();
    if (typeof values === 'string') values = JSON.parse(values || '{}');
    const base = rebuildFromTemplate() ? state.template : await currentBytes();
    const doc = new HwpxDocument(base);
    if (rebuildFromTemplate()) {
      // 화면에서 이미 입력한 값은 살리고, 새 값만 덮어쓴다
      await restoreShown(doc, comboSep);
    }
    const result = doc.fill(values, { comboSep, groupSep: state.groupSep });
    await load(doc.toBytes());
    await autoFit();
    return { ok: true, ...result };
  },

  /** 값 추출. {table, values:{컬럼: 값}} */
  async getFields(comboSep = ':') {
    requireDocument();
    return { ok: true, ...(await readValues(comboSep)) };
  },

  /** 결과 문서(HWPX)를 base64 로 */
  async getDocument(comboSep = ':') {
    requireDocument();
    return { ok: true, hwpx: toB64(await buildDocument(comboSep)) };
  },

  /**
   * 인쇄·PDF 준비: 출력용 문서(빈 칸 안내문 제외)의 모든 쪽을 SVG 로 #print-area 에 깐다.
   * 이후 OCX 는 WebView2 인쇄/PrintToPdf 를, 브라우저는 window.print() 를 부른다.
   */
  async preparePrint(comboSep = ':') {
    requireDocument();
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

// 저장 확인 창이 떠 있는 동안에도 부를 수 있는 함수 (상태만 읽음)
const READ_ONLY = new Set(['getPermission', 'getKeys', 'isModified', 'getAutoFit', 'getShortcutLockModes', 'getRecovery']);

// OCX 는 문자열만 주고받으므로 결과를 JSON 문자열로 감싼다
window.hwpBridge = new Proxy(api, {
  get(target, name) {
    const fn = target[name];
    if (typeof fn !== 'function') return undefined;
    return async (...args) => {
      // OCX 는 답을 기다리는 동안 PB 메시지를 돌리므로, 창이 떠 있을 때 PB 단추로 다른 호출이 들어올 수 있다
      if (state.saveDialogOpen && !READ_ONLY.has(name) && name !== 'reset') {
        return JSON.stringify({ ok: false, busy: true, error: '저장 확인 창이 열려 있습니다 (사용자 응답을 기다리는 중)' });
      }
      try {
        return JSON.stringify(await fn(...args));
      } catch (e) {
        return JSON.stringify({ ok: false, error: String(e?.message ?? e) });
      }
    };
  },
});

async function startStudio() {
  await applyRecoveryBeforeStart(state.recovery);
  state.studio = await createStudio('#editor', {
    studioUrl: STUDIO_URL,
    plugins: ['hwpctrl'],
    chrome: { menu: false, toolbar: false, statusbar: false },
  });
  hookEditorKeys();
  watchSections();
  // 에디터 원래 화면(메뉴·도구 모음)이 잠깐 보였다 사라지지 않게, 숨긴 상태로 만든 뒤 보인다
  document.querySelector('#editor').style.visibility = 'visible';
}

state.recovery = startupRecovery();
watchResize();
await startStudio();
window.hwpBridgeReady = true;
emit('ready');
