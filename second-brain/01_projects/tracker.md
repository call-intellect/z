# Tracker — задачный модуль Z/Кора

> **Назначение:** бесплатный таск-трекер как PLG-точка входа в платформу Z/Кора. Каждое событие трекера → RawEvent → knowledge-core (принцип «трекер = источник для второго мозга»). Срок Wave 1 — 6 нед (2026-05-26 → 2026-07-06).

## Стратегический контекст

См. [`plans/analysis/2026-05-23-tracker-as-entry-wedge.md`](../../plans/analysis/2026-05-23-tracker-as-entry-wedge.md) — выбор сценария C (свой трекер на NestJS+Prisma+pgvector+Next.js, не Huly и не Plane). Главное отличие — простота YouGile + глубина Linear + AI вшит в knowledge-core (а не пришит сбоку).

## Расположение кода

- **Backend:** `backend/src/modules/tracker/` — 38+ файлов созданы Sprint 1.
- **Tracker module:** `tracker.module.ts` экспортирует `IssuesService`, `ActivityRecorderService`, `TrackerEventsService` (другие модули могут публиковать события и активность).
- **WebSocket gateway:** `gateways/tracker.gateway.ts` (namespace `/ws/tracker`, tenant rooms).
- **BullMQ worker:** `workers/webhook-delivery.worker.ts` (in-process, queue `tracker.webhook-delivery`).

## Модели Prisma (20 шт., 2026-05-24)

См. [`02_architecture/data-model`](../02_architecture/data-model.md) для полей. Список:

| Модель | Назначение |
|---|---|
| `Project` | Проект с slug/identifier/network/feature-flags/teamTemplateId |
| `ProjectMember` | M2M user↔project с role (20=Admin, 15=Member, 5=Guest) |
| `IssueState` | Статусы задач (Backlog/In Progress/Done/Cancelled) per project |
| `Cycle` | Недели работы с auto-rollover незакрытых задач |
| `Issue` | Задача с parent (иерархия), sequenceId, identifier (KORA-123), goalId, linkedMeetingIds, externalSource |
| `IssueAssignee` | M2M issue↔assignees |
| `Label` + `IssueLabel` | Метки (per-project или global) |
| `IssueSubscriber` | Подписка на изменения задачи |
| `IssueMention` | `@`-упоминания в комментариях |
| `IssueComment` | Rich-text JSON + voice (voiceUrl/voiceDuration/voiceTranscript) + threading |
| `IssueAttachment` | S3 файлы (25 MB лимит, MIME whitelist) |
| `IssueLink` | Внешние ссылки |
| `IssueRelation` | blocks/blocked_by/duplicates/duplicated_by/relates_to (с auto-обратной парной) |
| `IssueActivity` | Audit-trail (actorType, verb, field, oldValue/newValue, epoch BigInt) |
| `IssueVersion` | Исторические снимки задачи (snapshot Json) |
| `IntakeIssue` | Входящие задачи перед триажем (status, source, AI suggestions) |
| `IssueWebhook` | Outgoing webhooks (secretKey префикс `kora_wh_`) |
| `IssueWebhookLog` | Лог доставки (success/fail, retry, response) |
| `TeamTemplate` | 10 шаблонов команд (sales/development/installation/marketing/management/customer_support/hr/finance/operations/product) |

**Расширения:**
- `Meeting.linkedIssueId` — для видеовстреч из задачи (`POST /issues/:id/start-meeting`).
- `Goal.linkedIssues[]` — стратегическое согласование с Фазы 1.
- `MeetingType.task_discussion` — новое значение enum.

## SignalType — расширение для ingest

18 новых значений в Prisma enum `SignalType` (см. [`01_projects/llm-router`](llm-router.md) для общего списка):

- **8 task_***: `task_created, task_status_changed, task_blocked, task_completed, task_overdue, task_reassigned, task_comment, task_mention` — для tracker.adapter (B1-3.1, Sprint 3).
- **7 helpfulness**: `help_provided, proactive_hint, mentoring, emotional_support, constructive_feedback, question_unanswered, question_acknowledged_no_action` — для Specialist 3.8 Helpfulness Agent (Wave 2). Последние два — only-private-to-admin (этическая защита).
- **3 gamification**: `helped_by, helped_to, thanks_explicit` — для Recognition Agent (Wave 2).

## REST API endpoints

См. [`01_projects/api-layer`](api-layer.md) если есть, или [`plans/tz/2026-05-23-tracker-phase-1-models-api.md`](../../plans/tz/2026-05-23-tracker-phase-1-models-api.md). Сводка:

```
GET    /api/v1/projects                          # список + фильтры
POST   /api/v1/projects                          # + опц. teamTemplateId
GET    /api/v1/projects/:id
PATCH  /api/v1/projects/:id
DELETE /api/v1/projects/:id                      # soft-delete
POST   /api/v1/projects/:id/archive
POST   /api/v1/projects/:id/unarchive
GET/POST/DELETE /api/v1/projects/:id/members

GET    /api/v1/projects/:projectId/issues        # фильтры: state, assignee, label, cycle, goal
POST   /api/v1/projects/:projectId/issues
GET    /api/v1/issues/:id
PATCH  /api/v1/issues/:id
DELETE /api/v1/issues/:id
POST   /api/v1/issues/:id/transitions
POST/DELETE /api/v1/issues/:id/assignees
POST/DELETE /api/v1/issues/:id/labels
POST/DELETE /api/v1/issues/:id/subscribe
POST   /api/v1/issues/:id/link-goal
DELETE /api/v1/issues/:id/link-goal
GET    /api/v1/issues/:id/activity               # audit-trail
GET    /api/v1/issues/:id/versions

GET    /api/v1/issues/:id/comments
POST   /api/v1/issues/:id/comments               # rich-text + voice
PATCH  /api/v1/comments/:commentId
DELETE /api/v1/comments/:commentId

GET    /api/v1/issues/:id/relations              # blocks/duplicates/relates_to
POST   /api/v1/issues/:id/relations              # авто-парная обратная
DELETE /api/v1/relations/:relationId

POST   /api/v1/issues/:id/attachments            # multipart S3
GET    /api/v1/attachments/:id                   # presigned URL
DELETE /api/v1/attachments/:id

POST   /api/v1/issues/:id/start-meeting          # LiveKit JWT + Meeting.task_discussion

GET    /api/v1/projects/:projectId/cycles
POST   /api/v1/projects/:projectId/cycles
GET    /api/v1/cycles/:id
PATCH  /api/v1/cycles/:id
POST   /api/v1/cycles/:id/complete               # auto-rollover незакрытых
GET    /api/v1/cycles/:id/issues

GET    /api/v1/intake
POST   /api/v1/intake
POST   /api/v1/intake/:id/triage                 # accept | reject | snooze | duplicate
PATCH  /api/v1/intake/:id

GET    /api/v1/webhooks
POST   /api/v1/webhooks
PATCH  /api/v1/webhooks/:id
DELETE /api/v1/webhooks/:id
GET    /api/v1/webhooks/:id/logs
POST   /api/v1/webhooks/:id/test                 # 202 enqueued

GET    /api/v1/team-templates
GET    /api/v1/team-templates/:slug
POST   /api/v1/projects/from-template            # 501 пока (Phase 4 / Sprint 9)
```

## WebSocket events (`/ws/tracker`)

- Auth: JWT из `handshake.auth.token` → cookie `z_session` → Authorization.
- Подключение автоматически subscribe на `tenant:${tenantId}` room.
- Опционально: `subscribe.project` / `subscribe.issue` (с tenant cross-check).

События:
- `issue.created/updated/deleted` (с `changedFields` для update)
- `comment.created/updated/deleted`
- `cycle.created/progressUpdated/completed`
- `intake.newItem`
- `activity_feed.newItem`

## Outgoing webhooks (HMAC SHA256 + retry)

- Очередь: `tracker.webhook-delivery` (BullMQ, in-process worker, concurrency: 8).
- Retry: 5 попыток, exp backoff 60s → 300s → 1500s → 7500s → 37500s.
- Headers: `X-Kora-Signature: sha256=<hex>`, `X-Kora-Event`, `X-Kora-Webhook-Id`, `X-Kora-Delivery`, `X-Kora-Timestamp`.
- Body: JSON `{ event, tenantId, webhookId, enqueuedAt, data }`.
- После 5 неудач: `webhook.isActive=false` + Notification владельцу (TODO Sprint 2-3).
- Каждая попытка → `IssueWebhookLog` (success/fail, requestHeaders/body, responseStatus/body 10KB truncate, responseTime ms).

## RBAC ResourceType

6 новых в `policy.csv` (Casbin):
- `project` — owner/admin/manager (write всем), member (read)
- `issue` — assignee + project_member (read), manager (write all), creator/manager (delete self)
- `cycle` — manager (write), project_member (read)
- `intake_issue` — admin/manager/coo (read + triage)
- `team_template` — all (read), admin (write)
- `issue_webhook` — admin (full CRUD), tenant-scope

## ENV-переменные (`backend/src/common/config/env.schema.ts`)

| Переменная | Default | Назначение |
|---|---|---|
| `WEBHOOK_HMAC_PREFIX` | `kora_wh_` | Префикс secret webhook'ов |
| `TRACKER_INGEST_QUEUE` | `core.raw-events` | BullMQ очередь ingest tracker_event (Sprint 3) |
| `IDEMPOTENCY_KEY_TTL_SECONDS` | `86400` | TTL Idempotency-Key в Redis (Sprint 2) |
| `TRACKER_WEBHOOK_MAX_RETRIES` | `5` | Макс. попыток |
| `TRACKER_WEBHOOK_RETRY_BACKOFF_INITIAL_MS` | `60000` | Начальная задержка retry, ms |

## Prometheus метрики

9 метрик (см. [`02_architecture/module-map`](../02_architecture/module-map.md)):
- Counter: `issues_created_total{tenant, project, source}`, `issues_completed_total{tenant, project}`, `intake_triaged_total{tenant, decision}`, `tracker_webhook_delivery_total{tenant, event, success}`, `tracker_webhook_retry_count{tenant, webhook_id}`, `tracker_events_to_knowledge_core_total{tenant, type}`.
- Gauge: `issues_by_state_count{tenant, project, state}`, `issues_overdue_count{tenant, project}`, `intake_pending_count{tenant}`.

⚠ Cardinality риск (TODO Sprint 7): label `tenant`/`project`/`webhook_id` напрямую. Миграция на top-100 hash bucket + 'other' — при подключении Grafana recording rules.

## Что осталось до DoD Phase 1 трекера

| Тикет | Что | Sprint |
|---|---|---|
| B1-3.1 | `tracker.adapter.ts` в `modules/ingest/adapters/tracker/` — слушает `tracker.event_occurred` → создаёт RawEvent с правильным signalType (8 task_*) | Sprint 3 |
| B1-3.2 | Goals integration: расширение `strategic-alignment.cron` (учитывает Issue с goalId), probe-trigger «80% задач не привязаны к целям» | Sprint 3 |
| B1-3.3 | Миграция legacy `Task` → `Issue` (скрипт `backend/scripts/migrate-task-to-issue.ts` — DRY-RUN + `--apply`) | Sprint 3 |
| Idempotency middleware на POST | `IdempotencyService` общий для tracker (Redis cache) | Sprint 2 |
| Notification владельцу при webhook.isActive=false | Через ConversationalService | Sprint 2-3 |
| Sharp thumbnails для IssueAttachment | Отдельный воркер `attachment-thumbnail` | Sprint 3+ |
| task_discussion отдельный AI-промпт | Сейчас переиспользует `team` промпт | Sprint 3 |

## Frontend (F1 — отдельный поток с Sprint 3)

- `app/(authenticated)/projects/`, `/issues/`, `/me/inbox`, `/feed/` — заглушки + DTO-типы.
- Компоненты `<IssueCard>`, `<KanbanColumn>`, `<QuickAdd>`, `<IssueChat>`, `<CommandPalette>` — mobile-first.
- Cmd+K — `concierge-parse` LLM через DialogService (после α-5).
- PWA — manifest + service worker + web push.

См. [`plans/tz/2026-05-23-tracker-phase-2-frontend-mobile-first.md`](../../plans/tz/2026-05-23-tracker-phase-2-frontend-mobile-first.md).

## Mobile native (R1 — параллельный поток)

- React Native + Expo SDK 51+. Отдельный репозиторий `kora-mobile/`.
- Магазины: App Store + Google Play + RuStore (подтверждено владельцем 2026-05-24).
- Sprint 1 R1-1.1 (Bootstrap) — ожидает RN-среду владельца.

См. [`plans/tz/2026-05-23-tracker-mobile-native.md`](../../plans/tz/2026-05-23-tracker-mobile-native.md).

## Связь с другими модулями

| Модуль | Связь |
|---|---|
| [knowledge-core](../02_architecture/knowledge-core.md) | Tracker events → RawEvent → IdeaBlock через signalType (Sprint 3) |
| [chat-v2](chat-v2.md) | Чат-в-задаче (Sprint 5 — Phase 2) |
| [livekit](../02_architecture/ai-integration.md) | `POST /issues/:id/start-meeting` → LiveKit JWT |
| [decisions](decisions.md) | `Decision.linkedIssueIds[]` (Sprint 3+) |
| [insights](insights.md) | Pattern «5 задач в blocked у Иванова за неделю» через β-4 |
| [regulations](regulations.md) | Process steps извлекаются из чата задач |
| [conversational-channels](conversational-channels.md) | Telegram-бот для задач (Phase 4, Sprint 9-10) |

## История реализации

- **2026-05-24:** Sprint 1 + большая часть Sprint 2 закрыты за 1 сессию оркестрации (9 параллельных subagent'ов, ~10 200 строк). См. [`05_история/2026-05-24-tracker-sprint-1-orkestratsiya-9-agentov.md`](../05_история/2026-05-24-tracker-sprint-1-orkestratsiya-9-agentov.md).

## Активные планы

- [Sprint Plan Wave 1](../../plans/sprints/2026-05-24-sprint-plan-wave-1.md) — детальный план 3 спринтов × 2 нед.
- [Зонтичный план COO + Tracker](../../plans/tz/2026-05-23-coo-and-tracker-umbrella.md) — карта всех sub-ТЗ.
- [Phase 1 sub-ТЗ](../../plans/tz/2026-05-23-tracker-phase-1-models-api.md), [Phase 2](../../plans/tz/2026-05-23-tracker-phase-2-frontend-mobile-first.md), [Phase 3](../../plans/tz/2026-05-23-tracker-phase-3-ai-features.md), [Phase 4](../../plans/tz/2026-05-23-tracker-phase-4-rf-musthave.md), [Phase 5](../../plans/tz/2026-05-23-tracker-phase-5-import.md).

---

_Создан: 2026-05-24 (Sprint 1 финал)._
