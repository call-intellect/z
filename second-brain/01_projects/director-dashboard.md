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
- Сервис: `DirectorDashboardService.getDirectorView({tenantId, period})` — 14 параллельных запросов через `Promise.all` + `narrativeSummary` (опционально). **Б-1 устойчивость (2026-06-12):** каждый из 14 обёрнут в `safe(label, fn, fallback)` — ошибка отдельного виджета деградирует только его до нейтрального fallback'а и пишет `logger.error` с ИМЕНЕМ виджета, а дашборд отдаёт 200 с `degraded=true` (раньше reject любой ветки ронял весь метод в 500 `db_error`, маскируя источник). `isEmpty`-guard (`failures.length===0 && …`) не подменяет частичные данные синтетическим «образцом» при сбое. Тот же best-effort давно у `narrativeSummary` и `requiresAction`. Источник: [plans/tz/2026-06-12-urgent-dashboard-500-and-decisions-404-fix.md](../../plans/tz/2026-06-12-urgent-dashboard-500-and-decisions-404-fix.md) (Фаза 1).
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

## Батч 5 — состав ⊕ современный визуал + здоровье портфеля (2026-06-09, ТЗ-2/ТЗ-3/ТЗ-2 Ф6)

Источник — `plans/tz/2026-06-08-dashboards-info-rework.md` (состав) ⊕ `...-dashboards-redesign-modern-visual-language.md` (визуал). Сервисы — [[../02_architecture/module-map]] §«Батч 5»; модели — [[../02_architecture/data-model]] §«Батч 5».

- **Главная (S2.1):** первый экран сжат до ≤7 величин (`ValueStrip` + чат/настроение/обещания/висящие решения + вердикт компаса + AI-сводка + Top-1 риск). `director-dashboard.service.ts` += `fetchValueStrip` / `reasonSourceRef` / `mainReworkEnabled`. Гейт `dashboard.main_rework.enabled`. Виджеты `ValueStripWidget`/`WhatWeLearnedWidget`/`GoalVectorVerdictWidget`/`IdeasTopWidget`/`ChatUsageWidget`. Метрики `dashboard_value_strip_served_total`/`dashboard_main_first_screen_widget_count`.
- **Здоровье портфеля целей (S2.6, `/dashboard/portfolio`):** `PortfolioHealthService` + `PortfolioHealthSnapshotCron @Cron('0 5 * * 1')` → `GET /dashboard/operations/portfolio-health`; MoSCoW-приоритет цели `PATCH /goals/:id/priority`. Модель `PortfolioHealthSnapshot`, enum `GoalPriority`. Флаг `operations.portfolio_health.enabled`, крутилки `portfolio.health.*`. Метрики `portfolio_health_score`/`portfolio_health_snapshot_total`/`portfolio_priority_set_total`.
- **Витрина пользы (S2.6, `/dashboard/value-recap`):** экран поверх месячной `ValueRecap` (S1.5) + экспорт слайдов/печать (`GET /dashboard/operations/value-recap/:id/export`, read-only, без отдельного флага).
- **COO (S2.2) и /me (S2.5)** — см. [[../02_architecture/module-map]] §«Батч 5» и [[frontend-pages]] §«Батч 5».
- **Визуал (ТЗ-3):** modern-язык (стекло/градиент/объём) применён безусловно (без флага — не меняет данные); светлая тема — за владельцем (в `04_не-сделано`).

## Доводка редизайна до полного стеклянного языка + дата-виз (2026-06-10)

Источник — `plans/tz/2026-06-09-dashboards-redesign-completion-full-dataviz.md` (Ф0–Ф7). Доведены до конца 5 экранов, у которых после Батча 5 остался смешанный вид «новый фон + старые плоские `shadcn`-карточки»: `/dashboard` (ON-ветка), `/dashboard/operations`, `/dashboard/operations/daily`, `/dashboard/operations/weekly`, `/me`. Полная карта экранов — [[frontend-pages]] §«Доводка редизайна дашбордов»; новые контрактные поля бэка (`weeklyInflow`, `digest.trend`) — [[api-layer]] §«Дата-виз поля редизайна дашбордов».

- **Director (`/dashboard`, ON-ветка):** 3 `KpiHero`→`StatCard` (реальный sparkline уже отдавался бэком — доп. бэка не потребовалось), inline AI-сводка→`GlassCard` glow, виджеты табов (`SignalCounters`/`ActiveThemes`/`HotEntities`/`OpenQuestions`)→`GlassCard`. OFF-ветка kill-switch `mainReworkEnabled` **не тронута**.
- **Operations (`/dashboard/operations`):** новый бэк-ряд `weeklyInflow` (12 недель из `BlockerSynthesis`/`EntityLink conflicted_with`) кормит hero-`AreaTrend` «Операционная нагрузка» + спарклайны `StatCard`.
- **Daily/Weekly дайджесты:** hero-`AreaTrend`/`BarTrend` строятся из реальной истории persisted-снимков (`digest.trend`, поле в DTO дайджеста, Ф1b) — не выдуманные ряды.

Тема только тёмная (светлая — за владельцем), новых флагов нет (Ship-On), удалён мёртвый `DashboardClient.tsx`.

## Редизайн кабинета — ритмы + очередь решений (Ф0–Ф10, 2026-06-13)

Источник — `plans/tz/2026-06-13-cabinet-redesign-rhythms-and-decision-queue.md` (Ф0–Ф10, ветка `feature/cabinet-redesign-rhythms`, 23 коммита, реализован целиком). Рефлексия — [[../05_история/2026-06-13-cabinet-redesign-implementation]]. Прод-операции — [[../../docs/operations/prod-deploy-log]] (блок «2026-06-13 — Редизайн кабинета»).

Кабинет перестроен от «свалки меню + противоречивых дашбордов» к модели **ритмов** (Сегодня / Неделя / Месяц) + сквозной **очереди решений** «Требует вас». Ключевое:
- **Навигация:** единый источник `frontend/src/ui/components/app-shell/nav-config.ts` (десктоп+мобилка), меню 3 ритма + Работа + Я + Система (роль-зависимо), CTA «+ Создать»; redirects старых дашбордов в `next.config.mjs`.
- **Сегодня:** новый экран (VerdictBar + лента дня + чек-ин-плашка, ≤7 величин); новый эндпоинт `GET /dashboard/operations/checkin-discipline` (дисциплина чек-инов).
- **Очередь решений (Ф4):** суть+detail в pending-actions, сквозной `POST /pending-actions/confirm`, TTL (`expiresAt` на `ConflictItem`/`IntakeIssue`, миграция `add_expiresat_conflict_intake` + sweep-крон); 4 группы inline-резолва.
- **Неделя / Месяц:** /week табы (weekly+operations+portfolio + CheckinDisciplineWidget); /month — решения месяца + PPTX-экспорт (зависимость `pptxgenjs`), drill-down план-факта `GET /dashboard/operations/weekly-per-person/:personId/items` (+self).
- **Лента Коры (Ф8.6):** `GET /feed/cora`, `POST /feed/cora/seen` (миграция `feed_read_cursor`), `GET /probe/control` («ответил/молчит»), open_question-детектор.
- **Silence-детектор тем (Ф8.2/8.1):** `@Cron('theme-silence-detector')` → Insight за kill-switch `dashboard.theme_silence.enabled` (ON) + крутилка `dashboard.theme_silence_weeks` (3); decision auto-implement детерминированный.
- **Прочее:** taskType `meeting-title` (авто-название встреч, DEFAULT-цепочка), поиск по памяти `/memory`, мастер дедупа отделов (`POST /departments/:id/merge`), гейт полноты обещаний (`/me/promises` split items/openQuestions), EventForm rrule/reminders.
- **Светлая тема (Ф10):** тема-зависимые поверхности в `tokens.css`/`modern.css`/`tokens.ts` (корень контраста — был хардкод тёмного в `modern/tokens.ts`); визуальная доводка оттенков дата-виз на белом — за владельцем/qa (в `04_не-сделано`).

## Мастер-фиксы кабинета (2026-06-14, ТЗ cabinet-master-fixes, часть A)

Источник — `plans/tz/2026-06-14-cabinet-master-fixes-referral-and-hub.md` (часть A, ветка `feature/cabinet-master-fixes`, коммиты `dfb79211..fd0e8eeb`). Прод-операции — [[../../docs/operations/prod-deploy-log]] (блок «2026-06-14 — Мастер-фиксы кабинета»). Доводка кабинета по итогам аудита:
- **A1 — светлая тема доведена до конца:** новые тема-зависимые токены `--surface-inset/-strong/-hover` + `--border-inset` в `frontend/src/ui/tokens.css` (обе темы); modern-примитивы и ~24 файла кабинета переведены с белых оверлеев (`oklch(1 0 0 /…)` + `hover:bg-white/5`) на тема-токены; гард-тест `frontend/src/ui/components/dashboard/modern/light-theme.guard.spec.ts`.
- **A5 — ack чек-ина:** toast «✓ Записано в память компании» при отправке чек-ина.
- **A6 — бейдж «Спросил руководитель»:** в Ленте Коры на `open_question` — поле `askedByManager` (резолв через `IdeaBlockEntity(role='subject')`→`Person`).
- **A4 — `/intake` синхронизирован с очередью /actions** (snooze-aware `findAll`).
- **A7 — cross-surface тест Б-2; valueStrip-счётчики кликабельны** (`Link`).
- **A8 — виджет «Висят без ответа ≥3 дней»** (`StaleQuestionsWidget`) на /week.
- **A9 — CSV-экспорт «Скачать для планёрки»** в weekly-per-person.
- **A2 — merge отделов переносит FK** (Metric/Interaction/OrgUnit/Entity).
- **A10 — петля next-step→Issue:** миграция `IntakeIssue.sourceBlockIds TEXT[]`, `DecisionTaskLink('derived')`.
- (Виджет «Оцифровано» на «Сегодня» — `DigitizedSummary` — описан в части C, см. [[regulations]] §«Хаб "Оцифровано"».) `degraded`-деградация дашборда отражается в `VerdictBar`.
