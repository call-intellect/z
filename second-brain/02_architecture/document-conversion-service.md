---
type: architecture
name: document-conversion-service
title: Document Conversion Service (DCS) — research + smoke (Фаза 0)
status_overall: research_complete
last_audited: 2026-05-31
related_plans:
  - plans/tz/2026-05-31-document-ingest-universal.md
  - plans/analysis/2026-05-31-document-conversion-stack.md
related_projects: []
---

# Document Conversion Service — research + smoke status

## Что это будет

Отдельный Python-микросервис в `infra/document-conversion/` (sidecar в docker-compose, не в основном backend-контейнере). Принимает файлы любого формата через REST `POST /convert` и отдаёт markdown + структурированные таблицы + метаданные. Используется backend Z-knowledge-core для ingest-pipeline.

Полное ТЗ: [plans/tz/2026-05-31-document-ingest-universal.md](../../plans/tz/2026-05-31-document-ingest-universal.md).
Research стека: [plans/analysis/2026-05-31-document-conversion-stack.md](../../plans/analysis/2026-05-31-document-conversion-stack.md).

## Текущий статус (Фаза 0 закрыта 2026-05-31)

### Что уже есть в репо

- `backend/test/fixtures/documents/` — README + .gitignore + `download-fixtures.sh` для 5 фикстур (text-PDF, скан-PDF, DOCX, XLSX, HTML). Сами бинарники в локальном .gitignore — не в git.
- `infra/document-conversion/smoke/` — минимальный smoke-CLI: Dockerfile + docker-compose.yml + run.py. Не sidecar, не REST — только инструмент для замеров.

### Стек, подтверждённый smoke-тестом

| Слой | Инструмент | Лицензия |
|---|---|---|
| PDF/DOCX/PPTX/XLSX/HTML primary | **Docling 2.96** с `PdfPipelineOptions(backend=PyPdfiumDocumentBackend)` | MIT |
| OCR русский | **RapidOCR + PP-OCRv5 eslav-веса** (`monkt/paddleocr-onnx` HF репо) | Apache 2.0 |
| Legacy / RTF / ODT / EML | Apache Tika 3 (не задействован в smoke — будет в Фазе 1) | Apache 2.0 |

### Результаты smoke (5 фикстур, Windows 10, Docker Desktop 4 GB)

| Гейт §0.3 ТЗ | Порог | Факт | Статус |
|---|---|---|---|
| RAM на 50-стр PDF | ≤ 4 GB | 3.71 GiB | ✅ |
| Cold-time 20-стр PDF | ≤ 30 сек | 92 сек (cold с загрузкой HF-моделей) / 19 сек (warm) | ⚠️ архитектурно (persistent worker в Фазе 1 → warm-steady-state) |
| Markdown quality #1 | ≥ 3/4 | 4/4 | ✅ |
| OCR-precision #2 | ≥ 90% | **100%** | ✅ |
| Образ docling-cpu | ≤ 3 GB | 5.62 GB | ⚠️ решается volume для HF-кэша (Фаза 1) |

### Решение

✅ **Стек подтверждён. План B (OpenDataLoader PDF) НЕ нужен.** Фаза 1 разблокирована для отдельной сессии.

### Критическая находка

**PP-OCRv5 eslav-веса обязательны.** С дефолтным китайским ch_PP-OCRv4 — OCR precision на русском 0%. С eslav — 100%. В Dockerfile Фазы 1 явно прописать pre-download eslav-весов; в run-конфиге RapidOCR указать `rec_model_path` на eslav-веса.

## Чего НЕТ (отложено в Фазу 1 и далее)

- **Полноценный sidecar** (FastAPI + REST `POST /convert`, `POST /ocr`, `GET /health`) — Фаза 1.
- **Backend Z-клиент** `DocumentConversionClient` в `backend/src/modules/ingest/parsers/` с метриками — Фаза 1.
- **Apache Tika в стеке** — для RTF/ODT/EML/MSG/legacy DOC — Фаза 1.
- **OCRmyPDF для sandwich PDF/A** — Фаза 4.
- **Web-scraper sidecar** (Crawl4AI для парсинга сайта компании при регистрации) — Фаза 10.
- **Все остальные фазы 2-9 и 11**: расширение DocumentKind, magic-bytes, tabular-pipeline (Excel-import), retry, дедупликация, UX-статус через SSE.

## Что важно для разработчика следующей фазы

1. **Не запускай DCS-стек в основном `docker-compose.yml`** — он живёт в `infra/document-conversion/docker-compose.yml` отдельно. На 4 GB сервере можно отключить Tika и оставить Docling+RapidOCR.
2. **OCR confidence < порога** = warning в `parseError`, не отказ (как в Д8 ТЗ).
3. **Веса HF-моделей** — выноси в named volume `docling-models`, иначе образ распухает до 5+ GB.
4. **Тарифа в Z один** — никаких разделений «бесплатно/платно» в лимитах document-ingest. Все лимиты `DOCUMENT_*` через `env.schema.ts`/`TypedConfigService` (Д5 ТЗ).
5. **Только локальный OCR** — никаких Yandex Vision / SberCloud / AWS Textract. Единственный внешний платный API в Z — LLM через `proxy.agent-lia.ru` (Д6 + Д8 ТЗ).
