---
type: architecture
---

# Module Map

## Высокоуровневая схема

```
Frontend (Next.js + LiveKit React)
        ↓
Backend SaaS (NestJS)
        ↓
LiveKit Server (SFU)  →  LiveKit Egress  →  S3 Storage
        ↓                                       ↓
   webhooks                              AI Processing
        ↓                                       ↓
PostgreSQL + Redis  ←─────────────────  результаты AI
```

## Компоненты

| Компонент | Зона ответственности |
|---|---|
| **Frontend** | UI ЛК, комната встречи, гостевая страница, карточка результата |
| **Backend** | бизнес-логика встреч, токены, роли, webhooks, AI-оркестрация |
| **LiveKit SFU** | аудио/видео/screen share/media routing |
| **LiveKit Egress** | общая запись + отдельные аудиодорожки → S3 |
| **TURN** | NAT traversal для соединений |
| **PostgreSQL** | meetings, participants, recordings, ai_results |
| **Redis** | сессии, временные ключи, очереди задач |
| **S3** | видеофайлы, аудиодорожки |
| **AI Processing** | транскрибация, разделение по спикерам, шаблоны по типу |

## Потоки данных

### Создание встречи
`Frontend → Backend → LiveKit (room) + DB (meeting record) → Frontend (host_token, guest_link)`

### Гостевой вход
`Frontend (/meet/:token) → Backend (валидация токена) → LiveKit (guest token) → Frontend (подключение к room)`

### Запись
`Host жмёт «начать запись» → Backend → LiveKit Egress → S3 → webhook → Backend (status update)`

### AI после встречи
`Webhook «встреча завершилась» → Backend → очередь (Redis) → AI worker → транскрибация → шаблон по типу → DB (ai_result)`

## In-meeting interaction state (raise hand)

Состояние «поднята рука» хранится в **`participant.attributes`** LiveKit (key-value на участнике, нативно реплицируется всем + поздно подключившимся). Транспорт — без отдельного DataChannel-протокола.

```
{
  hand_raised: 'true' | 'false',
  hand_raised_at: '<timestamp>'
}
```

LiveKit чистит атрибуты автоматически при disconnect участника. Подробности: `plans/analysis/2026-05-06-raise-hand.md`.

## Webhooks от LiveKit (минимум для MVP)

- `participant_joined`
- `participant_left`
- `room_started`
- `room_finished`
- `egress_started`
- `egress_ended`
- `egress_failed`

## Org / RBAC модули (Фаза 0 knowledge-core, 2026-05-10)

- **`backend/src/modules/orgs/`** — Org / Membership / OrgInvitation:
  - `orgs.service.ts` — CRUD Org, листинг/смена ролей/удаление членов.
  - `org-invitations.service.ts` — создание/принятие/отзыв инвайтов, отправка email.
  - `orgs.controller.ts` — REST endpoints `/api/v1/orgs/*` под CookieAuthGuard.
  - DTO: `CreateOrgDto`, `UpdateOrgDto`, `InviteMemberDto`, `UpdateMemberDto` (zod).
  - Экспортирует `OrgsService` (используется в `accounts.service.register` хуке).

- **`backend/src/modules/rbac/`** — RBAC engine (Casbin-совместимый формат):
  - `rbac.service.ts` — `check/canRead/canWrite/canManageOrg`, in-memory кэш membership на 60s.
  - `guards/tenant.guard.ts` — TenantGuard, извлекает tenantId из `X-Org-Id`/`:orgId`/body/дефолта.
  - `decorators/current-org.decorator.ts` — `@CurrentOrg()`.
  - `policies/model.conf` + `policy.csv` — RBAC модель и правила. Версионируются через git.
  - Глобальный модуль (`@Global`).

Подробности: [[../01_projects/orgs-and-rbac]], [[../01_projects/llm-router]].

## Ingest / core-queue модули (Фаза 1 knowledge-core, 2026-05-10)

- **`backend/src/modules/core-queue/`** — диспетчер knowledge-core очередей:
  - `queues.ts` — константы (`CORE_QUEUE_NAMES.RAW_EVENTS = 'core.raw-events'`),
    дефолтные `JobsOptions` (5 attempts, exp backoff 5s).
  - `core-queue.service.ts` — `CoreQueueService.enqueueRawReceived(rawEventId)`
    с jobId='raw_<rawEventId>' (BullMQ 5.x запрещает `:` в Custom Id).
  - Глобальный модуль.

- **`backend/src/modules/ingest/`** — универсальный ingest pipeline:
  - `ingest.service.ts` — `IngestService.ingest({tenantId, sourceId, ...})`:
    проверка Source/tenant/active, sha256 idempotencyKey, inline payload до
    10 MiB / S3-fallback, P2002-handling, enqueue в `core.raw-events`.
  - `adapters/meeting.adapter.ts` — `MeetingIngestAdapter.ingestMeeting(meetingId)`:
    читает `Meeting+Transcript+Participants+merged.json`, lazy-upsert
    дефолтного `Source(type=meeting, name='Встречи Z')`, payload =
    `{meetingId, type, title, participants, transcript.turns, roomChat}`.
  - `guards/ingest-token.guard.ts` — Bearer-токен из ENV `INGEST_INTERNAL_TOKEN`,
    timingSafeEqual.
  - `ingest.controller.ts` — `POST /api/v1/ingest` (под `IngestTokenGuard`,
    для внешних адаптеров) и `GET /api/v1/raw-events/:id` (под
    `CookieAuthGuard+TenantGuard`, только owner/admin Org).
  - DTO: `IngestEventDto`, `RawEventResponseDto`.
  - Глобальный модуль (нужен и в HTTP-side, и в WorkersModule).

- **`backend/src/modules/ai/workers/analyze.worker.ts`** — добавлен
  четвёртый параллельный вызов в `Promise.allSettled` после `ai_ready`:
  `meetingIngest.ingestMeeting(meetingId)` (прямой await через адаптер).

Подробности: [[../01_projects/ingest-and-sources]].

## Knowledge-core модули (Фаза 2, 2026-05-10)

- **`backend/src/modules/knowledge-core/`** — `@Global` модуль:
  - `services/segment-builder.service.ts` — режет meeting-payload на
    скользящие окна сегментов.
  - `services/block-extraction.service.ts` — LLM-вызов `block-ingest`
    с JSON Schema strict.
  - `services/embedding.service.ts` — обёртка над `EmbeddingFallbackService`:
    `embedBlocks` / `embedEntityNames` / `embedQuery`.
  - `services/entity-resolution.service.ts` — findOrCreate Entity по
    `(tenantId, type, lower(canonicalName))` + embedding через
    `$executeRawUnsafe`.
  - `services/block-merge.service.ts` — KNN cosine top-5 + LLM-judge
    `block-distill` (verdict merge|distinct).
  - `services/entity-merge.service.ts` — KNN cosine top-5 + LLM-arbiter
    `entity-merge-arbiter` (с metadata + recentMentions[]).
  - `workers/block-ingest.worker.ts` — consumer `core.raw-events`,
    concurrency=2.
  - `workers/block-distill.worker.ts` — consumer `core.block-distill`,
    дебаунс 30s, concurrency=2.
  - `workers/entity-resolver.worker.ts` — consumer `core.entity-resolver`,
    concurrency=1.
  - `workers/entity-resolver.cron.ts` — `@Cron('*/5 * * * *')`,
    сканирует пары Entity и enqueue'ит, лимит 50 пар на тик.
  - `api/search.controller.ts` — `POST /api/v1/knowledge/search`.
  - `api/search.service.ts` — гибридный SQL (cosine + bm25, веса из ENV).
  - `api/blocks.controller.ts` — `GET /api/v1/knowledge/blocks/:id`.
  - `api/entities.controller.ts` — `GET /api/v1/knowledge/entities` +
    `GET /api/v1/knowledge/entities/:id`.
  - `prompts/block-ingest.prompt.ts` — JSON Schema, helpers, ENTITY/SIGNAL
    enum'ы.

- **`backend/src/modules/rbac/policies/policy.csv`** — добавлены ресурсы
  `block` и `entity` (read/write/delete для owner/admin, read для всех
  member'ов Org).

- **`backend/scripts/postgres-init.sql`** — pgvector HNSW индексы +
  generated `IdeaBlock.search_tsv` + GIN. Применяется через
  `bun run apply-postgres-init`.

Подробности: [[knowledge-core|knowledge-core.md]].

[[../index|← index]]
