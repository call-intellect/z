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

- [ ] **Шаг 1 — Prisma schema + db push.**
  - `Org.workersEnabled Json @default("{}")`.
  - `IdeaBlockLink.deletedAt/By` + index.
  - `EntityLink.deletedAt/By` + index.
  - `AiUsageLog.requestPreview/responsePreview` (text, optional).
  - `SuperAdminAccessLog` — новая таблица.
  - `User.superAdminAccessLogs` обратная связь.
  - `bun run prisma:push --accept-data-loss && bun run prisma:generate`.

- [ ] **Шаг 2 — Guards + interceptor.**
  - `SuperAdminGuard` → `req.user.isSuperAdmin`.
  - `OrgAdminGuard` → `RbacService.canManageOrg`.
  - `SuperAdminAuditInterceptor` → запись `SuperAdminAccessLog`.
  - Миграция `AiUsageAdminController` и `LlmRoutesController` под `SuperAdminGuard`.
  - Smoke specs guard'ов.

- [ ] **Шаг 3 — AdminUsageService + контроллеры usage.**
  - Методы `getDashboard / getUsersUsage / getCallsLog / getCallDetails / getFunctionsUsage / getFunctionCalls`.
  - Контроллеры `/api/v1/admin/usage/*` (super_admin) и `/api/v1/org-admin/usage/*` (owner Org).
  - DTO Zod, cursor pagination, CSV stream.
  - LlmRouter пишет `requestPreview/responsePreview` в AiUsageLog.

- [ ] **Шаг 4 — AdminFunctionsService + расширение LlmRoutesController.**
  - `ALL_LLM_TASK_TYPES` экспорт из `llm-router.service.ts`.
  - DTO TASK_TYPES = весь union.
  - `GET /admin/functions`, `GET /admin/functions/:taskType`.

- [ ] **Шаг 5 — AdminExperimentsService.**
  - `start/getStatus/finish/cancel`.
  - Контроллер `/api/v1/admin/experiments/*`.

- [ ] **Шаг 6 — AdminPricesService + AdminOrgsService + AdminHealthService.**
  - `/admin/llm-prices`, `/admin/orgs`, `/admin/health`.
  - Health: `Bull.getJobCounts()` + `pg_database_size`.

- [ ] **Шаг 7 — Org-Admin knowledge-core debug + worker org-gate.**
  - `OrgAdminKnowledgeService` + контроллер.
  - `EntityMergeService.mergeManually(...)`.
  - `WorkerOrgGate.checkOrThrow(tenantId, name)` в `core-queue.service.ts`.
  - Воркеры читают gate.
  - Reprocess RawEvent через `IdeaBlockEvidence.rawEventId` + suffix-jobId.

- [ ] **Шаг 8 — AdminCacheService + инвалидация.**
  - In-memory Map с TTL.
  - Подключение в `getDashboard` (TTL 60s).
  - Инвалидация на mutations.

## Frontend (Шаг 9 — другой агент)

Не входит в этот execution-план.

## Decisions / open questions

См. `plans/decisions-log.md` — будут добавляться по ходу.
