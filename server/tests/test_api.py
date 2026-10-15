import base64
import http.client
import json
import os
import stat
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.parse import unquote

from hwpxpb.app import App, create_server
from hwpxpb.engine import HwpxDocument

from .fixture import make_hwpx


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        d = Path(cls.tmp.name)
        # 실제 rhwp 대신 쓰는 가짜 PDF 변환기: -o 다음 경로에 PDF 머리말만 쓴다
        fake = d / "fake-rhwp"
        fake.write_text('#!/bin/sh\nwhile [ "$1" != "-o" ]; do shift; done\nprintf "%%PDF-1.7 fake" > "$2"\n')
        fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
        web = d / "web"
        (web / "studio").mkdir(parents=True)
        (web / "index.html").write_text("<!doctype html><title>editor</title>")
        (web / "studio" / "a.js").write_text("export {}")
        (d / "secret.txt").write_text("no")
        app = App(
            template_dir=d / "templates",
            web_dir=web,
            api_key="k",
            pdf={"rhwp_bin": os.environ.get("RHWP_BIN") or str(fake)},
            log_requests=False,
        )
        cls.server = create_server(app, "127.0.0.1", 0)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    def call(self, method, path, body=None, headers=None, key=True):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        h = {"X-API-Key": "k"} if key else {}
        h.update(headers or {})
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        conn.request(method, path, body=body, headers=h)
        r = conn.getresponse()
        data = r.read()
        conn.close()
        return r, data

    def test_needs_key(self):
        r, _ = self.call("GET", "/api/templates", key=False)
        self.assertEqual(r.status, 401)

    def test_template_flow(self):
        r, data = self.call("PUT", "/api/templates/rx01", make_hwpx())
        self.assertEqual(r.status, 200)
        self.assertEqual(json.loads(data)["table"], "TB_TEST")

        r, data = self.call("GET", "/api/templates")
        self.assertIn(["rx01", "TB_TEST"], [[t["id"], t["table"]] for t in json.loads(data)])

        r, data = self.call("GET", "/api/templates/rx01/schema")
        self.assertEqual(len(json.loads(data)["schema"]), 9)

        r, data = self.call(
            "POST", "/api/fill",
            {"templateId": "rx01", "values": {"PT_NM": "홍길동", "REGION_CD": "03", "SEX_CD": "F"}, "comboSep": "|"},
        )
        self.assertEqual(r.status, 200)
        self.assertEqual(r.getheader("Content-Type"), "application/hwp+zip")
        summary = json.loads(unquote(r.getheader("X-Fill-Result")))
        self.assertEqual(summary["applied"], ["PT_NM", "REGION_CD", "SEX_CD"])

        r, out = self.call("POST", "/api/extract?comboSep=|", data)
        self.assertEqual(json.loads(out)["values"]["REGION_CD"], "03")
        self.assertEqual(json.loads(out)["values"]["PT_NM"], "홍길동")

        r, data = self.call("GET", "/api/templates/rx01")
        self.assertEqual(data, make_hwpx())

    def test_strict_422(self):
        r, data = self.call("POST", "/api/fill", {"template": base64.b64encode(make_hwpx()).decode(), "values": {"NOPE": 1}, "strict": True})
        self.assertEqual(r.status, 422)
        self.assertEqual(json.loads(data)["unknown"], ["NOPE"])

    def test_pdf_and_both(self):
        tpl = base64.b64encode(make_hwpx()).decode()
        r, data = self.call("POST", "/api/fill", {"template": tpl, "values": {"PT_NM": "a"}, "format": "pdf"})
        self.assertEqual(r.status, 200)
        self.assertTrue(data.startswith(b"%PDF"))
        r, data = self.call("POST", "/api/fill", {"template": tpl, "values": {"PT_NM": "a"}, "format": "both"})
        j = json.loads(data)
        self.assertTrue(base64.b64decode(j["pdf"]).startswith(b"%PDF"))
        self.assertEqual(HwpxDocument(base64.b64decode(j["hwpx"])).extract()["values"]["PT_NM"], "a")
        r, data = self.call("POST", "/api/pdf", make_hwpx())
        self.assertTrue(data.startswith(b"%PDF"))

    def test_bad_input(self):
        r, _ = self.call("POST", "/api/extract", b"not a zip")
        self.assertEqual(r.status, 400)
        r, _ = self.call("PUT", "/api/templates/..x", make_hwpx())
        self.assertEqual(r.status, 400)
        r, _ = self.call("GET", "/api/templates/none")
        self.assertEqual(r.status, 404)
        r, _ = self.call("POST", "/api/fill", b"{bad json")
        self.assertEqual(r.status, 400)

    def test_web_editor(self):
        r, data = self.call("GET", "/?template=rx01", key=False)
        self.assertEqual(r.status, 200)
        self.assertIn("text/html", r.getheader("Content-Type"))
        r, _ = self.call("GET", "/studio/a.js", key=False)
        self.assertIn("javascript", r.getheader("Content-Type"))
        for bad in ("/..%2fsecret.txt", "/../secret.txt", "/studio/../../secret.txt"):
            r, _ = self.call("GET", bad, key=False)
            self.assertEqual(r.status, 404, bad)
        r, _ = self.call("GET", "/api/templates", key=False)  # API 는 여전히 키 필요
        self.assertEqual(r.status, 401)


if __name__ == "__main__":
    unittest.main()
