"""HWPX 양식 값 대입/추출 엔진 (Python). 브라우저용 engine/src/index.js 와 같은 규칙·결과.

원칙: 값이 들어가는 부분(누름틀 내부 텍스트, 양식 개체의 value/selectedValue)만 바꾸고
나머지 XML 은 그대로 둔다. 서식·표·배치는 건드리지 않는다.

DB 매핑 규칙
  테이블명  문서 정보(키워드/설명)에 "dbtable=테이블명"
  누름틀·드롭다운·단독 체크박스  개체 이름 = 컬럼명 (단독 체크박스 값은 Y/N)
  다중 체크박스  이름 "컬럼__코드" → 체크된 코드를 "01,02" 로
  라디오  그룹 이름 = 컬럼, 선택된 버튼의 이름 = 값 ("컬럼__값" 도 허용)
  드롭다운  항목 "코드<구분자>표시" (구분자 기본 ":"), 값은 코드. 코드만 줘도 항목 선택
"""
from __future__ import annotations

import io
import re
import zipfile
from typing import Any, Iterator

SEP = "__"
SECTION_RE = re.compile(r"^Contents/section\d+\.xml$")
FIELD_BEGIN_RE = re.compile(r'<hp:fieldBegin\b[^>]*\btype="CLICK_HERE"[^>]*>')
FORM_RE = re.compile(r"<hp:(checkBtn|radioBtn|comboBox)\b[^>]*>")
TEXT_RE = re.compile(r"<hp:t(?:\s[^>]*)?>([\s\S]*?)</hp:t>|<hp:t\s*/>")
FORM_KIND = {"checkBtn": "checkbox", "radioBtn": "radio", "comboBox": "combobox"}
GUIDE_RE = re.compile(r"Direction:wstring:\d+:([\s\S]*?) HelpState:")
DIRECTION_RE = re.compile(r"(Direction:wstring:(\d+):)([\s\S]*?)( HelpState:)")
META_RE = re.compile(r'<opf:meta name="(?:keyword|description)"[^>]*>([^<]*)</opf:meta>')
DBTABLE_RE = re.compile(r"dbtable\s*=\s*([\w.$#]+)", re.ASCII)


# ---- XML 유틸 ------------------------------------------------------------
def escape_xml(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def unescape_xml(s: str) -> str:
    s = s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'")
    s = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), s)
    s = re.sub(r"&#x([0-9a-fA-F]+);", lambda m: chr(int(m.group(1), 16)), s)
    return s.replace("&amp;", "&")


def to_text(v: Any) -> str:
    """JSON 값 → 문자열 (JavaScript String() 과 같게)"""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def attr(tag: str, name: str) -> str | None:
    m = re.search(r'\b' + name + r'="([^"]*)"', tag)
    return unescape_xml(m.group(1)) if m else None


def set_attr(tag: str, name: str, value: str) -> str:
    pattern = re.compile(r'(\b' + name + r'=")[^"]*(")')
    if pattern.search(tag):
        return pattern.sub(lambda m: m.group(1) + escape_xml(value) + m.group(2), tag, count=1)
    return re.sub(r"(/?>)$", lambda m: f' {name}="{escape_xml(value)}"' + m.group(1), tag, count=1)


def guide_text(begin_xml: str) -> str:
    m = GUIDE_RE.search(begin_xml)
    return unescape_xml(m.group(1)).strip() if m else ""


def content_text(fragment: str) -> str:
    out = ""
    for m in TEXT_RE.finditer(fragment):
        t = m.group(1) or ""
        t = re.sub(r"<hp:lineBreak\s*/>", "\n", t)
        t = re.sub(r"<hp:tab\b[^>]*/>", "\t", t)
        t = re.sub(r"<[^>]+>", "", t)
        out += unescape_xml(t)
    return out


def iter_fields(xml: str) -> Iterator[dict]:
    """누름틀 위치. 내용 구간 = fieldBegin 의 </hp:ctrl> 뒤 ~ fieldEnd 의 <hp:ctrl> 앞."""
    for m in FIELD_BEGIN_RE.finditer(xml):
        tag = m.group(0)
        fid = attr(tag, "id")
        block_end = xml.find("</hp:fieldBegin>", m.start()) + len("</hp:fieldBegin>")
        start = xml.find("</hp:ctrl>", block_end) + len("</hp:ctrl>")
        end_pos = xml.find(f'<hp:fieldEnd beginIDRef="{fid}"', start)
        if end_pos < 0:
            continue
        end = xml.rfind("<hp:ctrl>", 0, end_pos)
        yield {
            "name": attr(tag, "name"),
            "tag": tag,
            "tag_start": m.start(),
            "guide": guide_text(xml[m.start():block_end]),
            "dirty": attr(tag, "dirty") == "1",
            "start": start,
            "end": end,
        }


def combo_items(xml: str, start: int) -> list[str]:
    body = xml[start:xml.find("</hp:comboBox>", start)]
    return [unescape_xml(m.group(1)) for m in re.finditer(r'<hp:listItem\b[^>]*\bvalue="([^"]*)"', body)]


def code_of(item: str, combo_sep: str) -> str:
    return item[: item.index(combo_sep)].strip() if combo_sep and combo_sep in item else item


def pick_combo_item(items: list[str], wanted: Any, combo_sep: str) -> str | None:
    w = to_text(wanted)
    return next((it for it in items if it == w or code_of(it, combo_sep) == w), None)


def radio_matches(tag: str, wanted: Any) -> bool:
    want = to_text(wanted)
    name = attr(tag, "name") or ""
    return want == name or want == attr(tag, "caption") or (SEP in name and name[name.index(SEP) + len(SEP):] == want)


def _apply_edits(xml: str, edits: list[tuple[int, int, str]]) -> str:
    # 뒤에서부터 바꿔야 앞쪽 위치가 유지된다
    for a, b, rep in sorted(edits, key=lambda e: e[0], reverse=True):
        xml = xml[:a] + rep + xml[b:]
    return xml


# ---- 문서 ----------------------------------------------------------------
class HwpxDocument:
    def __init__(self, data: bytes):
        try:
            zf = zipfile.ZipFile(io.BytesIO(bytes(data)))
            self.entries: dict[str, bytes] = {i.filename: zf.read(i) for i in zf.infolist()}
        except (zipfile.BadZipFile, ValueError) as e:
            raise ValueError(f"HWPX 파일이 아닙니다 ({e})") from e
        if "mimetype" not in self.entries:
            raise ValueError("HWPX 파일이 아닙니다 (mimetype 없음)")
        self.sections = sorted(n for n in self.entries if SECTION_RE.match(n))

    def xml(self, name: str) -> str:
        # 잘못된 바이트도 그대로 되돌려 쓰도록 surrogateescape
        return self.entries[name].decode("utf-8", "surrogateescape")

    def _set_xml(self, name: str, xml: str) -> None:
        self.entries[name] = xml.encode("utf-8", "surrogateescape")

    def to_bytes(self) -> bytes:
        """원본 엔트리 순서 유지, mimetype 은 무압축"""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            for name, data in self.entries.items():
                if name == "mimetype":
                    zf.writestr(zipfile.ZipInfo(name), data, compress_type=zipfile.ZIP_STORED)
                else:
                    zf.writestr(name, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
        return buf.getvalue()

    @property
    def db_table(self) -> str | None:
        """문서 정보(키워드/설명)의 "dbtable=XXX" """
        hpf = self.entries.get("Contents/content.hpf")
        if hpf is None:
            return None
        for m in META_RE.finditer(hpf.decode("utf-8", "replace")):
            t = DBTABLE_RE.search(unescape_xml(m.group(1)))
            if t:
                return t.group(1)
        return None

    def schema(self) -> list[dict]:
        """개체 목록: [{name, type, guide?, group?, caption?, items?}]"""
        out: list[dict] = []
        for s in self.sections:
            xml = self.xml(s)
            for f in iter_fields(xml):
                out.append({"name": f["name"], "type": "clickhere", "guide": f["guide"]})
            for m in FORM_RE.finditer(xml):
                kind = FORM_KIND[m.group(1)]
                item: dict[str, Any] = {"name": attr(m.group(0), "name"), "type": kind}
                if kind == "radio":
                    item["group"] = attr(m.group(0), "radioGroupName")
                    item["caption"] = attr(m.group(0), "caption")
                if kind == "combobox":
                    item["items"] = combo_items(xml, m.end())
                out.append(item)
        return out

    def extract_raw(self) -> dict[str, Any]:
        """개체 단위 원시 값: 누름틀=문자열, 체크박스=bool, 라디오=그룹명→버튼 이름, 드롭다운=선택 항목 전체"""
        values: dict[str, Any] = {}
        for s in self.sections:
            xml = self.xml(s)
            for f in iter_fields(xml):
                # dirty=0 이면 아직 안내문만 있는 빈 칸
                values[f["name"]] = content_text(xml[f["start"]:f["end"]]) if f["dirty"] else ""
            for m in FORM_RE.finditer(xml):
                tag = m.group(0)
                name = attr(tag, "name")
                if m.group(1) == "checkBtn":
                    values[name] = attr(tag, "value") == "CHECKED"
                elif m.group(1) == "radioBtn":
                    group = attr(tag, "radioGroupName") or name
                    values.setdefault(group, "")
                    if attr(tag, "value") == "CHECKED":
                        values[group] = name
                else:
                    values[name] = attr(tag, "selectedValue") or ""
        return values

    def fill_raw(self, values: dict[str, Any], combo_sep: str = ":") -> tuple[set[str], set[str]]:
        """개체 단위 원시 값 대입. 반환: (적용된 이름, 넣지 못한 이름)"""
        applied: set[str] = set()
        rejected: set[str] = set()
        for s in self.sections:
            xml = self.xml(s)
            edits: list[tuple[int, int, str]] = []
            # 라디오: 그룹 안에 값과 맞는 버튼이 있을 때만 바꾼다 (없으면 rejected)
            radio_hit: dict[str, bool] = {}
            for m in FORM_RE.finditer(xml):
                if m.group(1) != "radioBtn":
                    continue
                group = attr(m.group(0), "radioGroupName")
                if group not in values:
                    continue
                radio_hit[group] = radio_hit.get(group, False) or radio_matches(m.group(0), values[group])
            for f in iter_fields(xml):
                if f["name"] not in values:
                    continue
                text = to_text(values[f["name"]])
                if not text and not f["dirty"]:
                    applied.add(f["name"])  # 이미 빈 칸: 안내문을 그대로 둔다
                    continue
                new_text = re.sub(r"\r?\n", "<hp:lineBreak/>", escape_xml(text))
                frag = xml[f["start"]:f["end"]]
                if f["dirty"] and re.search(r"<hp:t[\s>/]", frag):
                    # 이미 입력된 값: 첫 <hp:t> 에 새 값, 나머지는 비움 → 입력값의 글자 모양 유지
                    first = [True]

                    def repl(_m: re.Match, first=first, new_text=new_text) -> str:
                        if not first[0]:
                            return "<hp:t/>"
                        first[0] = False
                        return f"<hp:t>{new_text}</hp:t>"

                    new_frag = TEXT_RE.sub(repl, frag)
                else:
                    # 빈 칸(안내문만 있음): 안내문은 비우고 값은 누름틀 시작 run 에 넣는다.
                    # 안내문은 보통 빨간 글씨 등 별도 글자 모양이라, 한글에서 직접 입력할 때처럼 누름틀 글자 모양을 쓴다.
                    new_frag = (f"<hp:t>{new_text}</hp:t>" if text else "") + TEXT_RE.sub("<hp:t/>", frag)
                edits.append((f["start"], f["end"], new_frag))
                edits.append((f["tag_start"], f["tag_start"] + len(f["tag"]), set_attr(f["tag"], "dirty", "1" if text else "0")))
                applied.add(f["name"])
            for m in FORM_RE.finditer(xml):
                tag = m.group(0)
                name = attr(tag, "name")
                nxt = None
                if m.group(1) == "checkBtn" and name in values:
                    nxt = set_attr(tag, "value", "CHECKED" if values[name] else "UNCHECKED")
                    applied.add(name)
                elif m.group(1) == "radioBtn":
                    group = attr(tag, "radioGroupName")
                    if group not in values:
                        continue
                    if not radio_hit.get(group):
                        rejected.add(group)
                        continue
                    nxt = set_attr(tag, "value", "CHECKED" if radio_matches(tag, values[group]) else "UNCHECKED")
                    applied.add(group)
                elif m.group(1) == "comboBox" and name in values:
                    picked = pick_combo_item(combo_items(xml, m.end()), values[name], combo_sep)
                    if picked is None:
                        rejected.add(name)  # 목록에 없는 값은 넣지 않는다
                        continue
                    nxt = set_attr(tag, "selectedValue", picked)
                    applied.add(name)
                if nxt is not None:
                    edits.append((m.start(), m.end(), nxt))
            self._set_xml(s, _apply_edits(xml, edits))
        applied -= rejected
        return applied, rejected

    def hide_guides(self) -> "HwpxDocument":
        """출력(인쇄·PDF)용: 값이 없는 누름틀의 안내문을 지운다. 한글에서 인쇄할 때 안내문이 안 나오는 것과 같다.
        문서 안의 안내문 글자는 비우고, 누름틀 속성의 안내문(Direction)은 같은 길이의 공백으로 바꾼다."""
        for s in self.sections:
            xml = self.xml(s)
            edits: list[tuple[int, int, str]] = []
            for f in iter_fields(xml):
                if f["dirty"]:
                    continue
                block_end = xml.find("</hp:fieldBegin>", f["tag_start"])
                block = xml[f["tag_start"]:block_end]
                blanked = DIRECTION_RE.sub(lambda m: m.group(1) + " " * int(m.group(2)) + m.group(4), block, count=1)
                if blanked != block:
                    edits.append((f["tag_start"], block_end, blanked))
                edits.append((f["start"], f["end"], TEXT_RE.sub("<hp:t/>", xml[f["start"]:f["end"]])))
            self._set_xml(s, _apply_edits(xml, edits))
        return self

    def extract(self, combo_sep: str = ":") -> dict:
        """DB 컬럼 기준 추출: {table, values:{컬럼: 값}}"""
        raw = self.extract_raw()
        kinds = {x["name"]: x for x in self.schema()}
        out: dict[str, Any] = {}
        for name, val in raw.items():
            kind = kinds.get(name, {}).get("type", "radio")  # 라디오는 그룹 이름으로 들어온다
            if kind == "checkbox" and SEP in name:
                col, code = name[: name.index(SEP)], name[name.index(SEP) + len(SEP):]
                out.setdefault(col, [])
                if val:
                    out[col].append(code)
            elif kind == "checkbox":
                out[name] = "Y" if val else "N"
            elif kind == "radio":
                v = to_text(val)
                out[name] = SEP.join(v.split(SEP)[1:]) if SEP in v else val
            elif kind == "combobox":
                out[name] = code_of(val, combo_sep)
            else:
                out[name] = val
        for k, v in out.items():
            if isinstance(v, list):
                out[k] = ",".join(v)
        return {"table": self.db_table, "values": out}

    def fill(self, values: dict[str, Any], combo_sep: str = ":") -> dict:
        """DB 컬럼 기준 대입. 반환: {applied, unknown, rejected} (모두 컬럼명 목록)"""
        raw: dict[str, Any] = {}
        known: set[str] = set()
        for it in self.schema():
            name, kind = it["name"], it["type"]
            if kind == "checkbox" and SEP in name:
                col = name[: name.index(SEP)]
                known.add(col)
                if col in values:
                    codes = [c.strip() for c in to_text(values[col]).split(",")]
                    raw[name] = name[name.index(SEP) + len(SEP):] in codes
            elif kind == "checkbox":
                known.add(name)
                if name in values:
                    raw[name] = to_text(values[name]).upper() in ("Y", "1", "TRUE")
            elif kind == "radio":
                known.add(it["group"])
                if it["group"] in values:
                    raw[it["group"]] = values[it["group"]]
            else:
                known.add(name)
                if name in values:
                    raw[name] = values[name]
        applied, _ = self.fill_raw(raw, combo_sep)
        applied_cols = {n[: n.index(SEP)] if SEP in n else n for n in applied}
        keys = list(values.keys())
        return {
            "applied": sorted(k for k in keys if k in applied_cols),
            "unknown": sorted(k for k in keys if k not in known),
            "rejected": sorted(k for k in keys if k in known and k not in applied_cols),
        }
