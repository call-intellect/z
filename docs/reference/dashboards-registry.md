# Реестр дашбордов и виджетов Z

> Один документ — источник правды по всем дашбордам Z и их виджетам. Сверяемся
> с ним на каждой фазе ТЗ
> [plans/archive/2026-06-01-dashboards-wow-polish.md](../../plans/archive/2026-06-01-dashboards-wow-polish.md).
>
> Дата создания: 2026-06-01. Поддерживать актуальным при добавлении/удалении
> страниц и виджетов.

## 1. Дашборды (страницы)

Статусы:
- ✅ — закрыта Фазой 1 (есть вход из навигации) и визуально на эталоне.
- 🟡 — навигация есть, но визуально требует полировки.
- 🔴 — orphan / dead route (нет входа из меню) ИЛИ черновой UI.

| Дашборд | Маршрут | Главный Client.tsx | В меню? | Категория | Статус |
|---|---|---|---|---|---|
| CEO Director (главный дашборд) | `/dashboard` | `frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx` | да (Каждый день → Главная) | CEO | ✅ (main-rework выкачен ON: `dashboard.main_rework.enabled`, `ValueStripWidget` + перекомпоновка первого экрана) |
| Дашборд (старый wrapper) | `/dashboard` (роут) | `frontend/app/(authenticated)/dashboard/DashboardClient.tsx` | через `/dashboard` | CEO | 🟡 |
| Operations | `/dashboard/operations` | `frontend/app/(authenticated)/dashboard/operations/OperationsDashboardClient.tsx` | да (Управление → Панель операций) | Operations | ✅ (dashboard-rework выкачен ON: `operations.dashboard_rework.enabled`, capacity по командам + resolved-зеркало) |
| Ежедневный отчёт | `/dashboard/operations/daily` | `frontend/app/(authenticated)/dashboard/operations/daily/DailyDigestClient.tsx` | да (Управление) | Operations | 🟡 |
| Недельная сводка | `/dashboard/operations/weekly` | `frontend/app/(authenticated)/dashboard/operations/weekly/WeeklyDigestClient.tsx` | да (Управление) | Operations | 🟡 |
| Карточка сотрудника — корень | `/persons/[id]` | `frontend/app/(authenticated)/persons/[id]/PersonDetailClient.tsx` | через список `/persons` | Person | ✅ (нав добавлен 2026-06-01) |
| Профиль знаний | `/persons/[id]/knowledge-profile` | `frontend/app/(authenticated)/persons/[id]/knowledge-profile/PersonKnowledgeProfileClient.tsx` | ✅ через `PersonSubpagesNav` | Person | ✅ |
| Навыки (skill-profile) | `/persons/[id]/skill-profile` | _только редирект на `/persons/[id]` (см. `page.tsx`)_ | таб виден, но кликабельность приводит к редиректу | Person | 🟡 (по-сути deprecated, оставлен как редирект) |
| История назначений | `/persons/[id]/appointments` | `frontend/app/(authenticated)/persons/[id]/appointments/PersonAppointmentsClient.tsx` | ✅ через `PersonSubpagesNav` | Person | ✅ |
| Профиль вклада сотрудника | `/persons/[id]/contributions` | `frontend/app/(authenticated)/persons/[id]/contributions/PersonContributionsClient.tsx` (обёртка над `ContributionsView`) | ✅ через `PersonSubpagesNav` | Person | ✅ |
| Командный вклад | `/persons/[id]/social-contribution` | `frontend/app/(authenticated)/persons/[id]/social-contribution/PersonSocialContributionClient.tsx` | ✅ через `PersonSubpagesNav` | Person | ✅ |
| Пульс сотрудника | `/persons/[id]/pulse` | `frontend/app/(authenticated)/persons/[id]/pulse/PersonPulseClient.tsx` | ✅ через `PersonSubpagesNav` | Person | ✅ |
| Спринт — daily | `/sprints/[id]` | `frontend/app/(authenticated)/sprints/[id]/SprintDashboardClient.tsx` (+ `SprintDailyPanel.tsx`, `SprintWeeklyPanel.tsx`) | да (Каждый день → Спринты) | Sprint | 🟡 (Daily) / ✅ (Weekly — эталон) |
| Архив спринтов | `/sprints/archive` | `frontend/app/(authenticated)/sprints/archive/SprintArchiveClient.tsx` | ✅ да (Каждый день → Архив спринтов, добавлен 2026-06-01) | Sprint | 🟡 |
| Список таблиц | `/tables` | `frontend/app/(authenticated)/tables/TablesListClient.tsx` | ✅ да (Каждый день → Таблицы, добавлен 2026-06-01) | Tables | 🟡 |
| Таблица — деталь | `/tables/[id]` | `frontend/app/(authenticated)/tables/[id]/TableClient.tsx` | через `/tables` | Tables | 🟡 |

**Итого:** 16 страниц-дашбордов / 5 семейств (CEO / Operations / Person / Sprint / Tables).
После Фазы 1 не осталось orphan-страниц без входа в навигацию: 3 dead route закрыты
(`/tables`, `/sprints/archive`, 6 подстраниц `/persons/[id]/*`).

## 2. Виджеты CEO-дашборда

Папка: [frontend/src/ui/components/dashboard/](../../frontend/src/ui/components/dashboard/).

Тоны соответствуют paired-токенам Z (`bg-{tone}` + `text-{tone}-fg`):
`success` · `warning` · `danger` · `accent` · `info` · `neutral`.

| Виджет | Файл | Где используется | Доминирующий тон | Статус |
|---|---|---|---|---|
| ActivityFeedWidget | `ActivityFeedWidget.tsx` | DirectorDashboardClient | accent | ✅ полировано Фазой 3 (2026-06-01): event-type → иконка+тон, `formatDistanceToNow` (ru) |
| AiNarrativeWithSources | `AiNarrativeWithSources.tsx` | DirectorDashboardClient | accent / info | ✅ эталон (inline-цитаты, тон тона) |
| AssistantSidebar | `AssistantSidebar.tsx` | AuthenticatedShell (FAB) | accent | ✅ эталон |
| BottleneckHeatmapWidget | `BottleneckHeatmapWidget.tsx` | DirectorDashboardClient | warning → danger | ✅ эталон (живая heatmap) |
| BusFactorWidget | `BusFactorWidget.tsx` | DirectorDashboardClient | danger / warning | ✅ полировано Фазой 3 (2026-06-01): `MiniBarRow` глубины + цветной чип по severity (API даёт только `expertsCount`, без уровней — stacked не применим) |
| GoalVectorWidget | `GoalVectorWidget.tsx` | DirectorDashboardClient | success / accent | ✅ полировано Фазой 3 (2026-06-01): `MiniDonut` слева цели + `MiniStackedBar` top-3 contributors |
| IrreversibleDecisionsAlert | `IrreversibleDecisionsAlert.tsx` | DirectorDashboardClient | danger | ✅ полировано Фазой 3 (2026-06-01): градиентный фон, иконка `AlertTriangle` в круге, `border-l-4` |
| KnowledgeVelocityKpi | `KnowledgeVelocityKpi.tsx` | DirectorDashboardClient | success / warning / danger | ✅ полировано Фазой 3 (2026-06-01): главное число через `CountUp` (sparkline-данных в API нет) |
| LowRoiMeetingsWidget | `LowRoiMeetingsWidget.tsx` | DirectorDashboardClient | danger / warning | ✅ полировано Фазой 3 (2026-06-01): ROI как `MiniBarRow` (danger), hover-tone `bg-chip-danger-bg/5` (массив участников в API виджета отсутствует — чипы пропущены) |
| RecurringTopicsWidget | `RecurringTopicsWidget.tsx` | DirectorDashboardClient | accent / warning | ✅ полировано Фазой 3 (2026-06-01): общий `MiniSparkline` плотности + `MiniBarRow` справа от каждой темы, авто-тон |
| SampleStoryBanner | `SampleStoryBanner.tsx` | DirectorDashboardClient (demo) | info | ✅ эталон |
| TeamHealthGrid | `TeamHealthGrid.tsx` | DirectorDashboardClient | по строке (sentiment.tone) | ✅ полировано Фазой 3 (2026-06-01): hover-tone строки по `sentiment.tone`, колонка «Обещания» — `MiniDonut` + `centerLabel` |

**Итого:** 12 виджетов. 12 эталонных/полированных ✅, 0 на полировку 🟡, 0 черновых 🔴.

## 3. Эталонные виджеты — тон проекта

Когда сомневаешься, «достаточно ли секси» — открой эти три файла и сравни:

- **BottleneckHeatmapWidget** — [frontend/src/ui/components/dashboard/BottleneckHeatmapWidget.tsx](../../frontend/src/ui/components/dashboard/BottleneckHeatmapWidget.tsx) — живая heatmap по дням × часам, цвет-кодирование через `bg-bg-overlay/40 → bg-chip-warning-bg → bg-chip-danger-bg`. Hover, плотность данных, mobile-grid.
- **AiNarrativeWithSources** — [frontend/src/ui/components/dashboard/AiNarrativeWithSources.tsx](../../frontend/src/ui/components/dashboard/AiNarrativeWithSources.tsx) — inline-цитаты прямо в нарративе, `chip-info`-фон для пометки источников, аккуратная типографика.
- **SprintWeeklyPanel** — [frontend/app/(authenticated)/sprints/[id]/SprintWeeklyPanel.tsx](../../frontend/app/(authenticated)/sprints/[id]/SprintWeeklyPanel.tsx) — информационная иерархия: KPI-шапка → AI-нарратив → секции с цвет-кодированием, всё на парных токенах.

## 4. Карта главной — табы (зонтик main-screen-umbrella, 2026-06-01)

> Источник: [`plans/tz/2026-06-01-dashboard-main-tabs-restructure.md`](../../plans/tz/2026-06-01-dashboard-main-tabs-restructure.md) Фаза 0. Sticky Hero + 4 таба `Обзор/Команда/Знания/Цели и встречи` (один экран — одна тема).

### 4.1. Sticky Hero (видим всегда)

| Зона | Содержимое | Источник данных |
|---|---|---|
| 3 KPI с MiniSparkline | Настроение / Обещания / Висящие решения. CountUp + цвет тренда | `pulse.kpi.*` (DirectorDashboard API) |
| AI-сводка | `<AiNarrativeWithSources>` (без изменений) | `data?.narrative` |
| Топ-1 риск | Первый из `pulsePatterns.irreversibleDecisions` или fallback «✅ Нет критических рисков» | API `/dashboard/pulse-patterns` |

Под Hero (узкая sticky-полоса):
- Слева: 4 мини-счётчика «Структура компании» (`StructureSummaryWidget`) — отделы / должности / сотрудники / документы.
- Справа: Pill «💬 Спросите Кору» — открывает `AssistantSidebar` на табе «Спросить».

### 4.2. Виджеты по табам

| Виджет | Файл | Таб | Позиция | Источник данных | Статус |
|---|---|---|---|---|---|
| **WeeklyDigestSection** | inline в DirectorDashboardClient | Обзор | 1 | `themesApi.recent` + `insightsApi.recent` + `decisionsApi.recent` (или top-3 из общего списка) | 🆕 inline-секция (нет отдельного файла) |
| **TeamHealthGrid** | TeamHealthGrid.tsx | Команда | 1 | `pulse.teamHealth` | ✅ existing |
| **BusFactorWidget** | BusFactorWidget.tsx | Команда | 2 | `pulse.busFactor` | ✅ existing |
| **ActivityFeedWidget** | ActivityFeedWidget.tsx | Команда | 3 | `dashboard.activityFeed` | ✅ existing |
| **PeopleAtRiskWidget** | PeopleAtRiskWidget.tsx | Команда | 4 | `dashboard.peopleAtRisk` (endpoint `/dashboard/people-at-risk`, top-N) | ✅ existing (skeleton/empty/error) |
| **RecurringTopicsWidget** | RecurringTopicsWidget.tsx | Знания | 1 | `pulse.recurringTopics` | ✅ existing |
| **BottleneckHeatmapWidget** | BottleneckHeatmapWidget.tsx | Знания | 2 | `pulse.bottleneckHeatmap` | ✅ existing |
| **ActiveThemesWidget** | inline в DirectorDashboardClient | Знания | 3 | `data?.activeThemes` | ✅ inline |
| **HotEntitiesWidget** | inline | Знания | 4 | `data?.hotEntities` | ✅ inline |
| **OpenQuestionsWidget** | inline (стр. 797) | Знания | 5 | `data?.openQuestions` | ✅ inline |
| **SignalCountersWidget** | inline | Знания | 6 | `data?.signalCounters` | ✅ inline |
| **InsightsTopWidget** | widgets/InsightsTopWidget.tsx | Знания | 7 | SBA β-4 (Insights Radar) | ✅ existing |
| **KnowledgeVelocityKpi** | KnowledgeVelocityKpi.tsx | Знания | 8 (перенесён из Hero) | `pulse.knowledgeVelocity` | ✅ existing |
| **GoalVectorWidget** | GoalVectorWidget.tsx | Цели и встречи | 1 | `pulse.goalVector` | ✅ existing |
| **IrreversibleDecisionsAlert** | IrreversibleDecisionsAlert.tsx | Цели и встречи | 2 | `pulsePatterns.irreversibleDecisions` | ✅ existing |
| **LowRoiMeetingsWidget** | LowRoiMeetingsWidget.tsx | Цели и встречи | 3 | `pulse.lowRoiMeetings` | ✅ existing |
| **StrategicAlignmentWidget** | widgets/StrategicAlignmentWidget.tsx | Цели и встречи | 4 | `data?.strategicAlignment` | ✅ existing |
| **QualityScoreWidget** | widgets/QualityScoreWidget.tsx | Цели и встречи | 5 | Фаза C (owner/admin only) | ✅ existing |

### 4.3. Виджеты на главной → переезд / out of scope

| Виджет | Куда | Причина |
|---|---|---|
| `SampleStoryBanner` | остаётся в DirectorDashboardClient (для demo) | Не вписывается в табы — глобальный баннер демо-режима |
| `IntroWizardWidget` (онбординг) | между Hero и Tabs (Фаза Б.5) | Видим только owner/admin при `setup < 6/6`; компактная плашка для 6/6 ≤30 дн; иначе скрыт |
| `CurationPendingWidget` (SBA α-4) | НЕ в главную | Профильная функция куратора — отдельная страница `/curation` |
| `OrgChatPanel` (низ страницы «Спросите про вашу компанию») | в AssistantSidebar.Спросить (Фаза Б.4) | Перенос из inline в боковую панель |

### 4.4. Открытые хвосты по данным

| Хвост | Влияет на | Статус |
|---|---|---|
| ~~**Ranked Pulse score per Person**~~ | `PeopleAtRiskWidget` | ✅ закрыт: shipped endpoint `GET /dashboard/people-at-risk` (top-N) + `PeopleAtRiskService`; виджет рендерит реальные данные (skeleton/empty/error) |
| **Themes/Insights/Decisions `.recent` (за неделю)** | таб Обзор | Используем top-3 из общего списка, отфильтрованного по `createdAt > startOfWeek` |
| ~~**`chatApi.askCompany()` endpoint**~~ | AssistantSidebar.Спросить | ✅ закрыт: таб «Спросить» рендерит `OrgChatPanel` (LLM-чат с цитатами), `@PublicDemo()` на chat-эндпоинтах для demo_observer |

### 4.5. Матрица состояний главной (для Шага В.7)

| # | Org | Role | Подписка | Рендер DirectorDashboardClient |
|---|---|---|---|---|
| 1 | Эталон | `demo_observer` | (n/a) | Hero+Tabs полные. CTA disabled+PaywallDialog |
| 2 | Эталон | `super_admin` | (n/a) | Hero+Tabs полные. CTA активны (bypass) |
| 3 | Своя | `owner`/`admin` | DEMO | **`MainEmptyState`** замещает Hero+Tabs (правило 3 матрицы) |
| 4 | Своя | `owner`/`admin` | ACTIVE | Hero+Tabs полные. Per-таб empty-state если виджеты пусты |
| 5 | Своя | `member` | ACTIVE | Hero+Tabs полные. Онбординг-блок не показываем |
| 6 | Своя | `owner` | ACTIVE без demo_observer | Hero+Tabs полные |

### 4.6. Реализация в коде (после Волны В, 2026-06-02)

Все 6 строк матрицы реализованы в [`frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx`](../../frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx):

```ts
// Состояние 3 — MainEmptyState замещает Hero+Tabs.
const isPageEmpty =
  isOwnOrg &&                              // isReferenceDemo === false
  subscriptionStatus === 'DEMO' &&         // своя Org не оплачена
  isOwnerOrAdmin &&                        // member никогда не видит
  !loading && !subscriptionLoading &&
  (data?.isEmpty === true || data === null);

// Состояние 1 — read-only CTA + paywall trigger.
<TopRiskCard
  isReadOnlyDemo={currentOrgRole === 'demo_observer'}
  onPaywallTrigger={showPaywallModal}
  ...
/>
```

Static smoke-комментарий 6 ветвей зафиксирован inline в коде (поиск `Static smoke матрицы 6 состояний`). Дополнительные правила:

- **№1** — `DemoObserverGuard` (backend) режет мутации на ресурсах эталона. `@PublicDemo()` на `/concierge/messages` + `/concierge/messages/once` + `/chat-v2/messages` позволяет LLM-чат.
- **№2** — `super_admin` bypass в `DemoObserverGuard` (req.user.isSuperAdmin).
- **№3** — `setupProgress` встроен в `MainEmptyState` через prop (Шаг В.3) — компактная плашка «Настройка компании · N/6» с CTA `/onboarding/company/step-1`.
- **№4-6** — Hero+Tabs стандартно. `IntroWizardWidget` сам проверяет role и `setupCompletedAt`-возраст (Фаза Б.5).

## 5. Семь «вау»-критериев

Чеклист, по которому проверяем каждый виджет / страницу:

1. **Визуализация:** для каждой числовой метрики есть мини-визуал (sparkline / bar / donut) вместо «числа в чипе» там, где это уместно. Числа без контекста — только в KPI-hero, где есть `CountUp` и фон.
2. **Цвет-кодирование по тону:** ряды/ячейки получают `bg-chip-{tone}-bg/N` или `border-l-{tone}` в зависимости от смысла (sentiment, severity, ROI). Парные токены (`bg-{tone}` + `text-{tone}-fg`), без `text-white` поверх цветного.
3. **Hover / transition:** интерактивные элементы — `hover:bg-bg-overlay`, `hover:shadow-md`, `transition-colors duration-150`. Никаких резких прыжков, только плавные переходы.
4. **Skeleton / empty / error:** все три состояния прорисованы, не «белый экран». Используются `<Skeleton />`, `<AdminEmpty />`, `<AdminError />` или их аналоги.
5. **Mobile (375px):** виджет помещается без `overflow-x`, не ломает grid. Тестируется DevTools на iPhone SE-ширине.
6. **Motion-safe микро-движение:** `motion-safe:animate-in`, `motion-safe:fade-in`, `motion-safe:slide-in-from-bottom-2`, дозированно. Уважение `prefers-reduced-motion`.
7. **Русский язык:** ни одного английского слова в видимых строках (кроме брендов вроде «GitHub»). Любая аббревиатура — c расшифровкой при первом упоминании.
