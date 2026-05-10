---
type: project
status: in_progress
phase: 7
---

# Z-Admin (super_admin консоль)

> Глобальная админка владельца продукта Z. Доступ только под `User.isSuperAdmin = true` (отдельно от Membership-ролей Org).

## Назначение

Дать оператору Z единый интерфейс для:
- наблюдения экономики всех Org (расход USD, разбивка по провайдерам/функциям/Org/пользователям);
- drill-down до конкретного LLM-вызова с просмотром промпта и ответа;
- управления LLM-моделями для всех `LlmTaskType`;
- A/B-экспериментов между провайдерами/моделями;
- управления прайс-картой `LlmModelPrice`;
- управления тарифами и фичами Org (через `OrgEntitlement` — Фаза 12);
- мониторинга здоровья (Bull-очереди, размер БД, эмбеддинги).

## Доступ

- Поле `User.isSuperAdmin: Boolean @default(false)`.
- Назначается ТОЛЬКО через прямой `UPDATE` в БД: `UPDATE "User" SET "isSuperAdmin" = true WHERE email = ?`.
- UI для назначения super_admin'ов **не предусмотрен** (намеренно — снижает риск эскалации).

## Guard-цепочка

```
CookieAuthGuard → SuperAdminGuard → SuperAdminAuditInterceptor
```

`SuperAdminGuard` ([backend/src/modules/auth/guards/super-admin.guard.ts](backend/src/modules/auth/guards/super-admin.guard.ts)) проверяет `req.user.isSuperAdmin === true`, иначе `403 super_admin_required`.

`SuperAdminAuditInterceptor` ([backend/src/modules/admin/super-admin.audit.interceptor.ts](backend/src/modules/admin/super-admin.audit.interceptor.ts)) пишет в `SuperAdminAccessLog` каждый запрос — для compliance.

## API префикс

Все Z-Admin endpoints: `/api/v1/admin/*` (см. [api-layer.md](api-layer.md)).

## UI

Расположение: [frontend/app/(authenticated)/admin/](frontend/app/(authenticated)/admin/).
Защита: `AdminShell.tsx` смотрит `useAuth().isSuperAdmin`, иначе redirect.

| URL | Назначение |
|---|---|
| `/admin` | Глобальный дашборд экономики |
| `/admin/usage/users` | Аналитика по пользователям |
| `/admin/usage/functions` | Список функций с метриками |
| `/admin/usage/functions/:taskType` | Карточка функции, смена модели, A/B-старт |
| `/admin/experiments/:taskType` | A/B статус с recent calls |
| `/admin/llm-prices` | CRUD прайс-карты |
| `/admin/orgs` | Таблица Org (tier/freeze/delete) |
| `/admin/orgs/:id/billing` | Управление tier и overrides Org (Фаза 12) |
| `/admin/health` | Bull-очереди, БД, embeddings |

## Кэш

`AdminCacheService` ([backend/src/modules/admin/services/admin-cache.service.ts](backend/src/modules/admin/services/admin-cache.service.ts)) — single-process in-memory Map с TTL 60s.
Инвалидация при `setRouteForTaskType`, `setPrice`, `start/finishExperiment`, `setWorkersEnabled` через `invalidate('usage:')`.

## Связанные документы

- [admin-org-knowledge-core.md](admin-org-knowledge-core.md) — Org-Admin (для owner Org).
- [llm-router.md](llm-router.md) — A/B-эксперименты, prices, dataClass-routing.
- [tariffs-and-entitlements.md](tariffs-and-entitlements.md) — управление tier через Z-Admin.
