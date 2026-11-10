// HWPX 양식 값 대입/추출 엔진 (브라우저·Node 공용 ESM)
//
// 원칙: 값이 들어가는 부분(누름틀 내부 텍스트, 양식 개체의 value/selectedValue)만 바꾸고
// 나머지 XML 은 바이트 단위로 그대로 둔다. 서식·표·배치는 건드리지 않는다.
//
// DB 매핑 규칙
//   테이블명  문서 정보(키워드/설명)에 "dbtable=테이블명"
//   누름틀·드롭다운·단독 체크박스  개체 이름 = 컬럼명 (단독 체크박스 값은 Y/N)
//   다중 체크박스  이름 "컬럼__코드" → 체크된 코드를 "01,02" 로
//   누름틀 묶음  이름 "컬럼__아무거나" → 문서 순서대로 값을 "|" 로 이어서 (구분자는 groupSep 로 바꿀 수 있음)
//   라디오  그룹 이름 = 컬럼, 선택된 버튼의 이름 = 값 ("컬럼__값" 도 허용)
//   드롭다운  항목 "코드<구분자>표시" (구분자 기본 ":"), 값은 코드. 코드만 줘도 항목 선택
import { unzipSync, zipSync } from 'fflate';

export const SEP = '__';
/** 누름틀 묶음 값의 기본 구분자 */
export const GROUP_SEP = '|';
const SECTION_RE = /^Contents\/section\d+\.xml$/;
const FIELD_BEGIN_RE = /<hp:fieldBegin\b[^>]*\btype="CLICK_HERE"[^>]*>/g;
const FORM_RE = /<hp:(checkBtn|radioBtn|comboBox)\b[^>]*>/g;
const TEXT_RE = /<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>|<hp:t\s*\/>/g;
const FORM_KIND = { checkBtn: 'checkbox', radioBtn: 'radio', comboBox: 'combobox' };

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8');

// ---- XML 유틸 ------------------------------------------------------------
const escapeXml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unescapeXml = (s) =>
  String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

function attr(tag, name) {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? unescapeXml(m[1]) : null;
}

function setAttr(tag, name, value) {
  const re = new RegExp(`(\\b${name}=")[^"]*(")`);
  if (re.test(tag)) return tag.replace(re, (_, a, b) => a + escapeXml(value) + b);
  return tag.replace(/(\/?>)$/, ` ${name}="${escapeXml(value)}"$1`);
}

function guideText(beginXml) {
  const m = /Direction:wstring:\d+:([\s\S]*?) HelpState:/.exec(beginXml);
  return m ? unescapeXml(m[1]).trim() : '';
}

function contentText(fragment) {
  let out = '';
  for (const m of fragment.matchAll(TEXT_RE)) {
    let t = m[1] || '';
    t = t.replace(/<hp:lineBreak\s*\/>/g, '\n').replace(/<hp:tab\b[^>]*\/>/g, '\t').replace(/<[^>]+>/g, '');
    out += unescapeXml(t);
  }
  return out;
}

// 누름틀 하나의 위치 정보. 내용 구간 = fieldBegin 의 </hp:ctrl> 뒤 ~ fieldEnd 의 <hp:ctrl> 앞.
// 내용은 같은 run 안(<ctrl/><t/><ctrl/>)에 있을 수도, 여러 run 에 걸칠 수도 있다.
function* iterFields(xml) {
  for (const m of xml.matchAll(FIELD_BEGIN_RE)) {
    const tag = m[0];
    const id = attr(tag, 'id');
    const blockEnd = xml.indexOf('</hp:fieldBegin>', m.index) + '</hp:fieldBegin>'.length;
    const start = xml.indexOf('</hp:ctrl>', blockEnd) + '</hp:ctrl>'.length;
    const endPos = xml.indexOf(`<hp:fieldEnd beginIDRef="${id}"`, start);
    if (endPos < 0) continue;
    const end = xml.lastIndexOf('<hp:ctrl>', endPos);
    const guide = guideText(xml.slice(m.index, blockEnd));
    // 에디터(rhwp)는 직접 입력해도 dirty="0" 그대로 저장한다. 내용이 안내문과 다르면 입력된 값으로 본다
    const shown = contentText(xml.slice(start, end)).trim();
    yield {
      name: attr(tag, 'name'),
      id: Number(id) || 0,
      tag,
      tagStart: m.index,
      guide,
      dirty: attr(tag, 'dirty') === '1' || (shown !== '' && shown !== guide),
      start,
      end,
    };
  }
}

function comboItems(xml, from) {
  const body = xml.slice(from, xml.indexOf('</hp:comboBox>', from));
  return [...body.matchAll(/<hp:listItem\b[^>]*\bvalue="([^"]*)"/g)].map((m) => unescapeXml(m[1]));
}

const codeOf = (item, comboSep) =>
  comboSep && item.includes(comboSep) ? item.slice(0, item.indexOf(comboSep)).trim() : item;

function pickComboItem(items, wanted, comboSep) {
  const w = String(wanted);
  return items.find((it) => it === w || codeOf(it, comboSep) === w) ?? null;
}

function radioMatches(tag, wanted) {
  const want = String(wanted);
  const name = attr(tag, 'name') || '';
  return want === name || want === attr(tag, 'caption') || (name.includes(SEP) && name.slice(name.indexOf(SEP) + SEP.length) === want);
}

/** ZIP 으로 못 여는 이유를 사람이 알 수 있게 (Python 엔진 not_hwpx_reason 과 같은 문구) */
export function notHwpxReason(u8, err) {
  const n = u8.length;
  const head = Array.from(u8.subarray(0, 4), (b) => b.toString(16).padStart(2, '0')).join(' ');
  if (n === 0) return 'HWPX 파일이 아닙니다: 내용이 비어 있습니다 (0바이트)';
  if (head === 'd0 cf 11 e0') return 'HWPX 파일이 아닙니다: HWP(바이너리) 파일입니다. 한글에서 HWPX 로 저장해 쓰세요';
  if (head.startsWith('50 4b')) return `HWPX 파일이 손상됐거나 덜 저장됐습니다 (${n}바이트${err ? `, ${err.message ?? err}` : ''}). 파일 쓰기가 끝난 뒤(닫은 뒤) 여세요`;
  return `HWPX(ZIP) 형식이 아닙니다 (${n}바이트, 앞부분 ${head}). 문서보안(DRM) 암호화나 base64 오류일 수 있습니다`;
}

// ---- 문서 열기/저장 --------------------------------------------------------
export class HwpxDocument {
  /** @param {Uint8Array|ArrayBuffer} bytes */
  constructor(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    try {
      this.entries = unzipSync(u8); // 객체 키 순서 = ZIP 엔트리 순서
    } catch (e) {
      throw new Error(notHwpxReason(u8, e));
    }
    if (!this.entries['mimetype']) throw new Error('HWPX 파일이 아닙니다 (mimetype 없음)');
    this.sections = Object.keys(this.entries).filter((n) => SECTION_RE.test(n)).sort();
  }

  xml(name) {
    return dec.decode(this.entries[name]);
  }

  /** 원본 엔트리 순서 유지, mimetype 은 무압축 */
  toBytes() {
    const files = {};
    for (const [name, data] of Object.entries(this.entries)) {
      files[name] = name === 'mimetype' ? [data, { level: 0 }] : [data, { level: 6 }];
    }
    return zipSync(files);
  }

  /**
   * XML 원문 일괄 치환. 모든 .xml/.hpf 엔트리(본문·머리말·문서정보)에서 글자를 바꾼다.
   * 예: doc.replaceText({ ptinfo: 'ptif' }).toBytes()
   * - 키는 긴 것부터 한 번에 바꾼다(바뀐 결과를 다시 바꾸지 않음). 대소문자 구분.
   * - 누름틀 속성의 `xxx:wstring:길이:값` 안에서 바뀌면 길이 표기도 고친다.
   * - 값은 XML 원문에 그대로 들어간다(< & 등은 직접 이스케이프).
   * 바꾼 개수는 this.replaced 에 남는다.
   */
  replaceText(map) {
    const keys = Object.keys(map).filter((k) => k !== '').sort((a, b) => b.length - a.length);
    this.replaced = 0;
    if (!keys.length) return this;
    const re = new RegExp(keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
    const sub = (t) => t.replace(re, (m) => (this.replaced++, String(map[m])));
    for (const name of Object.keys(this.entries)) {
      if (!/\.(xml|hpf)$/i.test(name)) continue;
      const xml = this.xml(name);
      if (!keys.some((k) => xml.includes(k))) continue;
      let out = '';
      let i = 0;
      const ws = /wstring:(\d+):/g;
      for (let m; (m = ws.exec(xml)); ) {
        const vs = m.index + m[0].length;
        const ve = vs + Number(m[1]);
        const val = sub(xml.slice(vs, ve));
        out += sub(xml.slice(i, m.index)) + `wstring:${val.length}:` + val;
        i = ws.lastIndex = ve;
      }
      this.entries[name] = enc.encode(out + sub(xml.slice(i)));
    }
    return this;
  }

  /** 문서 정보(키워드/설명)의 "dbtable=XXX" */
  get dbTable() {
    const hpf = this.entries['Contents/content.hpf'];
    if (!hpf) return null;
    const re = /<opf:meta name="(?:keyword|description)"[^>]*>([^<]*)<\/opf:meta>/g;
    for (const m of dec.decode(hpf).matchAll(re)) {
      const t = /dbtable\s*=\s*([\w.$#]+)/.exec(unescapeXml(m[1]));
      if (t) return t[1];
    }
    return null;
  }

  /** 개체 목록: [{name, type, guide?, group?, caption?, items?}] */
  schema() {
    const out = [];
    for (const s of this.sections) {
      const xml = this.xml(s);
      // order: 만든 순서. 누름틀은 id(넣을 때마다 커짐), 양식 개체는 tabOrder(넣은 순서로 매겨짐)
      for (const f of iterFields(xml)) out.push({ name: f.name, type: 'clickhere', guide: f.guide, order: f.id });
      for (const m of xml.matchAll(FORM_RE)) {
        const type = FORM_KIND[m[1]];
        const item = { name: attr(m[0], 'name'), type, order: Number(attr(m[0], 'tabOrder')) || 0 };
        if (type === 'radio') {
          item.group = attr(m[0], 'radioGroupName');
          item.caption = attr(m[0], 'caption');
        }
        if (type === 'combobox') item.items = comboItems(xml, m.index + m[0].length);
        out.push(item);
      }
    }
    return out;
  }

  /** 개체 단위 원시 값: 누름틀=문자열, 체크박스=boolean, 라디오=그룹명→버튼 이름, 드롭다운=선택 항목 전체 */
  extractRaw() {
    const values = {};
    for (const s of this.sections) {
      const xml = this.xml(s);
      for (const f of iterFields(xml)) {
        // dirty=0 이면 아직 안내문만 있는 빈 칸
        values[f.name] = f.dirty ? contentText(xml.slice(f.start, f.end)) : '';
      }
      for (const m of xml.matchAll(FORM_RE)) {
        const tag = m[0];
        const name = attr(tag, 'name');
        if (m[1] === 'checkBtn') values[name] = attr(tag, 'value') === 'CHECKED';
        else if (m[1] === 'radioBtn') {
          const group = attr(tag, 'radioGroupName') || name;
          if (!(group in values)) values[group] = '';
          if (attr(tag, 'value') === 'CHECKED') values[group] = name;
        } else values[name] = attr(tag, 'selectedValue') || '';
      }
    }
    return values;
  }

  /** 개체 단위 원시 값 대입. 반환: 적용된 개체/그룹 이름 집합 */
  fillRaw(values, { comboSep = ':' } = {}) {
    const applied = new Set();
    const rejected = new Set();
    for (const s of this.sections) {
      let xml = this.xml(s);
      const edits = [];
      // 라디오: 그룹 안에 값과 맞는 버튼이 있을 때만 바꾼다 (없으면 rejected)
      const radioHit = new Map();
      for (const m of xml.matchAll(FORM_RE)) {
        if (m[1] !== 'radioBtn') continue;
        const group = attr(m[0], 'radioGroupName');
        if (!(group in values)) continue;
        radioHit.set(group, radioHit.get(group) || radioMatches(m[0], values[group]));
      }
      for (const f of iterFields(xml)) {
        if (!(f.name in values)) continue;
        const text = values[f.name] == null ? '' : String(values[f.name]);
        if (!text && !f.dirty) {
          applied.add(f.name); // 이미 빈 칸: 안내문을 그대로 둔다
          continue;
        }
        const newText = escapeXml(text).replace(/\r?\n/g, '<hp:lineBreak/>');
        const frag = xml.slice(f.start, f.end);
        let newFrag;
        if (f.dirty && /<hp:t[\s>/]/.test(frag)) {
          // 이미 입력된 값: 첫 <hp:t> 에 새 값, 나머지는 비움 → 입력값의 글자 모양 유지
          let first = true;
          newFrag = frag.replace(TEXT_RE, () => {
            if (!first) return '<hp:t/>';
            first = false;
            return `<hp:t>${newText}</hp:t>`;
          });
        } else {
          // 빈 칸(안내문만 있음): 안내문은 비우고 값은 누름틀 시작 run 에 넣는다.
          // 안내문은 보통 빨간 글씨 등 별도 글자 모양이라, 한글에서 직접 입력할 때처럼 누름틀 글자 모양을 쓴다.
          newFrag = (text ? `<hp:t>${newText}</hp:t>` : '') + frag.replace(TEXT_RE, '<hp:t/>');
        }
        edits.push([f.start, f.end, newFrag]);
        edits.push([f.tagStart, f.tagStart + f.tag.length, setAttr(f.tag, 'dirty', text ? '1' : '0')]);
        applied.add(f.name);
      }
      for (const m of xml.matchAll(FORM_RE)) {
        const tag = m[0];
        const name = attr(tag, 'name');
        let next = null;
        if (m[1] === 'checkBtn' && name in values) {
          next = setAttr(tag, 'value', values[name] ? 'CHECKED' : 'UNCHECKED');
          applied.add(name);
        } else if (m[1] === 'radioBtn') {
          const group = attr(tag, 'radioGroupName');
          if (!(group in values)) continue;
          if (!radioHit.get(group)) {
            rejected.add(group);
            continue;
          }
          next = setAttr(tag, 'value', radioMatches(tag, values[group]) ? 'CHECKED' : 'UNCHECKED');
          applied.add(group);
        } else if (m[1] === 'comboBox' && name in values) {
          const picked = pickComboItem(comboItems(xml, m.index + tag.length), values[name], comboSep);
          if (picked == null) {
            rejected.add(name); // 목록에 없는 값은 넣지 않는다
            continue;
          }
          next = setAttr(tag, 'selectedValue', picked);
          applied.add(name);
        }
        if (next != null) edits.push([m.index, m.index + tag.length, next]);
      }
      // 뒤에서부터 바꿔야 앞쪽 위치가 유지된다
      edits.sort((a, b) => b[0] - a[0]);
      for (const [a, b, rep] of edits) xml = xml.slice(0, a) + rep + xml.slice(b);
      this.entries[s] = enc.encode(xml);
    }
    for (const r of rejected) applied.delete(r);
    return { applied, rejected };
  }

  /**
   * 출력(인쇄·PDF)용: 값이 없는 누름틀의 안내문을 지운다. 한글에서 인쇄할 때 안내문이 안 나오는 것과 같다.
   * 문서 안의 안내문 글자는 비우고, 누름틀 속성의 안내문(Direction)은 같은 길이의 공백으로 바꾼다
   * (속성 길이 표기가 어긋나지 않게). 저장용이 아니라 출력 직전에만 쓴다.
   */
  hideGuides() {
    for (const s of this.sections) {
      let xml = this.xml(s);
      const edits = [];
      for (const f of iterFields(xml)) {
        if (f.dirty) continue;
        const blockEnd = xml.indexOf('</hp:fieldBegin>', f.tagStart);
        const block = xml.slice(f.tagStart, blockEnd);
        const blanked = block.replace(/(Direction:wstring:(\d+):)([\s\S]*?)( HelpState:)/, (_, a, n, _t, b) => a + ' '.repeat(Number(n)) + b);
        if (blanked !== block) edits.push([f.tagStart, blockEnd, blanked]);
        edits.push([f.start, f.end, xml.slice(f.start, f.end).replace(TEXT_RE, '<hp:t/>')]);
      }
      edits.sort((a, b) => b[0] - a[0]);
      for (const [a, b, rep] of edits) xml = xml.slice(0, a) + rep + xml.slice(b);
      this.entries[s] = enc.encode(xml);
    }
    return this;
  }

  /**
   * DB 컬럼 이름 목록.
   * order='document' 는 문서에 나오는 순서(extract 와 같음),
   * order='created' 는 개체를 넣은 순서: 누름틀(id 순) 다음에 양식 개체(tabOrder 순).
   * HWPX 에는 누름틀과 양식 개체를 함께 비교할 시각 정보가 없어서 두 무리는 이 순서로 잇는다.
   * order='keep:이전목록'(탭 또는 쉼표로 이음) 은 이전 목록 순서를 그대로 두고, 새로 생긴 컬럼만 뒤에 붙인다
   * (없어진 컬럼은 빠진다). 양식에 개체를 중간에 넣어도 기존 컬럼 위치가 밀리지 않는다.
   */
  columns(order = 'document') {
    if (String(order).startsWith('keep:')) return keepOrder(this.columns('created'), String(order).slice(5));
    if (order !== 'created') return Object.keys(this.extract().values);
    const items = this.schema().map((it, i) => ({ ...it, i }));
    items.sort((a, b) => (a.type !== 'clickhere') - (b.type !== 'clickhere') || a.order - b.order || a.i - b.i);
    const out = [];
    for (const it of items) {
      let col = it.name;
      if ((it.type === 'checkbox' || it.type === 'clickhere') && col.includes(SEP)) col = col.slice(0, col.indexOf(SEP));
      else if (it.type === 'radio') col = it.group || it.name;
      if (!out.includes(col)) out.push(col);
    }
    return out;
  }

  /** DB 컬럼 기준 추출: {table, values:{컬럼: 값}} */
  extract({ comboSep = ':', groupSep = GROUP_SEP } = {}) {
    const raw = this.extractRaw();
    const kinds = new Map(this.schema().map((x) => [x.name, x]));
    const out = {};
    const joinWith = {};
    for (const [name, val] of Object.entries(raw)) {
      const type = kinds.get(name)?.type ?? 'radio'; // 라디오는 그룹 이름으로 들어온다
      if ((type === 'checkbox' || type === 'clickhere') && name.includes(SEP)) {
        const [col, code] = [name.slice(0, name.indexOf(SEP)), name.slice(name.indexOf(SEP) + SEP.length)];
        if (!Array.isArray(out[col])) out[col] = [];
        if (type === 'checkbox') {
          joinWith[col] = ',';
          if (val) out[col].push(code);
        } else {
          joinWith[col] = groupSep;
          out[col].push(val);
        }
      } else if (type === 'checkbox') out[name] = val ? 'Y' : 'N';
      else if (type === 'radio') out[name] = String(val).includes(SEP) ? String(val).split(SEP).slice(1).join(SEP) : val;
      else if (type === 'combobox') out[name] = codeOf(val, comboSep);
      else out[name] = val;
    }
    for (const k of Object.keys(out)) {
      if (!Array.isArray(out[k])) continue;
      // 누름틀 묶음이 모두 비었으면 "" (구분자만 남기지 않는다)
      out[k] = out[k].every((v) => v === '') ? '' : out[k].join(joinWith[k]);
    }
    return { table: this.dbTable, values: out };
  }

  /** DB 컬럼 기준 대입. 반환: {applied, unknown, rejected} (모두 컬럼명 배열) */
  fill(values, { comboSep = ':', groupSep = GROUP_SEP } = {}) {
    const items = this.schema();
    const raw = {};
    const known = new Set();
    const colOf = new Map(); // 개체(라디오는 그룹) 이름 → 컬럼
    // 누름틀 묶음: 컬럼 → 문서 순서의 개체 이름 목록 (같은 이름은 한 번)
    const groups = new Map();
    for (const it of items) {
      if (it.type !== 'clickhere' || !it.name.includes(SEP)) continue;
      const col = it.name.slice(0, it.name.indexOf(SEP));
      if (!groups.has(col)) groups.set(col, []);
      if (!groups.get(col).includes(it.name)) groups.get(col).push(it.name);
    }
    for (const [col, names] of groups) {
      known.add(col);
      for (const n of names) colOf.set(n, col);
      if (!(col in values)) continue;
      const parts = splitParts(values[col], groupSep, names.length);
      names.forEach((n, i) => (raw[n] = parts[i] ?? ''));
    }
    for (const it of items) {
      const { name, type } = it;
      if (type === 'clickhere' && name.includes(SEP)) continue;
      if (type === 'checkbox' && name.includes(SEP)) {
        const col = name.slice(0, name.indexOf(SEP));
        known.add(col);
        colOf.set(name, col);
        if (col in values) {
          const codes = String(values[col] ?? '')
            .split(',')
            .map((c) => c.trim());
          raw[name] = codes.includes(name.slice(name.indexOf(SEP) + SEP.length));
        }
      } else if (type === 'checkbox') {
        known.add(name);
        colOf.set(name, name);
        if (name in values) raw[name] = ['Y', '1', 'TRUE'].includes(String(values[name]).toUpperCase());
      } else if (type === 'radio') {
        known.add(it.group);
        colOf.set(it.group, it.group);
        if (it.group in values) raw[it.group] = values[it.group];
      } else {
        known.add(name);
        colOf.set(name, name);
        if (name in values) raw[name] = values[name];
      }
    }
    const { applied } = this.fillRaw(raw, { comboSep });
    const appliedCols = new Set([...applied].map((n) => colOf.get(n) ?? n));
    const keys = Object.keys(values);
    return {
      applied: keys.filter((k) => appliedCols.has(k)).sort(),
      unknown: keys.filter((k) => !known.has(k)).sort(),
      rejected: keys.filter((k) => known.has(k) && !appliedCols.has(k)).sort(),
    };
  }
}

/** 이전 순서를 지키고 새 컬럼은 뒤에 (Python keep_order 와 같음) */
function keepOrder(current, prev) {
  const have = new Set(current);
  const kept = [...new Set(prev.split(/[\t,\r\n]+/).map((c) => c.trim()).filter((c) => have.has(c)))];
  return [...kept, ...current.filter((c) => !kept.includes(c))];
}

/** 값을 구분자로 n 조각까지 나눈다. 조각이 남으면 마지막 칸에 나머지를 그대로 붙인다 */
function splitParts(value, sep, n) {
  const text = value == null ? '' : String(value);
  if (text === '') return [];
  const parts = sep ? text.split(sep) : [text];
  if (parts.length <= n) return parts;
  return [...parts.slice(0, n - 1), parts.slice(n - 1).join(sep)];
}

/** 함수 한 번으로: replaceText(bytes, { ptinfo: 'ptif' }) → 새 HWPX 바이트 */
export function replaceText(bytes, map) {
  return new HwpxDocument(bytes).replaceText(map).toBytes();
}
