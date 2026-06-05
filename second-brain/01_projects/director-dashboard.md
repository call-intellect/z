---
type: project
status: in_progress
phase: 8-9
---

# Дашборд директора

> Главная страница для роли `owner` Org — срез знаний компании за период с 6 виджетами и AI-чатом. Расширяется индикатором «Согласованность стратегии» (Фаза 9).

## Назначение

Owner Org логинится → попадает на `/dashboard` → видит **директорский** вид (а не менеджерский). Дашборд отвечает на 6 вопросов:

1. **Что узнали?** — топ новых тем + топ новых сигналов.
2. **Какие сигналы клиентов?** — счётчики по `signalType` (pain, churn_risk, feature_request, ...).
3. **Что в фокусе?** — активные растущие темы.
4. **Кто/что в центре внимания?** — топ сущностей по росту упоминаний за период.
5. **Что не понимаем?** — открытые вопросы (`signalType='knowledge_gap'`).
6. **Движемся ли к целям?** — индикатор «Согласованность стратегии» (Фаза 9, см. [goals-and-strategic-alignment.md](goals-and-strategic-alignment.md)).

Плюс AI-чат «Спросите про вашу компанию» (org-scope) — встроен в дашборд через `<OrgChatPanel>`.

## Backend

- Контроллер: `DirectorDashboardController` ([backend/src/modules/dashboard/director-dashboard.controller.ts](backend/src/modules/dashboard/director-dashboard.controller.ts)).
- Endpoint: `GET /api/v1/dashboard/director?period=week|month`.
- Auth: `CookieAuthGuard + TenantGuard` + `RbacService.canViewDirectorDashboard(userId, tenantId)` (`role IN ('owner','admin')` или `isSuperAdmin`).
- Сервис: `DirectorDashboardService.getDirectorView({tenantId, period})` — 7 параллельных Prisma-запросов через `Promise.all` + `narrativeSummary` (опционально).
- Кэш: `AdminCacheService` (Phase 7), TTL 60s. Ключ `dashboard:director:${tenantId}:${period}`.

## `narrativeSummary` (опциональный)

LLM-резюме «Главное за неделю» — 3-4 факта + 1 рекомендация (200-400 символов).
- Промпт: `backend/src/modules/dashboard/prompts/dashboard-summary.prompt.ts`.
- TaskType: `dashboard-summary`. LlmTaskRoute создан патчем `patch-dashboard-summary-route.ts` (idempotent).
- Кэш: TTL 24h, ключ `dashboard:director:narrative:${tenantId}:${period}`. Cron `@Cron('0 6 * * *')` сбрасывает все narrative-ключи.
- На фейл LLM → `null`, UI скрывает блок.

## Период

`week → now() - 7d`, `month → now() - 30d`. Custom from/to — vNext.

## Frontend

- Страница `/dashboard` через `DashboardRouter.tsx`:
  - `currentOrgRole IN ('owner','admin','super_admin')` → `<DirectorDashboardClient>`.
  - Иначе → существующий `<DashboardClient>` (manager-вид, не трогаем).
- Виджеты в карточках shadcn `Card`. Skeleton + empty state per widget.
- AI-чат — `<OrgChatPanel withHistory={false} height="400px">` (общий компонент, переиспользуется в `/chat`).
- `<TierGate feature="feature.dashboard_director">` (Phase 12) — basic-Org видит fallback заглушку.

## Связанные документы

- [knowledge-core.md](../02_architecture/knowledge-core.md) — источники данных (IdeaBlock, Entity, Theme).
- [goals-and-strategic-alignment.md](goals-and-strategic-alignment.md) — индикатор «Согласованность стратегии».
- [tariffs-and-entitlements.md](tariffs-and-entitlements.md) — gating через `feature.dashboard_director`.

## Связанные панели

- **Панель операционного директора** (`/dashboard/operations`) — параллельная панель для роли `coo`/`owner`/`admin`. Источник — модуль `backend/src/modules/operations/`. Реализована в β-8 (PersonalRelation + DailyCheckIn + CooDashboard) + β-8.1 (виджет «Температура команды» + страница `/dashboard/operations/weekly`) + β-8.2 (виджет «Открытые обещания»). См. ТЗ: [β-8](../../plans/tz/2026-05-23-sba-beta-8-personal-relation-coo-checkin.md), [β-8.1](../../plans/tz/2026-05-24-sba-beta-8-1-coo-dobivka.md), [β-8.2](../../plans/tz/2026-05-24-sba-beta-8-2-promise-keeper.md).
- **Личный кабинет сотрудника:** `/me/check-ins` (β-8), `/me/promises` (β-8.2). С пакета дашбордов 2026-06-05 (ТЗ-E) — кабинет «Я» с вкладками (Pulse self-режим, перенос срока обещания, отписка от соцвклада).

## Пакет улучшений дашбордов (2026-06-05, ТЗ B/D/C/G/E)

Источник — `plans/tz/2026-06-05-{goal-vector-compass,weekly-per-person-plan-fact,operations-dashboards-redesign,employee-pulse-and-people-at-risk,personal-cabinet-me}.md`. Карта сервисов — [[../02_architecture/module-map]] §«Пакет улучшений дашбордов».

- **Компас целей (B):** на главной директора список целей заменён SVG-виджетом `CompassWidget`. `GET /api/v1/dashboard/pulse-patterns` (`getGoalVector`) отдаёт `primaryGoalId` (`Goal.isPrimary` — главная цель компании), `proScore`/`contraScore`, `byDepartment`.
- **Недельный план-факт по людям (D):** виджет в «Недельной сводке» — обещано/закрыто/просрочено per Person (`GET /api/v1/dashboard/operations/weekly-per-person`, `WeeklyPerPersonService`).
- **Люди под риском (G):** виджет self-fetch + CTA «Открыть Пульс» (`GET /api/v1/dashboard/people-at-risk`, `PeopleAtRiskService`; пороги — `AdminSetting peopleAtRisk.*`).
- **Операции (C):** «Панель операций» — `KpiHero` + 3 зоны + SWR, KPI «Открытые обещания», единый блок температуры с переключателем; ежедневный дайджест отдаёт `whoShined`.
