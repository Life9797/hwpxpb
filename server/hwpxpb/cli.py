"""Unix 배치·쉘에서 서버 없이 바로 쓰는 명령행 도구, 그리고 서버 실행.

  hwpxpb schema  <양식.hwpx>
  hwpxpb extract <문서.hwpx> [--combo-sep :]
  hwpxpb fill    <양식.hwpx> <값.json|-> -o <출력.hwpx> [--pdf <출력.pdf>] [--combo-sep :] [--strict]
  hwpxpb pdf     <문서.hwpx> -o <출력.pdf>
  hwpxpb serve   [--port 8080] [--host 0.0.0.0]
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from .engine import HwpxDocument
from .pdf import hwpx_to_pdf, printable

USAGE = """사용법:
  hwpxpb schema  <양식.hwpx>
  hwpxpb extract <문서.hwpx> [--combo-sep :]
  hwpxpb fill    <양식.hwpx> <값.json|-> -o <출력.hwpx> [--pdf <출력.pdf>] [--combo-sep :] [--strict]
  hwpxpb pdf     <문서.hwpx> -o <출력.pdf>
  hwpxpb serve   [--port 8080] [--host 0.0.0.0]"""


def pdf_opts() -> dict:
    return {
        "rhwp_bin": os.environ.get("RHWP_BIN") or "rhwp",
        "font_paths": [p for p in os.environ.get("FONT_PATHS", "").split(":") if p],
    }


def parse(argv: list[str]) -> tuple[list[str], dict]:
    pos: list[str] = []
    opt: dict = {}
    it = iter(argv)
    for a in it:
        if a in ("-o", "--output"):
            opt["output"] = next(it, None)
        elif a == "--pdf":
            opt["pdf"] = next(it, None)
        elif a == "--combo-sep":
            opt["combo_sep"] = next(it, None)
        elif a == "--port":
            opt["port"] = int(next(it, "8080"))
        elif a == "--host":
            opt["host"] = next(it, None)
        elif a == "--strict":
            opt["strict"] = True
        else:
            pos.append(a)
    return pos, opt


def out(obj) -> int:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False, indent=1) + "\n")
    return 0


def serve(opt: dict) -> int:
    from .app import App, create_server

    # 웹 에디터 화면 (scripts/build-pb-web.sh 결과). 없으면 API 만 연다
    default_web = Path(__file__).resolve().parents[2] / "pb" / "dist"
    web_dir = os.environ.get("WEB_DIR")
    if web_dir is None:
        web_dir = str(default_web) if (default_web / "index.html").is_file() else ""
    app = App(
        template_dir=os.environ.get("TEMPLATE_DIR") or "./templates",
        web_dir=web_dir or None,
        api_key=os.environ.get("API_KEY", ""),
        pdf=pdf_opts(),
        edit_keys=[k.strip() for k in os.environ.get("EDIT_KEYS", "").split(",")],
        edit_users=[u.strip() for u in os.environ.get("EDIT_USERS", "").split(",")],
        user_header=os.environ.get("AUTH_USER_HEADER", ""),
    )
    port = opt.get("port") or int(os.environ.get("PORT") or 8080)
    server = create_server(app, opt.get("host") or "0.0.0.0", port)
    print(f"hwpxpb server listening on :{port}" + (" (web editor: /)" if web_dir else ""), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    cmd, rest = (argv[0], argv[1:]) if argv else ("", [])
    pos, opt = parse(rest)
    combo_sep = opt.get("combo_sep") or ":"
    try:
        if cmd == "serve":
            return serve(opt)
        if cmd == "schema" and pos:
            doc = HwpxDocument(Path(pos[0]).read_bytes())
            return out({"table": doc.db_table, "schema": doc.schema()})
        if cmd == "extract" and pos:
            return out(HwpxDocument(Path(pos[0]).read_bytes()).extract(combo_sep))
        if cmd == "fill" and len(pos) >= 2 and opt.get("output"):
            text = sys.stdin.read() if pos[1] == "-" else Path(pos[1]).read_text(encoding="utf-8")
            doc = HwpxDocument(Path(pos[0]).read_bytes())
            result = doc.fill(json.loads(text), combo_sep)
            out(result)
            if opt.get("strict") and (result["unknown"] or result["rejected"]):
                return 2
            hwpx = doc.to_bytes()
            Path(opt["output"]).write_bytes(hwpx)
            if opt.get("pdf"):
                Path(opt["pdf"]).write_bytes(hwpx_to_pdf(printable(hwpx), **pdf_opts()))
            return 0
        if cmd == "pdf" and pos and opt.get("output"):
            Path(opt["output"]).write_bytes(hwpx_to_pdf(printable(Path(pos[0]).read_bytes()), **pdf_opts()))
            return 0
    except (OSError, ValueError, RuntimeError) as e:
        print(e, file=sys.stderr)
        return 1
    print(USAGE, file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
