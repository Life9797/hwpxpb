"""브라우저 없이 동작하는 HTTP 서버. Python 표준 라이브러리만 쓴다.

  GET  /health
  GET  /api/templates                     등록된 템플릿 목록
  PUT  /api/templates/:id                 템플릿 등록/교체 (본문: HWPX 바이트)
  GET  /api/templates/:id                 템플릿 파일 내려받기
  GET  /api/templates/:id/schema          개체 목록 + 테이블명
  POST /api/fill                          값 대입 → HWPX 또는 PDF
  POST /api/extract?comboSep=:            본문 HWPX 에서 값 추출
  POST /api/schema                        본문 HWPX 의 개체 목록
  POST /api/pdf                           본문 HWPX → PDF
  GET  /api/permission                    이 사용자가 문서 전체를 편집할 수 있는지 {canEdit}
  GET  /                                  웹 에디터 (web_dir 이 있을 때. 열기·저장·인쇄)
  GET  /?template=rx01                    등록된 양식을 에디터로 열기
"""
from __future__ import annotations

import base64
import json
import mimetypes
import posixpath
import re
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote, unquote, urlsplit

from .engine import HwpxDocument
from .pdf import hwpx_to_pdf, printable

ID_RE = re.compile(r"^[A-Za-z0-9가-힣_.-]{1,100}$")
TEMPLATE_RE = re.compile(r"^/api/templates/([^/]+)(/schema)?$")
HWPX_TYPE = "application/hwp+zip"
STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".wasm": "application/wasm",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".txt": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json",
}


class HttpError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class App:
    def __init__(
        self,
        template_dir: str | Path,
        web_dir: str | Path | None = None,
        api_key: str = "",
        max_body_bytes: int = 50 * 1024 * 1024,
        pdf: dict | None = None,
        log_requests: bool = True,
        edit_keys: list[str] | None = None,
        edit_users: list[str] | None = None,
        user_header: str = "",
    ):
        self.template_dir = Path(template_dir)
        self.web_dir = Path(web_dir).resolve() if web_dir else None
        self.api_key = api_key
        self.max_body_bytes = max_body_bytes
        self.pdf = pdf or {}
        self.log_requests = log_requests
        # 편집 권한: X-API-Key 가 edit_keys 중 하나이거나, 앞단 인증 프록시가 넣은 사용자 헤더가 edit_users 중 하나.
        # "*" 는 모두 허용. 아무것도 정하지 않으면 아무도 편집할 수 없다(작성만).
        self.edit_keys = [k for k in (edit_keys or []) if k]
        self.edit_users = [u for u in (edit_users or []) if u]
        self.user_header = user_header

    def can_edit(self, headers) -> bool:
        if "*" in self.edit_keys or "*" in self.edit_users:
            return True
        key = headers.get("X-API-Key") or ""
        if key and key in self.edit_keys:
            return True
        user = headers.get(self.user_header) if self.user_header else None
        return bool(user) and user in self.edit_users

    # ---- 템플릿 ----
    def template_path(self, tid: str) -> Path:
        if not ID_RE.match(tid) or tid.startswith("."):
            raise HttpError(400, "템플릿 ID 는 영문·숫자·한글·_ . - 만 쓸 수 있습니다")
        return self.template_dir / f"{tid}.hwpx"

    def load_template(self, tid: str) -> bytes:
        p = self.template_path(tid)
        if not p.is_file():
            raise HttpError(404, f"템플릿이 없습니다: {tid}")
        return p.read_bytes()

    @staticmethod
    def open_doc(data: bytes) -> HwpxDocument:
        try:
            return HwpxDocument(data)
        except ValueError as e:
            raise HttpError(400, f"HWPX 파일을 열 수 없습니다: {e}") from e

    def to_pdf(self, hwpx: bytes) -> bytes:
        try:
            # PDF 에는 빈 칸 안내문을 찍지 않는다 (한글 인쇄와 같게)
            return hwpx_to_pdf(printable(hwpx), **self.pdf)
        except RuntimeError as e:
            raise HttpError(500, str(e)) from e

    # ---- 요청 처리 ----
    def handle(self, req: "Handler") -> None:
        url = urlsplit(req.path)
        path = url.path
        query = parse_qs(url.query)
        combo_sep = query.get("comboSep", [":"])[0]
        method = req.command

        if path == "/health":
            return req.send_json(200, {"ok": True})
        if path == "/api/permission" and method == "GET":
            # API 키가 없어도 묻는다 (없으면 작성만)
            user = req.headers.get(self.user_header) if self.user_header else None
            return req.send_json(200, {"canEdit": self.can_edit(req.headers), "user": user or None})
        # 웹 에디터 화면은 인증 없이 연다 (화면 파일만. 양식·API 는 아래에서 키 확인)
        if self.web_dir and method in ("GET", "HEAD") and not path.startswith("/api/"):
            return self.send_static(req, path)
        if self.api_key and req.headers.get("X-API-Key") != self.api_key:
            raise HttpError(401, "X-API-Key 가 필요합니다")

        if method == "GET" and path == "/api/templates":
            self.template_dir.mkdir(parents=True, exist_ok=True)
            items = []
            for p in sorted(self.template_dir.glob("*.hwpx")):
                data = p.read_bytes()
                try:
                    table = HwpxDocument(data).db_table
                except ValueError:
                    table = None
                modified = datetime.fromtimestamp(p.stat().st_mtime, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                items.append({"id": p.stem, "size": len(data), "modified": modified, "table": table})
            return req.send_json(200, items)

        m = TEMPLATE_RE.match(path)
        if m:
            tid = unquote(m.group(1))
            if method == "PUT" and not m.group(2):
                data = req.read_body(self.max_body_bytes)
                doc = self.open_doc(data)
                self.template_dir.mkdir(parents=True, exist_ok=True)
                self.template_path(tid).write_bytes(data)
                return req.send_json(200, {"id": tid, "table": doc.db_table, "schema": doc.schema()})
            if method == "GET" and m.group(2):
                doc = self.open_doc(self.load_template(tid))
                return req.send_json(200, {"id": tid, "table": doc.db_table, "schema": doc.schema()})
            if method == "GET":
                return req.send_bytes(self.load_template(tid), HWPX_TYPE, f"{tid}.hwpx")

        if method == "POST" and path == "/api/fill":
            body = json.loads(req.read_body(self.max_body_bytes).decode("utf-8") or "{}")
            if body.get("templateId"):
                src = self.load_template(str(body["templateId"]))
            elif body.get("template"):
                src = base64.b64decode(str(body["template"]))
            else:
                raise HttpError(400, "templateId 또는 template(base64) 가 필요합니다")
            doc = self.open_doc(src)
            result = doc.fill(body.get("values") or {}, body.get("comboSep") or ":")
            if body.get("strict") and (result["unknown"] or result["rejected"]):
                return req.send_json(422, {"error": "대입하지 못한 값이 있습니다", **result})
            hwpx = doc.to_bytes()
            fmt = body.get("format") or "hwpx"
            headers = {"X-Fill-Result": quote(json.dumps(result, ensure_ascii=False, separators=(",", ":")), safe="")}
            if fmt == "hwpx":
                return req.send_bytes(hwpx, HWPX_TYPE, "filled.hwpx", headers)
            if fmt not in ("pdf", "both"):
                raise HttpError(400, "format 은 hwpx, pdf, both 중 하나입니다")
            pdf_bytes = self.to_pdf(hwpx)
            if fmt == "pdf":
                return req.send_bytes(pdf_bytes, "application/pdf", "filled.pdf", headers)
            return req.send_json(
                200,
                {**result, "hwpx": base64.b64encode(hwpx).decode(), "pdf": base64.b64encode(pdf_bytes).decode()},
                headers,
            )

        if method == "POST" and path == "/api/extract":
            return req.send_json(200, self.open_doc(req.read_body(self.max_body_bytes)).extract(combo_sep))
        if method == "POST" and path == "/api/schema":
            doc = self.open_doc(req.read_body(self.max_body_bytes))
            return req.send_json(200, {"table": doc.db_table, "schema": doc.schema()})
        if method == "POST" and path == "/api/pdf":
            data = req.read_body(self.max_body_bytes)
            self.open_doc(data)
            return req.send_bytes(self.to_pdf(data), "application/pdf", "document.pdf")
        raise HttpError(404, "없는 경로입니다")

    def send_static(self, req: "Handler", path: str) -> None:
        rel = posixpath.normpath(unquote(path)).lstrip("/")
        if rel in ("", "."):
            rel = "index.html"
        target = (self.web_dir / rel).resolve()
        if target.is_dir():
            target = target / "index.html"
        if self.web_dir not in target.parents or not target.is_file():
            raise HttpError(404, "없는 경로입니다")
        data = target.read_bytes()
        ext = target.suffix.lower()
        ctype = STATIC_TYPES.get(ext) or mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        req.send_response(200)
        req.send_header("Content-Type", ctype)
        req.send_header("Content-Length", str(len(data)))
        req.send_header("Cache-Control", "no-cache" if ext == ".html" else "max-age=3600")
        req.end_headers()
        if req.command != "HEAD":
            req.wfile.write(data)


class Handler(BaseHTTPRequestHandler):
    app: App
    server_version = "hwpxpb"
    protocol_version = "HTTP/1.1"

    def _run(self) -> None:
        try:
            self.app.handle(self)
        except HttpError as e:
            self.send_json(e.status, {"error": str(e)})
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as e:
            self.send_json(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            self.log_error("요청 처리 실패: %r", e)
            self.send_json(500, {"error": str(e)})

    do_GET = do_HEAD = do_POST = do_PUT = do_DELETE = _run

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        if self.app.log_requests:
            super().log_message(format, *args)

    def read_body(self, limit: int) -> bytes:
        size = int(self.headers.get("Content-Length") or 0)
        if size > limit:
            self.close_connection = True
            raise HttpError(413, "파일이 너무 큽니다")
        return self.rfile.read(size) if size else b""

    def send_json(self, status: int, obj: Any, headers: dict | None = None) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def send_bytes(self, data: bytes, ctype: str, filename: str, headers: dict | None = None) -> None:
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{quote(filename)}")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)


def create_server(app: App, host: str = "0.0.0.0", port: int = 8080) -> ThreadingHTTPServer:
    handler = type("BoundHandler", (Handler,), {"app": app})
    return ThreadingHTTPServer((host, port), handler)
