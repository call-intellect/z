# Smoke-test image for Phase 0 of document-ingest TZ.
# CPU-only stack: Docling + RapidOCR + pypdfium2 backend (avoids issue #2077 memory leak).
# Image size target: <= 3 GB (gate §0.3).

FROM python:3.12-slim

# System deps:
#   libgl1-mesa-glx + libglib2.0-0 — нужны opencv/onnxruntime (RapidOCR)
#   ghostscript + poppler-utils — fallback rasterization / page count
#   ca-certificates — для HuggingFace model downloads
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 \
    ghostscript poppler-utils \
    ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# CPU-only torch (avoid full CUDA wheels ≈ 2.5 GB).
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
    torch torchvision

# Docling + RapidOCR + pypdfium2.
# Versions pinned to those declared in TZ Д7-Д8 (May 2026).
RUN pip install --no-cache-dir \
    docling==2.96.0 \
    rapidocr-onnxruntime \
    pypdfium2 \
    onnxruntime \
    pandas openpyxl

WORKDIR /work
COPY run.py /work/run.py

# Pre-download Docling models at build-time to avoid cold-start network hit during smoke.
# If offline build env — comment this RUN out and accept first-doc cold-start cost.
RUN python -c "from docling.utils.model_downloader import download_models; download_models()" || \
    echo "WARN: docling model pre-download skipped (offline build?); will fetch on first run"

# Pre-warm RapidOCR default models (Chinese det+rec+cls) — needed for fallback paths.
# RapidOCR downloads them lazily on first use from modelscope.cn.
RUN python -c "import numpy as np; from rapidocr_onnxruntime import RapidOCR; engine = RapidOCR(); engine(np.zeros((32,32,3), dtype='uint8'))" || \
    echo "WARN: rapidocr default model pre-download failed; first run will need network"

# Pre-download PP-OCRv5 east-slavic models (Russian/Ukrainian/Belarusian/Bulgarian)
# from monkt/paddleocr-onnx HF repo. These are the ONNX-converted weights described
# in TZ Д8 (RapidOCR + PP-OCRv5 eslav). Stored under /work/models/eslav for run.py.
RUN mkdir -p /work/models/eslav && \
    curl -fSL -o /work/models/eslav/det.onnx \
        "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/detection/v5/det.onnx" && \
    curl -fSL -o /work/models/eslav/rec.onnx \
        "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/eslav/rec.onnx" && \
    curl -fSL -o /work/models/eslav/dict.txt \
        "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/eslav/dict.txt" && \
    ls -lh /work/models/eslav/

CMD ["python", "/work/run.py"]
