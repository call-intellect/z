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

- **Панель операционного директора** (`/dashboard/operations`) — параллельная панель для роли `coo`/`owner`/`admin`. Источник — модуль `backend/src/modules/operations/`. Реализована в β-8 (PersonalRelation + DailyCheckIn + CooDashboard) + β-8.1 (виджет «Температура команды» + страница `/dashboard/operations/weekly`) + β-8.2 (виджет «Открытые обещания»). См. ТЗ: [β-8](../../plans/archive/2026-05-23-sba-beta-8-personal-relation-coo-checkin.md), [β-8.1](../../plans/archive/2026-05-24-sba-beta-8-1-coo-dobivka.md), [β-8.2](../../plans/archive/2026-05-24-sba-beta-8-2-promise-keeper.md).
- **Личный кабинет сотрудника:** `/me/check-ins` (β-8), `/me/promises` (β-8.2). С пакета дашбордов 2026-06-05 (ТЗ-E) — кабинет «Я» с вкладками (Pulse self-режим, перенос срока обещания, отписка от соцвклада).

## Пакет улучшений дашбордов (2026-06-05, ТЗ B/D/C/G/E)

Источник — `plans/tz/2026-06-05-{goal-vector-compass,weekly-per-person-plan-fact,operations-dashboards-redesign,employee-pulse-and-people-at-risk,personal-cabinet-me}.md`. Карта сервисов — [[../02_architecture/module-map]] §«Пакет улучшений дашбордов».

- **Компас целей (B):** на главной директора список целей заменён SVG-виджетом `CompassWidget`. `GET /api/v1/dashboard/pulse-patterns` (`getGoalVector`) отдаёт `primaryGoalId` (`Goal.isPrimary` — главная цель компании), `proScore`/`contraScore`, `byDepartment`.
- **Недельный план-факт по людям (D):** виджет в «Недельной сводке» — обещано/закрыто/просрочено per Person (`GET /api/v1/dashboard/operations/weekly-per-person`, `WeeklyPerPersonService`).
- **Люди под риском (G):** виджет self-fetch + CTA «Открыть Пульс» (`GET /api/v1/dashboard/people-at-risk`, `PeopleAtRiskService`; пороги — `AdminSetting peopleAtRisk.*`).
- **Операции (C):** «Панель операций» — `KpiHero` + 3 зоны + SWR, KPI «Открытые обещания», единый блок температуры с переключателем; ежедневный дайджест отдаёт `whoShined`.

## Батч 5 — состав ⊕ современный визуал + здоровье портфеля (2026-06-09, ТЗ-2/ТЗ-3/ТЗ-2 Ф6)

Источник — `plans/tz/2026-06-08-dashboards-info-rework.md` (состав) ⊕ `...-dashboards-redesign-modern-visual-language.md` (визуал). Сервисы — [[../02_architecture/module-map]] §«Батч 5»; модели — [[../02_architecture/data-model]] §«Батч 5».

- **Главная (S2.1):** первый экран сжат до ≤7 величин (`ValueStrip` + чат/настроение/обещания + вердикт компаса + AI-сводка + Top-1 риск). `director-dashboard.service.ts` += `fetchValueStrip` / `reasonSourceRef` / `mainReworkEnabled`. _(Величина «висящие решения» снята — чистка оперативно-контрольного хвоста решений 2026-06-30.)_ Гейт `dashboard.main_rework.enabled`. Виджеты `ValueStripWidget`/`WhatWeLearnedWidget`/`GoalVectorVerdictWidget`/`IdeasTopWidget`/`ChatUsageWidget`. Метрики `dashboard_value_strip_served_total`/`dashboard_main_first_screen_widget_count`.
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

Источник — `plans/archive/2026-06-13-cabinet-redesign-rhythms-and-decision-queue.md` (Ф0–Ф10, ветка `feature/cabinet-redesign-rhythms`, 23 коммита, реализован целиком). Рефлексия — [[../05_история/2026-06-13-cabinet-redesign-implementation]]. Прод-операции — [[../../docs/operations/prod-deploy-log]] (блок «2026-06-13 — Редизайн кабинета»).

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

Источник — `plans/archive/2026-06-14-cabinet-master-fixes-referral-and-hub.md` (часть A, ветка `feature/cabinet-master-fixes`, коммиты `dfb79211..fd0e8eeb`). Прод-операции — [[../../docs/operations/prod-deploy-log]] (блок «2026-06-14 — Мастер-фиксы кабинета»). Доводка кабинета по итогам аудита:
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

## Доска «Аналитика» — подключение агентов операционного директора (2026-06-16, Ф1–Ф8)

Источник — `plans/tz/2026-06-15-coo-orphan-agents-wire-to-operations-board.md` (Ф1–Ф8, ветка `feature/coo-orphan-agents-wire`, коммиты `ac56ce2b..b44229ae`, реализован целиком). Рефлексия — [[../05_история/2026-06-16-coo-orphan-agents-wire]]. Прод-операции — [[../../docs/operations/prod-deploy-log]] (блок «2026-06-16 — Подключение агентов «Операционного директора»»).

Бэкенд COO почти весь уже считал данные, но часть результатов была «осиротевшей» (код есть, потребителя на экране нет). ТЗ ничего нового не строит — **подключает готовое** слой за слоем (`ApiDto → DomainModel → UiModel → mount`), всё сразу включено (Ship-On). Доска **переименована «Операции» → «Аналитика»** (метка в `nav-config.ts`, RHYTHMS_SECTION/LEADERSHIP_ROLES, сразу после «Сегодня»); маршрут остался `/dashboard/operations`. Виджеты смонтированы ВНЕ ветки `reworkEnabled` (чужой kill-switch соседней задачи).

- **Подключённые виджеты (`OperationsDashboardClient.tsx`, секции «Риски и непрерывность» / «Аналитика пульса» / «Загрузка и распределение» / «Трения»):**
  - **pulse-виджеты** одним общим SWR к `GET /dashboard/pulse-patterns` (Ф1): `BusFactorWidget`, `RecurringTopicsWidget`, `LowRoiMeetingsWidget`, `BottleneckHeatmapWidget`, `KnowledgeVelocityKpi`. Props НЕ единообразны (`data` / `meetings`-массив / только-`data`). _(Алерт необратимых решений `IrreversibleDecisionsAlert` снят — чистка оперативно-контрольного хвоста решений 2026-06-30.)_
  - **«Клиенты под риском оттока»** `CustomerRiskRadarWidget` (Ф4, SWR `limit≤20`) + зеркало `customersAtRisk` в чтение дневного дайджеста (`CustomersAtRiskSection` в `DailyDigestClient`).
  - **«Знания под риском»** `KnowledgeAtRiskWidget` (Ф5) + минимальный backend-join имени эксперта (relation `soleExpert`, опц. поле `soleExpertPersonName` — без сырого cuid).
  - **«Перегруз ответственностью»** `PromiseOverloadWidget` (Ф7) — accumulators сети обещаний.
- **Оживлённые мёртвые сигналы:**
  - **Факторы вовлечённости команд** (Ф6): за `Department.healthSummaryJson` уже платили LLM ежедневно, но `getHealth` его не селектил. Добавлен `select healthSummaryJson` + защитный парс в опц. поле `healthSummary`; рендер раскрытия «Почему такая оценка» (5 факторов чипами + summary + `generatedAt`, fallback «не посчитана») в `StructureWidgets`.
  - **Сеть обещаний** (Ф7): `PromiseNetworkSnapshot` писался weekly, читателей было 0. НОВЫЙ `PromiseNetworkService` + НОВЫЙ эндпоинт `GET /api/v1/dashboard/operations/promise-network` (owner/admin/coo).
- **Починенные заглушки данных (Ф2, backend-доводки, фронт уже был готов):**
  - `team-detail.goals` — заглушка `[]` заменена на `findMany` по `Goal.ownerPersonId` (связь уже была в схеме).
  - _(Заглушка `team-health.decisions` (scoped count висящих решений через `HangingDecisionsService`) снята — чистка оперативно-контрольного хвоста решений 2026-06-30; team-health по решениям больше не считается.)_
- **Доставка дневной сводки COO + персональная галочка (Ф8, Ship-On):** удалён OFF-флаг `operations.daily_digest.deliver_to_telegram` / ENV `COO_DAILY_DIGEST_DELIVER_TO_TELEGRAM`; cron шлёт безусловно (идемпотентно по `deliveredAt`), kill-switch `operations.daily_digest.enabled` остаётся. Policy `operations.daily_digest` в `EVENT_TYPE_CHANNEL_POLICY` (in_app+email+telegram+max). НОВЫЙ эндпоинт `GET /api/v1/me/notification-preferences`; персональная галочка «Ежедневная сводка компании» в Настройки → Уведомления управляет доставкой через существующий `optOutEventTypes` (при отключении сводка остаётся в кабинете). Стелс-эффект: после выката сводка начинает доставляться owner/coo во все привязанные каналы по умолчанию.

Миграций БД нет (все поля/модели уже в схеме), seed/patch/backfill на запуск нет. `TeamHealthGrid` оказался НЕ orphan (живой на `/teams`) — не удалён.

## Модульные дашборды исполнения (2026-06-21, ТЗ-модульные-дашборды, реализован целиком)

Источник — `plans/tz/2026-06-21-modular-execution-dashboards.md` (Ф1–Ф5, ветка `dev`, коммиты Ф1 `9ee6d531`, Ф2 `4e5d3748`, Ф3 `1b9ed454`, Ф4+Ф5 `f244ada6`). Рефлексия — [[../05_история/2026-06-21-modular-execution-dashboards]]. Прод-операции — [[../../docs/operations/prod-deploy-log]] (блок «2026-06-21 — Модульные дашборды исполнения»).

Дашборды стали **модульными**: вместо жёстко свёрстанных экранов — единый реестр виджетов + ролевые пресеты + canvas, который рендерит набор по паре `{role, rhythm}`. Три ритма День ⊂ Неделя ⊂ Месяц (каждый старший включает виджеты младшего + свои). Схема БД не менялась.

- **Фронтовый слой** `frontend/src/ui/components/dashboard/registry/`:
  - `types.ts` — `WidgetDescriptor` (`id,title,rhythm,roles,size,visibleWhen?,Component`).
  - `widget-registry.ts` — `WIDGET_REGISTRY` из **18 виджетов** (M1–M10 + `WeeklyPlanFact`/`Trend`/`Achievements`/`Maturity`/`BusFactor`/`WeeklyDynamics`/`MonthRecap`).
  - `presets.ts` — `DEFAULT_PRESETS` (3 роли × 3 ритма) + `toDashboardRole` (owner/admin→owner, coo→coo, иначе member).
  - `DashboardCanvas.tsx` — рендер по `{role,rhythm}`, грид по `size`, пустой виджет скрыт через `:empty`.
  - `use-dashboard-layout.ts` — SWR-крюк, override из бэка **или** code-fallback на `DEFAULT_PRESETS`.
  - `_kit.tsx` — общие примитивы (`PeopleDrawer`/`Chip`/`MiniArrow`/`PersonRow`/`SourceLink`).
- **Экраны на канвасе:** `/dashboard` (`DirectorDashboardClient`, rhythm `today`), `/week` (`WeekDesktopClient`, `week`), `/month` (`MonthDesktopClient`, `month`).
- **Роли:** owner/coo — полный набор; **member** — только коллаборативные виджеты (`ideas`, `value`), командных данных не видит (решение владельца Р6).
- **Drill-down + проваливание в источник:** вектор к цели / загрузка / план-факт раскрываются по людям (`PeopleDrawer`); виджет блокеров проваливается в исходный `IdeaBlock` через `relatedBlockIds`/`sourceBlockId` → `ProvenanceDrawer`.
- **Бэкенд:** `ExecutionDashboardController` (`@Controller('api/v1/dashboard')`) + `ExecutionDashboardService` — 5 GET (`layout`, `goal-vector/by-person`, `issue-chains`, `load/by-person`, `operations/trend`); раскладка пресета через `getDynamic` (override AdminSetting / `null`). Контракты — [[api-layer]] §«Модульные дашборды исполнения»; карта модуля — [[../02_architecture/module-map]] §`dashboard`.
- **Раскладка — Option B:** дефолты живут на фронте (`DEFAULT_PRESETS`), бэк отдаёт только override или `null`. Новой таблицы/колонки нет (`sourceBlockId` — JSON-поле в `blockersJson`), миграции нет; ENV/seed/очередей/cron не добавлено.

## Видимость руководителю задач (2026-06-22, ТЗ tasks-subsystem-unified-fix D)

- **«Почему» вклада в цель (D1):** `getGoalVectorByPerson` отдаёт `reasons` (топ-3 из `signalsJson`) — руководитель видит, ЧТО именно двигает вектор человека к цели, а не только стрелку.
- **Кросс-проектные зависшие (D2):** новый `GET /api/v1/dashboard/stuck/cross-project` — задачи без движения вне спринта, порог-крутилка `dashboard.stuck.staleDaysThreshold` (AdminSetting, сид `seed-admin-setting-dashboard-main.ts`).
- **Решение↔задача замкнуты (D3, см. [[decisions]]):** обратная линковка `linkDerivedTasksForDecision` + переход Decision→`implemented` при закрытии всех связанных задач.
- ТЗ [`2026-06-22-tasks-subsystem-unified-fix`](../../plans/tz/2026-06-22-tasks-subsystem-unified-fix.md) (Блок D).

## Ремонт дашбордов (2026-06-26, ТЗ dashboards-repair)

Принцип: чиним и переставляем, ничего не удаляем (решение владельца Р5). 9 классов проблем на 4 дашбордах + Аналитике.

- **Контракт goal-vector расширен:** `getGoalVectorByPerson` + DTO `GoalVectorByPersonResponse` теперь возвращают поле `goalState ∈ {primary, active_fallback, none}`. `resolveGoalId` получил 4-й fallback — активная цель (`status: 'active'`, orderBy `isPrimary→weight→createdAt`, tenant-изоляция) после ветки `personGoalContribution`. `GoalVectorWidget` показывает пустой-стейт по `goalState` (none → CTA «Задать главную цель»; active_fallback → «Кора предложила — подтвердить главной» + название цели), вместо безусловного «Цель компании не задана».
- **Раскладка без пустот:** размеры в `widget-registry.ts` (plan-fact/trend/weekly-dynamics/maturity/blockers→md, feed→xl), порядок в `presets.ts` (owner+coo today/week/month — md-виджеты парами, состав сохранён), `DashboardCanvas` — `grid-flow-row-dense`. Списочные (`stale`/`ideas`) — топ-5 + «Показать все (N)». Чартам `modern/*` — `minHeight={160}`.
- **Единый период экрана:** `ValueWidget` today→week (был month); `TrendWidget` — «Недостаточно данных» вместо пустого графика. _(Виджет решений `DecisionsWidget` снят — чистка оперативно-контрольного хвоста решений 2026-06-30.)_
- **Дедуп выборок (бэк):** `CustomerRiskRadarService` (`dedupeLatestSnapshotPerCustomer` — последний снимок на `customerEntityId`, применён в listForTenant/listForResponsible/topForDigest, counts по дедуп-набору); `PulsePatternsService` recurringTopics (`dedupeLatestRecurringTopicByTheme`). Идеи «Без темы» схлопнуты в один агрегат.
- **Лента:** текстовые бейджи типов (парные `--chip-*` токены) + клиентский фильтр Все/События/Вопросы/Риски.
- **План и факт:** «сдали X / ожидалось Y / всего Z сотрудников» (Z=`missing.totalEmployees`); «По людям» из `checkin-discipline.byPerson` со ссылкой на `/persons/[id]/pulse`.
- **Аналитика:** пустые-стейты вместо сетки нулей (сводка «Пока спокойно», «Накапливаем данные», «Пересечений между командами пока нет»); promise-network честно подписан «в сети N связанных».
- **Дедуп запросов:** единый SWR-ключ `["director", orgId, period]` во всех 4 потребителях (Verdict/Goal/Value/MobileOverview) — SWR дедупит до 1 запроса. `weekly-digest` 404 (digest_not_found) ловится → виджет скрывается без красной ошибки.
- Без миграций/seed/ENV/очередей. ТЗ [`2026-06-25-dashboards-repair`](../../plans/tz/2026-06-25-dashboards-repair.md).

## Решение как источник задач (ось исполнения, без дашборд-надзора)

Решение живёт по двум ортогональным осям: **память** (что решили — `Decision`, не меняется) и **исполнение** (нужно ли завести работу). Связку держит `Decision.impliesAction` + `Decision.actionExtractedAt` (Ф2, ТЗ [`task-decision-execution-unified`](../../plans/tz/2026-06-27-task-decision-execution-unified-tz.md), см. [[../02_architecture/data-model]] §«impliesAction», [[ai-jobs]] §«Задача·решение·исполнение», [[decisions]]).

- **Ось исполнения (живёт):** actionable-решение (`impliesAction=true`) авто-заводит задачу через `IntakeService` (`source='decision'`) → `Issue` + `DecisionTaskLink('derived')`. Это пассивное замыкание «решение → задача», оперконтроль дальше идёт по трекеру задач, а не по решению.
- **Дашборд-надзор за внедрением снят (2026-06-30, чистка оперативно-контрольного хвоста решений):** убраны классификатор статуса внедрения + метрика доведения, оба дашборд-эндпоинта решений (доведение/застрявшие), виджет очереди решений и KPI «висящие решения». Решение на дашборде больше не показывается как очередь «доведи» — оно остаётся пассивной памятью; контроль доведения — на задачах. ТЗ [`2026-06-29-decisions-operational-cleanup`](../../plans/tz/2026-06-29-decisions-operational-cleanup.md).
- **Бэкфилл `impliesAction`** для исторических решений по-прежнему отложен (см. [[../04_не-сделано/README]]).

## «День компании» — ежедневный брифинг владельца на `/dashboard` (2026-06-29)

Owner-only герой `DayCompanyHero` (`frontend/src/ui/components/dashboard/day-company/*`) над `DashboardCanvas` на `/dashboard`. Это **расширение** существующего дневного дайджеста (`DailyOperationsDigest` + `operations-daily-digest` taskType + `OperationsDailyDigestCron` + `DailyDigestService`), а НЕ новый пайплайн/модель/агент. RBAC чтения дайджеста (`canViewOperationsDashboard`) уже пускал owner/admin/coo/super. **Новых эндпоинтов нет** — переиспользованы daily-digest (3) + stuck/cross-project + director + insights/top + ideas/top.

- **Состав и порядок героя:** обложка-вердикт (4 оси) → «Читать полный отчёт» (одно разворачивание письма-прозы) → «Цель и компас» → «Зависшие задачи ↔ кто просрочил» (live stuck + агрегат по assignee, клик → `/issues/{id}`) → «Что мешает ↔ Идеи» (insights/top + ideas/top + risks/ideasSummary) → «Польза Коры за период» (5 счётчиков value-strip).
- **Источники данных:** новые JSONB-поля дайджеста `verdictJson`/`letterJson`/`goalAlignmentDayJson` (см. [[../02_architecture/data-model]] §«DailyOperationsDigest» — расширение «День компании»); дневные `risksSummary`/`ideasSummary` из `metricsJson`; live-`getStuckCrossProject` (+`assigneeUserId`/`assigneeName`/`dueDate`); value-strip директора (+`tasksResolved`/`ideasCollected`); `insights/top` + `ideas/top`.
- **Синтез (бэк):** `DailyDigestService.generate` + `daily-digest.prompt.ts` собирают пакет дня прямыми Prisma-запросами + детерминированные сигналы → ОДИН capable LLM-вызов (`operations-daily-digest`, json_schema strict) → строгий JSON; post-LLM `clampVerdict` (критич. клиентский сигнал ⇒ ось «Клиенты» ≠ ok); при провале — «сухой» fallback (NULL новых полей). Крон `OperationsDailyDigestCron` перенесён `@Cron('0 22 * * *')` → `@Cron('0 3 * * *')` (03:00 UTC, после ночных синков); доставка: title «День компании за …», actionUrl `/dashboard`. Kill-switch `operations.daily_digest.enabled` переиспользован (новый флаг НЕ вводился).
- Миграция `20260629000000_add_day_company_fields_to_digest` (аддитивная, 3 nullable JSONB). Подробности AI-job — [[ai-jobs]] §«operations-daily-digest».

## «Неделя компании» — недельный брифинг владельца на `/dashboard` (2026-06-29)

Недельный близнец «Дня компании»: герой `WeekCompanyHero` (`frontend/src/ui/components/dashboard/week-company/*`) на `/dashboard` под **rhythm-switcher День↔Неделя** (он же чинит дыру — раньше `/dashboard` рендерил hardcoded `rhythm="today"` без переключателя, и пресеты `week`/`month` были недостижимы). Это **расширение** существующего недельного дайджеста (`WeeklyOperationsDigest` + `operations-weekly-digest` taskType + `OperationsWeeklyDigestCron` + `WeeklyDigestService`), а НЕ новый пайплайн/модель/агент. Источник ТЗ — `plans/tz/2026-06-29-week-company-weekly-brief.md` (Ф1–Ф6, ветка `feature/week-company-weekly-brief`).

- **rhythm-switcher:** состояние ритма `day`|`week` (`month` — таб ведёт на vNext/disabled) вместо hardcoded `today`; дефолт `day`, но в пн по локали Org → дефолт «Неделя»; `?rhythm=week` из URL. `GoalCompass3D` — **общий** премиум-компас (CSS/SVG-3D, 0 зависимостей): conic-зоны + стеклянный безель + металлическая стрелка `--angle` из score + parallax/взмах за `prefers-reduced-motion`; заменил плоский `MiniArrow` и используется в недельном И дневном (`GoalCompassCard`).
- **Состав и порядок героя:** обложка-вердикт (4 оси) + тренд осей по дням пн–пт → «Читать недельное письмо» (одно разворачивание письма-прозы) → компас к цели (`GoalCompass3D`) → таблица «план ↔ факт» по людям (+колонка **«Вклад в цель»** `goalContributionNet`, разворот по задачам) → «Зависло ↔ кто держит» (live stuck/cross-project, клик-фильтр) → риски/идеи → польза.
- **Окно и тайминг:** неделя = **пн–пт** (cron `weekEnd = weekStart+4`); запуск пн ~**06:00** локали Org (крутилка `betaOps.weeklyDigestLocalHour` дефолт 8→6, `weeklyDigestLocalDay`=1). `WeeklyPerPersonService` получил опц. параметр окна `weekEnd` (по умолчанию пн–вс для страницы `/dashboard/operations/weekly` — не сломана).
- **Синтез (бэк):** `WeeklyDigestService.generate` + `weekly-digest.prompt.ts` собирают пакет = 5 дневных «Дней компании» (пн–пт) + команда план/факт + повторяющиеся блокеры/риски + компас + прошлая неделя → ОДИН capable LLM-вызов (`operations-weekly-digest`, deepseek-v4-pro, json_schema strict, `reasoningEffort high`, `maxTokens 8000`) → строгий JSON; `extractWeekCompanyResponse` (toolCalls+envelope+lenient zod) → post-LLM `clampWeekVerdict` (клиентский risk в дневных ⇒ `clients≠ok`; план/факт<50% ⇒ `execution≠ok`); `dayTrend` всегда детерминирован из 5 дневных вердиктов; при провале — «сухой» fallback (NULL новых полей). Доставка: уведомление `operations.weekly_digest`, title «Неделя компании …», actionUrl `/dashboard?rhythm=week`. Kill-switch `weeklyDigestEnabled` переиспользован (новый флаг НЕ вводился).
- Миграция `20260629010000_add_week_company_fields_to_digest` (аддитивная, 4 nullable JSONB: `verdictJson`/`letterJson`/`goalAlignmentWeekJson`/`dayTrendJson`). Подробности — [[../02_architecture/data-model]] §«WeeklyOperationsDigest» (расширение «Неделя компании»), AI-job — [[ai-jobs]] §«operations-weekly-digest». **Новый эндпоинт** — `GET /api/v1/dashboard/operations/weekly-digest/latest` ([[api-layer]]).

## «Месяц компании» — месячный брифинг владельца на `/month` (2026-06-30)

Третий ритм брифинга — зеркало «Недели компании» на месячном окне: герой `MonthCompanyHero` (`frontend/src/ui/components/dashboard/month-company/*`) над `DashboardCanvas rhythm=month` на `/month` (владельцу). В отличие от День/Неделя — это **новая модель `MonthlyOperationsDigest`** (а не расширение существующей записи), но тот же пайплайн «свод одним capable LLM-вызовом без нового извлекающего агента». Источник ТЗ — `plans/tz/2026-06-29-month-company-monthly-brief.md` (ветка `feature/month-company-and-report-navigation`).

- **Состав и порядок героя:** `MonthVerdictCover` (4 оси + тренд по неделям месяца) → «Читать письмо месяца» (`MonthLetter`) → `MonthGoalCompass` (общий `GoalCompass3D`) + `MonthGoalPace` (факт/план/ETA/ведущий сигнал) → `MonthDecisions` («что решить собственнику») → `MonthNextFocus` («фокус месяца») → таблица план/факт за месяц (переиспользует `WeeklyPerPersonWidget` с месячным окном; колонка «Вклад в цель» `goalContributionNet` теперь СУММА по окну — range-sum в `weekly-per-person.service`).
- **Синтез (бэк):** `MonthlyDigestService.generate` + `monthly-digest.prompt.ts` сводят **4 недельных `WeeklyOperationsDigest`** месяца ОДНИМ capable LLM-вызовом (`operations-monthly-digest`, deepseek-v4-pro, json_schema strict + lenient Zod, `maxTokens 8000`; `MONTH_COMPANY_SYSTEM_PROMPT` стабилен — prompt-caching). Вход компрессирован (select без `letterJson`; пропущенные недели — graceful). Post-LLM `clampMonthVerdict` (нельзя зелёный при красном клиенте); `weekTrendJson` всегда детерминирован; **`pace` (факт/план/ETA) считает КОД** — LLM отдаёт только текст `leadingSignal`; при провале — «сухой» fallback.
- **Тайминг и доставка:** крон `OperationsMonthlyDigestCron` (`@Cron('0 * * * *')` + глобальный МСК-гейт «1-е число && час===`betaOps.monthlyDigestLocalHour`, default 6») генерит за прошлый месяц (`shiftPeriod -1`) → уведомление `operations.monthly_digest` ролям owner/coo, `actionUrl /month`, идемпотентный `markDelivered`. Kill-switch `betaOps.monthlyDigestEnabled` (ON). Метрики `coo_monthly_digest_generated/failed/delivered_total`.
- **API/слои:** контроллер `MonthlyDigestController` (`/api/v1/dashboard/operations/monthly-digest`: GET `/?period=`, `/latest`, POST `/generate`, GET `/available-periods`); фронт-слои `src/api/monthly-digest.api.ts` → `src/domain/operations-monthly-digest.ts` → `src/hooks/useMonthCompany.ts`. Модель `MonthlyOperationsDigest` — [[../02_architecture/data-model]] §«MonthlyOperationsDigest»; AI-job — [[ai-jobs]] §«operations-monthly-digest»; крон — [[workers-queues]]; модуль — [[../02_architecture/module-map]] §«Месяц компании».

## Навигация по датам + архив отчётов на всех ритмах (2026-06-30)

Все 3 героя-брифинга (день/неделя/месяц) получили общий навигатор периодов вместо «только последний». Источник — `plans/tz/2026-06-30-report-date-navigation-archive.md`.

- **Бэк:** к 3 ритмам добавлен `GET /api/v1/dashboard/operations/{daily,weekly,monthly}-digest/available-periods?limit=` → `{rhythm, periods:[{period,stateHint,title}], latest}` (метод `listAvailablePeriods` в 3 сервисах; shared `available-periods.dto.ts`). Лимит — крутилка `operations.report_archive.recent_limit` (12, getDynamic + admin-сид `seed-admin-setting-report-archive.ts`).
- **Фронт:** общий `PeriodNavigator` (`shared/PeriodNavigator.tsx`) — stepper по ритму («вперёд» disabled на latest, не в будущее), клик-подпись → попап «Недавние отчёты» (архив с цветной точкой `stateHint`) + «Выбрать дату…». Хелперы `src/domain/period.ts`; `PeriodEmptyState` (нет данных → ближайший/«К последнему»; первый запуск → обучающий). Каждый герой держит `selectedPeriod` (default «последний завершённый» из `available-periods.latest`), грузит данные по периоду (SWR-ключ включает период), кнопка «К последнему». `value-recap` переведён с локального `PeriodSelector` на общий `PeriodNavigator`. Подробности — [[frontend-contexts-hooks]] §«PeriodNavigator», [[frontend-pages]].
