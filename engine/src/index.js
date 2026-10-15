// HWPX 양식 값 대입/추출 엔진 (브라우저·Node 공용 ESM)
//
// 원칙: 값이 들어가는 부분(누름틀 내부 텍스트, 양식 개체의 value/selectedValue)만 바꾸고
// 나머지 XML 은 바이트 단위로 그대로 둔다. 서식·표·배치는 건드리지 않는다.
//
// DB 매핑 규칙
//   테이블명  문서 정보(키워드/설명)에 "dbtable=테이블명"
//   누름틀·드롭다운·단독 체크박스  개체 이름 = 컬럼명 (단독 체크박스 값은 Y/N)
//   다중 체크박스  이름 "컬럼__코드" → 체크된 코드를 "01,02" 로
//   라디오  그룹 이름 = 컬럼, 선택된 버튼의 이름 = 값 ("컬럼__값" 도 허용)
//   드롭다운  항목 "코드<구분자>표시" (구분자 기본 ":"), 값은 코드. 코드만 줘도 항목 선택
import { unzipSync, zipSync } from 'fflate';

export const SEP = '__';
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
    yield {
      name: attr(tag, 'name'),
      tag,
      tagStart: m.index,
      guide: guideText(xml.slice(m.index, blockEnd)),
      dirty: attr(tag, 'dirty') === '1',
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

// ---- 문서 열기/저장 --------------------------------------------------------
export class HwpxDocument {
  /** @param {Uint8Array|ArrayBuffer} bytes */
  constructor(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.entries = unzipSync(u8); // 객체 키 순서 = ZIP 엔트리 순서
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
      for (const f of iterFields(xml)) out.push({ name: f.name, type: 'clickhere', guide: f.guide });
      for (const m of xml.matchAll(FORM_RE)) {
        const type = FORM_KIND[m[1]];
        const item = { name: attr(m[0], 'name'), type };
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

  /** DB 컬럼 기준 추출: {table, values:{컬럼: 값}} */
  extract({ comboSep = ':' } = {}) {
    const raw = this.extractRaw();
    const kinds = new Map(this.schema().map((x) => [x.name, x]));
    const out = {};
    for (const [name, val] of Object.entries(raw)) {
      const type = kinds.get(name)?.type ?? 'radio'; // 라디오는 그룹 이름으로 들어온다
      if (type === 'checkbox' && name.includes(SEP)) {
        const [col, code] = [name.slice(0, name.indexOf(SEP)), name.slice(name.indexOf(SEP) + SEP.length)];
        out[col] ??= [];
        if (val) out[col].push(code);
      } else if (type === 'checkbox') out[name] = val ? 'Y' : 'N';
      else if (type === 'radio') out[name] = String(val).includes(SEP) ? String(val).split(SEP).slice(1).join(SEP) : val;
      else if (type === 'combobox') out[name] = codeOf(val, comboSep);
      else out[name] = val;
    }
    for (const k of Object.keys(out)) if (Array.isArray(out[k])) out[k] = out[k].join(',');
    return { table: this.dbTable, values: out };
  }

  /** DB 컬럼 기준 대입. 반환: {applied, unknown, rejected} (모두 컬럼명 배열) */
  fill(values, { comboSep = ':' } = {}) {
    const items = this.schema();
    const raw = {};
    const known = new Set();
    for (const it of items) {
      const { name, type } = it;
      if (type === 'checkbox' && name.includes(SEP)) {
        const col = name.slice(0, name.indexOf(SEP));
        known.add(col);
        if (col in values) {
          const codes = String(values[col] ?? '')
            .split(',')
            .map((c) => c.trim());
          raw[name] = codes.includes(name.slice(name.indexOf(SEP) + SEP.length));
        }
      } else if (type === 'checkbox') {
        known.add(name);
        if (name in values) raw[name] = ['Y', '1', 'TRUE'].includes(String(values[name]).toUpperCase());
      } else if (type === 'radio') {
        known.add(it.group);
        if (it.group in values) raw[it.group] = values[it.group];
      } else {
        known.add(name);
        if (name in values) raw[name] = values[name];
      }
    }
    const { applied, rejected } = this.fillRaw(raw, { comboSep });
    const appliedCols = new Set([...applied].map((n) => (n.includes(SEP) ? n.slice(0, n.indexOf(SEP)) : n)));
    const keys = Object.keys(values);
    return {
      applied: keys.filter((k) => appliedCols.has(k)).sort(),
      unknown: keys.filter((k) => !known.has(k)).sort(),
      rejected: keys.filter((k) => known.has(k) && !appliedCols.has(k)).sort(),
    };
  }
}
