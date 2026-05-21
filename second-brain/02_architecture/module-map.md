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

## Дельта Фаз 7–12 (closed 2026-05-10)

### `backend/src/modules/admin/` (Phase 7)
- `services/{admin-cache, admin-usage, admin-functions, admin-experiments, admin-prices, admin-orgs, admin-health, org-admin-knowledge}.service.ts` — Z-Admin + Org-Admin сервисы.
- `controllers/{admin-usage, org-admin-usage, admin-functions, admin-experiments, admin-prices, admin-orgs, admin-health, org-admin-knowledge}.controller.ts` + `admin-usage.csv.ts` (CSV-stream).
- `dto/{admin-usage, admin-experiments, admin-prices, admin-orgs, org-admin-knowledge}.dto.ts` — Zod.
- `super-admin.audit.interceptor.ts` — пишет `SuperAdminAccessLog`.

### `backend/src/modules/auth/guards/` (Phase 7)
- `super-admin.guard.ts` — проверяет `User.isSuperAdmin`.
- `org-admin.guard.ts` — проверяет `RbacService.canManageOrg` (owner/admin/super_admin).

### `backend/src/modules/core-queue/` (Phase 7)
- `worker-org-gate.ts` — `WorkerOrgGate.checkOrThrow(tenantId, workerName)` — общий хелпер для тумблеров `Org.workersEnabled`.

### `backend/src/modules/dashboard/` (Phase 8)
- `dashboard.module.ts`, `services/director-dashboard.service.ts`, `director-dashboard.controller.ts`, `dto/director-dashboard.dto.ts`, `prompts/dashboard-summary.prompt.ts`.
- `GET /api/v1/dashboard/director?period=week|month` под `RbacService.canViewDirectorDashboard`.

### `backend/src/modules/goals/` (Phase 9)
- `goals.module.ts`, `services/goals.service.ts`, `goals.controller.ts`, `dto/goals.dto.ts`.
- `RbacService.ResourceType` расширена `'goal'`. policy.csv: owner write/delete, admin/manager — read.

### `backend/src/modules/knowledge-core/workers/` (Phase 9, 11)
- `strategic-alignment.worker.ts` (concurrency 2) + `strategic-alignment.cron.ts` (`@Cron('0 4 * * *')`).
- `core-metrics-snapshot.cron.ts` (`@Cron('*/5 * * * *')`) — gauges `core_*`.
- `prompts/goal-alignment.prompt.ts`.

### `backend/src/modules/sources/` (Phase 10)
- `sources.module.ts`, `sources.service.ts`, `sources.controller.ts`, `dto/source.dto.ts`.
- `RbacService.ResourceType` расширена `'source'`. owner/admin write, manager read.

### `backend/src/modules/ingest/adapters/` (Phase 10)
- `telegram/{telegram.controller, telegram.service, telegram-config.schema}.ts`.
- `phone-call/{mango.controller, mango.service, mango-config.schema}.ts`.
- `email/{email-fetch.service, email-fetch.cron, imap-config.schema, ingest-email.module}.ts`.
- `web-form/{dump.controller, dump.service}.ts`.

### `backend/src/common/crypto/` (Phase 10)
- `crypto.service.ts` + `crypto.module.ts` (`@Global`) — AES-256-GCM на ENV `CRYPTO_MASTER_KEY`.

### `backend/src/modules/retention/` (Phase 11, расширение)
- `retention.service.ts` — `processAll()`, `processExpiredRawEvents/Blocks/Chat/Audit`.
- `retention.cron.ts` — переключён на `processAll`.
- `retention-policy.service.ts` — lazy upsert + `markSwept`.
- `retention-policy.controller.ts` — `GET/PATCH /api/v1/settings/retention`.

### `backend/src/modules/security/` (Phase 11)
- `personal-data-deletion.service.ts` — `eraseEntity` (idempotent).
- `personal-data.controller.ts` — `DELETE /api/v1/persons/:id/data`.
- `RbacService.ResourceType` расширена `'person'`, action `'erase'`.

### `backend/src/common/metrics/` (Phase 11)
- `business-metrics.service.ts` — gauges/counters/histograms `core_*`. Обёртки `setCoreBlocks`, `observeCorePipelineDuration`, `addCoreLlmTokens`, `incCoreErasure`, `incCoreRetentionDeleted`, `incCoreDataClassViolation`.

### `backend/src/modules/ai/services/llm-router.service.ts` (Phase 11)
- Расширение `call({taskType, dataClass?, ...})`. Фильтр провайдеров по `provider.maxDataClass >= dataClass`. На фейл — `NoEligibleProviderError` + инкремент метрики.
- Экспорт `ALL_LLM_TASK_TYPES` (Phase 7).

### `backend/src/modules/entitlements/` (Phase 12)
- `tier-config.ts` — реестр TIER_CONFIG (basic/pro/enterprise) + `FeatureKey/QuotaKey/TierKey` типы.
- `entitlement.service.ts` — Redis cache TTL 300s.
- `entitlement.guard.ts` + `require-entitlement.decorator.ts` — `APP_GUARD` global.
- `entitlements.controller.ts` — `/me/entitlements`, `/settings/billing`, `/admin/orgs/:id/entitlement`.

### Frontend (фазы 7–12)
- `frontend/app/(authenticated)/admin/*` — Z-Admin (8 страниц + AdminShell).
- `frontend/app/(authenticated)/settings/admin/*` — Org-Admin (4 страницы).
- `frontend/app/(authenticated)/dashboard/{DashboardRouter, DirectorDashboardClient}.tsx` + `widgets/StrategicAlignmentWidget.tsx`.
- `frontend/app/(authenticated)/goals/{page, GoalsClient, [id]/{page, GoalDetailClient}}.tsx`.
- `frontend/app/(authenticated)/settings/{sources, retention, billing}/*.tsx`.
- `frontend/app/(authenticated)/dump/{page, DumpClient}.tsx`.
- `frontend/app/(authenticated)/persons/*` (новый раздел) + двухстадийный диалог 152-ФЗ erase.
- `frontend/app/(authenticated)/admin/orgs/[id]/billing/*` — Z-Admin tier-управление.
- `frontend/src/contexts/entitlement-context.tsx` + `useEntitlement.ts` + `<TierGate>`.
- `frontend/src/ui/components/chat/OrgChatPanel.tsx` — общий компонент `/chat` и `/dashboard`.

### Удалено (Phase 7 fix)
- `frontend/app/(admin)/admin/page.tsx` (legacy home, дублировал новый Z-Admin dashboard).

## Фаза 0 — каркас компании

- `backend/src/common/graph/` — GraphService (Postgres EntityLink + AGE двойная запись).
- `backend/src/modules/departments/` — CRUD `/api/v1/departments`.
- `backend/src/modules/roles-domain/` — CRUD `/api/v1/roles` (бизнес-должности).
- `backend/src/modules/persons/` — CRUD `/api/v1/persons` (новый, не путать с knowledge-core entities/persons).
- `backend/src/modules/job-descriptions/` — CRUD `/api/v1/job-descriptions`.
- `backend/src/modules/skills/` — CRUD `/api/v1/skills`.
- `backend/src/modules/documents/` — CRUD `/api/v1/documents`.
- `backend/src/modules/role-profiles/` — `/api/v1/role-profiles` (rebuild stub до 0d).
- `backend/src/modules/structure/` — `/api/v1/structure/summary`.
- `backend/src/modules/ingest/adapters/document/` — document.adapter.
- `backend/src/modules/ingest/adapters/text/` — text.adapter.
- `backend/src/modules/ingest/parsers/document-parser.service.ts`.
- `backend/src/modules/knowledge-core/workers/role-profile.worker.ts` (Фаза 0d).

[[../index|← index]]
