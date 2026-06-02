---
type: execution-plan
status: proposed
date: 2026-06-02
owner: tozixwot@gmail.com
relates_to:
  - plans/tz/2026-05-31-document-ingest-universal.md
  - plans/analysis/2026-05-31-document-conversion-stack.md
  - second-brain/02_architecture/document-conversion-service.md
  - second-brain/01_projects/document-ingest.md
---

# Execution-plan: универсальный document-ingest (разбивка ТЗ на PR)

> Это **план реализации**, производный от согласованного ТЗ
> [2026-05-31-document-ingest-universal.md](tz/2026-05-31-document-ingest-universal.md).
> ТЗ описывает «что и почему», этот файл — «в каком порядке, какими PR, какими файлами,
> что едет в прод». Развилок в ТЗ нет; этот план их не вводит, только секвенирует работу.

## 0. Текущее фактическое состояние (аудит 2026-06-02)

Production-код: **0 из 11 фаз**. Закрыта только **Фаза 0** (research + smoke-test).

Что есть в репо:
- `infra/document-conversion/smoke/` — smoke-CLI (Dockerfile + run.py + compose). **Не sidecar, не REST** — только инструмент замеров. Стек подтверждён: Docling 2.96 + PyPdfium2 backend + RapidOCR (PP-OCRv5 eslav-веса). OCR русского 100%, markdown 4/4.
- `backend/src/modules/ingest/parsers/document-parser.service.ts` — парсер только `pdf` (pdf-parse) / `docx` (mammoth) / `markdown` (marked) / `text`. Всё прочее → `other` → `BadRequestException`.
- `backend/src/modules/documents/documents.service.ts` — `upload()` + `detectKind()` (наивный MIME+расширение, без magic-bytes), всё буферами в RAM.
- `backend/src/modules/ingest/adapters/document/document.adapter.ts` — BullMQ-consumer `core.document-uploaded`, использует `external`-Source (`name='Документы'`).
- `schema.prisma`: `enum DocumentKind { pdf docx markdown text other }`; `enum SourceType` без `tabular`; `model Document` без `contentHash`.
- `second-brain/02_architecture/document-conversion-service.md` — статус research_complete, детальные находки Фазы 0.

Ключевые находки Фазы 0, влияющие на план:
1. **Persistent worker обязателен** — DocumentConverter держим singleton в app-state FastAPI (cold 92с → warm 19с). Pre-warm dummy-convert на старте контейнера.
2. **HF-модели в named volume** `docling-models` (иначе образ 5.6 GB вместо ≤3 GB).
3. **PP-OCRv5 eslav-веса критичны** (без них OCR русского = 0%).
4. **OCR confidence < порога = warning**, не отказ (Д8).
5. **DCS — отдельный `infra/document-conversion/docker-compose.yml`**, НЕ корневой (ide_selection владельца).

## 1. Принципы секвенирования

- **Один PR = одна фаза ТЗ** (требование чек-листа ТЗ). Каждый PR проходит `bun run typecheck` + `lint` + `test:unit` + relevant `test:integration`.
- **Backend всегда behind фича-флаг** — `DOCUMENT_CONVERSION_ENABLED=false` по умолчанию на Фазе 1, старый pdf-parse путь остаётся fallback. Переключение через ENV, не админка.
- **Prisma — только `bun run prisma:push`**, никогда migrate. После правок моделей — `prisma:generate`.
- **Каждый prod-эффект** (ENV/модель/очередь/скрипт) → запись в `docs/operations/prod-deploy-log.md` + регистрация seed/patch/backfill в `backend/scripts/apply-prod-deploy.ts` STEPS.
- **Рефлексия** после каждого push в `second-brain/05_история/2026-MM-DD-document-ingest-phase-N.md`.

## 2. Граф зависимостей фаз

```
Фаза 1 (DCS sidecar) ──┬─> Фаза 2 (enum+magic-bytes) ──┬─> Фаза 3 (tabular Excel/CSV)
                       │                                ├─> Фаза 4 (OCR scan/image)
                       │                                ├─> Фаза 5 (PPTX/HTML/EPUB/RTF/DOC/ODT)
                       │                                ├─> Фаза 6 (eml/msg рекурсия)
                       │                                └─> Фаза 7 (ZIP рекурсия)
                       └─> (Фаза 10 web-scraper — независима от DCS, свой sidecar)

Фаза 8 (дедуп/retry/stream) — cross-cutting, после Фазы 2.
Фаза 9 (SSE/локализация/админ-дашборд) — UX-слой, после Фаз 3-4.
```

Критический путь ценности (из §«Бизнес-приоритет» ТЗ): **1 → 2 → 3 → 10 → 4 → 8 → 5/6/7/9**.

---

## PR-1 — Фаза 1: DCS-микросервис (внешний API в отдельном контейнере)

**Цель:** поднять Python/FastAPI sidecar `document-conversion` и подключить к Z за фича-флагом.

### Sidecar (`infra/document-conversion/`)
- [ ] `Dockerfile` (prod): из smoke-Dockerfile, но HF-кэш в named volume `docling-models:/root/.cache/huggingface`, torch CPU-index, eslav-веса в образ (~92 MB). Target ≤3 GB.
- [ ] `app.py` (FastAPI):
  - singleton `DocumentConverter` в app-state (lifespan startup), pre-warm dummy 1-стр PDF.
  - `POST /convert` (multipart `file`, query `mode=auto|text|tabular|ocr`, `language=ru|en|auto`) → `{kind, markdown, plainText, tables[], metadata, warnings[]}`. Контракт §1.2 ТЗ.
  - `POST /ocr`, `GET /health`.
  - роутинг по magic-bytes MIME: pdf/office → docling; csv/xlsx/ods → docling tabular-extract; rtf/odt/eml/msg/legacy → tika; image/* → ocr-service; zip → unzip+recursive.
  - `tables[]` — **отдельное поле**, не часть markdown (нужно для Фазы 3).
  - русские user-сообщения на 4xx/5xx, technical detail в логах; `X-Request-Id` в логах.
- [ ] `requirements.txt`/`pyproject.toml`, `README.md` (контракт).
- [ ] `docker-compose.yml` (**отдельный**, не корневой): сервисы `docling-cpu` (4 GB), `tika-server` (`apache/tika:3.3.0.0-full`, 2 GB), `ocr-service` (1 GB), `router` (FastAPI, ~100 MB). Внутренний порт 8000, внешний — через ENV. concurrency=1 на контейнер.

### Backend
- [ ] `backend/src/modules/ingest/parsers/document-conversion.client.ts` — HTTP-клиент через `fetch`, таймаут, retry transient, обработка 4xx/5xx.
- [ ] ENV в `env.schema.ts` (раздел DocumentIngest): `DOCUMENT_CONVERSION_URL`, `DOCUMENT_CONVERSION_TIMEOUT_MS=120000`, `DOCUMENT_CONVERSION_ENABLED=false`.
- [ ] `DocumentParserService.parse()` — ветка: если `cfg.documentConversion.enabled` → DCS; иначе старый путь (pdf-parse/mammoth/marked) **остаётся fallback**.
- [ ] Метрики: `document_conversion_requests_total{kind,status}`, `document_conversion_duration_seconds{kind}`, `document_conversion_ocr_applied_total`.
- [ ] Тесты: `document-conversion.client.spec.ts` (мок DCS) + `test/integration/document-conversion.e2e.spec.ts` (реальная Postgres, DCS мок/testcontainer).

**Prod-эффект:** Шаг 1 (новые ENV) + Шаг 12 (новый сервис, health-smoke). Sidecar деплоится отдельной командой `docker compose -f infra/document-conversion/docker-compose.yml up -d`.

**DoD:** sidecar поднят локально; `/convert` отрабатывает PDF/DOCX/XLSX/PPTX/PNG; backend-клиент с метриками и флагом; старый путь — fallback на `ENABLED=false`.

**Оценка:** L (самая большая фаза — два рантайма). ~1 PR, но внутри 2 под-домена (Python + TS).

---

## PR-2 — Фаза 2: расширение DocumentKind + magic-bytes + sync фронта

- [ ] `schema.prisma`: расширить `enum DocumentKind` (doc, rtf, odt, html, epub, xlsx, xls, ods, csv, pptx, ppt, odp, image, eml, msg, archive). `prisma:push` + `prisma:generate`.
- [ ] `detectKind()` в `documents.service.ts` → двухступенчатая: magic-bytes через `file-type` npm-пакет, fallback MIME+расширение.
- [ ] `frontend/src/lib/document-formats.ts` — единый источник `ACCEPT_STRING`, `MAX_SIZE_MB`, `FORMAT_LABELS`. Импорт в `DocumentsListClient.tsx` (accept + текст ошибки).
- [ ] Telegram-бот: проверить `bot.processor` whitelist, расширить под xlsx/pptx/eml (`BOT_DOCUMENT_ENABLED`).
- [ ] unit-тесты на `detectKind` для каждого нового расширения.

**Prod-эффект:** Шаг 4 (enum DocumentKind — изменение enum). `file-type` — новая npm-зависимость.

**DoD:** enum расширен и применён; magic-bytes работает; фронт accept из общего файла; бот принимает новые форматы.

**Оценка:** S.

---

## PR-3 — Фаза 3: tabular-ingest (Excel/CSV/ODS как структурированный источник) ⭐ главная боль

- [ ] `schema.prisma`: `enum SourceType += tabular`; модели `Dataset` + `DatasetRow` (см. §3.1 ТЗ); `Entity.type += 'dataset'`. `prisma:push` + `prisma:generate`.
- [ ] pgvector/индексы — не требуется (нет embedding на DatasetRow); `@@index([datasetId, rowIndex])` в schema.
- [ ] `backend/src/modules/ingest/adapters/tabular/tabular.adapter.ts` — подписан на `core.tabular-uploaded`; из `tables[]` DCS создаёт `Dataset` (1/лист) + `DatasetRow` + `RawEvent{sourceType:'tabular', payload:{cells,sheetName,rowIndex}}`, публикует в `core.raw-events`.
- [ ] Новая очередь `core.tabular-uploaded` в `core-queue/queues.ts` (`CORE_QUEUE_NAMES`).
- [ ] `block-ingest.worker` — ветка `RawEvent.payload.kind==='tabular_row'`: без LLM-нарезки, 1 IdeaBlock `signalType='dataset_row'`, текст «header: value; …», метаданные в `IdeaBlock.metadata`.
- [ ] Schema-inference: 1 LLM-вызов на Dataset (cache-friendly: стабильный SYSTEM, headers+5 sample-row в USER) → авто-создание Entity (Person/Org/Customer). Промпт через registry (skill z-ai-agent-rules).
- [ ] Лимиты: ENV `TABULAR_MAX_ROWS=50000`; `priority` для tabular в очереди.
- [ ] Integration-тест: CRM-выгрузка 100 строк → 1 Dataset + 100 DatasetRow + 100 IdeaBlock + Entity по schema.

**Prod-эффект:** Шаг 4 (модели Dataset/DatasetRow, enum SourceType/Entity.type) + Шаг 12 (очередь `core.tabular-uploaded`) + Шаг 1 (ENV TABULAR_MAX_ROWS) + новый prompt-seed/patch в STEPS.

**DoD:** см. §3 ТЗ.

**Оценка:** L.

---

## PR-4 — Фаза 10: website-ingest (парсинг сайта компании при регистрации) ⭐ wow-эффект

> Независим от DCS — отдельный sidecar. По приоритету ТЗ идёт сразу после Фазы 3.

### Sidecar (`infra/web-scraper/`)
- [ ] `Dockerfile`: Python 3.12 + Crawl4AI + extruct + trafilatura + Playwright Chromium (~1.2 GB, 4 GB RAM).
- [ ] `app.py`: `POST /scrape-company` (контракт §10.2 ТЗ). Пайплайн §10.3: robots.txt+sitemap → extruct → heuristic-маршрут (RU/EN словарь) → fit_markdown → 1 LLM-вызов DeepSeek V4 Flash через `proxy.agent-lia.ru` (cache-friendly) → Pydantic-валидация.
- [ ] User-Agent `Z-Company-Ingest`, robots.txt respect, timeout job 5 мин, only same-domain.
- [ ] **Отдельный** `infra/web-scraper/docker-compose.yml`.

### Backend
- [ ] `schema.prisma`: `model WebsiteIngestJob` + `enum WebsiteIngestStatus` (§10.4.2). `prisma:push`.
- [ ] Очередь `core.website-ingest` + `WebsiteIngestWorker` в `workers/main.ts` (§10.4.3): scrape → extract → save, создаёт Entity (Org/Service/Person) + IdeaBlock + EntityLink + lazy Source{type:'web'}.
- [ ] ENV: `WEBSITE_INGEST_URL`, rate-limit (1/час, 10/день на Org; 5 concurrent на sidecar).
- [ ] REST: `POST /api/v1/orgs/:id/website-ingest` → `{jobId}`; SSE `GET /api/v1/website-ingest/:jobId/status/stream`. RBAC owner/admin/super_admin.
- [ ] UI: поле «Сайт компании» в onboarding + кнопка «Перепарсить» в `/admin/organizations/[id]`.
- [ ] Идемпотентность `(tenantId,url)` свежее 7 дней; метрики §10.6.
- [ ] Integration-тест на mocked sidecar: `POST → BullMQ → Worker → Entity created`.

**Prod-эффект:** Шаг 1 (ENV WEBSITE_INGEST_URL) + Шаг 4 (WebsiteIngestJob) + Шаг 12 (очередь). Sidecar — отдельный compose.

**Оценка:** L.

---

## PR-5 — Фаза 4: OCR для скан-PDF и изображений

- [ ] DCS: маркер «нужен OCR» (page <100 символов + есть изображения) → OCR, `metadata.ocrApplied=true`.
- [ ] `DocumentKind='image'` (PNG/JPG/TIFF) → DCS вызывает OCR безусловно. ENV `IMAGE_MAX_SIZE_MB=20`, `IMAGE_OCR_LANGUAGES=ru,en`.
- [ ] Switchable OCR-провайдер в DCS `config.yaml`: `ocr_provider: rapidocr|tesseract` (перезапуск контейнера, без передеплоя Z). Никаких облачных.
- [ ] Метрики `document_ocr_provider_used_total{provider}`, `document_ocr_duration_seconds{provider}`, `document_ocr_failed_total{provider,reason}`.
- [ ] Integration-тест: скан-PDF 3 стр → IdeaBlock'и.

**Prod-эффект:** Шаг 1 (ENV IMAGE_*).

**Оценка:** M.

---

## PR-6 — Фаза 8: дедупликация SHA-256 + magic-bytes stream + retry + stream-upload

- [ ] `schema.prisma`: `Document.contentHash String?` + `@@unique([tenantId, contentHash])`. `prisma:push` + backfill-скрипт хешей для существующих документов (в STEPS).
- [ ] `DocumentsService.upload`: хеш до записи; дубль в Org → `{id, status:'duplicate'}` HTTP 200. Фронт: «уже загружен <дата>».
- [ ] `file-type` stream-режим (снимает «весь файл в RAM»); stream-upload >50MB напрямую в S3.
- [ ] Кнопка «Распарсить заново» в UI деталки (`status='failed'`); `POST /api/v1/documents/:id/retry` (`failed→uploaded`, ре-enqueue), RBAC owner/admin; метрика `document_manual_retry_total{previousStatus}`.
- [ ] (опц.) `DOCUMENT_VIEW_AUDIT_ENABLED=false` аудит просмотров.

**Prod-эффект:** Шаг 4 (contentHash) + Шаг 8 (backfill-document-content-hash.ts в STEPS) + Шаг 1 (ENV).

**Оценка:** M.

---

## PR-7 — Фаза 5: PPTX/HTML/EPUB/RTF/DOC/ODT (широкое покрытие)

- [ ] Фронт accept + переводы; unit-тесты `detectKind` на каждое расширение; фикстуры по 1 файлу/формат в `backend/test/fixtures/documents/`.
- [ ] PPTX: текст из shape'ов + опц. OCR встроенных картинок (флаг `pptx_ocr_embedded`).

**Оценка:** S (DCS уже умеет; работа — accept + тесты + фикстуры).

---

## PR-8 — Фаза 6: e-mail .eml/.msg с рекурсией по вложениям

- [ ] DCS: парс .eml/.msg → заголовки + тело + вложения (binary+filename+mime).
- [ ] Backend: 1 `Document{kind:'eml'}` + N `Document` на вложения (`metadata.parentEmailId`); `EntityLink{relationType:'attached_to'}`.
- [ ] Лимиты `EMAIL_MAX_ATTACHMENTS=20`, рекурсия только 1 уровень.

**Оценка:** M.

---

## PR-9 — Фаза 7: ZIP-архивы с рекурсивным разбором

- [ ] `archive.adapter`: распаковка в tmp воркера → per-file standard ingest → `EntityLink{relationType:'extracted_from'}`; удаление tmp.
- [ ] Лимиты `ARCHIVE_MAX_TOTAL_SIZE_MB=200`, `ARCHIVE_MAX_FILES=200`, `ARCHIVE_MAX_DEPTH=2`. RAR/7z — отложить.

**Оценка:** M.

---

## PR-10 — Фаза 9: UX (SSE-статус, локализация ошибок, превью, админ-дашборд)

- [ ] SSE `GET /api/v1/documents/:id/status/stream` + публикация `document.status.changed` в Redis pub/sub из адаптеров (parsing→parsed→blocks_extracted с прогрессом).
- [ ] `frontend/src/lib/document-errors.ts` — коды→русский текст; backend пишет код в `parseError`.
- [ ] Превью parsedText (collapsible, первые 2000 символов).
- [ ] `/admin/documents`: график загрузок по типам, топ-10 ошибок, конверсия uploaded→blocks_extracted.

**Оценка:** M.

---

## 3. Сводная таблица PR

| PR | Фаза ТЗ | Что | Оценка | Prod-шаги |
|---|---|---|---|---|
| PR-1 | 1 | DCS sidecar + backend-клиент (флаг) | L | 1, 12 |
| PR-2 | 2 | DocumentKind enum + magic-bytes + sync фронта | S | 4 |
| PR-3 | 3 | tabular Excel/CSV (Dataset/DatasetRow) ⭐ | L | 1, 4, 12 |
| PR-4 | 10 | website-ingest sidecar + воркер ⭐ | L | 1, 4, 12 |
| PR-5 | 4 | OCR scan-PDF/image | M | 1 |
| PR-6 | 8 | дедуп/retry/stream | M | 1, 4, 8 |
| PR-7 | 5 | PPTX/HTML/EPUB/RTF/DOC/ODT | S | — |
| PR-8 | 6 | eml/msg рекурсия | M | — |
| PR-9 | 7 | ZIP рекурсия | M | — |
| PR-10 | 9 | UX (SSE/локализация/дашборд) | M | — |

Фаза 0 — закрыта. Общий объём: 3×L + 4×M + 2×S + 1×L = существенно больше одной сессии.

## 4. Рекомендованный порядок реализации

1. **PR-1 (Фаза 1)** — фундамент, без него мёртвое. ← начинать здесь.
2. **PR-2 (Фаза 2)** — маленькая, снимает баги форматов сегодня.
3. **PR-3 (Фаза 3)** — главная боль (Excel/CSV).
4. **PR-4 (Фаза 10)** — wow для нового клиента (можно параллелить — независимый sidecar).
5. **PR-5 (Фаза 4)** → **PR-6 (Фаза 8)** → **PR-7/8/9/10**.

## 5. Открытые вопросы владельца (из ТЗ §«Открытые вопросы») — нужны до старта PR-1/PR-4

1. **Хостинг sidecar'ов** — тот же сервер (Docker Compose) или отдельный VPS? Предложение ТЗ: на старте тот же сервер.
2. **Глубина website-ingest** — `maxPages=10` на MVP? (предложение ТЗ — да).
3. **Цикл повторного парсинга сайта** — только по кнопке + автотриггер раз в 90 дней?
(Вопрос про OCR-провайдер закрыт: только локальный RapidOCR+Tesseract.)

## 6. Итог

План секвенирует 11 фаз в 10 PR (Фаза 0 готова). Критический путь ценности: PR-1 → PR-2 → PR-3 → PR-4. Каждый PR самодостаточен, проходит typecheck/lint/test, обновляет prod-deploy-log и second-brain, имеет рефлексию. Развилок относительно ТЗ нет.
