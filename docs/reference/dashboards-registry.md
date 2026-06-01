# Реестр дашбордов и виджетов Z

> Один документ — источник правды по всем дашбордам Z и их виджетам. Сверяемся
> с ним на каждой фазе ТЗ
> [plans/tz/2026-06-01-dashboards-wow-polish.md](../../plans/tz/2026-06-01-dashboards-wow-polish.md).
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
| CEO Director (главный дашборд) | `/dashboard` | `frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx` | да (Каждый день → Главная) | CEO | 🟡 |
| Дашборд (старый wrapper) | `/dashboard` (роут) | `frontend/app/(authenticated)/dashboard/DashboardClient.tsx` | через `/dashboard` | CEO | 🟡 |
| Operations | `/dashboard/operations` | `frontend/app/(authenticated)/dashboard/operations/OperationsDashboardClient.tsx` | да (Управление → Панель операций) | Operations | 🟡 |
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

## 4. Семь «вау»-критериев

Чеклист, по которому проверяем каждый виджет / страницу:

1. **Визуализация:** для каждой числовой метрики есть мини-визуал (sparkline / bar / donut) вместо «числа в чипе» там, где это уместно. Числа без контекста — только в KPI-hero, где есть `CountUp` и фон.
2. **Цвет-кодирование по тону:** ряды/ячейки получают `bg-chip-{tone}-bg/N` или `border-l-{tone}` в зависимости от смысла (sentiment, severity, ROI). Парные токены (`bg-{tone}` + `text-{tone}-fg`), без `text-white` поверх цветного.
3. **Hover / transition:** интерактивные элементы — `hover:bg-bg-overlay`, `hover:shadow-md`, `transition-colors duration-150`. Никаких резких прыжков, только плавные переходы.
4. **Skeleton / empty / error:** все три состояния прорисованы, не «белый экран». Используются `<Skeleton />`, `<AdminEmpty />`, `<AdminError />` или их аналоги.
5. **Mobile (375px):** виджет помещается без `overflow-x`, не ломает grid. Тестируется DevTools на iPhone SE-ширине.
6. **Motion-safe микро-движение:** `motion-safe:animate-in`, `motion-safe:fade-in`, `motion-safe:slide-in-from-bottom-2`, дозированно. Уважение `prefers-reduced-motion`.
7. **Русский язык:** ни одного английского слова в видимых строках (кроме брендов вроде «GitHub»). Любая аббревиатура — c расшифровкой при первом упоминании.
