import io
import re
import unittest
import zipfile

from hwpxpb.engine import HwpxDocument

from .fixture import make_hwpx


def section(data: bytes) -> str:
    return zipfile.ZipFile(io.BytesIO(data)).read("Contents/section0.xml").decode("utf-8")


def entries(data: bytes) -> dict:
    zf = zipfile.ZipFile(io.BytesIO(data))
    return {i.filename: zf.read(i) for i in zf.infolist()}


def open_doc() -> HwpxDocument:
    return HwpxDocument(make_hwpx())


class EngineTest(unittest.TestCase):
    def test_schema(self):
        by_name = {x["name"]: x for x in open_doc().schema()}
        self.assertEqual(by_name["PT_NM"]["type"], "clickhere")
        self.assertEqual(by_name["PT_NM"]["guide"], "성명")
        self.assertEqual(by_name["AGREE_YN"]["type"], "checkbox")
        self.assertEqual(by_name["M"]["group"], "SEX_CD")
        self.assertEqual(by_name["REGION_CD"]["items"], ["01:서울", "02:부산", "03|대구"])

    def test_extract_empty_form(self):
        r = open_doc().extract()
        self.assertEqual(r["table"], "TB_TEST")
        self.assertEqual(
            r["values"],
            {"PT_NM": "", "RESULT": "정상", "MEMO": "", "AGREE_YN": "N", "ITEM_CD": "", "SEX_CD": "M", "REGION_CD": ""},
        )

    def test_fill_extract_roundtrip(self):
        doc = open_doc()
        res = doc.fill(
            {
                "PT_NM": '홍<길>동 & "1"',
                "MEMO": "첫줄\n둘째줄",
                "AGREE_YN": "Y",
                "ITEM_CD": "02",
                "SEX_CD": "F",
                "REGION_CD": "02",
                "NOPE": "x",
            }
        )
        self.assertEqual(
            res,
            {"applied": ["AGREE_YN", "ITEM_CD", "MEMO", "PT_NM", "REGION_CD", "SEX_CD"], "unknown": ["NOPE"], "rejected": []},
        )
        again = HwpxDocument(doc.to_bytes()).extract()
        self.assertEqual(
            again["values"],
            {
                "PT_NM": '홍<길>동 & "1"',
                "RESULT": "정상",
                "MEMO": "첫줄\n둘째줄",
                "AGREE_YN": "Y",
                "ITEM_CD": "02",
                "SEX_CD": "F",
                "REGION_CD": "02",
            },
        )

    def test_rejected(self):
        doc = open_doc()
        res = doc.fill({"REGION_CD": "99", "SEX_CD": "X"})
        self.assertEqual(res["rejected"], ["REGION_CD", "SEX_CD"])
        self.assertEqual(doc.extract()["values"]["SEX_CD"], "M")  # 원래 선택 유지

    def test_combo_sep(self):
        doc = open_doc()
        self.assertEqual(doc.fill({"REGION_CD": "03"}, combo_sep="|")["applied"], ["REGION_CD"])
        self.assertEqual(doc.extract(combo_sep="|")["values"]["REGION_CD"], "03")
        self.assertEqual(doc.extract(combo_sep=":")["values"]["REGION_CD"], "03|대구")

    def test_only_value_xml_changes(self):
        src = make_hwpx()
        doc = HwpxDocument(src)
        doc.fill({"AGREE_YN": "Y"})
        before, after = section(src), section(doc.to_bytes())
        self.assertEqual(
            after,
            before.replace(
                'value="UNCHECKED" radioGroupName="" triState="0" backStyle="OPAQUE" name="AGREE_YN"',
                'value="CHECKED" radioGroupName="" triState="0" backStyle="OPAQUE" name="AGREE_YN"',
            ),
        )
        out, orig = entries(doc.to_bytes()), entries(src)
        self.assertEqual(list(out)[0], "mimetype")
        info = zipfile.ZipFile(io.BytesIO(doc.to_bytes())).getinfo("mimetype")
        self.assertEqual(info.compress_type, zipfile.ZIP_STORED)
        for n in ("version.xml", "Contents/content.hpf", "Contents/header.xml"):
            self.assertEqual(out[n], orig[n])

    def test_not_hwpx(self):
        with self.assertRaises(ValueError):
            HwpxDocument(b"\x01\x02\x03")

    def test_guide_text_char_shape(self):
        doc = open_doc()
        doc.fill({"PT_NM": "홍길동", "RESULT": "이상"})
        xml = section(doc.to_bytes())
        self.assertRegex(
            xml,
            r'name="PT_NM"[^>]*>[\s\S]*?</hp:fieldBegin></hp:ctrl><hp:t>홍길동</hp:t></hp:run><hp:run charPrIDRef="37"><hp:t/></hp:run>',
        )
        self.assertNotIn(" 성명</hp:t>", xml)
        self.assertRegex(xml, r'<hp:t>이상</hp:t><hp:ctrl><hp:fieldEnd beginIDRef="102"')

    def test_empty_fill_is_noop(self):
        src = make_hwpx()
        doc = HwpxDocument(src)
        doc.fill(doc.extract()["values"])
        self.assertEqual(section(doc.to_bytes()), section(src))

    def test_hide_guides(self):
        doc = open_doc()
        doc.fill({"MEMO": "메모"})
        doc.hide_guides()
        xml = section(doc.to_bytes())
        self.assertNotIn(" 성명</hp:t>", xml)
        self.assertIn("Direction:wstring:2:   HelpState:", xml)  # 길이 표기는 그대로, 글자만 공백
        v = HwpxDocument(doc.to_bytes()).extract()["values"]
        self.assertEqual((v["RESULT"], v["MEMO"], v["PT_NM"]), ("정상", "메모", ""))

    def test_json_number_and_bool_values(self):
        doc = open_doc()
        doc.fill({"PT_NM": 175.0, "MEMO": True, "AGREE_YN": 1})
        v = doc.extract()["values"]
        self.assertEqual((v["PT_NM"], v["MEMO"], v["AGREE_YN"]), ("175", "true", "Y"))


if __name__ == "__main__":
    unittest.main()
