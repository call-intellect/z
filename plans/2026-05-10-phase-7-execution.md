---
type: execution-plan
phase: 7
feature: knowledge-core — Z-Admin (super_admin) + Org-Admin (owner/admin) — отладка, наблюдение, аналитика стоимости, A/B
status: in_progress
date: 2026-05-10
---

# Фаза 7 — backend (шаги 1-8). Frontend (шаг 9) — отдельный агент.

## Контекст

Backend-имплементация двух админок поверх ядра знаний:
- **Z-Admin** — super_admin (User.isSuperAdmin), `/api/v1/admin/*`.
- **Org-Admin** — owner/admin Membership, `/api/v1/org-admin/*`.

Принципиально: одна логика расчётов, разные guard'ы и `scope=global|org` на уровне сервисов.

## Backend (этот документ)

- [x] **Шаг 1 — Prisma schema + db push.**
  - `Org.workersEnabled Json @default("{}")`.
  - `IdeaBlockLink.deletedAt/By` + index.
  - `EntityLink.deletedAt/By` + index.
  - `AiUsageLog.requestPreview/responsePreview` (text, optional).
  - `SuperAdminAccessLog` — новая таблица.
  - `User.superAdminAccessLogs` обратная связь.
  - `bun run prisma:push --accept-data-loss && bun run prisma:generate` — выполнено.
  - Коммит: `0a03275`.

- [x] **Шаг 2 — Guards + interceptor.**
  - `SuperAdminGuard` → `req.user.isSuperAdmin` (lookup в БД при отсутствии в сессии).
  - `OrgAdminGuard` → `RbacService.loadContext` + `role ∈ {owner,admin}` или `isSuperAdmin`.
  - `SuperAdminAuditInterceptor` → запись `SuperAdminAccessLog` (sanitized payload).
  - `AiUsageAdminController` и `LlmRoutesController` мигрированы под `SuperAdminGuard`.
  - Smoke specs `super-admin.guard.spec.ts` (5), `org-admin.guard.spec.ts` (6) — зелёные.
  - Коммит: `6e73787`.

- [x] **Шаг 3 — AdminUsageService + контроллеры usage.**
  - `getDashboard / getUsersUsage / getCallsLog / getCallDetails / getFunctionsUsage / getFunctionCalls`.
  - `/api/v1/admin/usage/*` (super_admin), `/api/v1/org-admin/usage/*` (owner/admin Org).
  - Cursor pagination для calls — base64({createdAt, id}). DTO Zod с custom from/to refine.
  - CSV-stream без библиотек (запятая + quote-policy).
  - `LlmRouter` пишет `requestPreview` ([SYSTEM]\n...\n[USER]\n...) и `responsePreview`
    в `AiUsageLog` (truncate до 8KB на стороне `AiUsageLogService`).
  - `LlmRouter.refreshPrices()` — для `AdminPricesService`.
  - `ALL_LLM_TASK_TYPES` экспортирован из `llm-router.service.ts`.
  - `AdminCacheService` создан.
  - Коммит: `2f921d4`.

- [x] **Шаг 4 — AdminFunctionsService + расширение LlmRoutesController.**
  - `listFunctions / getFunctionDetail / setRouteForTaskType`.
  - `TASK_TYPES_TUPLE = ALL_LLM_TASK_TYPES` в `llm-routes.dto.ts` — один источник правды.
  - `LlmRoutesService.upsert` теперь делегирует в `AdminFunctionsService.setRouteForTaskType`
    (с моделями + автоматической инвалидацией кэша).
  - `GET /api/v1/admin/functions`, `GET /admin/functions/:taskType`.
  - Коммит: `31dba5a`.

- [x] **Шаг 5 — AdminExperimentsService.**
  - `startExperiment / getStatus / finishExperiment / cancelExperiment`.
  - `POST/GET/POST(:taskType/finish)/DELETE /api/v1/admin/experiments/*`.
  - DTO Zod: `StartExperiment` (modelB regex `<provider>:<model>`, splitPercent ∈ [1,99]),
    `FinishExperiment {winner}`.
  - Все мутации: `LlmRouter.refreshCache()` + `AdminCache.invalidate('usage:')`.
  - Коммит: `9af69cd`.

- [x] **Шаг 6 — Prices/Orgs/Health сервисы и endpoints.**
  - `AdminPricesService.setPrice` — транзакция: закрыть старую (effectiveTo=now) → создать новую.
    refreshPrices LlmRouter + invalidate('usage:').
  - `AdminOrgsService`: list (Org + counts + costInPeriod), update (tier/freeze=deletedAt),
    delete (soft).
  - `AdminHealthService`: Bull.getJobCounts() для всех QUEUE_NAMES + CORE_QUEUE_NAMES,
    pg_database_size, count'ы IdeaBlock/Entity/RawEvent/AiUsageLog, Redis ping. S3 — пропускаем.
  - `/admin/llm-prices`, `/admin/orgs`, `/admin/health`.
  - Коммит: `b6cc470`.

- [x] **Шаг 7 — Org-Admin knowledge-core debug + worker org-gate.**
  - `WorkerOrgGate.checkOrThrow` в `core-queue/worker-org-gate.ts`.
  - Воркеры (block-ingest/distill/linker/entity-resolver) и cron'ы
    (theme-clusterer/reframing) проверяют gate.
  - `EntityMergeService.mergeManually(...)` — без LLM-арбитра.
  - `OrgAdminKnowledgeService` (setWorkersEnabled, getRecentAuditLogs, listLinks,
    deleteLink, bulkDeleteLinks (?confirm=YES), mergeEntities, patchEntity,
    reprocessRawEvent, getOrgMetrics).
  - `CoreQueueService.enqueueRawReceived(rawEventId, {suffix})` — обход BullMQ-дедупа.
  - Контроллер `/api/v1/org-admin/knowledge/*`.
  - `WorkerOrgGate` зарегистрирован в `WorkersModule`.
  - Коммит: `80fb281`.

- [x] **Шаг 8 — AdminCacheService + инвалидация на mutations.**
  - `AdminCacheService` (in-memory Map, get/setWithTtl/invalidate(prefix)) — создан в Шаге 3.
  - `AdminUsageService.getDashboard` — кэш с TTL 60s, ключ
    `usage:dashboard:${scope}:${tenantId??'*'}:${period}`.
  - Инвалидация `usage:`:
    - `AdminFunctionsService.setRouteForTaskType` (Шаг 4).
    - `AdminPricesService.setPrice` (Шаг 6).
    - `AdminExperimentsService.startExperiment / finishExperiment / cancelExperiment` (Шаг 5).
    - `OrgAdminKnowledgeService.setWorkersEnabled` (точечная: `usage:dashboard:org:${tenantId}:*`).
  - Коммит шага 8 — финализация execution-плана + decisions-log.

## Frontend (Шаг 9 — другой агент)

Не входит в этот execution-план.

## Decisions / open questions

См. `plans/decisions-log.md` — будут добавляться по ходу.
