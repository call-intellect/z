---
title: Ingest и Sources (Фаза 1 knowledge-core)
status: actual
updated: 2026-05-10
---

# Ingest и Sources

Введено в Фазе 1 ТЗ knowledge-core ([plans/archive/2026-05-10-knowledge-core-tz.md](../../plans/archive/2026-05-10-knowledge-core-tz.md), §«Фаза 1 — Универсальный ingest + Raw Memory + meeting-adapter»).

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
- Удаление `transcript-index.worker` + `MeetingTranscriptChunk` — **Фаза 6** (после chat-v2).

## Фаза 10 — внешние адаптеры (закрыта 2026-05-10)

Введены 4 адаптера поверх `IngestService`. Каждый адаптер живёт в `backend/src/modules/ingest/adapters/<adapter>/` и вызывает `IngestService.ingest(...)` — никакой записи в `RawEvent` напрямую.

| Адаптер | Type / subtype | Endpoint | Auth |
|---|---|---|---|
| Telegram-бот | `bot/telegram` | `POST /api/v1/ingest/telegram/:sourceId` | `X-Telegram-Bot-Api-Secret-Token` (timing-safe) |
| Mango Office | `phone_call/mango` | `POST /api/v1/ingest/calls/mango/:sourceId` | sha256(apiKey + json + apiSalt) |
| IMAP email | `email/imap` | внутренний cron `email-fetch.cron` `*/5 * * * *` | `EMAIL_FETCH_ENABLED` ENV + `WorkerOrgGate` |
| Web-form (дамп мысли) | `web_form` | `POST /api/v1/ingest/dump` | `CookieAuthGuard + TenantGuard`, quota 30/день/юзер |

### `Source.config` schemas (Zod)
- Telegram: `{subtype:'telegram', botToken (encrypted), botUsername, webhookSecret(>=32), allowedChatIds[], includeForwarded}`.
- Mango: `{subtype:'mango', apiKey (encrypted), apiSalt (encrypted), extensions[]}`.
- IMAP: `{subtype:'imap', host, port, secure, user, passwordEnc, folder, sinceDate?, sensitiveFolders[]}`.
- Web-form: config не нужен (lazy-upsert через `DumpService`).

Шифрование секретов — `CryptoService` ([backend/src/common/crypto/crypto.service.ts](backend/src/common/crypto/crypto.service.ts)) с AES-256-GCM на ENV-ключе `CRYPTO_MASTER_KEY` (32 байта base64).

### Per-Org API-ключи для ingest

`ApiKey.scope = 'ingest'` (расширение Phase 10). Префикс ключей `zik_*`. `IngestTokenGuard` поддерживает два режима: per-Org `zik_*` ключ → `req.ingestContext = {tenantId, apiKeyId, source:'org_key'}`; иначе → legacy shared-secret (для in-process IMAP-cron'ов).

### `SourcesController` (Org-Admin CRUD)

```
GET    /api/v1/sources?type=                          [RBAC source.read]
POST   /api/v1/sources  body: {type, name, config?}    [RBAC source.write]
PATCH  /api/v1/sources/:id                            [RBAC source.write]
DELETE /api/v1/sources/:id                            [soft isActive=false]
POST   /api/v1/sources/:id/test                       [RBAC source.read]
```

Секреты в `SourceResponseDto` приходят как маркер `'<encrypted>'`. UI отправляет либо новое значение, либо маркер (backend сохранит старое).

### Особенности Mango (отклонение от ТЗ)

`MeetingType` enum НЕ содержит `phone_call`; у `Meeting` нет `source/externalCallId/ownerId nullable`. Расширение схемы Meeting под phone_call — **vNext**. Сейчас Mango адаптер хранит metadata в `RawEvent` с указателем на S3-запись, без создания Meeting.

### Frontend

- `/settings/sources` — CRUD адаптеров под `currentOrgRole IN ('owner','admin')`.
- `/dump` — простая страница «дамп мысли» (textarea 60vh + nonce idempotency).

### Gating через entitlements (Фаза 12)

`SourcesController.create` runtime-check `feature.adapter_<type>`. Webhook'и НЕ гейтятся (внешние). `EmailFetchCron` пропускает Org без `feature.adapter_email`.

[[../index|← index]]
