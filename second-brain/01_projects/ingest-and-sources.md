---
title: Ingest и Sources (Фаза 1 knowledge-core)
status: actual
updated: 2026-05-10
---

# Ingest и Sources

Введено в Фазе 1 ТЗ knowledge-core ([plans/tz/2026-05-10-knowledge-core-tz.md](../../plans/tz/2026-05-10-knowledge-core-tz.md), §«Фаза 1 — Универсальный ingest + Raw Memory + meeting-adapter»).

## Зачем

knowledge-core рассчитывает иметь **единую точку приёма** входящих данных
из любого источника (встречи, чаты, звонки, email, web-формы, telegram-боты).
Раньше — каждая фича втыкалась в свой кусок pipeline'а; теперь любой текст
попадает через `IngestService.ingest(...)` в иммутабельную таблицу `RawEvent`
и эту запись разбирает универсальный консумер (`block-ingest.worker` — Фаза 2).

На Фазе 1 реализован первый адаптер: для существующих транскриптов встреч.
Адаптеры telegram/email/call/web-form — Фаза 10.

## Сущности

См. [[../02_architecture/data-model#knowledge-core: Source / RawEvent (Фаза 1, 2026-05-10)]] для полного списка полей.

- **`Source`** — справочник подключённых источников Org. Дефолтный
  `Source(type=meeting, name='Встречи Z')` создаётся **автоматически**
  при создании Org (хук в `OrgsService.createForOwner`). Backfill для
  Org из Фазы 0 — [backfill-meeting-sources-fase1.ts](../../backend/scripts/backfill-meeting-sources-fase1.ts).
- **`RawEvent`** — иммутабельная запись сырого события. Идемпотентность
  по `idempotencyKey = sha256(sourceId + ':' + (sourceExternalId ?? checksum) + ':' + occurredAtIso)`.
  Inline-payload до 10 MiB (jsonb); больше — в S3 (`raw-events/<tenantId>/<idempotencyKey>.json`).

## Сервисы и API

- **`IngestService.ingest({tenantId, sourceId, sourceExternalId?, occurredAt, payload, dataClass?})`** —
  главный путь. Прямой in-process вызов из любого адаптера. Делает sha256
  payloadChecksum + idempotencyKey, валидирует Source.tenantId+isActive,
  при `payloadSize > 10 MiB` уезжает в S3, обрабатывает P2002 (race) →
  идемпотентный возврат существующего `RawEvent`. После успеха — enqueue
  job в `core.raw-events` (BullMQ).
- **`MeetingIngestAdapter.ingestMeeting(meetingId)`** — высокоуровневый
  in-process адаптер для существующих встреч. Читает `Meeting + Transcript +
  Participants + merged.json`, lazy-upsert дефолтного `Source`, формирует
  канонический payload (`meetingId, type, title, participants, transcript.turns,
  roomChat`) и зовёт `IngestService.ingest(...)`. occurredAt = `endedAt ??
  startedAt ?? createdAt`.
- **`POST /api/v1/ingest`** — HTTP-обёртка над `IngestService.ingest` для
  будущих **внешних** адаптеров (telegram/email/IMAP-listener в отдельном
  процессе). На Фазе 1 защищён `IngestTokenGuard` (Bearer-токен из ENV
  `INGEST_INTERNAL_TOKEN`, timingSafeEqual). При пустом токене эндпоинт
  возвращает 503.
- **`GET /api/v1/raw-events/:id`** — отладочный просмотр. Под
  `CookieAuthGuard + TenantGuard`, доступ только owner/admin Org. Для
  s3-payload возвращается presigned URL (через `S3Service.presignGet`).

## Очередь `core.raw-events`

- `backend/src/modules/core-queue/queues.ts` — константа
  `CORE_QUEUE_NAMES.RAW_EVENTS = 'core.raw-events'`.
- `CoreQueueService.enqueueRawReceived(rawEventId)` — jobId='raw_<rawEventId>'
  (BullMQ 5.x запрещает `:` в Custom Id, поэтому разделитель `_`).
- Дефолтные `JobsOptions`: 5 attempts, exp backoff 5s.
- **На Фазе 1 ни один консумер не подписан на эту очередь** — jobs
  накапливаются в Redis. Это нормально (BullMQ умеет хранить). Consumer
  `block-ingest.worker` появится в Фазе 2.

## Подключение к существующему AI-pipeline

`AnalyzeWorker` (`backend/src/modules/ai/workers/analyze.worker.ts`) после
перехода `Meeting.aiStatus = 'ai_ready'` запускает 4 параллельные операции
через `Promise.allSettled`:
1. `enqueueChapters(meetingId)`
2. `enqueueTasksExtract(meetingId)`
3. `enqueueTranscriptIndex(meetingId)` — старый pipeline эмбеддингов для
   chat-модуля; **остаётся работать** до Фазы 6 (chat-v2 заменит, потом
   удалим).
4. `meetingIngest.ingestMeeting(meetingId)` — **новый**: пишет `RawEvent`.
   Обёрнут в `.catch(...)` — ошибка ingest не валит остальные стадии (на
   Фазе 1 ingest некритичен).

## ENV

- `INGEST_INTERNAL_TOKEN` (default `''`) — shared-secret для
  `POST /api/v1/ingest`. Длина 40+ символов. Генерация:
  `openssl rand -hex 32`. На Фазе 1 не задавать локально — это работа
  DevOps при прод-деплое.

## Smoke

[backend/scripts/smoke-ingest-fase1.ts](../../backend/scripts/smoke-ingest-fase1.ts) —
проверяет идемпотентность (повторный ingest → тот же id), корректность
`payloadChecksum`, разные `sourceExternalId` → разные RawEvent, появление
job'ов в `core.raw-events` (BullMQ).

Скрипт намеренно НЕ импортирует `IngestService` (чтобы не тащить
ConfigModule с zod-валидацией всех ENV) — он повторяет логику ingest
вручную через PrismaClient + IORedis + BullMQ.

Запуск:
```
cd backend && npx tsx scripts/smoke-ingest-fase1.ts
```

Полный e2e (с реальной встречей через UI/LiveKit + AnalyzeWorker) —
ручной (см. шаги в шапке smoke-скрипта).

## Что вне Фазы 1 (для напоминания)

- `IdeaBlock`, `Entity`, `Theme`, `block-ingest.worker` — **Фаза 2**.
- Адаптеры telegram/email/call/web-form — **Фаза 10**.
- UI управления источниками — **Фаза 10**.
- Полноценное per-Org API-key управление для внешнего ingest — **Фаза 10**.
- Удаление `transcript-index.worker` + `MeetingTranscriptChunk` — **Фаза 6**
  (после chat-v2).

[[../index|← index]]
