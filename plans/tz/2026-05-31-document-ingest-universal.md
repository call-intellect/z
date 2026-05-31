---
type: tz
status: ready-to-implement
date: 2026-05-31
owner: sergrv80@gmail.com
relates_to:
  - second-brain/01_projects/document-ingest.md
  - second-brain/02_architecture/knowledge-core.md
  - second-brain/02_architecture/module-map.md
  - plans/tz/2026-05-21-phase-0b-document-ingest.md
  - plans/tz/2026-05-31-smart-tables.md
  - plans/analysis/2026-05-31-document-conversion-stack.md
phases:
  - 0
  - 1
  - 2
  - 3
  - 4
  - 5
  - 6
  - 7
  - 8
  - 9
  - 10
---

> **Статус:** ТЗ согласовано владельцем 2026-05-31. Все принципиальные развилки закрыты — разработчик может стартовать **Фазу 0** (smoke-test финального стека) без дополнительных уточнений. Если по ходу реализации появляется новая развилка — сначала задать вопрос владельцу через issue, не принимать решение «по-своему».
>
> **Глобальное ограничение:** единственный платный внешний API в Z — LLM (DeepSeek через `proxy.agent-lia.ru`). Никаких облачных OCR (Yandex Vision и т.п.), никаких облачных ASR. Всё OCR — локально (RapidOCR + Tesseract). Тариф в Z один — лимиты единые технические guard'ы, не продажная воронка.

# Универсальный document-ingest (Document Conversion Service + tabular pipeline)

## Зачем

Сейчас document-ingest в Z поддерживает только PDF/DOCX/MD/TXT (см. `DocumentKind` enum и `DocumentParserService`). Это закрывает примерно 60% реальных корпоративных документов; остальное ломается с `status=failed` или вообще не принимается фронтом. Цель Z — «память компании», поэтому ingest должен принимать **всё**, что компания может загрузить: офисные форматы, таблицы, презентации, сканированные PDF, изображения с текстом, e-mail, выгрузки из CRM, web-страницы.

Главные дыры, найденные в текущем состоянии:

1. **Excel/CSV отсутствуют** — а это самый частый формат корпоративных выгрузок (CRM, бухгалтерия, аналитика). При попытке загрузить — фронт отдаст файл, бэк определит `kind=other` и упадёт.
2. **Сканированные PDF выглядят как «успешно распарсенные»** — pdf-parse возвращает пустую строку, `Document.status='parsed'`, parsedText пустой, граф знаний пополнения не получает. Пользователь думает, что всё работает.
3. **PowerPoint, RTF, .doc, HTML, EPUB — не поддерживаются.**
4. **Frontend accept-список рассинхронизирован с backend** — `.doc` и `.rtf` фронт принимает, бэк роняет в `failed`.
5. **Нет дедупликации** — два раза тот же файл создаст два Document и два прохода по pipeline (двойная стоимость LLM).
6. **MIME-определение по расширению ненадёжно** — пользователи присылают `.pdf` с реальным content-type `image/jpeg` (фотография с телефона).
7. **Таблицы в PDF/DOCX парсятся в линейный текст** — структура «ячейка-строка» теряется, LLM получает кашу.
8. **Нет stream-обработки** — 50MB PDF целиком грузится в Buffer (RAM воркера), масштабируется плохо.
9. **Excel/CSV даже если их разобрать как текст — теряется главное:** связь «строка таблицы → атрибуты Entity». В Z это критично, потому что выгрузка из CRM на 5000 клиентов должна попасть в граф как 5000 связанных Person/Org, а не одна простыня текста.
10. **Нет ручного retry при transient-ошибках** — если S3 моргнул, статус навсегда `failed`, пользователь не имеет кнопки «попробовать ещё раз».

## Принятые решения владельца (2026-05-31)

| # | Решение | Контекст |
|---|---|---|
| Д1 | Excel/CSV/ODS заводим как **структурированный источник**, не как простыню текста. Каждая строка — отдельный RawEvent, колонки — атрибуты будущей Entity. Нужен новый `SourceType='tabular'` или расширение существующего, и `tabular-ingest` pipeline. | Ответ на вопрос «Excel mode» |
| Д2 | Для PDF/изображений/презентаций — **отдельный микросервис document-conversion** на Python в docker-compose. Sidecar, потому что лучшие open-source инструменты — Python (Docling, Tika, RapidOCR). Контракт REST. | Архитектурное |
| Д3 | Целевое покрытие форматов — **«всё, что компания может загрузить»**: PDF (текст + скан), DOCX, RTF, DOC, ODT, MD, TXT, HTML, EPUB, XLSX, XLS, ODS, CSV, PPTX, PPT, ODP, PNG/JPG/TIFF (через OCR), EML/MSG, ZIP (рекурсивно). | Ответ «все нужно» |
| Д4 | LLM-промпты — **cache-friendly** (стабильный SYSTEM, переменные данные в user). Соблюдается в `second-brain/02_architecture/llm-cache-status.md`. | feedback_llm_prompts_cache_friendly |
| Д5 | Все настройки — через `TypedConfigService`/`env.schema.ts`, никаких `process.env.*`. | Стандарт Z |
| Д6 | OCR-провайдер — только локальный (RapidOCR primary, Tesseract secondary), switchable через ENV между двумя. Никаких облачных API. | feedback_switchable_endpoints + 2026-05-31 решение «единственный внешний API — LLM» |
| **Д7** | **Финальный стек document-parser (после research-фазы 2026-05-31, 6 параллельных агентов):** **Docling (MIT, IBM)** для PDF/DOCX/PPTX/XLSX/HTML — primary; **Apache Tika 3 (Apache 2.0)** для RTF/ODT/EML/MSG/legacy DOC/XLS/PPT/ZIP — fallback. Обязательно `PdfPipelineOptions(backend=PyPdfiumDocumentBackend)` — без него Docling течёт памятью до 20+ GB на длинных PDF (issue #2077). | Сводный research: [plans/analysis/2026-05-31-document-conversion-stack.md](../analysis/2026-05-31-document-conversion-stack.md) |
| **Д8** | **Финальный OCR-стек: только локальные.** **RapidOCR + PP-OCRv5 eslav-веса (Apache 2.0)** — primary, ~500-700 MB RAM, 0.5-2 сек/стр на CPU; **Tesseract 5 + OCRmyPDF** — secondary для PDF→PDF/A. **Никаких облачных OCR-провайдеров** (Yandex Vision, SberCloud и т.п.) — внешним платным API остаётся только LLM. Если локальный OCR вернул confidence < порога — фиксируем warning в `parseError`, кладём что есть, показываем пользователю предупреждение «качество распознавания низкое». | Research + решение владельца 2026-05-31 |
| **Д9** | **Финальный стек website-ingest (новая Фаза 10):** **Crawl4AI (Apache 2.0)** — каркас (Playwright + adaptive crawling + кастомный LLM-endpoint), **extruct (BSD)** — JSON-LD/Microdata/OG без LLM, **trafilatura (Apache 2.0)** — boilerplate-removal, **DeepSeek V4 Flash** через корпоративный proxy — structured extract. Целевая стоимость **≤$0.01 за регистрацию**. | Research + новый сценарий «URL компании при регистрации» |
| **Д10** | **Юридический блок-лист:** запрещено использовать в проде Z (in-process и в sidecar): **Marker** (GPL-3 + revenue cap $2M), **Surya** (modified OpenRAIL-M c cap $5M), **Chandra OCR 2** (modified OpenRAIL-M c cap $2M + "no-compete clause" — Datalab сама делает OCR-as-a-service), **PyMuPDF4LLM** (AGPL-3 токсична для SaaS), **Firecrawl OSS core** (AGPL-3), **MinerU** (16+ GB RAM, не лезет). Эти проекты остаются доступными только через their managed API (если когда-нибудь понадобится). | Research, lic-audit |
| Д11 | **Scrapling (BSD-3, недавний хайп) — не используется в Z сейчас.** Overkill для one-shot регистрации (Cloudflare-bypass и adaptive-selectors нам не нужны), solo-maintainer, нет v1.0, репутационный риск. Остаётся в backlog на будущий competitor-monitoring pipeline. | Deep-dive research |

## Целевой стек: Document Conversion Service (DCS)

Финальная архитектура — **три Python-сервиса в одном `infra/document-conversion/docker-compose.yml`**, выбранные по итогам research (см. [plans/analysis/2026-05-31-document-conversion-stack.md](../analysis/2026-05-31-document-conversion-stack.md)):

| Сервис | Образ | RAM-limit | Что делает |
|---|---|---|---|
| `docling-cpu` | Кастомная сборка Python 3.12 + Docling + torch CPU-index + pypdfium2 | 4 GB | PDF (текст + скан + таблицы), DOCX, PPTX, XLSX, HTML. Возвращает markdown + структурированный `tables[]` для tabular-ingest. |
| `tika-server` | `apache/tika:3.3.0.0-full` (~1.2 GB) | 2 GB | RTF, ODT/ODS/ODP, EML/MSG, legacy DOC/XLS/PPT/MHTML/ZIP — то, что Docling не умеет. REST :9998. |
| `ocr-service` | Python + onnxruntime + RapidOCR + Tesseract 5 wrapper | 1 GB | Изображения (PNG/JPG/TIFF), OCR-fallback для скан-PDF от Docling. Только локальный — никаких облачных API. |

**Тонкий маршрутизатор** (Python FastAPI, тоже в этом docker-compose, ~100 MB) — единая точка входа:

```
POST /convert
  multipart: file
  query: ?mode=auto|text|tabular|ocr&language=ru|en|auto
returns:
  {
    kind: "pdf" | "docx" | "xlsx" | "rtf" | ...,
    markdown: string,
    plainText: string,
    tables: [{ sheetName?, headers: string[], rows: string[][], rangeA1: string }],
    metadata: { pageCount?, title?, author?, ocrApplied: boolean, language: string },
    warnings: string[]
  }
```

Маршрутизатор смотрит на MIME (после magic-bytes detection) и форвардит:
- `application/pdf` → docling (если scan-PDF и `markdown.length < N` → попутно ocr-service)
- `application/vnd.openxmlformats-officedocument.*` → docling
- `text/csv`, `application/vnd.ms-excel`, `application/vnd.oasis.opendocument.spreadsheet` → docling tabular-extract
- `application/rtf`, `application/msword`, `application/vnd.ms-excel` (legacy `.xls`) → tika
- `message/rfc822`, `application/vnd.ms-outlook` → tika (eml/msg parser)
- `image/*` → ocr-service напрямую
- `application/zip` → unzip в tmp → recursive call per-file

Z-backend остаётся «оркестратором»: знает про RBAC, tenantId, S3, BullMQ, IdeaBlock — но не про конкретные библиотеки парсинга. Если завтра выйдет лучший open-source — меняется только DCS, без правок в knowledge-core.

**Суммарный RAM-бюджет sidecar**: ~7 GB при пиковой нагрузке, concurrency=1 на каждом контейнере. На 4 GB сервере придётся отключить `tika-server` (и потерять RTF/EML/legacy office) — оставить docling+ocr.

**Лицензии стека: 100% Apache 2.0 / MIT / BSD / MPL-2.0.** Никакого AGPL/GPL/OpenRAIL-M. Подробнее — таблица в research-документе.

## Фаза 0. Smoke-test финального стека (1-2 дня, до старта Фазы 1)

Research-фаза уже выполнена параллельным запуском 6 агентов 2026-05-31, отчёт — [plans/analysis/2026-05-31-document-conversion-stack.md](../analysis/2026-05-31-document-conversion-stack.md). Финальный стек — **Docling + Apache Tika + RapidOCR + Tesseract** (всё локальное, без облачных API), см. решение Д7-Д8.

Здесь — только smoke-test на наших реальных образцах, чтобы подтвердить ожидаемое качество ДО написания продакшен-кода.

### 0.1. Подготовка фикстур

В `backend/test/fixtures/documents/` положить 5 реальных образцов (без чувствительных данных):
1. Текстовый PDF русского регламента 20-50 страниц.
2. Сканированный PDF русского регламента 5-10 страниц (без text-слоя).
3. DOCX с таблицей 2-3 страницы.
4. XLSX с 100-1000 строк (CRM-выгрузка или похожий по форме).
5. HTML регламент (сохранённая страница).

Удалить PII перед коммитом в git.

### 0.2. Smoke-test трёх компонентов

Из тонкого CLI-скрипта (`infra/document-conversion/smoke/run.py`) прогнать через Docling+OCR на каждом образце и зафиксировать:
- Wall-clock cold (первый прогон) и warm (3-й прогон).
- Пик RAM воркера (`docker stats` снэпшоты).
- Качество markdown по 4-балльной шкале (1=каша, 4=идеально). Главный фокус — таблицы PDF (TableFormer).
- OCR-precision на русском: 5 проверочных слов из эталона.

### 0.3. Гейты для перехода в Фазу 1

| Гейт | Порог | Что если не проходит |
|---|---|---|
| Пик RAM на 50-стр PDF | ≤ 4 GB | Включить `generate_picture_images=False`, ограничить `max_num_pages` |
| Время на 20-стр PDF (cold) | ≤ 30 сек | Перейти на `pypdfium2_dlparse_v2` или ограничить OCR-провайдер |
| Качество markdown на test #1 | ≥ 3/4 | Поднять до Docling-serve full pipeline |
| OCR-precision на test #2 | ≥ 90% | Переключиться на Tesseract как primary; если оба ниже — поднять issue владельцу и обсудить локальные альтернативы |
| Образ docling-cpu | ≤ 3 GB | Использовать torch CPU-only index (`--index-url https://download.pytorch.org/whl/cpu`) |

**Если все гейты пройдены — старт Фазы 1.** Если нет — точечная переналадка, не смена стека.

### 0.4. Если Docling провалит smoke-test (план B)

Запасной вариант: **OpenDataLoader PDF v2.0** (Apache 2.0, март 2026) — #1 на собственных RAG-бенчмарках 2026 (0.928 table accuracy). Только PDF, без DOCX/XLSX/PPTX → пришлось бы Office-форматы оставить на Tika. План B активируется только если Docling реально упадёт по гейтам.

**DoD фазы 0:**
- [ ] 5 фикстур в `backend/test/fixtures/documents/`, без PII.
- [ ] Smoke-test всех гейтов зафиксирован в `plans/analysis/2026-05-31-document-conversion-stack.md` дополнением «Smoke-test results».
- [ ] Все гейты пройдены, либо обоснован переход на план B / точечная переналадка.

---

## Фаза 1. Document Conversion Service (DCS) — микросервис

Цель: поднять отдельный сервис конвертации файлов и подключить его к Z как опциональный provider.

### 1.1. Скаффолд микросервиса

- Новая директория `infra/document-conversion/` с:
  - `Dockerfile` (Python 3.12 + выбранный стек из Фазы 0).
  - `app.py` — FastAPI, эндпоинты: `POST /convert`, `POST /ocr`, `GET /health`.
  - `requirements.txt` или `pyproject.toml`.
  - `README.md` с описанием контракта.
- Добавить сервис в **отдельный** `infra/document-conversion/docker-compose.yml`, по аналогии с `infra/livekit/`. **НЕ** мержить в корневой `docker-compose.yml` — это снимает требование «всё в одной ноде» и позволяет деплоить DCS на отдельный воркер.
- Внутренний порт `8000`, внешний — конфигурируемый через ENV.

### 1.2. Контракт REST

```
POST /convert
  Headers: X-Request-Id (для трейсинга в логах Z)
  multipart/form-data:
    file: <binary>
    mode: "auto" | "text" | "tabular" | "ocr" (опц., default "auto")
    language: "ru" | "en" | "auto" (для OCR)
  Response 200:
    {
      "kind": "pdf" | "docx" | "xlsx" | ...,
      "markdown": string,
      "plainText": string,
      "tables": Array<{ sheetName?, headers: string[], rows: Array<Array<string>>, rangeA1: string }>,
      "metadata": { pageCount?, title?, author?, ocrApplied: boolean, language: string },
      "warnings": string[]
    }
  Response 4xx/5xx: { code, message }  (русские сообщения для пользователя; technical detail в логах)
```

`tables` — **отдельное поле**, не часть markdown, чтобы tabular-ingest pipeline мог работать структурно (Фаза 3).

### 1.3. Подключение в backend

- Новый сервис `backend/src/modules/ingest/parsers/document-conversion.client.ts` — HTTP-клиент к DCS через `fetch`. Таймаут, retry для transient, обработка 4xx/5xx.
- ENV: `DOCUMENT_CONVERSION_URL`, `DOCUMENT_CONVERSION_TIMEOUT_MS=120000`, `DOCUMENT_CONVERSION_ENABLED=true` (фича-флаг для постепенного включения).
- В `DocumentParserService.parse(...)` — новая ветка: если `cfg.documentConversion.enabled` — идём в DCS; иначе fallback на старый локальный путь (pdf-parse/mammoth/marked). На фазе 1 переключение **только через ENV**, не админка.
- Метрики:
  - `document_conversion_requests_total{kind, status}`
  - `document_conversion_duration_seconds{kind}`
  - `document_conversion_ocr_applied_total`

### 1.4. Тесты

- `backend/src/modules/ingest/parsers/document-conversion.client.spec.ts` — unit, мок DCS.
- `backend/test/integration/document-conversion.e2e.spec.ts` — integration, поднимает DCS-контейнер testcontainers'ом (если стек позволяет) или мокается. **Никаких моков БД** — integration-тесты на реальной Postgres.

**DoD фазы 1:**
- [ ] DCS поднят локально через `docker compose -f infra/document-conversion/docker-compose.yml up`.
- [ ] `POST /convert` работает на PDF, DOCX, XLSX, PPTX, PNG (smoke).
- [ ] В Z-backend новый клиент с метриками и фича-флагом.
- [ ] Старый pdf-parse/mammoth путь остаётся как fallback на `DOCUMENT_CONVERSION_ENABLED=false`.
- [ ] Запись в `docs/operations/prod-deploy-log.md` Шаг 1 + Шаг 12 (новый сервис).

---

## Фаза 2. Расширение DocumentKind и сквозная синхронизация frontend↔backend

Цель: убрать рассинхрон форматов и принимать всё, что DCS умеет.

### 2.1. Расширить enum `DocumentKind`

В `backend/prisma/schema.prisma`:
```prisma
enum DocumentKind {
  pdf
  docx
  doc          // NEW
  rtf          // NEW
  odt          // NEW
  markdown
  text
  html         // NEW
  epub         // NEW
  xlsx         // NEW
  xls          // NEW
  ods          // NEW
  csv          // NEW
  pptx         // NEW
  ppt          // NEW
  odp          // NEW
  image        // NEW — PNG/JPG/TIFF
  eml          // NEW — e-mail
  msg          // NEW — Outlook e-mail
  archive      // NEW — ZIP с вложениями
  other
}
```

`bun run prisma:push` + `bun run prisma:generate`. Никаких migrate.

### 2.2. Обновить `detectKind` в `documents.service.ts`

Перевести на двухступенчатую логику:
1. Magic-bytes detection через `file-type` npm-пакет — самый надёжный способ (читает первые байты). Это убирает баг «`.pdf` с реальным content-type `image/jpeg`».
2. Если magic-bytes не уверен — fallback на MIME + расширение (как сейчас).

### 2.3. Синхронизировать accept на фронте

В [frontend/app/(authenticated)/documents/DocumentsListClient.tsx](frontend/app/(authenticated)/documents/DocumentsListClient.tsx) `accept` строится из единого источника (новый файл `frontend/src/lib/document-formats.ts`), и тот же источник используется бэком (через generation API-схемы Swagger). Никаких ручных синхронизаций.

В `frontend/src/lib/document-formats.ts` — экспорт `ACCEPT_STRING`, `MAX_SIZE_MB`, `FORMAT_LABELS`. Импортируется и в UI accept-атрибут, и в текст ошибки «допустимые форматы».

### 2.4. Telegram-бот: BOT_DOCUMENT_ENABLED

Проверить, что бот пропускает новые форматы (xlsx/pptx/eml). Если в `bot.processor` есть hardcoded MIME-whitelist — расширить.

**DoD фазы 2:**
- [ ] enum `DocumentKind` расширен, миграция применена.
- [ ] magic-bytes detection в `detectKind`.
- [ ] Frontend accept берётся из общего файла.
- [ ] Telegram бот принимает новые форматы.

---

## Фаза 3. Tabular-ingest pipeline (Excel/CSV/ODS как структурированный источник)

Цель: ради этой фазы и затевалось всё ТЗ. Excel/CSV должны попадать в граф знаний **построчно**, а не одной простынёй.

### 3.1. Новая модель `Dataset` (или расширение Source)

В `schema.prisma`:
```prisma
enum SourceType {
  // ...существующие
  tabular   // NEW
}

model Dataset {
  id          String   @id @default(cuid())
  tenantId    String
  documentId  String   @unique
  document    Document @relation(...)
  sheetName   String?
  headers     String[] @db.Text[]
  rowCount    Int
  metadata    Json     // { columnTypes, sampleValues, detectedSchema }
  entityId    String?  @unique  // линка с Entity{type='dataset'}
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model DatasetRow {
  id          String   @id @default(cuid())
  tenantId    String
  datasetId   String
  dataset     Dataset  @relation(...)
  rowIndex    Int
  cells       Json     // { headerName: value }
  rawEventId  String?  @unique  // RawEvent для этой строки
  createdAt   DateTime @default(now())
  @@index([datasetId, rowIndex])
}
```

Новый `Entity.type='dataset'` (расширение существующего enum в schema).

### 3.2. Tabular-ingest adapter

Новый адаптер `backend/src/modules/ingest/adapters/tabular/tabular.adapter.ts` (по аналогии с document.adapter):
- Подписан на очередь `core.tabular-uploaded`.
- Когда документ — `xlsx`/`xls`/`ods`/`csv`, после DCS возвращает `tables[]`:
  - Создаёт `Dataset` (один на лист).
  - Для каждой строки — `DatasetRow` + `RawEvent` с `sourceType='tabular'`, `payload={cells, sheetName, rowIndex}`.
  - Публикует пачкой в `core.raw-events`.

### 3.3. Адаптация block-ingest worker для tabular

Текущий `block-ingest.worker` делает «нарезка текста LLM-ом на IdeaBlock». Для tabular это лишнее: одна строка таблицы = одна сущность, нарезать нечего. Нужна ветка:
- Если `RawEvent.payload.kind === 'tabular_row'` — пропускаем LLM-нарезку.
- Создаём один IdeaBlock с `signalType='dataset_row'`, текст = «{header1}: {value1}; {header2}: {value2}; …», и `roleRelevant=false` (или по эвристике).
- Метаданные строки кладём в `IdeaBlock.metadata`.

Это экономит огромное количество LLM-вызовов на больших выгрузках.

### 3.4. Schema-inference (опц., но желательно)

После загрузки таблицы один LLM-вызов на весь Dataset (не построчно!):
- Дать LLM headers + 5 sample-row.
- Получить ответ: «это похоже на CRM-выгрузку клиентов; колонка `email` → атрибут `Person.email`; колонка `company` → `Org.name`».
- На основании этого создавать Entity (Person/Org/Customer) автоматически из строк.

**Cache-friendly разметка промпта:**
```
SYSTEM: <стабильный, описание задачи schema-inference>
USER:
  Заголовки таблицы: {headers}
  Пример строк:
  {sample_rows}
```
Стабильная часть SYSTEM кэшируется (95-99% экономии по правилу проекта).

### 3.5. Лимиты и защита от мегатаблиц

- `TABULAR_MAX_ROWS=50000` — лимит строк на dataset. При превышении — статус `failed`, message «Таблица слишком большая, разбейте на части».
- Параллелизм на уровне очереди — `core.raw-events` уже это умеет, но добавим `priority` для tabular (чтобы 5000 строк не залочили обычные документы).

**DoD фазы 3:**
- [ ] Модели `Dataset`/`DatasetRow` в схеме, `prisma push` применён.
- [ ] Tabular-adapter принимает Excel/CSV из DCS и кладёт в БД.
- [ ] block-ingest умеет работать с `tabular_row` без LLM-нарезки.
- [ ] Schema-inference LLM-вызов с cache-friendly промптом.
- [ ] Integration-тест: загрузка CRM-выгрузки на 100 строк → 1 Dataset + 100 DatasetRow + 100 IdeaBlock + Entity по schema.
- [ ] Запись в `docs/operations/prod-deploy-log.md` Шаг 4 (новые модели) + Шаг 12 (новая очередь).

---

## Фаза 4. OCR для сканированных PDF и изображений

Цель: загрузка скана регламента и фото доски — приводит к тому же графу знаний.

### 4.1. Маркер «нужен OCR»

В DCS: если pdf-parse на странице вернул <100 символов И в PDF есть изображения — флаг «вероятно скан». Тогда:
- Применяем OCR (Tesseract/PaddleOCR в зависимости от выбора Фазы 0).
- В ответе `metadata.ocrApplied=true`.

### 4.2. Прямые изображения как документ

`DocumentKind='image'`: PNG/JPG/TIFF — DCS вызывает OCR безусловно, возвращает markdown с текстом. Лимиты:
- `IMAGE_MAX_SIZE_MB=20` (отдельный от PDF лимита).
- `IMAGE_OCR_LANGUAGES=ru,en` (детектируется автоматически, но fallback задаётся).

### 4.3. Switchable OCR-провайдер

Регистр провайдеров в DCS (`config.yaml`):
```
ocr_provider: rapidocr | tesseract
```
Переключение — без передеплоя Z, только перезапуск DCS-контейнера. **Никаких облачных провайдеров** — единственный платный внешний API в Z остаётся LLM (DeepSeek через proxy).

Метрики:
- `document_ocr_provider_used_total{provider}`
- `document_ocr_duration_seconds{provider}`
- `document_ocr_failed_total{provider, reason}`

### 4.4. Watchpoint: качество русского OCR

Tesseract на русском — middling. RapidOCR с PP-OCRv5 eslav-весами объективно лучше для кириллицы (81.6% acc по бенчмарку Baidu), и потому в проекте остаётся primary. Tesseract — fallback на случай редких форматов. Если оба локальных движка дают <90% на тестах — это блокер для запуска, не закрываем глаза облачным fallback'ом.

**DoD фазы 4:**
- [ ] DCS детектирует скан-PDF и применяет OCR.
- [ ] DocumentKind='image' принимается, OCR применяется.
- [ ] Метрики провайдера/длительности/ошибок собираются.
- [ ] Integration-тест: скан-PDF на 3 страницы (помещённый в `backend/test/fixtures/`) распознан, IdeaBlock'и созданы.

---

## Фаза 5. PPTX/HTML/EPUB/RTF/DOC/ODT — широкое покрытие

Цель: остаточные форматы из Д3.

Без отдельных подпунктов — DCS уже их умеет (по итогам Фазы 0). Здесь только:
- Расширить frontend accept-список и переводы.
- Добавить unit-тесты на `detectKind` для каждого нового расширения.
- Добавить smoke-тесты в `backend/test/fixtures/documents/` (по 1 файлу на формат).

⚠ **Особый кейс — PowerPoint:** в презентациях много текста на изображениях (диаграммы, картинки). DCS должен:
- Достать текст из shape'ов (это просто).
- Применить OCR к встроенным изображениям с текстом (это опционально, по флагу `pptx_ocr_embedded=true`).

**DoD фазы 5:**
- [ ] PPTX/HTML/EPUB/RTF/DOC/ODT принимаются с end-to-end проходом до IdeaBlock.
- [ ] По одному фикстуре на формат в `backend/test/fixtures/documents/`.
- [ ] Frontend список форматов и подсказок обновлён.

---

## Фаза 6. E-mail (.eml / .msg) с рекурсией по вложениям

Цель: загрузка письма с приложенными PDF/Excel — должна развернуться в Document на письмо + N Document'ов на вложения.

### 6.1. Парсер e-mail

DCS получает `.eml` или `.msg`:
- Извлекает заголовки (From/To/Subject/Date), тело (text/html), вложения (binary blobs + filenames + mime).
- Возвращает структурированный JSON.

### 6.2. Рекурсивный ingest

В Z создаётся:
- 1 `Document{kind:'eml', name='<Subject>'}` для самого письма.
- N `Document{kind:<format>, name='<attachmentName>', metadata: {parentEmailId: <doc.id>}}` для каждого вложения.
- Все они через стандартный pipeline.
- Между ними `EntityLink{relationType:'attached_to'}` в графе.

### 6.3. Защита от вложенности

- `EMAIL_MAX_ATTACHMENTS=20` — лимит вложений в одно письмо.
- Защита от forward-bombing: рекурсия только на 1 уровень. Если вложение — ещё одно письмо с вложениями, его вложения **не** разворачиваются автоматически.

**DoD фазы 6:**
- [ ] `.eml` и `.msg` принимаются, разворачиваются в Document + вложения.
- [ ] EntityLink между ними создаётся.
- [ ] Лимиты соблюдаются.

---

## Фаза 7. ZIP-архивы с рекурсивным разбором

Цель: «выгрузка из 1С zip-ом» = десятки документов в графе знаний.

### 7.1. Adapter `archive.adapter`

- Распаковка ZIP на диск воркера (временная директория).
- Для каждого файла внутри — стандартный document-ingest (как если бы пользователь загрузил их по одному).
- Все связаны `EntityLink{relationType:'extracted_from'}` с архивом-Document'ом.
- После обработки временная директория удаляется.

### 7.2. Лимиты

- `ARCHIVE_MAX_TOTAL_SIZE_MB=200` — суммарный размер всех файлов внутри (zip-bomb protection).
- `ARCHIVE_MAX_FILES=200`.
- `ARCHIVE_MAX_DEPTH=2` — глубина вложенности архивов (ZIP в ZIP допустим, но не глубже).

### 7.3. RAR/7z — отложить

В первой итерации только ZIP (он бесплатный/Apache-совместимый). RAR требует unrar (несвободный), 7z — большая зависимость. Отметить в TZ как «расширение позже».

**DoD фазы 7:**
- [ ] ZIP с 5 разнотипными файлами разворачивается, все попадают в граф, связаны рёбрами.
- [ ] Zip-bomb на 1GB архиве вежливо отказывает.

---

## Фаза 8. Дедупликация, magic-bytes, лимиты, retry

Cross-cutting улучшения, которые применяются ко всему ingest.

### 8.1. Дедупликация по SHA-256

- Добавить колонку `Document.contentHash String?` (SHA-256 от raw-bytes).
- Уникальный составной индекс: `@@unique([tenantId, contentHash])`.
- В `DocumentsService.upload`:
  - Считаем хеш до записи.
  - Если уже есть документ с таким хешом в этой Org → возвращаем `{id: existingId, status: 'duplicate'}` (HTTP 200, не 409 — это не ошибка, это «такой же файл уже был»).
  - Фронт показывает «Этот документ уже загружен <дата>, ссылка на существующий».

### 8.2. Magic-bytes detection

Уже сделано в Фазе 2.2, но здесь — `file-type` пакет на новых версиях принимает stream, что снимает требование «загрузить весь файл в RAM». Перевод на stream-режим.

### 8.3. Stream-обработка больших файлов

Сейчас вся стрелка `Buffer → Document.inlineContent | S3`. Для >50MB надо:
- Multer на фронте/multer-storage-s3 — стримим сразу в S3, не через RAM воркера.
- В DCS — тоже принимать file-stream, не bytes-buffer.

### 8.4. Ручной retry

- Кнопка «Распарсить заново» в UI деталки документа (только для `status='failed'`).
- Эндпоинт `POST /api/v1/documents/:id/retry` — переводит `failed → uploaded`, ре-enqueue в `core.document-uploaded`. RBAC: только owner/admin.
- Метрика `document_manual_retry_total{previousStatus}`.

### 8.5. Аудит просмотров (опционально, под флагом)

`DOCUMENT_VIEW_AUDIT_ENABLED=false` по умолчанию. Если включено — каждый `GET /documents/:id` пишет `AuditLog{action:'document.viewed', userId, documentId}`. Полезно для compliance в больших Org.

**DoD фазы 8:**
- [ ] SHA-256 дедупликация работает, повторный upload возвращает существующий ID.
- [ ] Magic-bytes detection через `file-type` stream.
- [ ] Большие файлы стримятся в S3, без OOM воркера.
- [ ] Кнопка «Распарсить заново» в UI и REST-эндпоинт.
- [ ] Тест: повторная загрузка того же PDF → 1 Document, не 2.

---

## Фаза 9. UX: статус парсинга, прогресс, отчёт об ошибках

Цель: пользователь видит, что происходит с его документом, и понимает, что делать при ошибке.

### 9.1. Server-Sent Events для статуса

- Эндпоинт `GET /api/v1/documents/:id/status/stream` (SSE).
- DocumentIngestAdapter и block-ingest публикуют события `document.status.changed` в Redis pub/sub:
  - `parsing` → `parsed` → `blocks_extracted` (с прогрессом «N/M блоков»).
- Фронт деталки документа подписывается, обновляет UI без перезагрузки.

### 9.2. Локализованные сообщения об ошибках

Сейчас `parseError` — техническое сообщение. Завести таблицу `frontend/src/lib/document-errors.ts`:
```
{
  'unsupported_kind': 'Этот формат не поддерживается. Список доступных: …',
  'too_large': 'Файл больше 50 МБ. Разбейте на части.',
  'ocr_failed': 'Не удалось распознать текст на сканированных страницах. Попробуйте загрузить чёткий скан.',
  'timeout': 'Парсинг занял слишком много времени. Попробуйте файл меньше или обратитесь к админу.',
  ...
}
```

Backend в `parseError` пишет код ошибки (`unsupported_kind`), фронт сам показывает русский текст. Это даёт i18n-готовность без переписывания.

### 9.3. Превью parsedText в UI

В деталке документа — collapsible-секция «Извлечённый текст» (первые 2000 символов, кнопка «развернуть»). Помогает пользователю верифицировать, что парсинг сработал корректно, ещё до того как граф знаний обновится.

### 9.4. Дашборд админа: статистика ingest

В `/admin/documents`:
- График «загрузок за неделю по типам».
- Таблица «топ-10 ошибок» (агрегация по `parseError`).
- Конверсия `uploaded → blocks_extracted` (drop-off на каждом шаге).

**DoD фазы 9:**
- [ ] SSE-статус работает в UI деталки документа.
- [ ] parseError-коды локализованы.
- [ ] Превью parsedText в UI.
- [ ] Дашборд админа со статистикой.

---

## Фаза 10. Парсинг сайта компании при регистрации (Website Ingest)

Цель: новая компания регистрируется в Z → может ввести URL своего сайта → асинхронный воркер обходит сайт → автоматически создаёт IdeaBlock'и и Entity (Org, Industry, Service, Person, Contact) в графе знаний. К моменту, когда сотрудники впервые открывают Z, граф уже знает «что за компания, чем занимается, основные продукты, контакты, регион».

### 10.1. Стек и обоснование

После research-фазы выбран: **Crawl4AI** (каркас, Playwright, кастомный LLM-endpoint) + **extruct** (schema.org/JSON-LD без LLM) + **trafilatura** (boilerplate-removal) + **DeepSeek V4 Flash** через `proxy.agent-lia.ru` (structured extract).

Обоснование (см. [analysis-документ](../analysis/2026-05-31-document-conversion-stack.md)):
- Crawl4AI — Apache 2.0, поддерживает кастомные LLM-эндпоинты (`LLMConfig.api_base`), `fit_markdown` с PruningContentFilter ужимает 60-100k HTML до 3-6k токенов на страницу, есть adaptive crawling.
- **ScrapeGraphAI отбракован**: LLM на каждой странице = $0.02-0.10 на сайт vs $0.003-0.005 у Crawl4AI.
- **Firecrawl OSS отбракован**: AGPL-3 в core.
- **Scrapling отбракован**: overkill для one-shot scan + solo-maintainer + репутационный риск.

### 10.2. Отдельный sidecar `infra/web-scraper/`

Новый docker-compose-сервис, по аналогии с DCS:
- `Dockerfile`: Python 3.12 + Crawl4AI + extruct + trafilatura + Playwright Chromium.
- `app.py`: FastAPI, эндпоинт `POST /scrape-company`.
- ~1.2 GB образ, 4 GB RAM limit на пике (Chromium).
- НЕ мержить с DCS — другие зависимости, другие отказы (Crawl4AI рестарт при memory creep Chromium).

Контракт:
```
POST /scrape-company
  body: { url: string, depth?: number=2, maxPages?: number=10, language?: "ru"|"auto" }
returns:
  {
    company: {
      name: string,
      legalName?: string,
      description: string,
      industry?: string,
      website: string,
      foundedYear?: number,
      headquarters?: { country, city, address },
      regions?: string[],
      employeeCountEstimate?: string,
      services: Array<{ name, description }>,
      products?: Array<{ name, description }>,
      clients?: Array<{ name, logoUrl? }>,
      keyPeople?: Array<{ name, role, bio? }>,
      contacts: { phones: string[], emails: string[], socials: Record<string, string> }
    },
    pages: Array<{ url, title, role: "about"|"services"|"team"|"contacts"|"other", markdown: string }>,
    confidence: number,
    warnings: string[]
  }
```

### 10.3. Пайплайн внутри сервиса

1. **robots.txt + sitemap.xml** — быстрая карта сайта. Уважаем `Disallow`.
2. **extruct на главной** — JSON-LD `Organization`, OpenGraph, microdata. Если разметка есть и полная — структурированный ответ за 0 LLM-токенов. Покрытие на западных корпсайтах 30-40%, на .ru меньше.
3. **Heuristic-маршрут** — поиск ссылок по словарю (на русском и английском): «о компании / о нас / о фирме / about / company», «услуги / services», «команда / team / about us», «контакты / contacts». Crawl4AI обходит максимум `maxPages` (default 10).
4. **fit_markdown** на каждой странице с `PruningContentFilter` → агрегированный markdown.
5. **Один LLM-вызов DeepSeek V4 Flash** с cache-friendly промптом:
   - **SYSTEM** (стабильный, кэшируется): «Ты извлекаешь информацию о компании из markdown-сборки её сайта. Верни JSON ровно по схеме (Pydantic). Не выдумывай: если поля нет — оставь null. Уважай язык исходника.»
   - **USER**: `{aggregated_markdown}` + JSON-schema.
   - Цена при `maxPages=10` × `~3-6k токенов/стр` ≈ 30-60k input + 1k output ≈ **$0.003-0.005 за сайт** на DeepSeek V4 Flash.
6. **Pydantic-валидация** ответа. При невалидном JSON — retry с другой temperature или return partial.
7. **Сохранение** в БД через REST в Z-backend (новая модель `WebsiteIngestJob`).

### 10.4. Интеграция в Z-backend

#### 10.4.1. UI и эндпоинт

- В onboarding-flow (`frontend/app/(authenticated)/onboarding/...`) на одном из шагов — поле «Сайт компании» с placeholder `https://example.ru`. Опциональное (можно пропустить).
- В админке (`/admin/organizations/[id]`) — кнопка «Перепарсить сайт» (доступна super_admin и owner Org).
- REST: `POST /api/v1/orgs/:id/website-ingest { url }` → возвращает `{ jobId }`. RBAC: owner/admin Org или super_admin.
- SSE-статус: `GET /api/v1/website-ingest/:jobId/status/stream`.

#### 10.4.2. Новая модель

```prisma
model WebsiteIngestJob {
  id          String              @id @default(cuid())
  tenantId    String
  url         String              @db.VarChar(2048)
  status      WebsiteIngestStatus @default(queued)
  startedAt   DateTime?
  finishedAt  DateTime?
  resultJson  Json?               // полный ответ из sidecar
  pageCount   Int?
  warnings    String[]            @db.Text[]
  error       String?             @db.Text
  triggeredBy String              // userId
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt
  @@index([tenantId, status])
}

enum WebsiteIngestStatus {
  queued
  scraping
  extracting
  saved
  failed
}
```

#### 10.4.3. BullMQ-очередь

- `core.website-ingest` — payload `{ jobId, tenantId, url }`.
- `WebsiteIngestWorker` (новый воркер в `workers/main.ts`):
  1. Update `status: queued → scraping`.
  2. HTTP POST → `web-scraper` sidecar.
  3. Update `status: scraping → extracting → saved`.
  4. Создаёт Entity (Org / Service / Person) + IdeaBlock'и из results.
  5. Связи через EntityLink: `Service{produces|offered_by} Org`, `Person{employed_by} Org`.
  6. Lazy-upsert `Source{type:'web', name:'<domain>'}`, создаёт RawEvent с `sourceExternalId='web:<jobId>:<pageUrl>'`.

#### 10.4.4. Идемпотентность и rate-limit

- Дедупликация по `(tenantId, url)` — повторный запрос на тот же URL возвращает существующий `jobId`, если результат свежее 7 дней.
- Rate-limit: 1 website-ingest на Org в час, 10 на день (защита от злоупотребления).
- Глобальный rate-limit на sidecar: 5 concurrent crawls (Chromium ёмкий).

### 10.5. Защита и этичность

- Уважение `robots.txt` (Crawl4AI по умолчанию делает).
- User-Agent в Crawl4AI должен явно указывать `Z-Company-Ingest (+https://kora.ai/docs/web-ingest)` — прозрачность, легко blacklist'нуть тем, кто не хочет.
- Timeout всего job — 5 минут. Большие сайты не парсим.
- Не следуем external-ссылкам (только same-domain).

### 10.6. Метрики

- `website_ingest_total{status}` (counter).
- `website_ingest_duration_seconds{stage}` (histogram, stage ∈ scrape/extract/save).
- `website_ingest_llm_tokens_total{model}` (counter).
- `website_ingest_pages_per_job` (histogram).

**DoD фазы 10:**
- [ ] Sidecar `web-scraper` поднят и парсит 3 тестовых .ru-сайта.
- [ ] Модель `WebsiteIngestJob`, очередь, воркер реализованы.
- [ ] UI в onboarding + кнопка «Перепарсить» в админке.
- [ ] SSE-статус.
- [ ] Integration-тест: на mocked sidecar — полный путь `POST → BullMQ → Worker → Entity created`.
- [ ] Метрики Prometheus.
- [ ] Запись в `docs/operations/prod-deploy-log.md` Шаг 1 (новый ENV `WEBSITE_INGEST_URL`) + Шаг 4 (новая модель) + Шаг 12 (новая очередь).

---

## Общий DoD ТЗ

- [ ] Все 11 фаз закрыты, либо явно отмечены как «not-now» с причиной.
- [ ] Все новые модели/enum применены через `bun run prisma:push`.
- [ ] Все новые скрипты (seed/patch/backfill) добавлены в `backend/scripts/apply-prod-deploy.ts`.
- [ ] `docs/operations/prod-deploy-log.md` обновлён по каждому затрагивающему prod шагу.
- [ ] `second-brain/01_projects/document-ingest.md` обновлён под новое целевое состояние.
- [ ] `second-brain/02_architecture/document-conversion-service.md` создан (Фаза 0–1).
- [ ] Метрики Prometheus + панели Grafana для нового pipeline.
- [ ] Рефлексия в `second-brain/05_история/2026-05-31-document-ingest-universal-*.md` после каждого push.

## Бизнес-приоритет фаз

По убыванию пользы для пользователя:

1. **Фаза 0 + Фаза 1** — фундамент DCS (без него остальное мёртвое). Стек уже выбран по research — это smoke-test и подъём sidecar.
2. **Фаза 2** — синхронизация frontend/backend, magic-bytes. Маленькая, снимает баги уже сегодня.
3. **Фаза 3** — Excel/CSV структурный pipeline. Главная боль из контекста разговора.
4. **Фаза 10** — Парсинг сайта компании при регистрации. Огромный wow-эффект для нового клиента: «Z уже знает мою компанию ещё до того, как я что-то загрузил».
5. **Фаза 4** — OCR (только локальный: RapidOCR primary, Tesseract fallback).
6. **Фаза 8** — дедупликация, retry, stream. Cross-cutting качество.
7. **Фазы 5–7, 9** — расширения форматов и UX, постепенно.

## Открытые вопросы (требуют решения владельца до старта Фазы 1)

1. **Хостинг DCS и web-scraper sidecar'ов** — отдельный VPS, тот же сервер что и backend, или managed (AWS Lambda Container/Yandex Serverless)? Влияет на cold start и стоимость. Предложение: на старте — тот же сервер (Docker Compose), при росте — выделить.
2. ~~OCR-провайдер~~ — закрыто решением 2026-05-31: только локальный (RapidOCR primary + Tesseract fallback). Никаких облачных API. Если качество окажется недостаточным — issue в виде отдельного ТЗ на улучшение, а не платный fallback.
3. **Глубина website-ingest** — стартуем с `maxPages=10` или сразу всеядно (sitemap.xml + до 50)? Влияет на стоимость и время. Предложение: 10 на MVP.
4. **Цикл повторного парсинга сайта** — раз в месяц обходить заново (компания обновила сайт) или только по кнопке? Предложение: только по кнопке + автотриггер раз в 90 дней при наличии активной подписки.

## Итог ТЗ

Реализовано: **0/11 фаз (Фаза 0 smoke-test закрыт 2026-05-31 — см. [analysis-документ §Smoke-test results](../analysis/2026-05-31-document-conversion-stack.md#smoke-test-results-2026-05-31-фаза-0-тз-document-ingest))**. ТЗ согласовано, развилок нет, можно стартовать.

Research-документ со сводной таблицей и обоснованием выбора каждого компонента стека: [plans/analysis/2026-05-31-document-conversion-stack.md](../analysis/2026-05-31-document-conversion-stack.md).

## Чек-лист «передал агенту-разработчику»

- [ ] Агент прочитал это ТЗ полностью + связанный [research-документ](../analysis/2026-05-31-document-conversion-stack.md).
- [ ] Агент прочитал [CLAUDE.md](../../CLAUDE.md) и skill'ы `core-engineering-standards`, `nestjs-rules`, `prisma-db-push-rules`, `safe-seed-rules`, `z-ai-agent-rules`.
- [ ] Агент стартует с **Фазы 0** (smoke-test финального стека). Фикстуры в `backend/test/fixtures/documents/`, гейты в Фазе 0.3. **Не прыгать сразу в Фазу 3 (Excel)**, даже если хочется быстрее закрыть боль.
- [ ] Каждая фаза — отдельный PR с прохождением `bun run typecheck`, `bun run lint`, `bun run test:unit` + relevant `test:integration`.
- [ ] Все новые модели Prisma — через `bun run prisma:push`, **никогда** `prisma migrate*`.
- [ ] Все новые ENV — в `backend/src/common/config/env.schema.ts`, никаких `process.env.*` прямо в коде.
- [ ] Все новые prod-операции (миграции схемы, новые скрипты, новые ENV, новые очереди BullMQ) — обновить `docs/operations/prod-deploy-log.md` соответствующий шаг.
- [ ] Все новые seed/patch/backfill/migrate-скрипты — зарегистрировать в `backend/scripts/apply-prod-deploy.ts` (массив `STEPS`).
- [ ] После каждого закрытого PR — рефлексия в `second-brain/05_история/2026-MM-DD-document-ingest-phase-N.md`.
- [ ] Если возникает развилка, которой нет в ТЗ — **не принимать решение «по-своему»**, написать вопрос владельцу в issue.
