---
type: tz
status: done
phase: 7
feature: Z-Admin (super_admin) + Org-Admin (owner/admin) — отладка, наблюдение, аналитика стоимости, управление LLM-моделями, A/B
date: 2026-05-10
parent_tz: plans/tz/2026-05-10-knowledge-core-tz.md
references:
  - second-brain/01_projects/llm-router.md
  - second-brain/01_projects/rbac-access-control.md
  - second-brain/01_projects/themes.md
  - backend/src/modules/admin/
  - backend/src/modules/rbac/
---

# ТЗ: Фаза 7 — Админка отладки, наблюдения, аналитики стоимости, управления LLM-моделями

> Это самостоятельный, готовый к выполнению документ для агента-исполнителя. Все архитектурные решения зафиксированы. Вопросы не задаются — если возникает развилка, выбирай вариант, явно прописанный в разделе «Архитектурные решения». Если развилки нет — следуй базовым правилам Z (см. skill `core-engineering-standards`, `nestjs-rules`, `frontend-rules`, `prisma-db-push-rules`).

## Цель фазы

Построить **две независимые админки** поверх существующего ядра знаний:

- **Z-Admin** (для владельца продукта Z, роль `super_admin = User.isSuperAdmin === true`) — глобальный обзор всех Org, экономика всех пользователей и функций, управление LLM-моделями, A/B-сравнение, прайс-карта, тарифы (скелет под Фазу 12), мониторинг здоровья.
- **Org-Admin** (для владельца Org, роль `owner` или `admin` в Membership) — локальная экономика своей Org, отладка ядра знаний (связи, сущности, перезапуск pipeline, тумблеры воркеров), управление членами и источниками.

Принципиально: одна и та же логика расчётов используется обеими админками — `scope=global|org` параметр на API-эндпоинтах. Z-Admin — это `scope=global`, Org-Admin — это `scope=org` с `tenantId` из `@CurrentOrg()`.

## Что входит

### 7.A — Z-Admin (роль `super_admin`)

Расположение: `frontend/app/(authenticated)/admin/*`. Защита: новый middleware `RequireSuperAdminGuard` (см. шаг 1). Существующая страница `/admin/ai-models` сохраняется как часть Z-Admin (раздел «LLM-модели»).

| # | Страница | Назначение |
|---|---|---|
| 7.A.1 | `/admin` | Дашборд глобальной экономики: счётчики Org/users/active, общий расход USD за день/неделю/месяц, график расхода по провайдерам, топ Org, топ функций, алерты. |
| 7.A.2 | `/admin/usage/users` | Аналитика по пользователям (всем Org): таблица + drill-down на ленту LLM-вызовов с просмотром промпта/ответа. CSV-экспорт. |
| 7.A.3 | `/admin/usage/functions` | Аналитика по `taskType`: текущая модель + fallback, средняя стоимость/длительность/fail rate, график активности 30d, ссылки на 10 последних вызовов. Drill-down на конкретный вызов. |
| 7.A.4 | `/admin/usage/functions/:taskType` | Управление моделью функции: смена `LlmTaskRoute.providers` (массив с порядком приоритета). Кнопка «Запустить A/B-эксперимент». |
| 7.A.5 | `/admin/experiments/:taskType` | Статус A/B-эксперимента: счётчики A vs B, средние метрики, 10 последних вызовов A vs B рядом для глазной оценки. Кнопки «Перейти на A», «Перейти на B», «Продлить», «Откатить». |
| 7.A.6 | `/admin/llm-prices` | CRUD прайс-карты `LlmModelPrice` с версионированием через `effectiveFrom/To`. |
| 7.A.7 | `/admin/orgs` | Таблица всех Org: тариф, владелец, расход за месяц, действия (сменить тариф, заморозить/разморозить, удалить). |
| 7.A.8 | `/admin/health` | Состояние воркеров (по всем Org), доступность провайдеров, размер БД/S3, количество эмбеддингов. |

Существующий `/admin/ai-models` (если есть отдельной страницей) объединяется с 7.A.3 как раздел «Список функций» в 7.A.3 — отдельной страницы под него больше не нужно.

### 7.B — Org-Admin (роль `owner`/`admin` в Membership)

Расположение: `frontend/app/(authenticated)/settings/admin/*`. Защита: `CookieAuthGuard + TenantGuard + RbacService.canManageOrg(userId, tenantId)`.

| # | Страница | Назначение |
|---|---|---|
| 7.B.1 | `/settings/admin/usage` | Локальная экономика: расход за период, разбивка по `taskType` и пользователям ВНУТРИ Org. CSV-экспорт. Ровно те же виджеты, что в 7.A.1 — только со `scope=org`. |
| 7.B.2 | `/settings/admin/knowledge-core` | Отладка ядра: тумблеры воркеров (`Org.workersEnabled` jsonb), журнал последних 200 событий `AuditLog`, последние 100 связей `IdeaBlockLink`/`EntityLink` с фильтрами и удалением, управление сущностями (слить/расклеить/переименовать), кнопка «Перезапустить pipeline для RawEvent», метрики Org. |
| 7.B.3 | `/settings/admin/members` | Уже сделано в Фазе 0 как `/settings/organization`. Добавить редирект `/settings/admin/members` → `/settings/organization` (либо физически перенести страницу под `/settings/admin/`). Решение: **редирект** (не двигаем страницу, чтобы не ломать ссылки). |
| 7.B.4 | `/settings/admin/sources` | Уже сделано в Фазе 10 как `/settings/sources`. На Фазе 7 — пока заглушка с anchor-ссылкой и текстом «Управление источниками — раздел „Подключения“ в `/settings/sources` (появится в Фазе 10)». |

## Архитектурные решения (зафиксированы — не пересматриваем)

| # | Решение |
|---|---|
| 1 | **Два guard'а**, не один: `SuperAdminGuard` (для `/api/v1/admin/*`, проверяет `User.isSuperAdmin`) и `OrgAdminGuard` (для `/api/v1/org-admin/*`, проверяет `RbacService.canManageOrg`). Унификация под `scope=global\|org` — на уровне сервисов, не guard'ов. |
| 2 | **Префикс роутов**: `/api/v1/admin/*` для Z-Admin (super_admin), `/api/v1/org-admin/*` для Org-Admin. Существующий `/api/v1/admin/llm-routes` (Фаза 0/8.2) и `/admin/api/v1/ai-usage` (Фаза 8.2 legacy) — мигрируем под новый guard `SuperAdminGuard` (см. ниже шаг миграции). |
| 3 | **Единые сервисы расчётов** в `backend/src/modules/admin/services/`: `AdminUsageService`, `AdminFunctionsService`, `AdminExperimentsService`, `AdminPricesService`, `AdminOrgsService`, `AdminHealthService`, `OrgAdminKnowledgeService`. Каждый принимает `{scope: 'global'\|'org', tenantId?: string}`. Z-Admin контроллер передаёт `{scope:'global', tenantId: undefined}`, Org-Admin контроллер — `{scope:'org', tenantId: currentOrg.id}`. |
| 4 | **Кэширование результатов дашборда**: `AdminUsageService.getDashboard(...)` использует in-memory cache (Map) с TTL 60s, ключ = `${scope}:${tenantId\|'*'}:${period}`. Свежесть метрик ≤ 1 минута (DoD ТЗ-родителя). |
| 5 | **`SuperAdminAccessLog`** — новая таблица: `id`, `superAdminUserId`, `accessedTenantId?`, `route`, `params jsonb`, `createdAt`. Записывается через `SuperAdminAuditInterceptor` для каждого drill-down действия super_admin'а. Используется для compliance и ежемесячного отчёта (письмо — vNext, в этой фазе только запись). |
| 6 | **`Org.workersEnabled jsonb`** — новое поле, default `{}`. Пустой объект = все воркеры включены. Структура: `{ "block-ingest": false, "block-distill": true, ... }`. Воркеры на старте jobs проверяют `org.workersEnabled[workerName] !== false` — если выключено, скипают job (но не теряют — ack с задержкой 5 минут). |
| 7 | **Удаление связей с soft-delete**: `IdeaBlockLink` / `EntityLink` получают поля `deletedAt`, `deletedBy`. Удаление через Org-Admin делает soft-delete; через 30 дней крон чистит `WHERE deletedAt < now() - 30d`. Это уже есть в схеме как `LinkStatus { active, deleted }` — переиспользуем существующий `status='deleted'` + новые `deletedAt/deletedBy`. |
| 8 | **Слияние сущностей** через Org-Admin использует существующий `EntityMergeService` (Фаза 2), но в обход LLM-арбитра (ручное слияние): API `POST /api/v1/org-admin/entities/:id/merge {intoEntityId}` напрямую вызывает `EntityMergeService.mergeManually(...)` (новый метод). |
| 9 | **Реprocess RawEvent**: `POST /api/v1/org-admin/raw-events/:id/reprocess` — снова кладёт в `core.raw-events` с тем же `rawEventId`, BullMQ jobId = `raw_${rawEventId}_v2_${Date.now()}` (suffix чтобы пройти dedup). Worker удаляет старые блоки этого RawEvent (через `IdeaBlockEvidence.rawEventId`) и создаёт заново. |
| 10 | **A/B-эксперименты**. Старт: `POST /api/v1/admin/experiments` body `{taskType, modelB, splitPercent?, durationDays?}`. Сервис записывает в `LlmTaskRoute.experiment = {enabled:true, modelA: <текущая первая из providers>, modelB, splitPercent: 50, startedAt, endsAt: now+7d}`. Завершение: `POST /api/v1/admin/experiments/:taskType/finish?winner=A\|B` — обнуляет `experiment` и при `winner=B` ставит modelB первой в `providers`. Уже есть поддержка в `LlmRouter` (см. `experimentGroup` в `AiUsageLog`). |
| 11 | **CSV-экспорт** — формируется на лету в контроллере через stream + `,;\n`-сериализацию (без библиотек). Имя файла: `usage-{scope}-{period}-{Date.now()}.csv`. Header: `Content-Type: text/csv; charset=utf-8`. |
| 12 | **Не делаем real-time push**. Все дашборды — pull-based, обновление по кнопке/таймеру (TTL кэша 60s). SSE/WebSocket для live-обновлений — vNext. |
| 13 | **Health-страница** не интегрируется с Prometheus в этой фазе. Использует только: `Bull.getJobCounts()` для воркеров, `prisma.$queryRaw` для размера БД (`pg_database_size`), `s3.headObject` опционально (или statics из `IngestSource.byteCount` суммой). Полная Prometheus + Grafana — Фаза 11. |
| 14 | **Tier-управление в 7.A.7** — только UI и API для смены `Org.tier`, без gating-логики. Полноценный entitlement engine — Фаза 12. |
| 15 | **Delete Org** — soft-delete: `Org.deletedAt = now()`, каскад уже описан через `onDelete: Cascade` в схеме. На Фазе 7 — soft-delete (физический cascade — vNext, отдельным кроном). |

## Что не входит

- Полноценный billing-модуль (выставление счетов, оплата) — vNext, отдельный проект.
- Кастомные дашборды (drag-and-drop виджеты) — vNext.
- Алерты по email/telegram о превышении расходов — vNext (можно добавить в Фазу 11 если нужно).
- Realtime-обновление дашбордов через SSE — vNext.
- Полный entitlement engine (gating фич по tier) — Фаза 12.
- Prometheus + Grafana интеграция — Фаза 11.
- Удаление `LinkStatus='deleted'` физически (hard-delete после 30d) — отдельным кроном можно сделать в этой фазе или отнести в Фазу 11. Решение: **отнесём в Фазу 11** (вместе с retention для всего ядра).
- Полные unit-тесты на каждый сервис. Минимум — smoke-тесты на ключевые сервисы (`AdminUsageService`, `AdminExperimentsService`).

## DoD верхнего уровня

- [ ] Super_admin заходит в `/admin` — видит реальные данные по всем Org (не моки).
- [ ] Super_admin может детализировать расход до конкретного LLM-вызова с просмотром промпта (input) и ответа (output) — drill-down работает на `AiUsageLog.id`.
- [ ] Super_admin меняет модель для функции `block-distill` — следующие вызовы идут на новую модель (проверка через `AiUsageLog.model` после нового вызова).
- [ ] Super_admin запускает A/B на функции `summary-v2` — после ≥10 вызовов видит сравнение метрик A vs B.
- [ ] Owner Org заходит в `/settings/admin/usage` — видит только свою экономику, чужую — нет (попытка зайти под manager — 403).
- [ ] Owner Org может выключить любой воркер своей Org — jobs соответствующего воркера для этой Org перестают обрабатываться.
- [ ] Owner Org может найти и слить две сущности — `mentionsCount` объединённой = сумме исходных.
- [ ] Перезапуск RawEvent работает: блоки исчезают, потом появляются заново (idempotency сохраняется).
- [ ] Попытка не-super_admin зайти в `/admin` или `/api/v1/admin/*` возвращает 403.
- [ ] Все метрики на дашбордах свежие (TTL ≤ 1 минута).
- [ ] Создан `second-brain/01_projects/admin-z-global.md` — про Z-Admin.
- [ ] Создан `second-brain/01_projects/admin-org-knowledge-core.md` — про Org-Admin.
- [ ] Обновлён `second-brain/02_architecture/module-map.md` — добавлен раздел про admin-модуль (Z-Admin + Org-Admin).
- [ ] Обновлён `second-brain/02_architecture/data-model.md` — добавлены `SuperAdminAccessLog`, `Org.workersEnabled`, `IdeaBlockLink.deletedAt/By`, `EntityLink.deletedAt/By`.
- [ ] `bun run typecheck` (backend) — зелёный.
- [ ] `bun run typecheck` (frontend) — зелёный.
- [ ] `bun run prisma:push --accept-data-loss` после каждого шага со схемой.
- [ ] `decisions-log.md` дополнен соответствующей строкой по дате.

## Риски и митигации

| Риск | Митигация |
|---|---|
| Опасные операции в Org-Admin (расклейка сущностей, массовое удаление связей) — необратимы | Явное подтверждение через диалог + soft-delete (30d). Восстановление — vNext, сейчас просто SQL-update `status='active'`. |
| Утечка данных между Org через Z-Admin (super_admin технически видит чужое) | Каждое drill-down действие super_admin'а пишется в `SuperAdminAccessLog`. Email-отчёт — vNext. |
| A/B даёт нестабильные ответы пользователям | Плашка в UI Org-Admin «AI работает в режиме A/B» — vNext. На Фазе 7 только super_admin видит это в Z-Admin. Конечный пользователь не видит изменения формата ответа. |
| Расчёт `costUsd` устаревает | Уже митигировано: `LlmModelPrice` версионируется через `effectiveFrom/To`, ретроспективные расчёты идут по цене на момент вызова. На Фазе 7 — только UI для управления. |
| Кэш дашборда показывает устаревшие данные после изменения модели/прайса | Инвалидация кэша на `PUT /api/v1/admin/llm-routes/:taskType`, `POST /api/v1/admin/llm-prices`, `POST /api/v1/admin/experiments`. |
| Тяжёлые SQL-запросы на больших Org | Все агрегации идут с `WHERE createdAt >= ?` (индекс `tenantId, createdAt` уже есть на `AiUsageLog`). На Фазе 7 без шардирования. Если Org реально вырастет (>1M LLM-вызовов в месяц) — отдельная таска по матвью. |

## Текущее состояние (на чём строим)

### Что уже есть в коде
- **`User.isSuperAdmin: Boolean`** ([backend/prisma/schema.prisma:329](backend/prisma/schema.prisma#L329)) — поле есть, default false.
- **`Membership` + `RbacService.canManageOrg`** — Org-Admin guard опирается на это.
- **`AiUsageLog`** уже имеет `tenantId, taskType, sourceRef jsonb, experimentGroup, cachedTokens, costUsd Decimal(10,6)`. Индексы `(tenantId, createdAt)`, `(tenantId, taskType, createdAt)`, `(userId, taskType, createdAt)` уже есть.
- **`LlmTaskRoute`** уже имеет `tenantId? + experiment jsonb`. Уникальный `(taskType, tenantId)`. Per-Org override уже технически работает: `LlmRouterService.findRoute()` сначала ищет по `tenantId`, потом по `tenantId=null`.
- **`LlmModelPrice`** существует с `effectiveFrom/To`. `LlmRouter.estimateCost()` уже её использует.
- **`AdminAuditInterceptor`** — пишет в `AdminAuditLog` для `/admin/api/v1/*` (legacy). Расширяем под `/api/v1/admin/*` и добавляем `SuperAdminAuditInterceptor` (новый, пишет в `SuperAdminAccessLog`).
- **Существующий `AdminGuard`** ([backend/src/modules/auth/guards/admin.guard.ts](backend/src/modules/auth/guards/admin.guard.ts)) — проверяет `user.role==='admin'` (legacy `UserRole`-enum, а не Membership). Оставляем для обратной совместимости, но **на Фазе 7 он перестаёт быть единственным**: новые контроллеры — под `SuperAdminGuard`.
- **`/admin/api/v1/ai-usage`** ([backend/src/modules/admin/ai-usage.controller.ts](backend/src/modules/admin/ai-usage.controller.ts)) и **`/api/v1/admin/llm-routes`** ([backend/src/modules/admin/llm-routes/llm-routes.controller.ts](backend/src/modules/admin/llm-routes/llm-routes.controller.ts)) — legacy под `AdminGuard`. На Фазе 7 — мигрируем под `SuperAdminGuard` (роуты не меняем, только guard).
- **`AdminModule`** — `@Global`. Уже зарегистрирован, добавляем туда новые контроллеры/сервисы.
- **`/admin/ai-models`** на фронте, если есть отдельной страницей, — соединяем с 7.A.3 (на Фазе 7 — отдельной страницы под него больше не делаем; функционал переезжает в карточки функций).

### Что нужно добавить
- `SuperAdminGuard` (новый guard, проверяет `User.isSuperAdmin`).
- `OrgAdminGuard` (новый guard, проверяет `RbacService.canManageOrg(userId, tenantId)`).
- `SuperAdminAccessLog` (новая Prisma-модель).
- `Org.workersEnabled jsonb` (новое поле).
- `IdeaBlockLink.deletedAt/By`, `EntityLink.deletedAt/By` (новые поля для soft-delete).
- 7 новых сервисов в `backend/src/modules/admin/services/`.
- 8 новых контроллеров (Z-Admin) + 3 новых контроллера (Org-Admin).
- 2 новых модуля во фронте: `/admin/*` и `/settings/admin/*`.

## Пошаговый план для агента-исполнителя

Фаза 7 разбита на **9 шагов**. Каждый — атомарный коммит. После шагов 1, 2, 6 — `bun run prisma:push --accept-data-loss` + `bun run build`. После шагов 3, 5, 7, 8 — `bun run typecheck` обязательно.

### Шаг 1 — Prisma schema + db push

**Цель:** добавить три недостающих поля и одну новую таблицу.

**Изменения в [backend/prisma/schema.prisma](backend/prisma/schema.prisma):**

1. **`Org.workersEnabled Json @default("{}")`** — после `Org.tier`. Комментарий: `/// Карта тумблеров воркеров для Org. {} = все включены. Воркеры читают org.workersEnabled[workerName] !== false. Управляется из Org-Admin (Фаза 7).`

2. **`IdeaBlockLink.deletedAt DateTime?`**, **`IdeaBlockLink.deletedBy String?`** + index `@@index([tenantId, deletedAt])`. Комментарий: `/// Soft-delete: записывается при удалении из Org-Admin. Hard-delete после 30 дней (Фаза 11).`

3. **`EntityLink.deletedAt DateTime?`**, **`EntityLink.deletedBy String?`** + аналогичный индекс.

4. **Новая модель `SuperAdminAccessLog`**:
```prisma
/// Лог drill-down действий super_admin (Z-Admin Фаза 7).
/// Любое чтение/запись super_admin'а в данные конкретной Org пишется сюда
/// для compliance. На Фазе 7 — только запись, ежемесячный email-отчёт vNext.
model SuperAdminAccessLog {
  id                String   @id @default(cuid())
  superAdminUserId  String
  superAdmin        User     @relation("SuperAdminAccessLog", fields: [superAdminUserId], references: [id], onDelete: Cascade)
  /// NULL = действие на глобальном уровне (без конкретной Org).
  accessedTenantId  String?
  route             String
  method            String
  params            Json?
  createdAt         DateTime @default(now())

  @@index([superAdminUserId, createdAt])
  @@index([accessedTenantId, createdAt])
}
```
В `model User` добавить обратную связь: `superAdminAccessLogs SuperAdminAccessLog[] @relation("SuperAdminAccessLog")`.

**Команда:** `bun run prisma:push --accept-data-loss && bun run prisma:generate`.

**Коммит:** `feat(knowledge-core): фаза 7 шаг 1 — schema (Org.workersEnabled, link.deletedAt/By, SuperAdminAccessLog)`.

### Шаг 2 — Guards: SuperAdminGuard + OrgAdminGuard

**Цель:** дать новым контроллерам корректные guard'ы.

**Создать:**
- `backend/src/modules/auth/guards/super-admin.guard.ts` — `SuperAdminGuard implements CanActivate`. После `CookieAuthGuard` смотрит `req.user.isSuperAdmin === true`. Иначе `NotAuthorizedError('super_admin_required')` (403).
- `backend/src/modules/auth/guards/org-admin.guard.ts` — `OrgAdminGuard`. Использует `RbacService.canManageOrg(userId, tenantId)`. tenantId — из `req.org.id` (положенного `TenantGuard`'ом). Иначе 403 `org_admin_required`.

**Создать `SuperAdminAuditInterceptor`:**
- `backend/src/modules/admin/super-admin.audit.interceptor.ts`. Inject `PrismaService`. На каждый запрос пишет `SuperAdminAccessLog` с `route, method, params (req.query + sanitized body), accessedTenantId (из X-Org-Id если есть, иначе null)`. Не блокирует ответ — fire-and-forget.

**Регистрация:** `AdminModule.providers` — добавить новый interceptor. `AuthModule.providers` — добавить `SuperAdminGuard`. `OrgsModule` (или отдельный `OrgAdminModule`, см. шаг 5) — `OrgAdminGuard`.

**Миграция legacy:** в `AiUsageAdminController` и `LlmRoutesController` существующий `AdminGuard` **дополняется** `SuperAdminGuard`. Decoder: `@UseGuards(CookieAuthGuard, SuperAdminGuard)` (убираем `AdminGuard`). Это означает: пользователи с legacy `User.role='admin'`, но без `isSuperAdmin=true`, теряют доступ. Это намеренно — для прода назначаем `isSuperAdmin=true` через DB одному-двум аккаунтам владельца Z. Документация (`second-brain/01_projects/admin-z-global.md`) фиксирует, как это делается.

**Verification:** написать smoke-тест `super-admin.guard.spec.ts` + `org-admin.guard.spec.ts` (Jest, mock req.user).

**Коммит:** `feat(knowledge-core): фаза 7 шаг 2 — SuperAdminGuard + OrgAdminGuard + SuperAdminAuditInterceptor`.

### Шаг 3 — AdminUsageService + контроллеры 7.A.1, 7.A.2, 7.A.3, 7.B.1

**Цель:** дашборды и аналитика usage (общая логика).

**Создать `backend/src/modules/admin/services/admin-usage.service.ts`:**

Методы (все принимают `{scope, tenantId?, period}`):
- `getDashboard({scope, tenantId, period})` — счётчики Org/users/active (для global) или members/sources (для org), общий расход USD, разбивка по провайдерам, топ-10 Org по расходу (только global), топ-10 функций по расходу. Кэш 60s.
  - SQL: `SELECT SUM(costUsd) FROM AiUsageLog WHERE createdAt >= ? [AND tenantId = ?]` → одна цифра.
  - Группировки через `groupBy({by: ['provider'\|'taskType'\|'tenantId'], _sum: {costUsd}, _count: {_all}})`.
- `getUsersUsage({scope, tenantId, period, filters})` — таблица: user, org (для global), расход, число вызовов, разбивка по taskType, средняя стоимость на встречу (= `SUM costUsd / COUNT distinct meetingId`). Pagination cursor-based.
- `getCallsLog({scope, tenantId, taskType?, userId?, limit, cursor})` — лента вызовов для drill-down. Возвращает `AiUsageLog` записи + sourceRef-resolve (`{type:'meeting',id} → meeting.title` через JOIN).
- `getCallDetails({scope, tenantId, callId})` — одна запись + промпт + ответ. **Промпт и ответ хранятся не в `AiUsageLog`**, а в logs LlmRouter'а. Решение: расширить `AiUsageLog` новыми полями `requestPreview text`, `responsePreview text` (truncated до 8KB каждый), запись через `LlmRouter` уже сейчас. **На Фазе 7 — добавить эти поля в schema (Шаг 1 amend) и заполнять через LlmRouter.** Для исторических записей — поля null, drill-down показывает «недоступно (вызов до Фазы 7)».
  - **Уточнение для шага 1:** добавить `AiUsageLog.requestPreview text?`, `AiUsageLog.responsePreview text?` (без индекса).
- `getFunctionsUsage({scope, tenantId, period})` — список всех `LlmTaskType`, для каждого: текущая модель (`LlmTaskRoute.providers[0]`), fallback chain, средняя стоимость/длительность/fail rate за период, средние input/output токены, график активности (count по дням за 30d).
- `getFunctionCalls({scope, tenantId, taskType, limit=10})` — последние N вызовов конкретной функции для глазной оценки качества. Использует тот же `getCallsLog` с фильтром.

**Создать контроллеры:**
- `backend/src/modules/admin/controllers/admin-usage.controller.ts` под `@Controller('api/v1/admin/usage')` с `@UseGuards(CookieAuthGuard, SuperAdminGuard)` + `@UseInterceptors(SuperAdminAuditInterceptor)`:
  - `GET /dashboard?period=...` → `AdminUsageService.getDashboard({scope:'global', period})`.
  - `GET /users?period=...&filters=...&limit=&cursor=` → `getUsersUsage`.
  - `GET /calls?taskType=&userId=&limit=&cursor=` → `getCallsLog`.
  - `GET /calls/:id` → `getCallDetails`.
  - `GET /functions?period=...` → `getFunctionsUsage`.
  - `GET /functions/:taskType/calls?limit=` → `getFunctionCalls`.
  - `GET /export/usage.csv?...` → CSV-stream.

- `backend/src/modules/admin/controllers/org-admin-usage.controller.ts` под `@Controller('api/v1/org-admin/usage')` с `@UseGuards(CookieAuthGuard, TenantGuard, OrgAdminGuard)`:
  - `GET /dashboard?period=...` → `getDashboard({scope:'org', tenantId: req.org.id, period})`.
  - `GET /users?...`, `/calls?...`, `/calls/:id`, `/export/usage.csv` — то же самое со `scope:'org'`.

**DTO:** `backend/src/modules/admin/dto/admin-usage.dto.ts` — Zod-схемы для query-параметров (period: `day|week|month|custom`, при `custom` — `from/to`).

**Verification:** smoke-тест `admin-usage.service.spec.ts` — на seed-данных проверить корректность `getDashboard`/`getUsersUsage`. `bun run typecheck`.

**Коммит:** `feat(knowledge-core): фаза 7 шаг 3 — AdminUsageService + endpoints /admin/usage и /org-admin/usage`.

### Шаг 4 — AdminFunctionsService + LlmRoutesService расширение

**Цель:** управление моделями для функций (7.A.4).

**Создать `backend/src/modules/admin/services/admin-functions.service.ts`:**
- `listFunctions()` — возвращает все `LlmTaskType` (из `LlmRouterService.LlmTaskType` union, экспортируем массив `ALL_LLM_TASK_TYPES`). Для каждого: текущая `LlmTaskRoute` (tenantId=null), наличие активного эксперимента, последняя `AiUsageLog`-метрика.
- `setRouteForTaskType({taskType, providers, isActive})` — обновляет глобальную (tenantId=null) `LlmTaskRoute`. Использует существующий `LlmRouterService.setRoute()`. Инвалидирует in-memory cache `AdminUsageService` (через `AdminCacheService` — единый сервис кэша, см. Шаг 8).

**Расширить `backend/src/modules/admin/llm-routes/dto/llm-routes.dto.ts`:**
- В `TASK_TYPES` массиве добавить все недостающие taskType (см. `LlmTaskType` union в `llm-router.service.ts:39`): `card-rollup, card-chat, block-ingest, block-distill, block-linker, entity-resolver, entity-merge-arbiter, entity-graph-builder, theme-classify, reframing, card-rollup-v2, task-extract-v2, chapter-extract-v2, summary-v2, chat-v2, goal-alignment, dashboard-summary`.
- Принципиально: один источник правды — экспортировать `ALL_LLM_TASK_TYPES` из `llm-router.service.ts` и переиспользовать в DTO.

**Контроллер:** на 7.A.3 уже есть `LlmRoutesController` (`PUT /api/v1/admin/llm-routes/:taskType`) — переиспользуем. Добавим:
- `GET /api/v1/admin/functions` → `AdminFunctionsService.listFunctions()`.
- `GET /api/v1/admin/functions/:taskType` → детальная карточка функции.

**Verification:** ручной smoke — изменить модель, проверить что следующий вызов идёт через новую (через `AiUsageLog.model`).

**Коммит:** `feat(knowledge-core): фаза 7 шаг 4 — AdminFunctionsService + расширение LlmRoutesController на все taskType`.

### Шаг 5 — AdminExperimentsService + контроллеры 7.A.4, 7.A.5

**Цель:** A/B-эксперименты.

**Создать `backend/src/modules/admin/services/admin-experiments.service.ts`:**
- `startExperiment({taskType, modelB, splitPercent=50, durationDays=7})`:
  - Загрузить текущий `LlmTaskRoute` (tenantId=null).
  - `modelA = providers[0].provider:providers[0].model` (или `<provider>:default` если model не задан).
  - Записать `experiment = {enabled:true, modelA, modelB, splitPercent, startedAt: now, endsAt: now+durationDays*24h}` в `LlmTaskRoute.experiment`.
  - Сбросить кэш роутов (`LlmRouterService.refreshRoutes()`).
- `getExperimentStatus(taskType)`:
  - Прочитать `LlmTaskRoute.experiment`.
  - Подсчитать через `AiUsageLog` где `taskType = ? AND experimentGroup IS NOT NULL AND createdAt >= experiment.startedAt`: `groupBy(experimentGroup)` → counts, avg cost, avg duration, fail rate, avg tokens.
  - Вернуть `{config: experiment, metrics: {A: {...}, B: {...}}, recentCalls: {A: [...], B: [...]}}`.
- `finishExperiment({taskType, winner: 'A'\|'B'})`:
  - Прочитать текущий `experiment.modelB`, текущие `providers`.
  - Если winner=B: переставить modelB в первую позицию `providers`. Парсинг `<provider>:<model>` → `{provider, model}`.
  - Обнулить `experiment = null`.
  - Опционально записать в `AuditLog` итог эксперимента.

**Контроллер:** `backend/src/modules/admin/controllers/admin-experiments.controller.ts`:
- `POST /api/v1/admin/experiments` body `{taskType, modelB, splitPercent?, durationDays?}` → `startExperiment`.
- `GET /api/v1/admin/experiments/:taskType` → `getExperimentStatus`.
- `POST /api/v1/admin/experiments/:taskType/finish` body `{winner}` → `finishExperiment`.
- `DELETE /api/v1/admin/experiments/:taskType` → отмена (обнулить `experiment = null` без миграции `providers`).

**DTO:** Zod-схема `StartExperimentSchema` с проверкой `splitPercent ∈ [1, 99]`, `durationDays ∈ [1, 30]`.

**Verification:** ручной smoke — стартовать эксперимент на `summary-v2`, после нескольких вызовов проверить, что `AiUsageLog.experimentGroup` заполняется.

**Коммит:** `feat(knowledge-core): фаза 7 шаг 5 — AdminExperimentsService + endpoints /admin/experiments`.

### Шаг 6 — AdminPricesService + AdminOrgsService + AdminHealthService (7.A.6, 7.A.7, 7.A.8)

**Цель:** прайс-карта, управление Org, health.

**`AdminPricesService`** ([backend/src/modules/admin/services/admin-prices.service.ts](backend/src/modules/admin/services/admin-prices.service.ts)):
- `listPrices({activeOnly: boolean})` — `LlmModelPrice.findMany({where: activeOnly ? {effectiveTo: null} : {}, orderBy: [{provider}, {model}, {effectiveFrom: 'desc'}]})`.
- `setPrice({provider, model, inputCost, outputCost, cachedCost?, currency, effectiveFrom?})`:
  - Транзакция: `update {where: {provider, model, effectiveTo: null}, data: {effectiveTo: effectiveFrom ?? now}}` (закрыть старую) → `create {provider, model, ..., effectiveFrom: effectiveFrom ?? now}`.
  - Сбросить in-memory `priceCache` в `LlmRouterService` (см. метод `refreshPrices()` — добавить если нет).

**Контроллер:** `backend/src/modules/admin/controllers/admin-prices.controller.ts`:
- `GET /api/v1/admin/llm-prices?activeOnly=` → `listPrices`.
- `POST /api/v1/admin/llm-prices` body `{provider, model, ...}` → `setPrice`.

**`AdminOrgsService`** ([backend/src/modules/admin/services/admin-orgs.service.ts](backend/src/modules/admin/services/admin-orgs.service.ts)):
- `listOrgs({period, search?, limit, cursor})` — `Org.findMany` + JOIN агрегации `_count: {memberships: true, meetings: true}` + `SUM(AiUsageLog.costUsd) WHERE tenantId = org.id AND createdAt >= ?` (отдельным `groupBy`).
- `updateOrg(orgId, {tier?, freeze?})` — `freeze=true` ставит `Org.deletedAt = now()` (soft); `freeze=false` обнуляет; `tier` напрямую обновляет.
- `deleteOrg(orgId)` — soft `deletedAt = now()`. Cascade hard-delete — vNext.

**Контроллер:** `backend/src/modules/admin/controllers/admin-orgs.controller.ts`:
- `GET /api/v1/admin/orgs?...` → `listOrgs`.
- `PATCH /api/v1/admin/orgs/:id` → `updateOrg`.
- `DELETE /api/v1/admin/orgs/:id` → `deleteOrg`.

**`AdminHealthService`** ([backend/src/modules/admin/services/admin-health.service.ts](backend/src/modules/admin/services/admin-health.service.ts)):
- `getHealth()` — собирает:
  - **Воркеры**: `Bull.Queue.getJobCounts()` для каждой очереди из `CORE_QUEUE_NAMES` + `AI_QUEUE_NAMES`. Возвращает `{queueName, waiting, active, completed, failed, delayed}`.
  - **Размер БД**: `prisma.$queryRaw<[{size: bigint}]>\`SELECT pg_database_size(current_database()) AS size\``.
  - **Эмбеддинги**: `prisma.ideaBlock.count()` + `prisma.entity.count()`.
  - **S3**: пропускаем (Фаза 11).
  - **Провайдеры**: пропускаем (Фаза 11). Можно добавить простейший ping (HEAD на anthropic.com / openai-proxy) с TTL 5min — опционально.

**Контроллер:** `backend/src/modules/admin/controllers/admin-health.controller.ts`:
- `GET /api/v1/admin/health` → `getHealth`.

**Verification:** `bun run typecheck` + ручной smoke.

**Коммит:** `feat(knowledge-core): фаза 7 шаг 6 — Prices/Orgs/Health сервисы и endpoints`.

### Шаг 7 — Org-Admin: knowledge-core debug (7.B.2)

**Цель:** Org-Admin отладка ядра.

**Создать `OrgAdminKnowledgeService`** ([backend/src/modules/admin/services/org-admin-knowledge.service.ts](backend/src/modules/admin/services/org-admin-knowledge.service.ts)):
- `setWorkersEnabled(tenantId, patch: Record<string, boolean>)` — мерджит patch в `Org.workersEnabled jsonb`.
- `getRecentAuditLogs(tenantId, {limit=200, entityTypes: string[]})` — `AuditLog.findMany WHERE tenantId AND action LIKE '<entityType>.%' ORDER BY createdAt DESC LIMIT ?`.
- `listLinks(tenantId, {kind: 'block'\|'entity', sortBy: 'confidence'\|'createdAt', minConfidence?, status?='active', limit=100})`.
- `deleteLink(tenantId, kind, linkId)` — soft-delete: `update {deletedAt: now, deletedBy: userId, status: 'deleted'}`.
- `bulkDeleteLinks(tenantId, kind, filters)` — массовое удаление по фильтру (с подтверждением через query `?confirm=YES`).
- `mergeEntities(tenantId, entityId, intoEntityId)` — вызов `EntityMergeService.mergeManually(...)` (новый метод в `entity-merge.service.ts`).
- `unmergeEntity(tenantId, entityId, sourceEntityId)` — расклейка. Если в `Entity` есть `mergedFromIds jsonb` (если нет — добавить в schema; **проверить и при необходимости добавить в Шаг 1**), вернуть из массива на отдельную запись.
- `renameEntity(tenantId, entityId, newCanonicalName)`.
- `addAlias(tenantId, entityId, alias)` — `Entity.aliases` jsonb-массив (проверить наличие; если нет — vNext, на Фазе 7 заглушка).
- `reprocessRawEvent(tenantId, rawEventId)` — удалить `IdeaBlock` через `IdeaBlockEvidence.rawEventId` + `IdeaBlockEntity` + связанные `IdeaBlockLink`. Затем `CoreQueueService.enqueueRawReceived(rawEventId, suffix=Date.now().toString())`.
- `getOrgMetrics(tenantId)` — счётчики (RawEvent/IdeaBlock/Entity/Theme/links за всё время + за период), avg confidence по типам связей, расход LLM-токенов за сутки/неделю.

**Расширить `EntityMergeService`** ([backend/src/modules/knowledge-core/services/entity-merge.service.ts](backend/src/modules/knowledge-core/services/entity-merge.service.ts)):
- Добавить публичный метод `mergeManually(tenantId, fromEntityId, intoEntityId, byUserId)` — вне LLM-арбитра, прямой merge: `IdeaBlockEntity.entityId` → `intoEntityId` (с разрешением unique-конфликтов), `EntityLink.entityFromId/ToId` → `intoEntityId`, `Entity.delete(fromEntityId)`. Логирует в `AuditLog`.

**Контроллер:** `backend/src/modules/admin/controllers/org-admin-knowledge.controller.ts` под `@Controller('api/v1/org-admin/knowledge')`:
- `PATCH /workers` body `{workerName: bool}` (multi).
- `GET /audit-logs?...`.
- `GET /links?kind=&...`.
- `DELETE /links/:id?kind=`.
- `POST /links/bulk-delete?kind=&confirm=YES` body фильтра.
- `POST /entities/:id/merge` body `{intoEntityId}`.
- `POST /entities/:id/unmerge` body `{sourceEntityId}`.
- `PATCH /entities/:id` body `{name?, alias?}`.
- `POST /raw-events/:id/reprocess`.
- `GET /metrics`.

**Воркеры — реакция на `Org.workersEnabled`:**
- Каждый knowledge-core воркер (`block-ingest`, `block-distill`, `block-linker`, `entity-resolver`, `theme-clusterer`, `reframing`) на старте processor'а:
  ```ts
  const org = await prisma.org.findUnique({where: {id: tenantId}, select: {workersEnabled: true}});
  if (org?.workersEnabled?.[WORKER_NAME] === false) {
    // Отложить job на 5 минут, повторить
    throw new UnrecoverableError(`worker_disabled_for_org`);
    // или: return job.moveToDelayed(Date.now() + 5*60_000);
  }
  ```
  **Решение:** реализовать через **общий хелпер `WorkerOrgGate.checkOrThrow(tenantId, workerName)`** в `core-queue.service.ts`. Throw'ит `Error('worker_disabled_for_org')` — BullMQ будет ретраить (текущая `JobsOptions` — 5 attempts с exp backoff 5s; если выключение долгое, доходит до `failed`, что ОК — потом owner включит и можно вручную retry, либо настроить `removeOnFail: false` чтобы они оставались для retry).

**Verification:** smoke на ручное слияние двух Entity. Smoke на тумблер воркера.

**Коммит:** `feat(knowledge-core): фаза 7 шаг 7 — Org-Admin knowledge-core debug + worker org-gate`.

### Шаг 8 — AdminCacheService + инвалидация

**Цель:** TTL-кэш для дашбордов с явной инвалидацией.

**Создать `backend/src/modules/admin/services/admin-cache.service.ts`:**
- In-memory `Map<string, {value: unknown, expiresAt: number}>`.
- `get<T>(key: string): T \| null`.
- `setWithTtl<T>(key: string, value: T, ttlMs: number): void`.
- `invalidate(prefix: string): void` — удаляет все ключи начинающиеся с `prefix:`.

**Использование:**
- `AdminUsageService.getDashboard({scope, tenantId, period})` — ключ `usage:dashboard:${scope}:${tenantId ?? '*'}:${period}`, TTL 60s.
- На `setRouteForTaskType`, `setPrice`, `startExperiment`, `finishExperiment`, `setWorkersEnabled` — `invalidate('usage:')`.

**Verification:** ручной smoke (изменить модель, проверить что метрики обновились ≤ 60s).

**Коммит:** `feat(knowledge-core): фаза 7 шаг 8 — AdminCacheService + инвалидация на mutations`.

### Шаг 9 — Frontend: Z-Admin (8 страниц) + Org-Admin (1 новая страница + 2 редиректа)

**Цель:** UI всех 7.A.* и 7.B.*.

**Принцип:** строго следуем `frontend-rules` skill: `ApiDto → DomainModel → UiModel`, `apiClient`, никаких прямых fetch'ей.

**API-клиенты** (новые):
- `frontend/src/api/admin-usage.api.ts` — `getDashboard`, `getUsers`, `getCalls`, `getCallDetails`, `getFunctions`, `getFunctionCalls`, `exportCsv`.
- `frontend/src/api/admin-experiments.api.ts` — `start`, `getStatus`, `finish`, `cancel`.
- `frontend/src/api/admin-prices.api.ts` — `list`, `set`.
- `frontend/src/api/admin-orgs.api.ts` — `list`, `update`, `delete`.
- `frontend/src/api/admin-health.api.ts` — `get`.
- `frontend/src/api/admin-llm-routes.api.ts` — `list`, `setRoute` (если ещё нет — проверить).
- `frontend/src/api/org-admin-knowledge.api.ts` — все методы из контроллера 7.B.2.
- `frontend/src/api/org-admin-usage.api.ts` — те же методы что в admin-usage, но scope=org (под `/api/v1/org-admin/usage/*`).

**Domain-модели:** `frontend/src/domain/admin-usage.ts`, `admin-experiment.ts`, `admin-price.ts`, `admin-org.ts`, `admin-health.ts`, `org-admin-knowledge.ts` — типы, mapper'ы api→domain, лейблы.

**Страницы Z-Admin** (`frontend/app/(authenticated)/admin/`):

1. **`layout.tsx`** + **`AdminShell.tsx`** — общий шелл с боковым меню Z-Admin: Dashboard / Usage / Functions / Experiments / Prices / Orgs / Health. Защита: проверка `user.isSuperAdmin` через context (если false — `redirect('/')`).
2. **`page.tsx`** + **`AdminDashboardClient.tsx`** — 7.A.1 (главная Z-Admin).
3. **`usage/users/page.tsx`** + **`UsersUsageClient.tsx`** — 7.A.2.
4. **`usage/functions/page.tsx`** + **`FunctionsClient.tsx`** — 7.A.3 (список функций со сравнительной таблицей).
5. **`usage/functions/[taskType]/page.tsx`** + **`FunctionDetailClient.tsx`** — 7.A.4 (карточка функции, смена модели, кнопка «Запустить A/B»).
6. **`experiments/[taskType]/page.tsx`** + **`ExperimentClient.tsx`** — 7.A.5.
7. **`llm-prices/page.tsx`** + **`LlmPricesClient.tsx`** — 7.A.6.
8. **`orgs/page.tsx`** + **`OrgsClient.tsx`** — 7.A.7.
9. **`health/page.tsx`** + **`HealthClient.tsx`** — 7.A.8.

**Страницы Org-Admin** (`frontend/app/(authenticated)/settings/admin/`):

1. **`layout.tsx`** — общий шелл Org-Admin, проверка `RbacService.canManageOrg` через `/api/v1/me/permissions` или вызов `useAuth()` + проверка membership-роли (нужно расширить контекст auth — текущий уже отдаёт `user`, добавить `currentOrgRole`).
2. **`usage/page.tsx`** + **`OrgUsageClient.tsx`** — 7.B.1.
3. **`knowledge-core/page.tsx`** + **`KnowledgeCoreClient.tsx`** — 7.B.2 (тумблеры воркеров, журнал, связи, сущности, метрики).
4. **`members/page.tsx`** — редирект на `/settings/organization` (`redirect('/settings/organization')` в server-компоненте).
5. **`sources/page.tsx`** — заглушка с текстом «Управление источниками появится в Фазе 10. Подключения уже доступны в /settings/sources (если фаза 10 завершена) или в `/settings/integrations`».

**Sidebar расширение** (`frontend/src/ui/components/app-shell/Sidebar.tsx`):
- Если `user.isSuperAdmin` — добавить пункт «Z-Admin» (icon `Shield` lucide-react) в нижнюю часть.
- Если `user.currentOrgRole ∈ ['owner','admin']` — добавить пункт «Админка Org» (icon `Settings2`) под основным меню.

**SettingsSidebar расширение** (`frontend/app/(authenticated)/settings/SettingsSidebar.tsx`):
- Добавить раздел «Админка» с пунктами: «Экономика», «Ядро знаний», «Источники». Видимость только для `owner`/`admin`.

**Verification:**
- `bun run typecheck` (frontend) — зелёный.
- Ручной smoke в браузере (golden path):
  1. Зайти как обычный user → `/admin` → редирект.
  2. Сменить через DB `isSuperAdmin=true` → `/admin` → видна главная.
  3. Перейти в `/admin/usage/functions/block-distill` → сменить модель → проверить через `AiUsageLog`.
  4. Зайти как owner Org → `/settings/admin/usage` → виден дашборд.
  5. Manager — редирект.

**Коммит:** `feat(knowledge-core): фаза 7 шаг 9 — frontend Z-Admin + Org-Admin (страницы, API, domain)`.

## Затронутые файлы (полный список)

### Backend / schema + guards + interceptors
- `backend/prisma/schema.prisma` — `Org.workersEnabled`, `IdeaBlockLink.deletedAt/By`, `EntityLink.deletedAt/By`, `SuperAdminAccessLog`, `AiUsageLog.requestPreview/responsePreview`.
- `backend/src/modules/auth/guards/super-admin.guard.ts` — новый.
- `backend/src/modules/auth/guards/org-admin.guard.ts` — новый.
- `backend/src/modules/admin/super-admin.audit.interceptor.ts` — новый.
- `backend/src/modules/auth/auth.module.ts` — providers.

### Backend / admin (Z-Admin)
- `backend/src/modules/admin/services/admin-usage.service.ts` — новый.
- `backend/src/modules/admin/services/admin-functions.service.ts` — новый.
- `backend/src/modules/admin/services/admin-experiments.service.ts` — новый.
- `backend/src/modules/admin/services/admin-prices.service.ts` — новый.
- `backend/src/modules/admin/services/admin-orgs.service.ts` — новый.
- `backend/src/modules/admin/services/admin-health.service.ts` — новый.
- `backend/src/modules/admin/services/admin-cache.service.ts` — новый.
- `backend/src/modules/admin/controllers/admin-usage.controller.ts` — новый.
- `backend/src/modules/admin/controllers/admin-functions.controller.ts` — новый.
- `backend/src/modules/admin/controllers/admin-experiments.controller.ts` — новый.
- `backend/src/modules/admin/controllers/admin-prices.controller.ts` — новый.
- `backend/src/modules/admin/controllers/admin-orgs.controller.ts` — новый.
- `backend/src/modules/admin/controllers/admin-health.controller.ts` — новый.
- `backend/src/modules/admin/dto/admin-usage.dto.ts`, `admin-experiments.dto.ts`, `admin-prices.dto.ts`, `admin-orgs.dto.ts` — новые.
- `backend/src/modules/admin/admin.module.ts` — providers + controllers.
- `backend/src/modules/admin/ai-usage.controller.ts` — миграция guard'а на `SuperAdminGuard`.
- `backend/src/modules/admin/llm-routes/llm-routes.controller.ts` — миграция guard'а + расширение taskType.
- `backend/src/modules/admin/llm-routes/dto/llm-routes.dto.ts` — расширение `TASK_TYPES`.

### Backend / org-admin
- `backend/src/modules/admin/services/org-admin-knowledge.service.ts` — новый.
- `backend/src/modules/admin/controllers/org-admin-usage.controller.ts` — новый.
- `backend/src/modules/admin/controllers/org-admin-knowledge.controller.ts` — новый.
- `backend/src/modules/knowledge-core/services/entity-merge.service.ts` — добавить `mergeManually`.
- `backend/src/modules/core-queue/core-queue.service.ts` или `worker-org-gate.ts` — `WorkerOrgGate.checkOrThrow`.
- Все workers ядра — добавить `WorkerOrgGate.checkOrThrow(tenantId, name)` в начале processor'а.

### Backend / common
- `backend/src/modules/ai/services/llm-router.service.ts` — экспорт `ALL_LLM_TASK_TYPES`, метод `refreshPrices()` (если ещё нет).

### Frontend / Z-Admin
- `frontend/app/(authenticated)/admin/layout.tsx` — новый.
- `frontend/app/(authenticated)/admin/AdminShell.tsx` — новый.
- `frontend/app/(authenticated)/admin/page.tsx` + `AdminDashboardClient.tsx` — новые.
- `frontend/app/(authenticated)/admin/usage/users/page.tsx` + `UsersUsageClient.tsx` — новые.
- `frontend/app/(authenticated)/admin/usage/functions/page.tsx` + `FunctionsClient.tsx` — новые.
- `frontend/app/(authenticated)/admin/usage/functions/[taskType]/page.tsx` + `FunctionDetailClient.tsx` — новые.
- `frontend/app/(authenticated)/admin/experiments/[taskType]/page.tsx` + `ExperimentClient.tsx` — новые.
- `frontend/app/(authenticated)/admin/llm-prices/page.tsx` + `LlmPricesClient.tsx` — новые.
- `frontend/app/(authenticated)/admin/orgs/page.tsx` + `OrgsClient.tsx` — новые.
- `frontend/app/(authenticated)/admin/health/page.tsx` + `HealthClient.tsx` — новые.

### Frontend / Org-Admin
- `frontend/app/(authenticated)/settings/admin/layout.tsx` — новый.
- `frontend/app/(authenticated)/settings/admin/usage/page.tsx` + `OrgUsageClient.tsx` — новые.
- `frontend/app/(authenticated)/settings/admin/knowledge-core/page.tsx` + `KnowledgeCoreClient.tsx` — новые.
- `frontend/app/(authenticated)/settings/admin/members/page.tsx` — редирект.
- `frontend/app/(authenticated)/settings/admin/sources/page.tsx` — заглушка.

### Frontend / API + Domain
- `frontend/src/api/admin-*.api.ts` — 6 новых файлов.
- `frontend/src/api/org-admin-*.api.ts` — 2 новых файла.
- `frontend/src/domain/admin-*.ts` — 6 новых файлов.

### Frontend / Shell
- `frontend/src/ui/components/app-shell/Sidebar.tsx` — пункты Z-Admin / Админка Org.
- `frontend/app/(authenticated)/settings/SettingsSidebar.tsx` — раздел «Админка».
- `frontend/src/contexts/auth-context.tsx` (или аналог) — добавить `currentOrgRole`/`isSuperAdmin` в публичный контракт.

### Documentation
- `second-brain/01_projects/admin-z-global.md` — новый (про Z-Admin).
- `second-brain/01_projects/admin-org-knowledge-core.md` — новый (про Org-Admin).
- `second-brain/02_architecture/module-map.md` — раздел про admin-модуль.
- `second-brain/02_architecture/data-model.md` — `SuperAdminAccessLog`, новые поля.
- `second-brain/index.md` — ссылки.
- `plans/decisions-log.md` — строка по фазе 7.

### Execution-план
- `plans/2026-05-10-phase-7-execution.md` — создаёт агент по ходу работы (формат — как `phase-6-execution.md`). Важно: `status: in_progress` пока не закрыты все шаги.

## Сквозные правила (из проекта)

- **Только `bun run prisma:push --accept-data-loss`** (skill `prisma-db-push-rules`). Никаких миграций.
- **Все DTO — Zod через `ZodValidationPipe`** (skill `nestjs-rules`).
- **Все таблицы новые/расширенные — `tenantId` обязателен**, кроме super_admin-уровня (`SuperAdminAccessLog` сам по себе глобальный).
- **Все LLM-вызовы — через `LlmRouter`**, никаких прямых fetch'ей к провайдерам (skill `z-ai-agent-rules`).
- **Никаких бизнес-логик в guard'ах/interceptor'ах** — только проверка/логирование.
- **Все commit-сообщения** в Conventional Commits, область `knowledge-core`.

## Открытые вопросы (агент сам выбирает решение и фиксирует в decisions-log)

1. **Pagination cursor-стиль** для `/admin/usage/users` и `/admin/usage/calls` — cursor по `(createdAt DESC, id)` через base64-encoded JSON или через offset. **Решение по умолчанию**: cursor `{createdAt, id}` base64. Документировать в `nestjs-rules` или в комментарии контроллера.
2. **Куда писать `requestPreview` / `responsePreview`** — в `AiUsageLog` (компактнее, JOIN не нужен) или в новую таблицу `AiUsageCallPayload` с FK на `AiUsageLog.id` (чище). **Решение по умолчанию**: в `AiUsageLog` напрямую (компактнее, индексы остаются те же). Truncate до 8KB каждый.
3. **Health для S3** — пинговать или нет. **Решение по умолчанию**: не пинговать, отдавать `{available: 'unknown'}`. Полная интеграция — Фаза 11.
4. **Org-Admin `/sources` редирект** — на `/settings/integrations` или заглушка. **Решение по умолчанию**: заглушка с anchor-ссылкой.

## Связанные документы

- Родитель: [plans/tz/2026-05-10-knowledge-core-tz.md](plans/tz/2026-05-10-knowledge-core-tz.md) (фаза 7 в общем списке).
- LLM-router: [second-brain/01_projects/llm-router.md](second-brain/01_projects/llm-router.md).
- RBAC: [second-brain/01_projects/rbac-access-control.md](second-brain/01_projects/rbac-access-control.md).
- Декораторы tenant: [backend/src/modules/rbac/decorators/current-org.decorator.ts](backend/src/modules/rbac/decorators/current-org.decorator.ts).

## Итог (заполняется агентом по ходу)

- [x] Шаг 1 — schema + db push.
- [x] Шаг 2 — guards + interceptor.
- [x] Шаг 3 — AdminUsageService + endpoints.
- [x] Шаг 4 — AdminFunctionsService + LlmRoutes расширение.
- [x] Шаг 5 — AdminExperimentsService.
- [x] Шаг 6 — Prices/Orgs/Health.
- [x] Шаг 7 — Org-Admin knowledge-core debug.
- [x] Шаг 8 — AdminCacheService.
- [x] Шаг 9 — Frontend.
- [ ] Создан `phase-7-execution.md` со статусом `completed`.
- [ ] Обновлён `decisions-log.md`.
- [ ] Обновлён `second-brain/`.

## Ревизия от 2026-05-24

**Статус:** done

**Реализовано:**
- `SuperAdminGuard` + `OrgAdminGuard` + `SuperAdminAuditInterceptor` — `backend/src/modules/auth/guards/super-admin.guard.ts`, `org-admin.guard.ts`, `backend/src/modules/admin/super-admin.audit.interceptor.ts`.
- 7 admin-сервисов и контроллеров: `backend/src/modules/admin/services/{admin-usage,admin-functions,admin-experiments,admin-prices,admin-orgs,admin-health,admin-cache,org-admin-knowledge}.service.ts` + `backend/src/modules/admin/controllers/{admin-usage,admin-functions,admin-experiments,admin-prices,admin-orgs,admin-health,org-admin-knowledge,org-admin-usage}.controller.ts`.
- Prisma-модели: `SuperAdminAccessLog` (schema.prisma:3061), `Org.workersEnabled`, расширение `AiUsageLog`. Plus Phase α-10 Economics — `LlmProvider`, `LlmModel`, `AiCostDaily`, `OrgBudgetCap`, `CurrencyRate` (`backend/src/modules/admin/economics/*`, 5 cron'ов + 4 контроллера).
- Frontend Z-Admin страницы все 8: `frontend/app/(authenticated)/admin/{page,usage/users,usage/functions,usage/functions/[taskType],experiments/[taskType],llm-prices,orgs,health}/*` + AdminShell + Sidebar.
- Frontend Org-Admin: `frontend/app/(authenticated)/settings/admin/{usage,knowledge-core,meetings}/*`.
- CSV-экспорт: `backend/src/modules/admin/controllers/admin-usage.csv.ts`.

**Осталось:** только документация (`phase-7-execution.md`, `decisions-log.md`, second-brain). Сам функционал готов и явно превышает изначальный scope (добавлен полный economics-стек α-10).
