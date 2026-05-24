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

## SBA α-1 — Conversational Channels Foundation (2026-05-21)

`backend/src/modules/conversational/` — `@Global` модуль omnichannel-слоя:
- `conversational.service.ts` — публичный API `sendNotification` / `respondToProbe` / `linkChannel` / `listMyNotifications` + routing (per-event policy + dataClass + preferences + quiet hours).
- `conversational.controller.ts` — REST `/api/v1/me/channels` и `/api/v1/me/notifications` (включая `POST /respond`, `POST /dismiss`, `POST /read`, `POST /free-note`).
- `channel-registry.ts` — реестр адаптеров каналов, заполняется через `@Injectable() + onModuleInit()`.
- `adapters/in-app.adapter.ts` — канал `in_app` (БД-резидент, без external transport).
- `adapters/email-smtp.adapter.ts` — outbound через общий `MailService`.
- `adapters/conversational-ingest.adapter.ts` — free-note → `RawEvent(Source.type='conversational')` через `IngestService`.
- `link-code.service.ts` — одноразовые коды привязки (Redis, TTL 10 мин).
- `queue/conversational-queue.service.ts` + `conversational-send.worker.ts` — BullMQ-очередь `conversational.send` (concurrency + retry с exp backoff).
- `types/event-payload.registry.ts` — Zod-схемы payload'ов per-eventType (`probe.question`, `curation.pending`, `system.message`); потребители могут регистрировать новые через `registerEventPayloadSchema`.
- `types/preferences.schema.ts` — `ChannelBindingPreferences` (quietHours, eventType allow/deny, rateLimitPerHour, disabledUntil).

Frontend:
- `frontend/src/api/conversational.api.ts` — REST-клиент.
- `frontend/src/domain/conversational.ts` — мапперы ApiDto → Domain.
- `frontend/app/(authenticated)/me/channels/` — страница «Мои каналы» (привязка/отвязка, генерация link-code).
- `frontend/app/(authenticated)/me/notifications/` — центр уведомлений (master-detail, respond/dismiss, free-note форма).

Подробности: [[../01_projects/conversational-channels|conversational-channels.md]].

## SBA β-1 — Channels Telegram + MAX adapters (2026-05-22)

Расширение conversational-слоя α-1 двумя внешними каналами (без правки α-1).

`backend/src/modules/conversational/adapters/telegram-bot/`:
- `telegram-bot.adapter.ts` — `IChannel`-адаптер (`send`/`ingestUpdate`/`parseResponse`).
- `telegram-api-client.ts` — thin client Bot API + per-second throttle (Redis-bucket, `cfg.telegramBot.globalRps`).
- `telegram-webhooks.controller.ts` — `POST /api/v1/webhooks/telegram-bot/:tenantId` с `X-Telegram-Bot-Api-Secret-Token` timing-safe verify.
- `telegram.types.ts` — типизированный subset Telegram Bot API.
- `telegram-bot.adapter.spec.ts` — unit-тесты (/link ok/fail, /ask, callback_query, voice, /status, незалинкованный юзер).
- `SMOKE.md` — ручной smoke для прода.

`backend/src/modules/conversational/adapters/max-bot/` — параллельная реализация MAX (api `https://platform-api.max.ru`). Secret в path (MAX не передаёт header).

`backend/src/modules/conversational/command-handler.service.ts` — подписан на `subscribeInbound('command')`, отвечает на `/status` / `/myideas` / `/help` через `sendNotification(eventType='system.message', preferredChannelKinds=[bindingKind], critical=true)`.

Setup-scripts (CLI-флаги, idempotent, шифруют секреты совместимо с `CryptoService`):
- `backend/scripts/setup-telegram-bot.ts` (`bun run setup:telegram-bot -- ...`).
- `backend/scripts/setup-max-bot.ts` (`bun run setup:max-bot -- ...`).

Расширения:
- `InboundMessage` в `types/channel.types.ts` — добавлен 4-й тип `command` + `originChannelBindingId?` у всех типов.
- `env.schema.ts` — `TELEGRAM_BOT_API_BASE` / `TELEGRAM_BOT_GLOBAL_RPS` / `MAX_BOT_API_BASE` / `MAX_BOT_GLOBAL_RPS`.
- `TypedConfigService` — геттеры `cfg.telegramBot.*` / `cfg.maxBot.*`.
- `BusinessMetricsService` — `telegram_bot_api_errors_total`, `telegram_bot_webhook_received_total`, `max_bot_api_errors_total`, `max_bot_webhook_received_total`.
- `ConversationalModule` зарегистрировал 2 контроллера webhook'ов и 5 новых providers.

Подробности: [[../01_projects/conversational-channels|conversational-channels.md]] (раздел β-1).

## SBA α-3 — Layer 2 Ontology Extension (2026-05-21)

Расширение Слоя 2 knowledge-core: онтология `Entity.type` 7 → 12, две новые модели категории A, RouterService для диспатча атомов в специалистов Слоя 3.

**Изменения схемы:**
- `enum EntityType` дополнен 6 значениями: `customer` (renamed from `client`), `vendor`, `document`, `goal`, `event`, `technology`, `metric`. Старые `client` и `custom` помечены deprecated — удалить в следующем релизе (Postgres не поддерживает DROP VALUE напрямую).
- `enum PersonRelationship` (employee | external | candidate | former), `enum VendorSegment`, `enum VendorStatus`, `enum EventKind`.
- `model Vendor` (`backend/prisma/schema.prisma`) — поставщик с `entityId` 1:1 на Entity{type=vendor}. Дедуп по `inn` (юр.лицо) с fallback на name.
- `model Event` — событие графа знаний (kind: meeting/incident/release/transition/milestone/other) с `entityId` 1:1. Дедуп по `(tenantId, title, startAt ±1 день)`.
- `Person.relationship` — `external` по умолчанию; patch-script проставляет `employee` тем, у кого есть Membership.
- `Goal.entityId?` / `Document.entityId?` — линковка с графом.
- `Card.kind` принимает строку `vendor` (без enum-миграции).

**Новые модули backend:**
- `backend/src/modules/vendors/` — read-only API `/api/v1/vendors` (list + getById). Полный CRUD — α-6.
- `backend/src/modules/events/` — read-only API `/api/v1/events`. RBAC ResourceType — `event_card` (чтобы не конфликтовать с доменными событиями).
- `backend/src/modules/knowledge-core/services/router.service.ts` — `RouterService.dispatch(block)`: статический mapping `signalType → specialistName` (decisions / regulations / insights / ideas / skill / project-customer / knowledge-clone). Анти-fan-out через `ROUTER_MAX_SPECIALISTS_PER_BLOCK` (default 4). Публикует jobs в BullMQ-очередь `core.specialist-routing` (consumer'ы появятся в α-6 / α-7 / β-2 / β-3 / γ-1).

**EntityResolutionService extension:**
- `findOrCreateVendorEntity({tenantId, name, inn?})` — приоритет дедупа по `inn`, fallback на name.
- `findOrCreateEventEntity({tenantId, title, startAt, kind?, relatedMeetingId?})` — дедуп по time-window.

**Hook в `block-ingest.worker.ts`:** после persist'а всех блоков вызывается `routerService.dispatch(block)` для каждого блока (best-effort, не валит pipeline).

**RBAC:** `vendor`, `event_card` ResourceType (owner/admin: read/write/delete, manager: read).

**Patch-скрипты** (backend/scripts/, все idempotent + `--dry-run`):
- `patch-rename-client-to-customer.ts` — `UPDATE Entity SET type='customer' WHERE type='client'`.
- `patch-backfill-entity-id-person.ts` / `-goal.ts` / `-document.ts` — backfill `.entityId` (батч 1000).
- `patch-person-relationship.ts` — Person.relationship='employee' для тех, у кого есть Membership.

Frontend:
- `frontend/src/api/vendors.api.ts` + `events.api.ts` — REST-клиенты.
- `frontend/app/(authenticated)/vendors/` + `/events/` — read-only страницы (master-list).
- Sidebar пополнен пунктами «Поставщики» и «События».

Подробности: [[knowledge-core|knowledge-core.md]] §Layer 2.

## SBA α-4 — Layer 4 Curation Foundation (2026-05-21)

Слой 4 контроля качества карточек специалистов: triage (auto/light/deep), per-domain кураторы, multi-touch UI, conflict-as-first-class, версионность.

**Изменения схемы (`backend/prisma/schema.prisma`):**
- Enum'ы: `CurationLevel` (light | deep), `CurationItemStatus` (pending | decided | expired | cancelled), `CurationDecisionType` (approve | reject | approve_with_edits | split | merge | supersede), `ConflictStatus` (open | resolved | dismissed), `ConflictResolution` (accept_new | keep_old | merge | evolving).
- `model CurationItem` — запись в очереди проверки: `tenantId / resourceType / resourceId / level / triageReason / proposedPayload / status / assignedToUserId / candidateCuratorIds[] / expiresAt`.
- `model CurationDecision` — решение куратора: `decisionType / payload / reasoning / reviewerUserId`.
- `model ConflictItem` — first-class конфликт между карточками: `resourceType / existingId / newId / evidence / relationType / detectedBy / status / resolution / evolvingMeta / resolvedByUserId / reasoning`. Решение №13.1 — `CardVersion` общая таблица для всех типов карточек.
- `model CardVersion` — версии карточек (общая таблица): `tenantId / resourceType / resourceId / version / previousVersionId / payload / changeReason / createdByUserId / curationDecisionId / curationItemId`. Unique `(resourceType, resourceId, version)`.
- `model CuratorAssignment` — назначение кураторов: `tenantId / resourceType / criteria? / curatorUserIds[] / level?`.
- `Org.curationSettings Json?` — org-настройки triage'а (autoThreshold / deepReviewThreshold / criticalTypes / itemExpiryDays). Если null — ENV-defaults.

**Новый модуль `backend/src/modules/curation/`:**
- `services/curation.service.ts` — публичный API `CurationService.triage(input)` для специалистов Слоя 3 + `decide / listQueue / getItemById / getSettings / updateSettings`. Три ветки triage: auto (CardVersion v1) / light (CurationItem + probe) / deep (+ system.message эскалация).
- `services/conflict.service.ts` — `ConflictService.report(input)` (идемпотентный) + `resolve / dismiss / list / getById`. Resolution `evolving` требует `evolvingMeta.{existingValidUntil, newValidFrom}`.
- `services/curator-routing.service.ts` — выбор кандидатов-кураторов по `CuratorAssignment` (точное → universal level=null → wildcard `*` → fallback owner/admin Org).
- `workers/card-stale-detector.cron.ts` — ежедневный (4:00) проход по `CardVersion`: версии старше N мес. → CurationItem(level='light', triageReason.reason='stale') + probe владельцу через `ConversationalService.sendNotification` (eventType='system.message'). Решение №13.2 — отдельный cron (не в reframing).
- `curation.controller.ts` — REST API `/api/v1/curation/queue|items/:id|items/:id/decide|conflicts|conflicts/:id|conflicts/:id/resolve|conflicts/:id/dismiss` + `/api/v1/settings/curation` (GET/PATCH).

**Probe через ConversationalService:**
- Light review → `eventType='curation.pending'` (схема уже зарегистрирована в α-1).
- Deep review → дополнительная `eventType='system.message'` со severity='warning'.
- При резолюции конфликта → нотификация всем candidateCuratorIds связанных CurationItem'ов.

**Интеграция в block-linker:** в `block-linker.worker.ts` после создания `IdeaBlockLink.relationType='contradicts'` с `confidence >= 0.85` — вызов `ConflictService.report({detectedBy: 'block-linker', resourceType: 'idea_block', evidence: {blockIds, relationType, confidence, explanation}})`. Best-effort: ошибка не валит link-job.

**RBAC (`backend/src/modules/rbac/policies/policy.csv`):**
- `curation_item` — owner/admin: r/w/d; manager: read/write self.
- `curation_decision` — owner/admin: r/w; manager: r/w self.
- `conflict_item` — owner/admin: r/w/d; manager: read.
- `card_version` — все member'ы Org: read (write только через CurationService).
- `curator_assignment` — owner/admin only.

**Метрики (`BusinessMetricsService`):** `curation_items_total{resource_type, level, status}`, `curation_decision_total{decision_type, level}`, `curation_time_to_decide_seconds{level}` (histogram), `curation_auto_canonical_total{resource_type}`, `curation_conflicts_total{relation_type, resolution}`, `curation_stale_detected_total{resource_type}`.

**ENV (через `TypedConfigService.curation`):** `CURATION_AUTO_THRESHOLD_DEFAULT=0.85`, `CURATION_DEEP_REVIEW_THRESHOLD_DEFAULT=0.6`, `CURATION_CRITICAL_TYPES_DEFAULT=regulation,process,decision`, `CURATION_ITEM_EXPIRY_DAYS=30`, `CARD_STALE_DETECTOR_CRON='0 4 * * *'`, `CARD_STALE_MONTHS_THRESHOLD=6`, `CARD_STALE_DYNAMIC_SCORE_THRESHOLD=0.3`.

**Frontend:**
- `frontend/src/api/curation.api.ts` — REST-клиент.
- `frontend/src/domain/curation.ts` — DomainModel + русские лейблы.
- `frontend/app/(authenticated)/curation/` — master-detail UI очереди с фильтрами (level/status/resourceType/assignedToMe), payload-viewer, кнопками decision (approve/reject/edit/split/merge/supersede), inline-резолвером конфликтов (включая `evolving` с двумя date-pickers).
- `frontend/app/(authenticated)/settings/curation/` — слайдеры порогов, список критических типов, expiry days. Доступно owner/admin (RBAC `curator_assignment`).
- `frontend/src/ui/components/curation/CurationBanner.tsx` — задел для inline-виджета на странице карточки. Подключение — в sub-TZ Слоя 3 (α-6/α-7/...).
- Виджет «На проверке у меня» на `/dashboard` (`widgets/CurationPendingWidget.tsx`).

**Что отложено:** LLM-арбитр `curation-conflict-suggest-resolution` (sub-TZ §11, §13.5; TODO в `ConflictService.resolve`). Реальная пометка `status='stale'` карточек специалистов (CardStaleDetectorCron создаёт CurationItem, но не трогает источники — это работа специалистов δ+).

Подробности: [[../01_projects/curation|01_projects/curation.md]].

## SBA α-5 — Layer 5 Chat-v2 Omnichannel (2026-05-22)

AI-чат компании поверх knowledge-core, с conversation history и omnichannel inbound/outbound через α-1 каналы.

**Изменения схемы (`backend/prisma/schema.prisma`):**
- Enum'ы: `ChatV2Scope` (org | meeting | card | theme | entity | personal), `ChatV2MessageRole` (user | assistant), `ChatV2Mode` (factual | synthetic | clone_style), `ChatV2ConversationStatus` (active | archived).
- `model ChatV2Conversation` — диалог: `tenantId / userId / title / scope / scopeRefId / channelKindOrigin / status / pinnedAt / createdAt / updatedAt`. Индексы: `(tenantId, userId, updatedAt)`, `(tenantId, status)`. Cascade на User/Org.
- `model ChatV2Message` — сообщение: `conversationId / role / mode? / text / citations Json? / retrievalMeta Json? / llmMeta Json? / createdAt`. Индекс `(conversationId, createdAt)`.
- Обратные relations в `User.chatV2Conversations` и `Org.chatV2Conversations`.

**Новый модуль `backend/src/modules/chat-v2/`:**
- `chat-v2.service.ts` — `ChatV2OrchestrationService.ask(input)` — главный entry-point: создаёт conversation если нет, append user message, загружает history, вызывает SynthesisService, append assistant message, генерирует title после первого раунда. Возвращает `{conversationId, messageId, text, citations, uncertaintyNote, mode}`.
- `services/synthesis.service.ts` — `SynthesisService.synthesize(...)` — тонкая обёртка над `ChatV2Service` из knowledge-core. Пробрасывает history; для mode='synthetic' проверяет открытые `ConflictItem` в Org и добавляет `uncertaintyNote`; для mode='clone_style' возвращает synthetic + пометку «(γ-1)».
- `services/conversations.service.ts` — `ChatV2ConversationsService` — CRUD + `generateTitle` (taskType `chat-v2-conversation-title`) + pin/archive.
- `services/card-specialist-registry.service.ts` — `CardSpecialistRegistry` (push-pattern) — pluggable реестр специалистов для извлечения карточек по запросу. На α-5 пустой; первая регистрация — в α-6 (Card-специалист).
- `prompts/chat-v2-synthesize.prompt.ts` — TODO-placeholder для mode-prompts (на α-5 LLM-вызов идёт через knowledge-core с встроенным BASE_SYSTEM_PROMPT).
- `prompts/chat-v2-conversation-title.prompt.ts` — короткий title (3-7 слов).
- `workers/chat-v2-cleanup.cron.ts` — `@Cron('0 3 * * 0')` авто-архив диалогов без активности > 90 дней (TTL из `cfg.chatV2.conversationTtlDays`), `pinnedAt IS NULL`.
- `chat-v2.controller.ts` — REST API `/api/v1/chat-v2/messages | conversations | conversations/:id | conversations/:id/pin | conversations/:id/archive`. CookieAuthGuard + TenantGuard.
- `dto/chat-v2.dto.ts` — Zod-schema для всех эндпоинтов. `asOf` → 501 (temporal queries отложены до завершения α-4 evolving).

**Расширение `ConversationalService` (SBA α-1):**
- `sendChatReply(args)` — outbound chat-ответ: создаёт `Notification(eventType='chat.answer')`, при наличии `originChannelBindingId` — приоритет тому же каналу, иначе работает по `EVENT_TYPE_CHANNEL_POLICY['chat.answer']`.
- `InboundMessage.chat_query` расширен полем `originChannelBindingId?: string` (id binding'а, через который пришёл вопрос).
- `event-payload.registry.ts` — зарегистрирован `chat.answer` payload schema (`conversationId / messageId / text / citationsCount / mode? / uncertaintyNote?`).
- `EVENT_TYPE_CHANNEL_POLICY['chat.answer'] = ['in_app', 'telegram_bot', 'max_bot', 'email_smtp']`.

**Omnichannel pipeline:**
- `ChatV2OmnichannelBridge` (внутри `ChatV2Module`, `onModuleInit`) — подписан на `ConversationalService.subscribeInbound('chat_query')`. Любое сообщение `chat_query` через любой канал → `ChatV2OrchestrationService.ask(...)` → `ConversationalService.sendChatReply(...)` обратно через тот же канал (если задан `originChannelBindingId`).

**RBAC (`backend/src/modules/rbac/policies/policy.csv`):**
- ResourceType `chat_v2_conversation` — owner/admin Org: read на всё (для отладки), write/delete только self. manager: read/write/delete self. super_admin — bypass.

**LLM TaskType'ы:**
- Существующий `chat-v2` (засеян в `seed-llm-task-routes-knowledge-core.ts`) — основной synthesis.
- Новые: `chat-v2-conversation-title` (короткий title диалога), `chat-v2-cite-select` (резерв на пост-обработку цитат, на α-5 не используется). Seed: `backend/scripts/seed-llm-task-routes-chat-v2.ts` — тройная цепочка `deepseek-flash → openai-via-proxy gpt-5.4-mini → ollama qwen3.5:9b`.

**Метрики (`BusinessMetricsService`):** `chat_v2_queries_total{mode, channel_origin}`, `chat_v2_retrieval_blocks{mode}` (histogram), `chat_v2_synthesis_duration_seconds{mode}` (histogram), `chat_v2_no_evidence_total{mode}`, `chat_v2_uncertainty_marked_total{mode}`, `chat_v2_conversations_archived_total{reason}`.

**ENV (через `TypedConfigService.chatV2`):** `CHAT_V2_HISTORY_MESSAGES=6`, `CHAT_V2_CONVERSATION_TTL_DAYS=90`, `CHAT_V2_CLEANUP_CRON='0 3 * * 0'`, `CHAT_V2_DEFAULT_MODE=synthetic`.

**Frontend:**
- `frontend/src/api/chat-v2.api.ts` — REST-клиент.
- `frontend/src/domain/chat-v2.ts` — DomainModel + русские лейблы scope/mode/status + хелпер `formatTimestamp`.
- `frontend/app/(authenticated)/chat-v2/` — master-detail UI: список диалогов слева (фильтр active/archived, pinned вверху), thread + input справа, citations inline-bubbles.
- `frontend/src/ui/components/chat-v2/ChatPanel.tsx` — лёгкий компонент для встраивания на других страницах (single-question UX).
- Legacy `frontend/app/(authenticated)/chat/ChatClient.tsx` — баннер «Доступна новая версия — попробовать /chat-v2», сам chat не тронут.

**Решения по открытым вопросам sub-ТЗ §14:**
1. Новый модуль `chat-v2/`, legacy `chat/` помечен `@deprecated` (не удалён).
2. `CardSpecialistRegistry` — push (специалисты регистрируются сами в `onModuleInit`).
3. Conversation TTL = 90 дней по `updatedAt`, `pinnedAt` исключает; archive (не delete).
4. Streaming SSE отложен на β.
5. `asOf` (temporal) → 501 NotImplemented до завершения α-4 evolving.

**Что отложено:** mode-specific system prompts (на α-5 LLM-call идёт через knowledge-core с базовым BASE_SYSTEM_PROMPT), реальная clone_style (γ-1), полный CardSpecialistRegistry pipeline (первые регистрации в α-6+), streaming SSE, temporal asOf.

**Влияние на legacy chat:** `backend/src/modules/chat/` помечен `@deprecated` в JSDoc контроллера и модуля. Endpoints `/api/v1/chat`, `/api/v1/meetings/:id/chat`, `/api/v1/cards/:id/chat`, `/api/v1/chat/v2` продолжают работать. Frontend `/chat` показывает баннер про `/chat-v2`, сам UI не тронут.

Подробности: [[../01_projects/chat-v2|01_projects/chat-v2.md]].

---

## SBA α-6 — Specialist 3.4 (Project / Customer Context) — эталонный референс контракта специалиста (2026-05-22)

Первая полная реализация единого §5 контракта специалиста Слоя 3 (см. зонтичное ТЗ). Остальные 6 специалистов Слоя 3 (`3-1-regulations`, `3-2-knowledge-clone`, `3-3-decisions`, `3-5-insights`, `3-6-ideas`, `3-7-skill`) построят по тому же паттерну. Это рефакторинг существующего `card-rollup-v2.worker` + расширение под `Card.kind='vendor'`.

**Изменения схемы (`backend/prisma/schema.prisma`):**
- `model Card` — добавлены поля:
  - `sourceBlockIds String[]` — блоки-источники последнего rollup'а (для citations chat-v2).
  - `confidence Decimal? @db.Decimal(4,3)` — уверенность последнего LLM-rollup'а.
  - `currentVersionId String?` + relation `currentVersion → CardVersion` — текущая опубликованная версия (для истории изменений и corretness нумерации в triage).
  - `personSubjectIds String[]` — Person.id, кому Card присваивается как subject (γ-1 SkillProfile).
  - `lastConfirmedAt DateTime?` — последнее подтверждение карточки (для stale-detection из α-4 и probe `card.outdated_summary`).
- `model CardVersion` — обратное relation `cardsAsCurrent Card[] @relation("CardCurrentVersion")`.

**Новый воркер `Specialist34ProjectCustomerWorker` (`backend/src/modules/knowledge-core/workers/specialist-3-4-project-customer.worker.ts`):**
- Consumer очереди `core.specialist-routing`, jobName-фильтр `'3-4-project-customer'`.
- Логика: загрузить блок → найти entities типа customer/vendor/project/product/client → найти Card'ы с этими entityIds (по `Card.entityId` или `Card.relatedEntityIds`) → enqueue `CardRollupV2` (дебаунс 60s) на каждую затронутую карточку.
- Воркер сам Card не обновляет; всё делает `CardRollupV2Service.buildRollup`.
- Concurrency=2; идемпотентность через jobId='3-4-project-customer_<blockId>' (из RouterService).

**Рефакторинг `CardRollupV2Service` (`backend/src/modules/knowledge-core/services/card-rollup-v2.service.ts`):**
- Зависимости: `CurationService`, `ConflictService`, `BusinessMetricsService`, `Specialist34ProbeService` (новые).
- После LLM-rollup'а:
  1. Собирается `proposedPayload` = `{summaryCache, kind, name, entityId, sourceBlockIds, cachedTopThemeIds, personSubjectIds, confidence}`.
  2. Вызывается `CurationService.triage({resourceType:'card', resourceId, proposedPayload, confidence})`.
  3. На `auto` — Card обновляется (`summaryCache`, `summaryUpdatedAt`, `cachedTopThemeIds`, `sourceBlockIds`, `confidence`, `currentVersionId`, `personSubjectIds`, `lastConfirmedAt`). `CardVersion(version=next, changeReason='auto-rollup')` создаётся внутри triage.
  4. На `light` / `deep` — Card НЕ обновляется до approve; обновляется только `summaryUpdatedAt` (чтобы дебаунс не повторял ту же ошибку).
  5. Conflict detection: regex-эвристика «активный ↔ закрыт» между старым и новым summary → `ConflictService.report(relationType='contradicts')`.
- Промпты вынесены в `prompts/card-rollup-v2.prompts.ts` (6 kinds: client/deal/project/topic/custom/vendor). Vendor — новый для α-3. Все промпты placeholder с `// TODO(owner-product): согласовать текст промпта`.
- `Card.confidence` пока хардкод `CARD_ROLLUP_V2_DEFAULT_CONFIDENCE=0.9` (выше autoThreshold=0.85), пока промпт не вернёт JSON Schema с явной confidence.

**Новый `Specialist34ProbeService` (`backend/src/modules/knowledge-core/services/specialist-3-4-probe.service.ts`):**
- 4 probe-trigger'а из §5.4 контракта:
  1. `card.missing_owner` — Card.kind ∈ {client,vendor,project} И Membership owner-creator не активен → notify admin'ов Org.
  2. `card.missing_deadline` — Card.kind='project' И в summaryCache нет «дедлайн/deadline/milestone/срок» И age > 7d → notify card.ownerId.
  3. `card.merge_suggestion` — найдены 2+ Card одного `entityId` в одной Org → notify admin'ов Org.
  4. `card.outdated_summary` — `lastConfirmedAt` старше 6 месяцев И за последнюю неделю появились свежие IdeaBlock'и по entityIds → notify card.ownerId.
- Отправка через `ConversationalService.sendNotification` с `eventType='specialist.probe'`. Best-effort: один упавший probe не валит остальные.

**Регистрация `Specialist34CardHandler` в `CardSpecialistRegistry`:**
- `Specialist34Module` (`backend/src/modules/knowledge-core/specialist-3-4.module.ts`) импортируется в `AppModule` ПОСЛЕ `ChatV2Module`.
- `Specialist34CardHandler.onModuleInit` вызывает `registry.register('3-4-project-customer', this)`.
- `getCardsForQuery({tenantId, query, candidateBlockIds, limit})` — два сигнала релевантности:
  1. `Card.sourceBlockIds hasSome candidateBlockIds` (overlap-score).
  2. `Card.entityId ∈ entities блоков` или `relatedEntityIds hasSome` (boost 0.5).
- Score = overlap-count + boost; confidence от Card.confidence + малый overlap-bonus (max +0.1).

**Probe event schema (`backend/src/modules/conversational/types/event-payload.registry.ts`):**
- Зарегистрирован `specialist.probe`: `{specialistName, reason, message, suggestedActions[]?, cardId?, blockIds[]?, actionUrl?}` (Zod strict).
- `EVENT_TYPE_CHANNEL_POLICY['specialist.probe'] = ['in_app', 'email_smtp']` — telegram/max не используем (это не вопрос, а подсказка).

**Метрики (`BusinessMetricsService`):**
- `core_specialist_cards_total{type, status}` (gauge) — replaceable label `type`: card/regulation/decision/insight/idea/skill/knowledge_clone.
- `core_specialist_pipeline_duration_seconds{type}` (histogram, buckets 0.5..300s).
- `core_specialist_llm_tokens_total{type, model, tier}` (counter) — tier=primary/secondary/tertiary.
- `core_specialist_probe_events_total{type, reason}` (counter).
- `core_specialist_conflict_events_total{type}` (counter).

**LLM seed (`backend/scripts/seed-llm-task-routes-knowledge-core.ts`):**
- `card-rollup-v2` — теперь три уровня согласно §5.11: primary deepseek-v4-flash, secondary openai-via-proxy/gpt-5.4-mini, tertiary ollama qwen3:30b. Verified-карта моделей: [[../01_projects/llm-providers-verified|01_projects/llm-providers-verified.md]].

**Patch-script `backend/scripts/patch-backfill-card-versions.ts`:**
- Для каждой Card с `summaryCache != null` и `currentVersionId IS NULL` создаёт `CardVersion(version=1, payload={summaryCache, kind, name, entityId, cachedTopThemeIds, sourceBlockIds}, changeReason='initial-backfill')` и проставляет `Card.currentVersionId`.
- Идемпотентно (фильтр по `currentVersionId IS NULL`). Батч 500. Поддерживает `--dry-run`. Карточки с `tenantId=NULL` (legacy) пропускаются.
- Команда: `bun run patch:backfill-card-versions`.

**Frontend:**
- `frontend/app/(authenticated)/cards/[id]/CardDetailClient.tsx` — встроен `<CurationBanner resourceType="card" resourceId={card.id} />` после header, перед Tabs.

**Legacy:**
- `backend/src/modules/ai/workers/card-rollup.worker.ts` — добавлен JSDoc `@deprecated SBA α-6 — используйте CardRollupV2Worker`. Удаление — отдельный sub-TZ в β/γ.

**Решения по открытым вопросам sub-ТЗ §12:**
1. **Старый `card-rollup.worker`** — оставлен параллельно (только @deprecated JSDoc), удаление отдельным sub-TZ.
2. **Migration существующих Card.summaryCache** — patch-script `patch-backfill-card-versions.ts` (batch 500, idempotent, `--dry-run`).
3. **Card.kind='custom'** — оставили, не ломаем; промпт `card-rollup-v2-custom` сохранился, новый `vendor` добавлен отдельно.

**Что отложено:**
- LLM confidence от промпта (требует переход к JSON Schema output) — пока хардкод 0.9.
- LLM-арбитр конфликтов (по §11 sub-TZ зонтичного — задача β-).
- Embedding-search в `Specialist34CardHandler` (β-2).
- `Card.metadata.ownerUserId` для назначенного ответственного (β-/γ-) — сейчас эвристика по Membership creator'а.

Подробности: [[../01_projects/specialist-3-4-project-customer|01_projects/specialist-3-4-project-customer.md]].

---

## SBA α-7 — Specialist 3.1 (Regulations) — первая видимая ценность Слоя 3 (2026-05-22)

Третий специалист Слоя 3 после α-6 (Specialist 3.4) — закрывает три из 5 уровней «каркаса компании» Фазы 0b: **Регламенты, Процессы, Политики** (Standard = Regulation.category='standard'). Построен по эталонному §5-контракту α-6.

**Изменения схемы (`backend/prisma/schema.prisma`):** in-place расширение existing моделей Phase 0b (НЕ создаём новую таблицу `Regulation` с `kind` — см. решение §14.1):
- `model Process` — добавлены `entityId`, `scope`, `currentVersionId`, `sourceBlockIds`, `personSubjectIds`, `dataClass`, `embedding (vector(1536))`, `lastConfirmedAt`, `inputs`, `outputs`, `metricsJson`. Relation `currentVersion → CardVersion`.
- `model Regulation` — добавлены `entityId`, `statement`, `scope`, `ownerPersonId`, `supersedesId` (self-relation), `currentVersionId`, `sourceBlockIds`, `personSubjectIds`, `dataClass`, `embedding`, `lastConfirmedAt`.
- `model Policy` — добавлены `entityId`, `scope`, `ownerPersonId`, `currentVersionId`, `sourceBlockIds`, `personSubjectIds`, `dataClass`, `embedding`, `lastConfirmedAt`.
- `model Person` — обратные relations `ownedRegulations`, `ownedPolicies`.
- `model CardVersion` — обратные relations `processesAsCurrent`, `regulationsAsCurrent`, `policiesAsCurrent`.

**Новый воркер `Specialist31RegulationsWorker` (`backend/src/modules/knowledge-core/workers/specialist-3-1-regulations.worker.ts`):**
- Consumer `core.specialist-routing`, jobName-фильтр `'3-1-regulations'`.
- Загружает блок + evidence + entities, проверяет tenant+status='canonical'.
- По `signalType` ('regulation' / 'process_step') делегирует в `Specialist31Service`.
- Concurrency=2, jobId=`'3-1-regulations_<blockId>'` (из RouterService).

**Новый `Specialist31Service` (`backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts`):**
- LLM-extraction `regulation-extract` → JSON Schema strict: `{kind, name, statement, scope?, ownerHint?, severity?, category?, processStepHint?, confidence}`. 
- LLM-arbiter `regulation-dedupe` поверх KNN top-5 (cosine на embedding, fallback ILIKE) → `{decision: 'new'|'merge'|'extension'|'contradicts', targetId?}`.
- Upsert в нужную таблицу по `(tenantId, name)`. При `merge` — обогащение existing записи (statement, scope, ownerPersonId, sourceBlockIds, personSubjectIds, confidence).
- Single-step upsert ProcessStep по `processStepHint` из draft (если есть) — multi-step pass отложен.
- KNN: pgvector cosine raw SQL (с partial HNSW при наличии), fallback ILIKE по первым 2 словам.
- Embedding записи (best-effort) через `KnowledgeEmbeddingService.embedQuery` + `UPDATE table SET embedding = $1::vector`.
- `CurationService.triage({resourceType: 'regulation'|'process'|'policy'})` — все три в `CURATION_CRITICAL_TYPES_DEFAULT` → всегда deep review.
- При verdict='contradicts' — `ConflictService.report({relationType:'contradicts'})`.

**Новый `Specialist31ProbeService` (`backend/src/modules/knowledge-core/services/specialist-3-1-probe.service.ts`) — 4 trigger'а:**
1. `regulation.missing_owner` — active регламент/процесс/политика без ownerPersonId → admin'ы Org.
2. `regulation.process_no_steps` — Process без ProcessStep'ов → owner процесса + admin'ы.
3. `regulation.stale` — lastConfirmedAt > 6 мес AND есть свежие блоки из sourceBlockIds → owner + admin'ы.
4. `regulation.scope_unclear` — Regulation без scope, или Policy(mandatory/blocking) без scope → admin'ы.

Отправка через `ConversationalService.sendNotification({eventType:'specialist.probe'})` (та же payload schema, что зарегистрирована в α-6).

**Регистрация `Specialist31CardHandler` в `CardSpecialistRegistry`:**
- `Specialist31Module` импортируется в `AppModule` параллельно `Specialist34Module`.
- `getCardsForQuery` — overlap по `sourceBlockIds ∩ candidateBlockIds` для трёх таблиц (Regulation/Process/Policy) с type='regulation'/'process'/'policy'.

**Новые `LlmTaskType` (`backend/src/modules/ai/services/llm-router.service.ts`):**
- `regulation-extract`, `regulation-dedupe`, `process-steps-extract` — добавлены в union + `ALL_LLM_TASK_TYPES`.

**Промпты-placeholder (`backend/src/modules/knowledge-core/prompts/`):**
- `regulation-extract.prompt.ts` — system + user template + JSON Schema strict (4 kinds + processStepHint).
- `regulation-dedupe.prompt.ts` — system + user template (draft + candidates) + JSON Schema (decision/targetId/reasoning).
- `process-steps-extract.prompt.ts` — system + user template (process + blocks) + JSON Schema (массив шагов).
- Все три с `// TODO(owner-product): согласовать финальный текст промпта`.

**Seed-script `backend/scripts/seed-llm-task-routes-regulations.ts`:**
- 3 taskType × 3 tier цепочка: primary deepseek-v4-flash → secondary openai-via-proxy gpt-5.4-mini → tertiary ollama qwen3:30b. Verified-карта моделей: [[../01_projects/llm-providers-verified|01_projects/llm-providers-verified.md]] (smoke 2026-05-21).
- Idempotent + `--update-existing` флаг. Защита от перезаписи `editedByAdmin=true`.
- Команда: `bun run seed:llm-task-routes-regulations`.

**Метрики (`BusinessMetricsService`):**
- Reused: `core_specialist_*` с label `type='regulation'|'process'|'policy'`.
- Новый: `core_specialist_extraction_failures_total{type, reason}` — провалы LLM (reasons: `llm_error`, `json_parse`, `schema_validation`, `arbiter_skip`, `arbiter_json_parse`, `db_error`).

**REST API + DTO (`backend/src/modules/regulations/`):**
- `GET /api/v1/regulations?kind=&status=&scope=&q=&page=&limit=` — единый список со всех трёх таблиц (с фильтром kind агрегатор уходит в одну таблицу).
- `GET /api/v1/regulations/:id?kind=` — детальная карточка; для process — со steps.
- `GET /api/v1/regulations/:id/history?kind=` — CardVersion timeline.
- `POST /api/v1/regulations/:id/supersede` (owner/admin only) — пометить старую `deprecated`, новая получает `supersedesId`.
- `POST /api/v1/regulations/:id/confirm` — `lastConfirmedAt = now()`.
- Z-DTO через `nestjs-zod`, RBAC через existing `regulation`/`process`/`policy` ResourceType. Все ошибки на русском.

**Frontend:**
- `frontend/src/api/regulations.api.ts` — API-клиент (list/get/history/supersede/confirm).
- `frontend/src/domain/regulation.ts` — DomainModel + лейблы (Регламент/Процесс/Политика/Стандарт; Рекомендация/Обязательная/Критическая).
- `frontend/app/(authenticated)/regulations/{page.tsx,RegulationsListClient.tsx}` — master-detail с фильтрами kind/status/scope/search. Перенесён из coming-soon в активный раздел Sidebar'а.

**Решения по открытым вопросам sub-ТЗ §14:**
1. **§14.1 — отдельная таблица или Regulation.kind**: гибрид — оставляем 3 отдельные таблицы (Process+ProcessStep, Regulation, Policy), расширяем их in-place, UI/DTO агрегируют как единый список с фильтром `kind`.
2. **§14.2 — Standard**: `Regulation.category='standard'`.
3. **§14.3 — поглощение Phase 0b**: не переписываем block-ingest.worker; обогащаем legacy in-place через merge-арбитра. Никакого migration patch-script'а не нужно.
4. **§14.4 — process_steps**: на α-7 — single-step upsert из processStepHint в draft'е. Multi-step pass через отдельный `process-steps-extract` LLM-вызов — будущая итерация.

**Что отложено:**
- Multi-step extraction (полный `process-steps-extract` поверх группы блоков одного процесса).
- UI выбора Person для назначения owner (сейчас только heuristic name-match через ILIKE).
- Workflow approval-цепочки — γ+.
- Импорт регламентов из Confluence/Notion/SharePoint — отдельный sub-TZ в ε.

Подробности: [[../01_projects/regulations|01_projects/regulations.md]].

---

## SBA β-2 — Specialist 3.2 (Knowledge Clone) — фундамент SkillProfile γ-1 (2026-05-22)

Четвёртый специалист Слоя 3 (после α-6 / α-7). Закрывает «**что человек знает**» — факты, опыт, экспертизу. **3.2 ≠ 3.7**: γ-1 надстраивает SkillProfile поверх knowledgeProfile (что человек знает vs как он думает).

**Изменения схемы (`backend/prisma/schema.prisma`):** in-place расширение `model Person` тремя полями:
- `knowledgeProfile Json?` — структурированный кеш категорий + опыта (см. формат в `01_projects/knowledge-clone.md`).
- `lastProfileBuildAt DateTime?` — момент последнего успешного rebuild'а.
- `profileBuildVersion Int @default(0)` — версия профиля (инкремент при каждом rebuild'е).

**Очередь и job-data (`backend/src/modules/core-queue/queues.ts`):**
- `CORE_QUEUE_NAMES.KNOWLEDGE_CLONE_REBUILD = 'core.knowledge-clone-rebuild'`.
- `RebuildKnowledgeProfileJobData = {personId, tenantId, reason?}`.
- `CoreQueueService.enqueueRebuildKnowledgeProfile` — дебаунс через jobId `rebuild-knowledge-profile_<personId>` + `cfg.knowledgeClone.debounceMs` (60s default).

**Расширение `RouterService.matchSpecialists`:** для `signalType='fact'` теперь добавляется `'3-2-knowledge-clone'` (в дополнение к `'3-4-project-customer'`), если в блоке есть Person с `relationship='employee'` (через `hasEmployeeMention`). `signalType='knowledge_gap'` остаётся → KNOWLEDGE_CLONE как и было.

**Новые воркеры (`backend/src/modules/knowledge-core/workers/`):**
- `specialist-3-2-knowledge-clone.worker.ts` — consumer `core.specialist-routing`, jobName='3-2-knowledge-clone'. Для каждого упомянутого Person'а-сотрудника enqueue rebuild с debounce.
- `knowledge-clone-rebuild.worker.ts` — consumer `core.knowledge-clone-rebuild`. Вызывает `Specialist32Service.rebuildForPerson`. concurrency=1.
- `knowledge-clone-rebuild.cron.ts` — `@Cron('0 */6 * * *')`. Для каждой Org находит employee-Person'ов со свежей активностью за неделю и `lastProfileBuildAt > 6 ч назад` → enqueue rebuild.

**Новый `Specialist32Service` (`backend/src/modules/knowledge-core/services/specialist-3-2-knowledge-clone.service.ts`):**
- Загружает блоки Person'а через `IdeaBlockEntity` (Person.entityId, role∈['subject','mentioned'], block.status='canonical', `createdAt >= now - cfg.knowledgeClone.lookbackMonths`).
- Пропускает при < `cfg.knowledgeClone.minBlocksForProfile` (default 10).
- LLM-extraction `knowledge-clone-extract` → JSON Schema strict: `{categories[], experienceHighlights[]}`.
- При наличии старого профиля — LLM-merge `knowledge-clone-merge` со старым (decay устаревших категорий внутри промпта).
- Heuristic detection противоречий (старый «не знает X» vs новый «знает X» в одной категории) → `ConflictService.report({relationType:'contradicts', existingId=personId, newId=personId:next})`.
- `CurationService.triage({resourceType: 'knowledge_profile', confidence: weighted-avg, conflictSignal})` — `knowledge_profile` НЕ в `CURATION_CRITICAL_TYPES_DEFAULT` → auto-canonical при confidence ≥ 0.85.
- На `decision='auto'` → `Person.knowledgeProfile = serialized`, `lastProfileBuildAt = now()`, `profileBuildVersion++`. На `pending` — ждём решение куратора.

**Новый `Specialist32ProbeService` (`backend/src/modules/knowledge-core/services/specialist-3-2-probe.service.ts`) — 2 trigger'а:**
1. `knowledge.new_expertise_detected` — новая категория с confidence='high', не было в старом профиле → admin'ы Org.
2. `knowledge.contradiction_detected` — в одной категории появилось противоположное по смыслу высказывание → admin'ы Org.

Direct manager как первый получатель отложен — нет `Department.headPersonId` (или аналогичного поля «руководитель отдела») в schema.

**Регистрация `Specialist32CardHandler` в `CardSpecialistRegistry`:**
- `Specialist32Module` в `AppModule` после `ChatV2Module`.
- `getCardsForQuery` — простой substring-match query → имена категорий `knowledgeProfile.categories[].name`. Sample statements экспортируются для context'а. Embedding-based search — γ+.

**Новые `LlmTaskType`:** `knowledge-clone-extract`, `knowledge-clone-merge` (+ в `ALL_LLM_TASK_TYPES`).

**Промпты-placeholder (`backend/src/modules/knowledge-core/prompts/`):**
- `knowledge-clone-extract.prompt.ts` — system + user template + JSON Schema strict (categories[] с эмерджентными name + sampleStatements + experienceHighlights[]).
- `knowledge-clone-merge.prompt.ts` — system + user template (old + new draft + ISO now) + та же JSON Schema. Промпт описывает правила decay (>12 мес — удалить, 6–12 мес — понизить confidence).
- Оба с `// TODO(owner-product): согласовать финальный текст промпта`.

**Seed-script `backend/scripts/seed-llm-task-routes-knowledge-clone.ts`:**
- 2 taskType × 3 tier: primary deepseek-v4-flash → secondary openai-via-proxy gpt-5.4-mini → tertiary ollama qwen3:30b.
- Idempotent + `--update-existing`. Защита от перезаписи `editedByAdmin=true`.
- Команда: `bun run seed:llm-task-routes-knowledge-clone`.

**Метрики (`BusinessMetricsService`):**
- Reused: `core_specialist_*{type='knowledge_profile'}`.
- Новые: `knowledge_clone_categories_per_profile` (histogram, no labels), `knowledge_clone_profile_size_kb` (histogram, no labels).

**REST API + DTO (`backend/src/modules/knowledge-clone/`):**
- `GET /api/v1/me/knowledge-profile` — свой профиль (с цитатами).
- `GET /api/v1/persons/:id/knowledge-profile` — профиль другого Person. Owner/admin/self — с цитатами; manager — только сводка.
- `POST /api/v1/me/knowledge-profile/mark-wrong` — пометить категорию неверной → `CurationService.triage(conflictSignal='hard')` → `CurationItem level='deep'`.
- Z-DTO через nestjs-zod, все ошибки на русском.

**RBAC `policy.csv`** — новый ResourceType `knowledge_profile`:
- owner/admin: r/w/d.
- manager (open): r на всё.
- manager (strict): r self.
- Write идёт только через worker / mark-wrong → triage; ручного API write нет.

**Frontend:**
- `frontend/src/api/knowledge-clone.api.ts` — API-клиент (getMine/getByPerson/markWrong).
- `frontend/src/domain/knowledge-profile.ts` — DomainModel + лейблы confidence (низкая/средняя/высокая).
- `frontend/app/(authenticated)/me/knowledge-profile/{page.tsx,KnowledgeProfileClient.tsx}` — read-only список категорий + цитаты + кнопка «помечу неверным» + disabled-кнопка «попробовать клона».
- `frontend/app/(authenticated)/persons/[id]/knowledge-profile/{page.tsx,PersonKnowledgeProfileClient.tsx}` — то же для другого Person без mark-wrong.

**ENV:**
```
KNOWLEDGE_CLONE_REBUILD_CRON="0 */6 * * *"
KNOWLEDGE_CLONE_LOOKBACK_MONTHS=12
KNOWLEDGE_CLONE_DEBOUNCE_MS=60000
KNOWLEDGE_CLONE_MIN_BLOCKS_FOR_PROFILE=10
```

**Решения по открытым вопросам sub-ТЗ §13:**
1. **§13.1 — Json vs отдельная таблица KnowledgeCategory**: Json (один профиль читается целиком). Миграция в отдельную таблицу — γ+, если нужно «найди людей со знанием X» по DB-фильтру.
2. **§13.2 — кнопка «попробовать клона» в β-2**: disabled с tooltip «Доступно в γ-1 (SkillProfile)».
3. **§13.3 — применение профиля в chat-v2**: Да, через CardSpecialistRegistry text-match. Embedding-based — γ+.

**Что отложено:**
- β-2.13 (Dashboard widget «Топ-5 людей с богатыми профилями») — отложен.
- Direct-manager как первый получатель probe — отложен до появления `Department.headPersonId`.
- Embedding-based search в Specialist32CardHandler — γ+.
- Migration в отдельную таблицу KnowledgeCategory (для DB-фильтра «найди людей с навыком X») — γ+.

Подробности: [[../01_projects/knowledge-clone|01_projects/knowledge-clone.md]].

## SBA β-3 — Specialist 3.3 (Decisions Registry) — реестр решений (2026-05-22)

Четвёртый специалист Слоя 3. Закрывает самую ценную для бизнеса сущность — **Decision** («что мы решили + почему + альтернативы + результат»). Главный источник для β-4 Insights и γ-1 Skill.

**Prisma `Decision`** (расширение модели Фазы 0a in-place; legacy-поля `text`/`decidedByPersonId`/`sourceMeetingId`/`sourceIdeaBlockId`/`decidedAt` nullable для совместимости):
- Новые: `entityId?`, `statement?`, `rationale?`, `alternatives Json?`, `decidedByPersonIds[]`, `deadline?`, `status DecisionStatus`, `supersedesId?`, `affectsEntityIds[]`, `sourceBlockIds[]`, `personSubjectIds[]`, `confidence Decimal(4,3)?`, `dataClass DataClass @default(sensitive)`, `currentVersionId?`, `embedding vector(1536)?`, `validFrom?`, `validUntil?`, `actualOutcomes?`, `lastConfirmedAt?`.
- `DecisionStatus` enum расширен: `proposed | approved | rejected | implemented | cancelled | superseded` (+ legacy `active | rolled_back`).
- HNSW + generated tsvector `decision_search_tsv` + GIN на `affectsEntityIds` / `decidedByPersonIds` / `sourceBlockIds` — в `apply-postgres-init.sql`.

**Новый воркер `Specialist33DecisionsWorker` (`backend/src/modules/knowledge-core/workers/specialist-3-3-decisions.worker.ts`):**
- Consumer `core.specialist-routing` jobName='3-3-decisions'.
- jobName-фильтр, tenant-check, status='canonical', signalType ∈ {decision, rationale, decision_basis}.
- Concurrency=2.

**Новый `Specialist33Service` (`backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts`):**
- `processBlock` — единая точка входа.
- LLM `decision-extract` (с контекстом ±2 минуты тех же RawEvent для rationale).
- Резолв decidedByPersonIds (name-match с приоритетом employee) и affectsEntityIds (через `EntityResolutionService.findOrCreate` для customer/project/product/vendor; process — skip).
- KNN cosine top-5 + LLM `decision-supersede-detect` → verdict {new/merge/supersedes}.
- Apply: new — create; merge — update existing (alternatives merge case-insensitive, sourceBlockIds/decidedByPersonIds/affectsEntityIds union); supersedes — новый с `supersedesId` + старый помечается superseded + ConflictItem(evolving).
- Triage всегда deep review (`decision` в `CURATION_CRITICAL_TYPES_DEFAULT`).
- Embedding (best-effort raw SQL UPDATE).

**Новый `Specialist33ProbeService` (`backend/src/modules/knowledge-core/services/specialist-3-3-probe.service.ts`) — 5 trigger'ов:**
| Reason | Trigger | Получатели |
|---|---|---|
| `decision.missing_decider` | decidedByPersonIds[] пуст AND status=approved | участники исходной встречи (Meeting.Participants), fallback admins |
| `decision.no_deadline_critical` | status=approved AND deadline=null AND блок с тегом 'critical' | owner / admins |
| `decision.overdue` (cron) | deadline < now AND status не финальный | owner / admins |
| `decision.competing_versions` | KNN близкое + supersede неуверен (на β-3 не вызывается автоматически) | admins |
| `decision.outcome_unknown` (cron) | implemented + null outcomes + > 3 мес | owner / admins |

Cron `@Cron('0 5 * * *')` в `Specialist33ProbeService.runDailyChecks` — по всем Org, по 100 Decision на проход.

**Новый `Specialist33CardHandler`** регистрируется в `CardSpecialistRegistry` как `'3-3-decisions'`. Возвращает Decision'ы (тип `'decision'`) по overlap sourceBlockIds + ILIKE по statement/rationale/actualOutcomes. Исключает статусы rejected/cancelled/superseded.

**LLM (3 уровня)** — 2 новых LlmTaskType:
- `decision-extract` — извлечение черновика. JSON Schema strict (statement, rationale, alternatives, hints, dates, status, confidence).
- `decision-supersede-detect` — арбитр {new/merge/supersedes} + evolvingMeta. JSON Schema strict.

Цепочка по умолчанию (см. `scripts/seed-llm-task-routes-decisions.ts`): DeepSeek-flash → OpenAI gpt-5.4-mini → Ollama qwen3:30b. `maxDataClass >= sensitive`.

**REST API `/api/v1/decisions`** (`backend/src/modules/decisions/`):
- `GET /decisions?status=&decided_by=&deadline_filter=&affects_entity_id=&q=&page=&limit=`
- `GET /decisions/:id`
- `GET /decisions/:id/history` — CardVersion timeline.
- `GET /decisions/:id/supersede-chain` — ancestors + descendants.
- `POST /decisions` (owner/admin) — manual create через triage.
- `POST /decisions/:id/supersede` — заменить новой версией (создаёт + auto-resolve ConflictItem evolving).
- `POST /decisions/:id/status` — изменить статус + новая CardVersion.
- `POST /decisions/:id/outcomes` — записать actualOutcomes + новая CardVersion.

**RBAC `policy.csv`** — обновлено для `decision` ResourceType:
- owner/admin: r/w/d (admin write/delete добавлены в β-3).
- manager (open): r на все (decision — shared knowledge).
- manager (strict): r self (legacy).

**Метрики:**
- Переиспользуем `core_specialist_*{type='decision'}`.
- Новые: `core_specialist_conflict_evolving_total{type='decision'}` (отдельный counter для evolving-конфликтов), `decision_supersede_chain_length` (histogram).

**Frontend:**
- `frontend/src/api/decisions.api.ts` — API-клиент.
- `frontend/src/domain/decision.ts` — DomainModel + лейблы статусов / тонов.
- `frontend/app/(authenticated)/decisions/{page.tsx,DecisionsListClient.tsx}` — master-detail с фильтрами (status, deadline, search), supersede chain breadcrumb, alternatives table, actions «отметить реализованным / отменить».
- `frontend/src/ui/components/app-shell/Sidebar.tsx` — добавлен пункт «Решения» в группу «Компания».

**ENV (используются дефолты из ТЗ §8, без новых полей в TypedConfigService):**
```
DECISION_DEDUPE_THRESHOLD=0.85       # (используется как hard-coded const в сервисе)
DECISION_KNN_TOP_K=5                  # (hard-coded const в Specialist33Service)
```

**Решения по открытым вопросам sub-ТЗ §14:**
1. **§14.1 `affectsEntityIds[]`** — массив с GIN. Миграция в join-таблицу — γ+.
2. **§14.2 `alternatives`** — Json. Отдельная таблица — γ+.
3. **§14.3 Manual creation UI** — endpoint есть (`POST /decisions`, owner/admin), кнопки в UI нет. TODO γ+.
4. **§14.4 Decision как Entity type** — НЕ добавили. У Decision есть `entityId?` для будущей связки. Расширение Entity.type — γ+.

**Что отложено:**
- β-3.14 (Dashboard widget «Overdue decisions») — отложен.
- UI «Создать решение вручную» — γ+.
- Workflow согласования (proposed → approved через approvals) — γ+.
- Голосование за решение — γ+.
- Decision как Entity type для графовых запросов — γ+.
- Process в `affectsEntityIds` (сейчас skip) — γ+.
- Migration legacy `text` → `statement` для исторических записей — γ+.

Подробности: [[../01_projects/decisions|01_projects/decisions.md]].

## SBA β-4 — Specialist 3.5 (Insights Radar) — радар повторяющихся сигналов (2026-05-22)

Пятый специалист Слоя 3. Закрывает категорию «что-то у нас не так» — повторяющиеся **проблемы / риски / блокеры / неэффективности**. Главное отличие — отслеживание **динамики** через rolling-окна 7d/30d.

**Prisma `Insight`** (новая модель):
- Поля: `kind InsightKind`, `statement String`, `severity InsightSeverity`, `frequencyScore`/`dynamicScore Decimal(6,3)`, `dynamicLabel InsightDynamic`, `affectedEntityIds[]`, `relatedDecisionIds[]`, `mitigationPlan?`, `firstObservedAt`/`lastObservedAt DateTime`, `status InsightStatus`, `sourceBlockIds[]`, `personSubjectIds[]`, `confidence Decimal(4,3)`, `dataClass DataClass @default(internal)`, `currentVersionId?`, `embedding vector(1536)?`, `lastConfirmedAt?`.
- 4 enum'а: `InsightKind` (problem | risk | blocker | inefficiency), `InsightSeverity` (low | medium | high | critical), `InsightDynamic` (growing | stable | declining | spike), `InsightStatus` (active | mitigating | mitigated | archived | false_alarm).
- HNSW + generated tsvector `insight_search_tsv` + GIN на `affectedEntityIds` / `relatedDecisionIds` / `sourceBlockIds` — в `apply-postgres-init.sql`.
- Reverse-relation `Org.insights` и `CardVersion.insightsAsCurrent`.

**Новый воркер `Specialist35InsightsWorker` (`backend/src/modules/knowledge-core/workers/specialist-3-5-insights.worker.ts`):**
- Consumer `core.specialist-routing` jobName='3-5-insights'.
- jobName-фильтр, tenant-check, status='canonical', signalType ∈ {pain, risk, churn_risk, objection}.
- Concurrency=2.

**Новый `Specialist35Service` (`backend/src/modules/knowledge-core/services/specialist-3-5-insights.service.ts`):**
- `processBlock` — единая точка входа.
- KNN cosine top-10 поверх `insights.embedding` (threshold `INSIGHT_CLUSTER_THRESHOLD=0.78`). Match → обновляем existing + recalcMetrics; иначе — extract + triage нового.
- LLM `insight-extract` (DeepSeek-flash → OpenAI gpt-5.4-mini → Ollama qwen3:30b). JSON Schema strict.
- Резолв `affectedEntityIds` через `EntityResolutionService.findOrCreate` (customer/project/product/vendor; process — skip).
- LLM `insight-link-to-decisions` (опц.) — top-10 KNN-Decision того же Org, отбор тех, что могли спровоцировать сигнал. Валидация: id должны быть из candidate-списка.
- Доп. источник linking — `IdeaBlockLink.relationType='consequences_of'`: для блоков-источников ищем link на блоки, попадающие в Decision.sourceBlockIds.
- Triage с особенностью: `severity='critical'` → confidence сбрасывается до 0.3 в triage-вызове (форс deep review). insight НЕ в critical-types default.
- `recalcMetrics({insightId})` — пересчёт frequency/dynamic. Вызывается из cron'а и сразу после update existing.

**Новый `Specialist35ProbeService` (`backend/src/modules/knowledge-core/services/specialist-3-5-probe.service.ts`) — 4 trigger'а:**
| Reason | Trigger | Получатели |
|---|---|---|
| `insight.escalation_suggested` | dynamicLabel='spike' OR (severity ∈ {high,critical} AND ↑частота) | owner / admins |
| `insight.no_mitigation_plan` (cron) | severity ∈ {high,critical} AND mitigationPlan=null AND age > 7d AND status=active | admins |
| `insight.linked_decision_question` | LLM нашёл candidate Decision'ы | owner / admins |
| `insight.recurring_after_mitigation` | status=mitigated AND новое упоминание | admins |

**Новый cron `InsightClustererCron` (`backend/src/modules/knowledge-core/workers/insight-clusterer.cron.ts`)** — `@Cron('0 *‎/6 * * *')` (литерал; ENV `INSIGHT_CLUSTER_CRON` управляет дефолтом):
- Для каждой Org → recalcMetrics на всех active/mitigating Insight'ах.
- Probe `checkNoMitigationPlanForOrg` по всем Org.
- Обновление gauge `insights_dynamic_label_count{label}` после прохода.

**Новый `Specialist35CardHandler`** регистрируется в `CardSpecialistRegistry` как `'3-5-insights'`. Возвращает Insight'ы (тип `'insight'`) по overlap sourceBlockIds + ILIKE по statement/mitigationPlan. Бонусы за severity high/critical и dynamicLabel spike/growing. Исключает архивные и false_alarm.

**LLM (3 уровня)** — 2 новых LlmTaskType:
- `insight-extract` — извлечение черновика (kind, statement, severity, hints, mitigation). JSON Schema strict.
- `insight-link-to-decisions` — арбитр linkedDecisionIds + reasoning. JSON Schema strict.

Цепочка по умолчанию (см. `scripts/seed-llm-task-routes-insights.ts`):
- `insight-extract`: DeepSeek-flash → OpenAI gpt-5.4-mini → Ollama qwen3:30b.
- `insight-link-to-decisions`: DeepSeek-flash → OpenAI gpt-5.4-nano (дешевле для select-задач) → Ollama qwen3:30b.

**REST API `/api/v1/insights`** (`backend/src/modules/insights/`):
- `GET /insights?kind=&severity=&status=&dynamic_label=&affected_entity_id=&q=&page=&limit=`.
- `GET /insights/chart?days=30` — stacked-bar по kind × неделя.
- `GET /insights/top?limit=5` — топ-N для виджета Director Dashboard.
- `GET /insights/:id`.
- `POST /insights/:id/status` (+ CardVersion).
- `POST /insights/:id/mitigation` — обновить mitigationPlan; если был active — авто-перевод в mitigating.
- `POST /insights/:id/severity`.

**RBAC `policy.csv`** — новый `insight` ResourceType:
- owner/admin: r/w/d.
- manager open: r/w (write нужен для mitigationPlan и смены статуса).
- manager strict: r self.

**Метрики:**
- Переиспользуем `core_specialist_*{type='insight'}`.
- Новый: `insights_dynamic_label_count{label}` (gauge, обновляется InsightClustererCron — `growing | stable | declining | spike`).

**Frontend:**
- `frontend/src/api/insights.api.ts` — API-клиент.
- `frontend/src/domain/insight.ts` — DomainModel + лейблы статусов / тонов.
- `frontend/app/(authenticated)/insights/{page.tsx,InsightsListClient.tsx}` — master-detail: SVG stacked-bar сверху, чипсы фильтров (kind/severity/status/dynamic), список слева (badges + frequency), детали справа (statement, badges, stats, affected entities, related decisions → /decisions/:id, mitigation textarea, actions).
- `frontend/app/(authenticated)/dashboard/widgets/InsightsTopWidget.tsx` — виджет «Топ-5 повторяющихся проблем» в Director Dashboard.
- `frontend/src/ui/components/app-shell/Sidebar.tsx` — пункт «Сигналы» в группе «Компания».

**ENV (новый блок в `env.schema.ts` / `typed-config.service.ts` как `cfg.insights.*`):**
```
INSIGHT_CLUSTER_THRESHOLD=0.78
INSIGHT_CLUSTER_CRON="0 */6 * * *"
INSIGHT_FREQUENCY_WINDOW_DAYS=30
INSIGHT_SPIKE_RATIO=3.0
```

**Решения по открытым вопросам sub-ТЗ §13:**
1. **§13.1 dynamicLabel computation** — упрощённое: ratio 7d / 30d-avg. ML-модель прогноза эскалации — γ+.
2. **§13.2 mitigation plan** — текст. Структурируем (steps + owner + deadline) — γ+.
3. **§13.3 Risk register linking** — γ+.
4. **§13.4 false_alarm** — owner / admin / curator могут выставлять.

**Что отложено:**
- Структурированный mitigation plan workflow — γ+.
- Связка Insight ↔ Risk register — γ+.
- ML-прогноз эскалации — γ+.
- Назначение mitigation owner — γ+ (сейчас admin fallback).

Подробности: [[../01_projects/insights|01_projects/insights.md]].

## SBA β-5 — Specialist 3.6 (Ideas Collector) + Layer 6 (Probe-Agent) (2026-05-22)

Шестой специалист Слоя 3 — Ideas Collector — **парно** с новым **Слоем 6 Probe-Agent**. Без активного уточнителя идеи превращаются в кладбище, поэтому пара неразделима (см. §3.3 (C4) зонтичного ТЗ).

**Источник:** [`plans/tz/2026-05-21-sba-beta-5-specialist-3-6-ideas-and-layer6-probe.md`](../../plans/tz/2026-05-21-sba-beta-5-specialist-3-6-ideas-and-layer6-probe.md).

### Backend — Specialist 3.6 (Ideas Collector)

**Prisma:** `Idea`, `IdeaCluster` + enum'ы `IdeaKind` (internal | client_request), `IdeaStatus` (captured → in_discussion → accepted → in_progress → shipped, плюс rejected | archived). HNSW на embedding + GIN на массивах в `apply-postgres-init.sql`.

**Сервисы:**
- `Specialist36Service` — KNN-дедуп Idea, LLM `idea-extract`, weight (`supporterCount × recency × specificity`), эмит EventEmitter `idea.created` / `idea.status_changed`, метод `changeStatus(...)`.
- `Specialist36ProbeService` — 2 probe-trigger'а: `idea.support_request` (новая Idea с 1 supporter), `idea.status_unclear` (`in_discussion` > 14 дней).
- `Specialist36CardHandler` — регистрация в `CardSpecialistRegistry` chat-v2.
- `IdeasClosingLoopHandler` — `@OnEvent('idea.status_changed')`, LLM `idea-status-summarize` → нотификация supporter'ам (customer → admin fallback).

**Workers / Cron:** `Specialist36IdeasWorker` (consumer `core.specialist-routing` jobName='3-6-ideas'), `IdeaClustererCron` (`@Cron('30 *‎/4 * * *')` — KNN attach + LLM `idea-cluster-merge`).

**REST API:** `IdeasModule` — `GET /api/v1/ideas`, `/ideas/:id`, `/me/ideas?role=author|supporter`; `POST /ideas/:id/status`, `/ideas/:id/support`, `/me/ideas/:id/withdraw`; `GET /idea-clusters`, `/idea-clusters/:id`.

### Backend — Layer 6 (Probe-Agent)

**Prisma:** `ProbeEvent` + enum `ProbeStatus` (pending | dispatched | dropped_dedup | dropped_rate_limit | dropped_cold_start | expired).

**Модуль `probe/`:**
- `ProbeService.suggest({tenantId, emittedByService, reason, payload, recipientCandidates, priorityHint})` — единая входная точка для специалистов Слоя 3. contentHash → Redis dedup (TTL=`PROBE_DEDUP_TTL_HOURS`) → per-user rate-limit (часовой+суточный) → cold-start check → priority compute → insert `ProbeEvent` + enqueue `core.probe-events`.
- `ProbeDispatcherWorker` (consumer `core.probe-events`) — re-check rate-limit, round-robin select recipient, LLM `probe-formulate` (fallback на `payload.suggestedQuestion`/`message`), `ConversationalService.sendNotification(eventType='probe.question')`.
- `ProbeResponseHandler` — `@OnEvent('notification.responded')`, метрики `probe_response_total` / `probe_response_time_seconds`.
- `ProbePriorityCron` — `@Cron('*/15 * * * *')`: expiry sweep + per-user engagement_rate gauge.
- `ProbeController`: `GET /api/v1/probe/queue` (admin), `GET /api/v1/me/probe-history`.

**EventEmitter:** `@nestjs/event-emitter` добавлен; `EventEmitterModule.forRoot({wildcard:true, delimiter:'.'})` в `app.module.ts`. События: `notification.responded` (из `ConversationalService.respondToProbe`), `idea.created` / `idea.status_changed` (из `Specialist36Service`).

**Миграция specialist'ов на ProbeService:** в 5 файлах `specialist-3-{1,2,3,4,5}-probe.service.ts` метод `emit()` теперь сначала пробует `ProbeService.suggest(...)` (через `@Optional() ProbeService`); fallback — прямой `ConversationalService.sendNotification(eventType='specialist.probe')`. Локализованная миграция без ломки контрактов.

### Promp + LLM TaskRoutes

**Промпты (placeholder + TODO):** `idea-extract`, `idea-cluster-merge`, `probe-formulate`, `idea-status-summarize`.

**LlmTaskType** (4 новых в union + ALL_LLM_TASK_TYPES). Seed: `bun run seed:llm-task-routes-ideas-and-probe` — primary `deepseek-v4-flash`, secondary `gpt-5.4-mini`/`gpt-5.4-nano`, tertiary `ollama qwen3:30b`.

### Frontend

- `frontend/src/api/ideas.api.ts` — API-клиент.
- `frontend/app/(authenticated)/ideas/{page.tsx,IdeasListClient.tsx}` — master-detail tabs «Внутренние / От клиентов / Мои» + status filter + поиск.
- Sidebar — пункт «Идеи» (icon Lightbulb).

### Slash-command `/myideas` (Telegram)

Раньше — placeholder. Теперь — top-5 идей пользователя (author OR supporter через personSubjectIds) с русскими статусами.

### RBAC

`policy.csv` + `rbac.service.ts` — `idea` (r/w/d owner/admin; r/w manager open; r self manager strict) и `probe_event` (r/w admin/owner).

### Метрики

`probe_events_total{emitted_by_service, reason, status}`, `probe_dispatched_total{kind}`, `probe_response_total{event_type,kind}`, `probe_response_time_seconds{event_type,kind}`, `probe_dedup_dropped_total{reason}`, `probe_rate_limit_dropped_total`, `probe_cold_start_dropped_total`, `probe_expired_total`, `probe_recipient_engagement_rate{user_id}`, `idea_status_change_notifications_total{new_status}`.

### ENV (`cfg.ideas.*` + `cfg.probe.*`)

```
# Ideas
IDEA_CLUSTER_THRESHOLD=0.80
IDEA_CLUSTERER_CRON="30 */4 * * *"
IDEA_MIN_SUPPORTERS_FOR_CLUSTER=2

# Probe
PROBE_DEDUP_TTL_HOURS=72
PROBE_RATE_LIMIT_PER_USER_PER_HOUR=5
PROBE_RATE_LIMIT_PER_USER_PER_DAY=20
PROBE_EXPIRY_DAYS=14
PROBE_PRIORITY_REFRESH_CRON="*/15 * * * *"
PROBE_QUIET_HOURS_DEFAULT_TZ_OFFSET_MIN=180
PROBE_COLD_START_MODE_HOURS=24
```

### Решения по открытым вопросам sub-ТЗ §14

1. **§14.1 кластеризация** — отдельная `IdeaCluster` (KNN cosine + LLM-арбитр).
2. **§14.2 customer supporters** — closing-loop fallback на admin (`Customer.responsibleUserId` модели нет в Z — Customer существует только как Entity{type=customer}).
3. **§14.3 priority** — rule-based по `priorityHint`; ML γ+.
4. **§14.4 cold-start mode** — поле и метрика реализованы; в текущем cold-start check возвращает false (упрощение — дедуп+rate-limit ловят probe-storm).
5. **§14.5 дедуп** — content hash (sha256 from `reason + sorted contextIds + message`). Embedding-дедуп γ+.

### Что отложено

- Cold-start mode после deploy — крючок ENV + метрика, реальная активация требует deploy-маркера (γ+).
- Полный flow «ответ на probe → новый RawEvent → ingest pipeline» (нужен conversational Source — γ+).
- ML-priority Probe-Agent.
- Embedding-дедуп Probe.

Подробности: [[../01_projects/ideas|01_projects/ideas.md]], [[../01_projects/probe-agent|01_projects/probe-agent.md]].

## SBA γ-1 — Specialist 3.7 (SkillProfile) + ExecutablePersona + Clone API (2026-05-22)

Финальная фаза SBA. **Самый чувствительный sub-TZ**: Employee Clones — клоны сотрудников по наблюдаемому поведению.

**Источник:** [`plans/tz/2026-05-21-sba-gamma-1-specialist-3-7-skill-and-clone.md`](../../plans/tz/2026-05-21-sba-gamma-1-specialist-3-7-skill-and-clone.md).

### Что добавлено

**Backend (knowledge-core):**
- `services/specialist-3-7-skill.service.ts` — rebuildProfile (KNN-группировка reasoning-блоков → LLM skill-trait-detect → KNN-merge с активными → decay).
- `services/specialist-3-7-skill-probe.service.ts` — 2 probe-trigger (`skill.profile_starved` + `skill.contradicting_traits`).
- `services/executable-persona-build.service.ts` — компиляция persona snapshots (scope='person' + scope='role').
- `workers/specialist-3-7-skill.worker.ts` — consumer `core.specialist-routing` jobName='3-7-skill'.
- `workers/skill-profile-rebuild.worker.ts` — consumer новой очереди `core.skill-profile-rebuild`.
- `workers/skill-profile-recalibrate.cron.ts` — daily decay (`0 5 * * *`).
- `workers/executable-persona-build.cron.ts` — weekly snapshots (`0 6 * * SUN`).
- `workers/skill-manager-digest.cron.ts` — weekly digest direct manager'ам (`0 9 * * MON`).

**Backend (новый модуль `clones/`):**
- `clones.controller.ts` — `POST /api/v1/clones/persons/:id/ask`, `POST /api/v1/clones/roles/:id/ask`, `GET .../skill-profile`, `POST .../skill-traits/:id/mark-misleading`.
- `services/clones.service.ts` — askPerson / askRole / getPersonSkillProfile / getRoleSkillProfile / markTraitMisleading. RBAC (owner/admin/self/direct manager) + rate limit (`CLONE_ASK_PER_USER_PER_DAY=20` через Redis).
- ClonesModule помечен `@Global()` (чтобы SynthesisService мог инжектить через `@Optional()`).

**Backend (chat-v2):**
- `synthesis.service.ts` — mode='clone_style' + scope='card' + scopeRefId → делегирует `ClonesService.askPerson`.

**Frontend:**
- `app/(authenticated)/me/clone/page.tsx` + `MyCloneClient.tsx` — **обязательная** страница (зонтичный §3.3 C5).
- `app/(authenticated)/persons/[id]/skill-profile/PersonSkillProfileClient.tsx` — manager UI с mark-misleading.
- `app/(authenticated)/roles/[id]/skill-profile/RoleSkillProfileClient.tsx` — агрегатный профиль + диалог с клоном роли.
- `src/api/clones.api.ts`, `src/domain/clone.ts`.

### Prisma (3 модели + 5 enum'ов)

```
model SkillProfile     (1:1 с Person.relationship='employee')
model SkillTrait       (эмерджентная категория + гипотезный statement + KNN-merge)
model ExecutablePersona (версионированный snapshot для clone-respond)
enum SkillProfileStatus  { active | archived | paused_relationship }
enum SkillConfidence     { low | medium | high }
enum SkillTraitStatus    { active | superseded_by | archived | misleading }
enum PersonaScope        { person | role }
enum PersonaStatus       { active | superseded }
```

Расширен `CurationDecisionType` — добавлено значение `mark_as_misleading` (post-hoc контроль кураторов).

HNSW индекс на `SkillTrait.embedding` (cosine) + GIN на `sourceBlockIds`.

### LLM (4 новых taskType)

- `skill-trait-detect` (⚠ КРИТИЧНО) — primary `openai-via-proxy:gpt-5.4` (capable), secondary `deepseek:deepseek-v4-pro`, tertiary `ollama:qwen3:30b`. **Без согласования с product owner — не менять primary.**
- `skill-trait-merge`, `executable-persona-compile`, `clone-respond` — flash-цепочка (deepseek-v4-flash → gpt-5.4-mini → ollama:qwen3:30b).

Seed-script: `bun run seed:llm-task-routes-skill-and-clone`.

### Очереди (новая 1)

- `core.skill-profile-rebuild` (jobName='rebuild-skill-profile') — consumer `SkillProfileRebuildWorker`, debounce 60s через jobId `skill-profile-rebuild_<profileId>`.

### Метрики

- `skill_profiles_active_total`, `skill_traits_per_profile`, `skill_traits_marked_misleading_total{category}`.
- `persona_active_total{scope}`, `persona_build_duration_seconds`.
- `clone_ask_total{scope}`, `clone_ask_by_owner_total` (engagement носителем).
- `core_specialist_*{type='skill_trait'}` стандартные.

### RBAC (новые ResourceType)

- `skill_profile` — read owner/admin / manager open (все профили Org) / manager strict (self).
- `clone_persona` — read те же.
- mark-misleading в ClonesService — owner/admin/direct manager (тонкая логика).

### ENV (`cfg.skill.*` + `cfg.persona.*`)

```
SKILL_MIN_OBSERVATIONS=5
SKILL_TRAIT_SIMILARITY_THRESHOLD=0.85
SKILL_LOOKBACK_MONTHS=12
SKILL_DECAY_MONTHS=6
SKILL_ARCHIVE_MONTHS=12
SKILL_RECALIBRATE_CRON="0 5 * * *"
SKILL_MANAGER_DIGEST_CRON="0 9 * * MON"
SKILL_REBUILD_DEBOUNCE_MS=60000
CLONE_ASK_PER_USER_PER_DAY=20
PERSONA_BUILD_CRON="0 6 * * SUN"
PERSONA_MIN_TRAITS=3
PERSONA_ROLE_AGG_MIN_PERSONS=2
```

### Hook на Person.relationship change

`Specialist37Service.onRelationshipChanged` (`@OnEvent('person.relationship_changed')`) — обновляет `SkillProfile.status` автоматически при эмиссии события. Эмиссия события — TODO (γ+) в PersonsService.update, в OrgInvitationsService.acceptInvitation и patch-скриптах. Без эмиссии rebuild всё равно подхватит изменение (через `statusForRelationship` в начале rebuild'а).

### Решения по открытым вопросам sub-ТЗ §15

1. **SkillTrait.category** — Text-поле в γ-1.
2. **ExecutablePersona** — раз в неделю (cron) + on-demand rebuild в ClonesService.
3. **Manager visibility** — direct manager (1 уровень).
4. **«Попробовать клона» для пустых профилей <3 traits** — disabled с tooltip.
5. **Rate limit clone_ask** — 20/сутки на пользователя через Redis.

### Что отложено

- EventEmitter эмиссия `person.relationship_changed` в PersonsService / OrgInvitationsService / patch-скриптах (handler уже готов).
- Mark-wrong для ответов клона — пока placeholder toast (CurationItem для clone-output — γ+).
- ContradictingTraits фактическая детекция (placeholder API в Specialist37ProbeService).
- Реальный smoke на dev-сотрудниках после deploy (γ-1.20 — документация SMOKE.md создана).
- Manager validation note: 1–2 dev-куратора подтверждают «traits похожи на правду» (не блокирует DoD).

Подробности: [[../01_projects/skill-and-clone|01_projects/skill-and-clone.md]].

## Tracker — задачный модуль (2026-05-24, Sprint 1)

Полный backend модуля `tracker/` создан Sprint 1 (10 коммитов, 9 параллельных subagent'ов, ~10 200 строк). Полное описание: [[../01_projects/tracker]].

### `backend/src/modules/tracker/`

```
tracker/
  tracker.module.ts                                    # экспорт IssuesService, ActivityRecorderService, TrackerEventsService
  README.md
  queues.ts                                            # TRACKER_QUEUE_NAMES.WEBHOOK_DELIVERY = 'tracker.webhook-delivery'
  controllers/
    projects.controller.ts                             # CRUD + archive/unarchive + members
    issues.controller.ts                               # CRUD + transitions + assignees/labels/subscribe + link-goal + activity/versions + start-meeting
    cycles.controller.ts                               # CRUD + complete (auto-rollover)
    intake.controller.ts                               # CRUD + triage (accept/reject/snooze/duplicate)
    comments.controller.ts                             # CRUD + threading + voice
    labels.controller.ts
    webhooks.controller.ts                             # CRUD + logs + test (202 enqueued)
    relations.controller.ts                            # IssueRelation CRUD с auto-парной обратной
    attachments.controller.ts                          # S3 multipart + presigned URL
    team-templates.controller.ts                       # read-only (seed контента — Phase 4)
  services/
    projects.service.ts                                # create с default IssueState + owner ProjectMember
    issues.service.ts                                  # CRUD + transitions + assignees + labels + subscribe + goal-link + WS publish + webhook dispatch
    cycles.service.ts                                  # CRUD + complete с auto-rollover
    intake.service.ts                                  # CRUD + triage
    comments.service.ts                                # CRUD + @-упоминания → IssueMention
    labels.service.ts                                  # CRUD
    webhooks.service.ts                                # CRUD + secretKey `kora_wh_` + enqueueTest
    relations.service.ts                               # CRUD с auto-обратной (blocks↔blocked_by, etc.)
    attachments.service.ts                             # S3.putObject + Prisma create + presignGet + delete
    issue-meetings.service.ts                          # Meeting.task_discussion + LiveKit JWT
    activity-recorder.service.ts                       # запись IssueActivity (epoch BigInt, $transaction(tx))
    tracker-events.service.ts                          # WS publish (issue/comment/cycle/intake)
    webhook-dispatcher.service.ts                      # queue.add для active webhooks per event
    webhook-signer.service.ts                          # HMAC SHA256
  workers/
    webhook-delivery.worker.ts                         # in-process BullMQ worker, attempts:5, exp backoff 60s→300s→1500s→7500s→37500s
  gateways/
    tracker.gateway.ts                                 # @nestjs/websockets namespace /ws/tracker, tenant rooms
  dto/
    projects/{create,update,project-response,list-projects-query}.dto.ts
    issues/{create,update,transition-state,issue-response,list-issues-query,create-relation,start-meeting}.dto.ts
    cycles/{create,update,cycle-response}.dto.ts
    intake/{create,triage}.dto.ts
    comments/{create,update}.dto.ts
    labels/{create}.dto.ts
    webhooks/{create,update}.dto.ts
    ws-events.ts                                       # WsEventDto<T>
```

### Зависимости (импорты)

- `PrismaService` (через PrismaModule)
- `RbacService` (через RbacModule) — 6 ResourceType: project, issue, cycle, intake_issue, team_template, issue_webhook
- `S3Service` (Global, из RecordingsModule) — для attachments
- `LivekitService` (Global) — для start-meeting JWT
- `BullMQ` через TYPED_QUEUES + Redis-connection — для tracker.webhook-delivery queue
- `@nestjs/websockets` + `@nestjs/platform-socket.io` + `socket.io@4.8` (новые зависимости backend/package.json)

### Потоки данных

1. **Создание задачи через REST:**
   - POST /api/v1/projects/:projectId/issues → IssuesController.create
   - IssuesService.create в $transaction: Issue + assignees + labels + IssueActivity verb='created'
   - После tx: TrackerEventsService.publishIssueCreated → emit `issue.created` на tenant:${tenantId} + project:${projectId} rooms
   - WebhookDispatcher.dispatch(tenantId, 'issue.created', payload) → queue jobs для active webhooks с events.includes('issue.created')
   - WebhookDeliveryWorker берёт job → HMAC sign → fetch URL с timeout 30s → IssueWebhookLog запись → retry или success
   - **Sprint 3:** EventEmitter `tracker.event_occurred` → TrackerAdapter → RawEvent с signalType='task_created' → core.raw-events очередь → knowledge-core pipeline (block-ingest → распознавание сущностей → специалисты)

2. **Цикл (Cycle) complete:**
   - POST /api/v1/cycles/:id/complete → CyclesService.complete
   - В транзакции: для каждой Issue с cycleId=id и state.category !== 'completed' → move в следующий Cycle + IssueActivity verb='moved_from_cycle'
   - Publish `cycle.progressUpdated` + `cycle.completed` через WS
   - Webhook event `cycle.completed`

3. **Видеовстреча из задачи:**
   - POST /api/v1/issues/:id/start-meeting → IssueMeetingsService
   - В транзакции: Meeting (type='task_discussion', linkedIssueId=id) + host MeetingParticipant + filtered guest Participants
   - LivekitService.ensureRoom + generateHostToken
   - IssueActivity verb='meeting_started' с metadata={meetingId}
   - Возврат { meetingId, meetingUrl, token } клиенту

### Метрики Prometheus (business-metrics.service.ts)

```
issues_created_total{tenant, project, source}
issues_completed_total{tenant, project}
intake_triaged_total{tenant, decision}
tracker_webhook_delivery_total{tenant, event, success}
tracker_webhook_retry_count{tenant, webhook_id}        # ⚠ cardinality risk Sprint 7
tracker_events_to_knowledge_core_total{tenant, type}

issues_by_state_count{tenant, project, state}          # gauge, cron-обновление
issues_overdue_count{tenant, project}                  # gauge, cron-обновление
intake_pending_count{tenant}                           # gauge, обновляется при IntakeIssue.status change
```

### LiveKit RNNoise активация (frontend)

`frontend/src/lib/livekit/noise-suppression.ts` — buildAudioCaptureOptions + localStorage helper'ы (`kora_noise_suppression_enabled`). Включён по умолчанию во встречах, toggle в `GuestNameForm.tsx` (mobile + desktop). См. [[../01_projects/livekit-noise-cancellation]].

[[../index|← index]]
