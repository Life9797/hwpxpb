"""시험용 최소 HWPX 생성기 (engine/test/fixture.js 와 같은 내용)."""
import io
import zipfile


def _click_here(fid, name, guide, content, dirty=0, same_run=False):
    begin = (
        f'<hp:ctrl><hp:fieldBegin id="{fid}" type="CLICK_HERE" name="{name}" editable="1" dirty="{dirty}" zorder="-1" fieldid="1">'
        '<hp:parameters cnt="2" name=""><hp:integerParam name="Prop">9</hp:integerParam>'
        f'<hp:stringParam name="Command" xml:space="preserve">Clickhere:set:40:Direction:wstring:{len(guide)}:{guide} HelpState:wstring:0:  </hp:stringParam>'
        "</hp:parameters></hp:fieldBegin></hp:ctrl>"
    )
    end = f'<hp:ctrl><hp:fieldEnd beginIDRef="{fid}" fieldid="1"/></hp:ctrl>'
    if same_run:
        return f'<hp:run charPrIDRef="32">{begin}<hp:t>{content}</hp:t>{end}<hp:t/></hp:run>'
    return (
        f'<hp:run charPrIDRef="32">{begin}</hp:run>'
        f'<hp:run charPrIDRef="37"><hp:t>{content}</hp:t></hp:run>'
        f'<hp:run charPrIDRef="32">{end}<hp:t/></hp:run>'
    )


def _form(el, name, caption="", value="UNCHECKED", group="", selected=None, inner=""):
    sel = f' selectedValue="{selected}"' if selected is not None else ""
    return (
        f'<hp:run charPrIDRef="0"><hp:{el} caption="{caption}" value="{value}" '
        f'radioGroupName="{group}" triState="0" backStyle="OPAQUE" name="{name}"{sel}'
        ' foreColor="#000000" backColor="#FFFFFF" groupName="" tabStop="1" tabOrder="1" enabled="1">'
        f'<hp:formCharPr charPrIDRef="0" followContext="0" autoSz="0" wordWrap="0"/>{inner}'
        f'<hp:sz width="1000" widthRelTo="ABSOLUTE" height="800" heightRelTo="ABSOLUTE" protect="0"/></hp:{el}><hp:t/></hp:run>'
    )


def _para(body):
    return (
        f'<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">{body}'
        '<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000" textheight="1000" baseline="850" spacing="600" horzpos="0" horzsize="7280" flags="393216"/></hp:linesegarray></hp:p>'
    )


def make_hwpx(keyword="dbtable=TB_TEST") -> bytes:
    section = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>'
        '<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">'
        + _para('<hp:run charPrIDRef="0"><hp:t>성명: </hp:t></hp:run>' + _click_here(101, "PT_NM", "성명", " 성명"))
        + _para(_click_here(102, "RESULT", "판정", "정상", dirty=1, same_run=True))
        + _para(_click_here(103, "MEMO", "메모", ""))
        + _para(_form("checkBtn", "AGREE_YN"))
        + _para(_form("checkBtn", "ITEM_CD__01") + _form("checkBtn", "ITEM_CD__02"))
        + _para(_form("radioBtn", "M", caption="남", group="SEX_CD", value="CHECKED") + _form("radioBtn", "F", caption="여", group="SEX_CD"))
        + _para(
            _form(
                "comboBox",
                "REGION_CD",
                selected="",
                inner='<hp:listItem displayText="" value="01:서울"/><hp:listItem displayText="" value="02:부산"/><hp:listItem displayText="" value="03|대구"/>',
            )
        )
        + "</hs:sec>"
    )
    hpf = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:metadata>'
        f'<opf:title/><opf:meta name="keyword" content="text">{keyword}</opf:meta></opf:metadata></opf:package>'
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(zipfile.ZipInfo("mimetype"), "application/hwp+zip", compress_type=zipfile.ZIP_STORED)
        for name, text in (
            ("version.xml", '<?xml version="1.0"?><hv:HCFVersion xmlns:hv="x"/>'),
            ("Contents/content.hpf", hpf),
            ("Contents/header.xml", '<?xml version="1.0"?><hh:head xmlns:hh="x"/>'),
            ("Contents/section0.xml", section),
        ):
            zf.writestr(name, text.encode("utf-8"), compress_type=zipfile.ZIP_DEFLATED)
    return buf.getvalue()
