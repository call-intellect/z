---
type: project
status: in_progress
phase: 7
---

# Org-Admin (отладка ядра знаний для owner)

> Локальная админка владельца Org. Доступ — `Membership.role IN ('owner', 'admin')`.

> ⚠️ **Обновление 2026-06-02 (ТЗ `plans/archive/2026-06-02-org-admin-cleanup-no-costs-nav-split.md`).**
> Org-admin развёрнут в отдельную поверхность `/company-admin/*` (свой `CompanyAdminSidebar`), в клиенте остались только: **Доступ к памяти**, **Источники**, **Встречи**.
> - **«Экономика»** (расход LLM) **удалена целиком**: backend `OrgAdminUsageController` (`/api/v1/org-admin/usage/*`) удалён, frontend `OrgUsageClient`/`org-admin-usage.api` удалены. Владелец Org себестоимость LLM **не видит** (он платит за тариф, остальное — на платформе).
> - **«Ядро знаний» (debug)** удалена из клиента (страница + `org-admin-knowledge.api`/домен). Backend `OrgAdminKnowledgeController`/сервис оставлены живыми, но из ответа вырезан `llm.costUsd` (defense-in-depth). Возможный перенос debug под супер-админку — отдельная задача.
> Разделы «Назначение/API/Тумблеры» ниже описывают backend-механику (актуальна), но привязка к клиентской странице устарела.

## Назначение

Дать владельцу Org инструменты для:
- наблюдения локальной экономики LLM-расхода;
- отладки knowledge-core (тумблеры воркеров, журнал AuditLog, связи блоков и сущностей с soft-delete);
- управления сущностями (слить, расклеить, переименовать, добавить алиас);
- ручного перезапуска pipeline'а для `RawEvent`;
- метрик Org (число блоков, сущностей, тем, RawEvent).

## Доступ

- `OrgAdminGuard` ([backend/src/modules/auth/guards/org-admin.guard.ts](backend/src/modules/auth/guards/org-admin.guard.ts)) — проверяет `RbacService.canManageOrg(userId, tenantId)` (роли `owner` или `admin` в Membership). super_admin тоже проходит.
- Tenant — через `TenantGuard` (header `X-Org-Id` или активная Org).

## API префикс

Все Org-Admin endpoints: `/api/v1/org-admin/*` (см. [api-layer.md](api-layer.md)).

| Группа | Префикс |
|---|---|
| Экономика | `/api/v1/org-admin/usage/*` (зеркалит `/api/v1/admin/usage/*` со scope=org) |
| Knowledge-core debug | `/api/v1/org-admin/knowledge/*` |

## Тумблеры воркеров

Поле `Org.workersEnabled: Json @default("{}")`. Структура: `{ "block-ingest": false, "block-distill": true, ... }`. Пустой объект = все воркеры включены.

`WorkerOrgGate.checkOrThrow(tenantId, workerName)` ([backend/src/modules/core-queue/worker-org-gate.ts](backend/src/modules/core-queue/worker-org-gate.ts)) — общий хелпер. Каждый knowledge-core воркер вызывает его в начале job. Если выключено — `throw new Error('worker_disabled_for_org')`, BullMQ ретраит.

Воркеры под gate'ом: `block-ingest`, `block-distill`, `block-linker`, `entity-resolver`, `theme-clusterer`, `reframing`, `strategic-alignment` (Фаза 9), `email-fetch` (Фаза 10).

## Soft-delete связей

`IdeaBlockLink` и `EntityLink` имеют поля `deletedAt: DateTime?`, `deletedBy: String?`.

Org-Admin удаляет связи через `DELETE /api/v1/org-admin/knowledge/links/:id?kind=block|entity` — soft. Hard-delete после 30 дней — vNext (отдельный cron, Фаза 11+).

## Слияние сущностей (manual)

`EntityMergeService.mergeManually(tenantId, fromEntityId, intoEntityId, byUserId)` ([backend/src/modules/knowledge-core/services/entity-merge.service.ts](backend/src/modules/knowledge-core/services/entity-merge.service.ts)) — прямой merge без LLM-арбитра. Используется через `POST /api/v1/org-admin/knowledge/entities/:id/merge`.

## Reprocess RawEvent

`POST /api/v1/org-admin/knowledge/raw-events/:id/reprocess` — удаляет блоки через `IdeaBlockEvidence.rawEventId` и переотправляет в `core.raw-events` с suffix-jobId (для прохождения dedup).

## UI

> ⚠️ **Устарело (2026-06-02).** Org-admin переехал на поверхность `/company-admin/*`; все `/settings/admin/*` теперь redirect-заглушки. Страницы **«Экономика»** и **«Ядро знаний» (debug)** удалены из клиента (см. шапку).

Расположение актуального UI: [frontend/app/(authenticated)/company-admin/](frontend/app/(authenticated)/company-admin/). Старые пути [frontend/app/(authenticated)/settings/admin/](frontend/app/(authenticated)/settings/admin/) — только редиректы для совместимости закладок:

| Старый URL | Поведение |
|---|---|
| `/settings/admin/usage` | удалена; redirect на `/company-admin` |
| `/settings/admin/knowledge-core` | удалена; redirect на `/company-admin` |
| `/settings/admin/members` | redirect на `/settings/organization` |
| `/settings/admin/sources` | redirect на `/company-admin/sources` |

## Связанные документы

- [admin-z-global.md](admin-z-global.md) — Z-Admin (для super_admin).
- [rbac-access-control.md](rbac-access-control.md) — Membership-роли.
- [ingest-and-sources.md](ingest-and-sources.md) — управление источниками (отдельная страница).
