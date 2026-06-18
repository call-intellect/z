---
title: Document ingest pipeline
phase: 0b
status: in_progress
date: 2026-05-21
references:
  - plans/archive/2026-05-21-phase-0b-document-ingest.md
---

# Document ingest pipeline

## Pipeline
`POST /api/v1/documents (multipart)` → `Document.status='uploaded'` → BullMQ event `document.uploaded` → `document.adapter` → `DocumentParserService.parse(...)` → `Document.parsedText` + `status='parsed'` → `RawEvent` создание → existing knowledge-core pipeline.

## Парсеры (0b.1)
- PDF — `pdf-parse`.
- DOCX — `mammoth` (text mode).
- Markdown — `marked` + strip HTML.
- Text — `Buffer.toString('utf-8')`.

## Адаптеры
- `document.adapter` — `backend/src/modules/ingest/adapters/document/document.adapter.ts`.
- `text.adapter` — `backend/src/modules/ingest/adapters/text/text.adapter.ts` (для /dump).

## Лимиты
- Размер файла: 50 MiB (ENV `DOCUMENT_MAX_SIZE_MB`).
- Время парсинга: 30 сек (ENV `DOCUMENT_PARSE_TIMEOUT_MS`).

## Storage
- Файлы ≤10 MiB → `Document.inlineContent` (Bytes).
- >10 MiB → S3 `documents/<tenantId>/<documentId>.bin`.

## Extraction (0b.3)
Расширение `BlockExtractionService` на группу Б (Process/Decision/Regulation/Policy/Metric/Tool) + role-relevance флаг. Эксперимент «один промпт vs три прохода» — в первой неделе 0b.3.

## Provenance в API
`GET /api/v1/documents/:id` возвращает `extractedEntities: { processes, decisions, ... }` — readonly + confidence. Только для admin/owner.

## Расширение канала (ТЗ-4, 2026-06-09)

**Источник:** [`plans/archive/2026-06-08-manual-document-upload-and-import-tz.md`](../../plans/archive/2026-06-08-manual-document-upload-and-import-tz.md). Ветка `feature/2026-06-08-daily-value-dashboards-uploads`. Модули — [[../02_architecture/module-map]] §«Батч 5».

- **Новые форматы** (`DocumentKind +=` xlsx/pptx/html/rtf/odt/csv): `officeparser` (v7, функция `parseOffice`) для pptx/rtf/odt/csv/html, `exceljs` для .xlsx (текст по листам). `detectKind` расширен. PDF — `pdf-parse` (заброшен, но работает), DOCX — `mammoth`. ⚠ officeparser имеет `postinstall` — проверить нативную сборку на проде.
- **Мультифайл-загрузка** `POST /documents` (`FileFieldsInterceptor`) + дедуп по `Document.contentHash` (sha256 содержимого).
- **Смысловой тип** `Document.docType` (`DocumentType`: regulation/policy/instruction/process/job_description/other) — отдельно от `DocumentKind` (формат файла).
- **Явная привязка**: `attachedThemeId`/`attachedProjectId` + должность; **проброс в граф** через `block-ingest.applyDocumentAttribution` (`roleId`/`roleRelevant` + `ThemeIdeaBlock`).
- **AI-подсказка привязки** (human-in-the-loop): LLM `document-attribution-suggest` (`deepseek-v4-flash`) пишет `suggestedDocType`/`suggestedThemeId`; принимается через `PATCH /documents/:id/attribution`. Флаг `documents.ai_attribution.enabled`. См. [[ai-jobs]].
- **Массовый импорт**: `POST /documents/import-zip` (ZIP/Notion через `source`, `fflate`) + `POST /documents/import-confluence` (Confluence API, токен crypto-encrypted в job) → batch `DocumentImport` → очередь `core.document-import` → каждый файл = отдельный `Document` (re-use ingest-пути). См. [[workers-queues]].
- **chat-v2 citations** += `documentId`/`documentName` — документ-источник в ответах AI-чата.
- Крутилки: `documents.{maxSizeMb,maxFilesPerUpload,acceptedFormats,maxZipSizeMb}` (AdminSetting). Модели — [[../02_architecture/data-model]] §«Батч 5».

**Остаток (Волна 3, не сделано):** OCR (`tesseract.js`) для сканов + конвертация через `docling` (нужен `DOCLING_SERVICE_URL` владельца). См. реестр `04_не-сделано`.
