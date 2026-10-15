// 일반 브라우저에서 열었을 때의 화면 (PB 의 WebView2 안에서는 아무것도 하지 않는다).
// 버튼: 열기 · 모드 · 저장 · 다른 이름으로 저장 · 값 저장(JSON) · 인쇄/PDF
//
// PC 의 파일을 열어 편집하고 그 파일에 바로 저장한다 (Chrome·Edge 의 파일 접근 기능).
// 이 기능은 https 주소나 localhost 에서만 켜진다. 그 밖(http://서버주소 등)에서는
// 열기는 파일 선택, 저장은 내려받기로 대신한다.
//
// 주소로 문서를 바로 열 수도 있다 (서버 주소로 접속하면 이 화면이 뜬다).
//   http://서버:8080/?template=rx01      서버에 등록된 양식 (/api/templates/rx01)
//   index.html?src=<HWPX 주소>           임의 주소의 HWPX
//   &mode=edit                          자유 편집으로 열기 (기본: 양식 입력)
//   &key=<API 키>                       서버에 API_KEY 를 설정했을 때
//   &comboSep=|                         드롭다운 코드 구분자 (기본 ":")
import { DEFAULT_KEYS, eventKey } from './bridge.js';

if (!window.chrome?.webview) {
  document.body.classList.add('standalone');

  const params = new URLSearchParams(location.search);
  const comboSep = params.get('comboSep') ?? ':';
  const $ = (id) => document.getElementById(id);
  let fileName = 'document.hwpx';
  let fileHandle = null; // 연 PC 파일 (저장 시 덮어쓰기)
  const canPick = typeof window.showOpenFilePicker === 'function';
  const pickerTypes = [{ description: '한글 문서 (HWPX)', accept: { 'application/hwp+zip': ['.hwpx'] } }];

  const say = (msg = '') => ($('message').textContent = msg);
  const call = async (method, ...args) => {
    const r = JSON.parse(await window.hwpBridge[method](...args));
    if (!r.ok) throw new Error(r.error);
    return r;
  };
  const busy = async (fn) => {
    say('');
    document.body.style.cursor = 'progress';
    try {
      await fn();
    } catch (e) {
      say(String(e.message ?? e));
    } finally {
      document.body.style.cursor = '';
    }
  };
  const toB64 = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const download = (blob, name) => {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };

  async function openBytes(u8, name, handle = null) {
    await call('open', toB64(u8), name, $('sel-mode').value);
    fileName = name;
    fileHandle = handle;
    $('doc-name').textContent = name + (handle ? '' : ' (저장하면 내려받기)');
    for (const id of ['btn-save', 'btn-save-as', 'btn-values', 'btn-print']) $(id).disabled = false;
  }

  async function documentBytes() {
    const { hwpx } = await call('getDocument', comboSep);
    return Uint8Array.from(atob(hwpx), (c) => c.charCodeAt(0));
  }

  async function writeTo(handle, bytes) {
    if ((await handle.queryPermission?.({ mode: 'readwrite' })) !== 'granted') {
      if ((await handle.requestPermission?.({ mode: 'readwrite' })) !== 'granted') throw new Error('파일에 쓸 권한이 없습니다');
    }
    const w = await handle.createWritable();
    await w.write(bytes);
    await w.close();
  }

  async function saveAs() {
    const bytes = await documentBytes();
    if (typeof window.showSaveFilePicker !== 'function') {
      download(new Blob([bytes], { type: 'application/hwp+zip' }), fileName);
      return;
    }
    let handle;
    try {
      handle = await window.showSaveFilePicker({ suggestedName: fileName, types: pickerTypes });
    } catch (e) {
      if (e.name === 'AbortError') return; // 사용자가 취소
      throw e;
    }
    await writeTo(handle, bytes);
    fileHandle = handle;
    fileName = handle.name;
    $('doc-name').textContent = fileName;
    say('저장했습니다');
  }

  async function save() {
    if (!fileHandle) return saveAs();
    await writeTo(fileHandle, await documentBytes());
    say('저장했습니다');
  }

  // ---- 이동 키 설정 (이 브라우저에 저장) ----
  const KEYS_STORE = 'hwpxpb.keys';
  const prettyKey = (k) =>
    k
      .split('+')
      .map((p) => (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
      .join('+');
  const loadKeys = () => {
    try {
      return { ...DEFAULT_KEYS, ...JSON.parse(localStorage.getItem(KEYS_STORE) || '{}') };
    } catch {
      return { ...DEFAULT_KEYS };
    }
  };
  const keyInputs = () => Array.from(document.querySelectorAll('#keys-dialog input[data-key]'));
  const fillKeyInputs = (map) => keyInputs().forEach((i) => (i.value = map[i.dataset.key] ?? ''));
  for (const input of keyInputs()) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.shiftKey)) return;
      e.preventDefault();
      if (e.key === 'Backspace' || e.key === 'Delete') input.value = '';
      else if (eventKey(e)) input.value = prettyKey(eventKey(e));
    });
  }
  $('keys-default').onclick = () => fillKeyInputs(DEFAULT_KEYS);
  $('btn-keys').onclick = async () => {
    fillKeyInputs((await call('getKeys')).keys);
    $('keys-dialog').showModal();
  };
  $('keys-dialog').addEventListener('close', () =>
    busy(async () => {
      if ($('keys-dialog').returnValue !== 'ok') return;
      const map = Object.fromEntries(keyInputs().map((i) => [i.dataset.key, i.value]));
      await call('setKeys', JSON.stringify(map));
      try {
        localStorage.setItem(KEYS_STORE, JSON.stringify(map));
      } catch {} // 저장소를 못 쓰면 이번 화면에서만 적용
      say('이동 키를 바꿨습니다');
    }),
  );

  async function ready() {
    while (!window.hwpBridgeReady) await new Promise((r) => setTimeout(r, 50));
    try {
      await call('setKeys', JSON.stringify(loadKeys()));
    } catch {
      await call('setKeys', JSON.stringify(DEFAULT_KEYS)); // 저장된 값이 잘못됐으면 기본값
    }
    $('btn-open').disabled = false;
    $('sel-mode').disabled = false;
    $('btn-keys').disabled = false;
    try {
      document.querySelector('#editor iframe')?.contentWindow?.addEventListener('keydown', onKey, true);
    } catch {} // 다른 출처면 건너뜀
  }

  $('btn-open').onclick = () => {
    if (!canPick) return $('file-input').click();
    busy(async () => {
      let handle;
      try {
        [handle] = await window.showOpenFilePicker({ types: pickerTypes });
      } catch (e) {
        if (e.name === 'AbortError') return;
        throw e;
      }
      const f = await handle.getFile();
      await openBytes(new Uint8Array(await f.arrayBuffer()), f.name, handle);
    });
  };
  $('file-input').onchange = (e) =>
    busy(async () => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) await openBytes(new Uint8Array(await f.arrayBuffer()), f.name);
    });
  $('sel-mode').onchange = (e) => busy(() => call('setMode', e.target.value));
  $('btn-save').onclick = () => busy(save);
  $('btn-save-as').onclick = () => busy(saveAs);
  $('btn-values').onclick = () =>
    busy(async () => {
      const { table, values } = await call('getFields', comboSep);
      const json = JSON.stringify({ table, values }, null, 2);
      download(new Blob([json], { type: 'application/json' }), fileName.replace(/\.hwpx$/i, '') + '.json');
    });
  $('btn-print').onclick = () => busy(() => call('print', comboSep));
  // Ctrl+S 저장, Ctrl+P 출력 (안내문 제외). 에디터(iframe) 안에서 눌러도 여기서 처리한다
  const onKey = (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const btn = { s: 'btn-save', p: 'btn-print' }[e.key.toLowerCase()];
    if (btn && !$(btn).disabled) {
      e.preventDefault();
      e.stopImmediatePropagation();
      $(btn).click();
    }
  };
  window.addEventListener('keydown', onKey, true);

  await ready();
  if (params.get('mode')) $('sel-mode').value = params.get('mode');
  const template = params.get('template');
  const src = template ? new URL(`/api/templates/${encodeURIComponent(template)}`, location.href).href : params.get('src');
  if (src) {
    await busy(async () => {
      const headers = params.get('key') ? { 'X-API-Key': params.get('key') } : {};
      const res = await fetch(src, { headers });
      if (!res.ok) throw new Error(`문서를 불러오지 못했습니다 (${res.status})`);
      const name = template ? `${template}.hwpx` : decodeURIComponent(new URL(src, location.href).pathname.split('/').pop() || 'document.hwpx');
      await openBytes(new Uint8Array(await res.arrayBuffer()), name);
    });
  }
}
