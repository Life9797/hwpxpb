"""rhwp 명령행 도구(export-pdf)로 HWPX → PDF 변환. 브라우저가 필요 없다."""
from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path


def hwpx_to_pdf(
    hwpx: bytes,
    rhwp_bin: str | None = None,
    font_paths: list[str] | None = None,
    fallback_serif: str | None = None,
    fallback_sans: str | None = None,
    fallback_mono: str | None = None,
    timeout: float = 120,
) -> bytes:
    rhwp_bin = rhwp_bin or os.environ.get("RHWP_BIN") or "rhwp"
    # 문서 글꼴이 없을 때 쓸 글꼴. 기본은 rhwp 기본값(Noto CJK KR)
    fallback_serif = fallback_serif or os.environ.get("PDF_FALLBACK_SERIF")
    fallback_sans = fallback_sans or os.environ.get("PDF_FALLBACK_SANS")
    fallback_mono = fallback_mono or os.environ.get("PDF_FALLBACK_MONO")
    with tempfile.TemporaryDirectory(prefix="hwpxpb-") as d:
        src, out = Path(d, "doc.hwpx"), Path(d, "doc.pdf")
        src.write_bytes(hwpx)
        args = [rhwp_bin, "export-pdf", str(src), "-o", str(out)]
        for p in font_paths or []:
            args += ["--font-path", p]
        for flag, val in (("--fallback-serif", fallback_serif), ("--fallback-sans", fallback_sans), ("--fallback-mono", fallback_mono)):
            if val:
                args += [flag, val]
        try:
            r = subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=timeout)
        except FileNotFoundError as e:
            raise RuntimeError(f"PDF 변환기 실행 실패 ({rhwp_bin}): {e}") from e
        except subprocess.TimeoutExpired as e:
            raise RuntimeError(f"PDF 변환 시간 초과 ({timeout}초)") from e
        if r.returncode != 0:
            err = r.stderr.decode("utf-8", "replace").strip()[-8000:]
            raise RuntimeError(f"PDF 변환 실패 (exit {r.returncode}): {err}")
        return out.read_bytes()


def printable(hwpx: bytes) -> bytes:
    """PDF·인쇄용: 빈 칸 안내문을 지운 사본 (한글 인쇄와 같게)"""
    from .engine import HwpxDocument

    return HwpxDocument(hwpx).hide_guides().to_bytes()
