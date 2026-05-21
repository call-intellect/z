---
title: Document ingest pipeline
phase: 0b
status: in_progress
date: 2026-05-21
references:
  - plans/tz/2026-05-21-phase-0b-document-ingest.md
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
