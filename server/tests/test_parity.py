"""브라우저 엔진(JavaScript)과 Python 엔진이 같은 결과를 내는지 비교. node 가 없으면 건너뜀.

PB·브라우저에서 저장한 문서와 서버에서 만든 문서가 똑같아야 하므로 둘을 맞춰 둔다.
HWPXPB_PARITY_FILES 에 실제 양식 경로(: 로 구분)를 주면 그것도 비교한다.
"""
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

from hwpxpb.engine import SECTION_RE, HwpxDocument

from .fixture import make_hwpx

HERE = Path(__file__).resolve().parent
NODE = shutil.which("node")
HAS_FFLATE = (HERE.parents[1] / "node_modules" / "fflate").is_dir()

CASES = [
    ({}, ":"),
    ({"PT_NM": '홍<길>동 & "1"', "MEMO": "첫줄\n둘째줄", "AGREE_YN": "Y", "ITEM_CD": "01,02", "SEX_CD": "F", "REGION_CD": "02", "NOPE": 1}, ":"),
    ({"REGION_CD": "03", "SEX_CD": "남", "RESULT": "", "PT_NM": 175.5}, "|"),
    ({"REGION_CD": "99", "SEX_CD": "X", "AGREE_YN": "N", "ITEM_CD": ""}, ":"),
]


def py_run(data: bytes, values: dict, combo_sep: str) -> dict:
    def sections(b):
        zf = zipfile.ZipFile(io.BytesIO(b))
        return {n: zf.read(n).decode("utf-8") for n in zf.namelist() if SECTION_RE.match(n)}

    doc = HwpxDocument(data)
    out = {"schema": doc.schema(), "extract": doc.extract(combo_sep)}
    out["fill"] = doc.fill(values, combo_sep)
    out["filled"] = sections(doc.to_bytes())
    out["filledExtract"] = HwpxDocument(doc.to_bytes()).extract(combo_sep)
    out["hidden"] = sections(HwpxDocument(doc.to_bytes()).hide_guides().to_bytes())
    return out


@unittest.skipUnless(NODE and HAS_FFLATE, "node 와 npm 패키지(fflate)가 있어야 비교할 수 있음")
class ParityTest(unittest.TestCase):
    def compare(self, data: bytes, label: str):
        with tempfile.NamedTemporaryFile(suffix=".hwpx", delete=False) as f:
            f.write(data)
        # 문서의 실제 개체로 값을 채운 경우도 비교
        own = {}
        for it in HwpxDocument(data).schema():
            if it["type"] == "clickhere":
                own[it["name"]] = f"값 {it['name']}\n<&>"
            elif it["type"] == "checkbox":
                own[it["name"].split("__")[0]] = "Y" if "__" not in it["name"] else it["name"].split("__", 1)[1]
            elif it["type"] == "radio":
                own[it["group"]] = it["name"]
            elif it["type"] == "combobox" and it["items"]:
                own[it["name"]] = it["items"][-1].split(":")[0]
        try:
            for values, sep in CASES + [(own, ":")]:
                with self.subTest(file=label, values=values, sep=sep):
                    js = json.loads(
                        subprocess.run(
                            [NODE, str(HERE / "parity.mjs"), f.name, json.dumps(values), sep],
                            check=True, capture_output=True, text=True,
                        ).stdout
                    )
                    self.assertEqual(py_run(data, values, sep), js)
        finally:
            os.unlink(f.name)

    def test_fixture(self):
        self.compare(make_hwpx(), "fixture")

    def test_real_forms(self):
        for p in filter(None, os.environ.get("HWPXPB_PARITY_FILES", "").split(":")):
            self.compare(Path(p).read_bytes(), Path(p).name)


if __name__ == "__main__":
    unittest.main()
