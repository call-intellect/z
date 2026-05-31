"""Smoke-test runner for document-ingest Phase 0.

Goal: validate Docling + RapidOCR stack on 5 real Russian fixtures BEFORE
investing into the full DCS sidecar (Phase 1).

Gates from TZ §0.3:
  - RAM peak on 50-page PDF      <= 4 GB
  - Cold on 20-page PDF          <= 30 s
  - Markdown quality test #1     >= 3/4 (manual)
  - OCR precision test #2        >= 90% (5 known Russian words present)
  - docling-cpu image            <= 3 GB

Mounted layout:
  /work/fixtures/  (read-only, 5 fixtures from backend/test/fixtures/documents)
  /work/results/   (writable, markdown outputs + smoke.log)
"""

from __future__ import annotations

import gc
import json
import os
import time
import tracemalloc
from dataclasses import dataclass, field
from pathlib import Path

# Quiet down noisy loggers before importing docling.
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

from docling.backend.pypdfium2_backend import PyPdfiumDocumentBackend
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import (
    PdfPipelineOptions,
    RapidOcrOptions,
)
from docling.document_converter import DocumentConverter, PdfFormatOption


FIXTURES_DIR = Path("/work/fixtures")
RESULTS_DIR = Path("/work/results")
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

# Order matters — text-PDF first (warms up Docling), then scan (OCR path),
# then office formats, then HTML.
FIXTURES = [
    ("text-pdf-regulation.pdf", "text-pdf"),
    ("scan-pdf-regulation.pdf", "scan-pdf"),
    ("contract.docx", "docx"),
    ("rosstat-regions.xlsx", "xlsx"),
    ("regulation.html", "html"),
]

# Russian words KNOWN to be present in scan-pdf-regulation.pdf (first 8 pages of
# GOST R ISO 15489-1-2019). Used for OCR precision check on fixture #2.
# Words chosen to be unambiguous and high-frequency in the GOST text.
OCR_REFERENCE_WORDS = [
    "ГОСТ",
    "информация",
    "документация",
    "документами",
    "стандарт",
]


@dataclass
class RunResult:
    fixture: str
    kind: str
    file_size_bytes: int = 0
    page_or_row_count: str = "n/a"
    cold_seconds: float = 0.0
    warm_seconds: float = 0.0
    ram_peak_mb: float = 0.0
    markdown_quality: str = "n/a"
    ocr_precision_pct: str = "n/a"
    markdown_chars: int = 0
    error: str = ""
    warnings: list[str] = field(default_factory=list)


def _make_converter() -> DocumentConverter:
    """Construct DocumentConverter with PyPdfium backend + RapidOCR (Russian)."""
    pdf_opts = PdfPipelineOptions()
    pdf_opts.do_ocr = True  # auto-OCR on scanned PDFs
    pdf_opts.do_table_structure = True  # TableFormer
    pdf_opts.generate_picture_images = False  # save RAM, we don't need images

    # PP-OCRv5 east-slavic weights baked into image at /work/models/eslav/.
    # See Dockerfile (downloaded from monkt/paddleocr-onnx HF repo).
    eslav_dir = Path("/work/models/eslav")
    ocr_kwargs = {"force_full_page_ocr": False}
    if eslav_dir.exists() and (eslav_dir / "rec.onnx").exists():
        ocr_kwargs["det_model_path"] = str(eslav_dir / "det.onnx")
        ocr_kwargs["rec_model_path"] = str(eslav_dir / "rec.onnx")
        ocr_kwargs["rec_keys_path"] = str(eslav_dir / "dict.txt")
        print(f"[run] using PP-OCRv5 eslav weights from {eslav_dir}")
    else:
        print(f"[run] eslav weights not found in {eslav_dir}, falling back to default RapidOCR")

    pdf_opts.ocr_options = RapidOcrOptions(**ocr_kwargs)

    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(
                pipeline_options=pdf_opts,
                backend=PyPdfiumDocumentBackend,
            ),
        },
    )


def _convert_once(converter: DocumentConverter, path: Path) -> tuple[float, str]:
    """Run a single conversion, return (wall-clock seconds, markdown text)."""
    t0 = time.perf_counter()
    result = converter.convert(str(path))
    elapsed = time.perf_counter() - t0
    markdown = result.document.export_to_markdown()
    return elapsed, markdown


def _read_vmhwm_mb() -> float:
    """Read current process VmHWM (max RSS) from /proc/self/status, in MB.

    This includes C/C++ allocations from onnxruntime, torch, etc — unlike
    tracemalloc which only sees Python objects. Linux-only (smoke runs in
    docker container, so always Linux).
    """
    try:
        with open("/proc/self/status", "r", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("VmHWM:"):
                    # Format: "VmHWM:    123456 kB"
                    parts = line.split()
                    return float(parts[1]) / 1024.0
    except Exception:
        pass
    return 0.0


def _measure_fixture(converter: DocumentConverter, fixture_path: Path, kind: str) -> RunResult:
    res = RunResult(fixture=fixture_path.name, kind=kind)
    if not fixture_path.exists():
        res.error = "fixture file missing"
        return res

    res.file_size_bytes = fixture_path.stat().st_size

    # --- Cold run ---
    gc.collect()
    rss_before = _read_vmhwm_mb()
    tracemalloc.start()
    try:
        cold_s, markdown = _convert_once(converter, fixture_path)
    except Exception as exc:  # noqa: BLE001
        res.error = f"cold-run failed: {exc!r}"
        tracemalloc.stop()
        return res
    _, peak_bytes_cold = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    rss_after = _read_vmhwm_mb()
    res.cold_seconds = cold_s
    # Use VmHWM (real RSS incl. C++ libs) when available, fallback to tracemalloc.
    if rss_after > 0:
        res.ram_peak_mb = rss_after  # cumulative high-water mark
    else:
        res.ram_peak_mb = peak_bytes_cold / (1024 * 1024)
    res.markdown_chars = len(markdown)
    if rss_before > 0:
        res.warnings.append(
            f"rss before/after: {rss_before:.0f}MB → {rss_after:.0f}MB"
        )

    # Persist markdown
    md_path = RESULTS_DIR / f"{fixture_path.stem}.md"
    md_path.write_text(markdown, encoding="utf-8")

    # --- Warm runs (2 throw-away + 1 measured = 3rd) ---
    warm_times: list[float] = []
    for _ in range(3):
        try:
            t, _ = _convert_once(converter, fixture_path)
        except Exception as exc:  # noqa: BLE001
            res.warnings.append(f"warm-run failed: {exc!r}")
            break
        warm_times.append(t)
    if warm_times:
        res.warm_seconds = warm_times[-1]  # 3rd run = steady-state

    # --- Markdown quality (heuristic, 1-4 scale) ---
    # Heuristic:
    #   4 = >2000 chars + structured (## headings) + tables preserved
    #   3 = >1000 chars + some structure
    #   2 = >500 chars, mostly flat text
    #   1 = <500 chars or empty
    res.markdown_quality = _grade_markdown(markdown, kind)

    # --- OCR precision (only for scan-pdf) ---
    if kind == "scan-pdf":
        hits = sum(1 for w in OCR_REFERENCE_WORDS if w.lower() in markdown.lower())
        pct = (hits / len(OCR_REFERENCE_WORDS)) * 100.0
        res.ocr_precision_pct = f"{pct:.1f}"

    # --- Page/row count (best-effort) ---
    if kind in {"text-pdf", "scan-pdf"}:
        # Count "## Page" or use markdown heuristic; fall back to "n/a"
        page_count = markdown.count("\f") + 1
        res.page_or_row_count = f"{page_count} стр."
    elif kind == "xlsx":
        # Count rows in markdown table approximation
        rows = sum(1 for line in markdown.splitlines() if line.strip().startswith("|"))
        res.page_or_row_count = f"~{rows} строк (md)"
    elif kind == "docx":
        # Approximate via markdown paragraphs
        paras = sum(1 for line in markdown.splitlines() if line.strip())
        res.page_or_row_count = f"~{paras} параграфов"
    elif kind == "html":
        res.page_or_row_count = "1 стр."

    return res


def _grade_markdown(markdown: str, kind: str) -> str:
    n = len(markdown)
    has_headings = "##" in markdown or "# " in markdown
    has_tables = "|" in markdown and "---" in markdown
    if n < 200:
        return "1/4"
    if n < 1000:
        return "2/4"
    if has_headings and (kind != "xlsx" or has_tables):
        if has_tables or kind in {"text-pdf", "scan-pdf", "html"}:
            return "4/4" if n > 4000 else "3/4"
        return "3/4"
    return "2/4"


def _format_size(size_bytes: int) -> str:
    if size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    return f"{size_bytes / (1024 * 1024):.1f} MB"


def main() -> int:
    print("=" * 80)
    print("Docling smoke-test (Phase 0, document-ingest TZ)")
    print(f"Fixtures: {FIXTURES_DIR}")
    print(f"Results : {RESULTS_DIR}")
    print("=" * 80)

    converter = _make_converter()

    results: list[RunResult] = []
    for filename, kind in FIXTURES:
        print(f"\n--- Processing: {filename} ({kind}) ---")
        path = FIXTURES_DIR / filename
        res = _measure_fixture(converter, path, kind)
        results.append(res)
        if res.error:
            print(f"  ERROR: {res.error}")
        else:
            print(
                f"  cold={res.cold_seconds:.2f}s  warm={res.warm_seconds:.2f}s  "
                f"ram_peak={res.ram_peak_mb:.0f}MB  md_chars={res.markdown_chars}  "
                f"quality={res.markdown_quality}  ocr={res.ocr_precision_pct}"
            )

    # --- Summary table ---
    print("\n" + "=" * 80)
    print("SMOKE RESULTS TABLE")
    print("=" * 80)
    header = (
        f"| {'Fixture':28s} | {'Size':>8s} | {'Pages/Rows':>14s} | "
        f"{'Cold(s)':>8s} | {'Warm(s)':>8s} | {'RAM(MB)':>8s} | "
        f"{'Quality':>8s} | {'OCR%':>6s} |"
    )
    sep = "|" + "-" * (len(header) - 2) + "|"
    print(header)
    print(sep)
    for r in results:
        print(
            f"| {r.fixture:28s} | {_format_size(r.file_size_bytes):>8s} | "
            f"{r.page_or_row_count:>14s} | {r.cold_seconds:>8.2f} | "
            f"{r.warm_seconds:>8.2f} | {r.ram_peak_mb:>8.0f} | "
            f"{r.markdown_quality:>8s} | {r.ocr_precision_pct:>6s} |"
        )

    # --- JSON dump for downstream processing ---
    json_path = RESULTS_DIR / "smoke-results.json"
    json_path.write_text(
        json.dumps(
            [
                {
                    "fixture": r.fixture,
                    "kind": r.kind,
                    "file_size_bytes": r.file_size_bytes,
                    "page_or_row_count": r.page_or_row_count,
                    "cold_seconds": r.cold_seconds,
                    "warm_seconds": r.warm_seconds,
                    "ram_peak_mb": r.ram_peak_mb,
                    "markdown_quality": r.markdown_quality,
                    "ocr_precision_pct": r.ocr_precision_pct,
                    "markdown_chars": r.markdown_chars,
                    "error": r.error,
                    "warnings": r.warnings,
                }
                for r in results
            ],
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nJSON saved: {json_path}")
    print("Markdown outputs saved to /work/results/*.md")

    # Exit code 0 even on partial errors — smoke-test, not pass/fail CI.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
