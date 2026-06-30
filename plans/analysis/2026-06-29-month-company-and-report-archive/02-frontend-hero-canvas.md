---
type: analysis
status: research-input
feature: month-company-and-report-archive
date: 2026-06-29
snapshot_date: 2026-06-29
source: vexp/code-read (carto agent frontend-hero-canvas)
---

# 02 — Картография frontend дашборда День/Неделя/Месяц

Все факты `verified` (прямое чтение кода).

## Движок ритмов

- `Rhythm = 'today'|'week'|'month'` — [types.ts:3](../../../frontend/src/ui/components/dashboard/registry/types.ts). `DashboardCanvas {role,rhythm}` фильтрует виджеты по `rhythm.includes && roles.includes` — [DashboardCanvas.tsx:19](../../../frontend/src/ui/components/dashboard/registry/DashboardCanvas.tsx).
- Пресет `owner.month` — [presets.ts:32](../../../frontend/src/ui/components/dashboard/registry/presets.ts): verdict, **month-recap**, goal-vector, trend, **achievements**, **weekly-dynamics**, **maturity**, **bus-factor**, plan-fact, …, weekly-plan-fact, feed, value.

## Герой дня (шаблон месяца)

- `DayCompanyHero` — [DayCompanyHero.tsx:58](../../../frontend/src/ui/components/dashboard/day-company/DayCompanyHero.tsx): оркестратор, 3 состояния (skeleton/error/empty+Пересобрать). Порядок под-компонентов [DayCompanyHero.tsx:184](../../../frontend/src/ui/components/dashboard/day-company/DayCompanyHero.tsx): `DayVerdictCover`(4 оси) → `DayLetter`(раскрытие полного отчёта) → `GoalCompassCard`(компас) → `StaleTasksLinked` → `RisksIdeas` → `PeriodValue`.
- `DirectorDashboardClient` — [DirectorDashboardClient.tsx:38](../../../frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx): герой только для owner, затем `DashboardCanvas rhythm='today'`; в шапке хардкод-ссылки `/week`, `/month`.
- `MonthDesktopClient` — [MonthDesktopClient.tsx:12](../../../frontend/app/(authenticated)/month/MonthDesktopClient.tsx): `ModernPageShell` + `DashboardCanvas rhythm='month'`, своего героя нет.

## Месячные виджеты (реализованы)

- `MonthRecapWidget` = `<ValueRecapDashboardClient embedded />` — [MonthRecapWidget.tsx:9](../../../frontend/src/ui/components/dashboard/registry/widgets/MonthRecapWidget.tsx).
- `AchievementsWidget` (goals achieved этого месяца), `MaturityCardWidget`, `BusFactorCardWidget` (`getPulsePatterns(orgId,'month').busFactor`), `WeeklyDynamicsWidget` (`weeklyDigestApi.get().trend`), `TrendWidget` (параметризован `rhythm='month'` — [TrendWidget.tsx:58](../../../frontend/src/ui/components/dashboard/registry/widgets/TrendWidget.tsx)).

## Навигатор по периодам (готовый эталон)

- **`ValueRecapDashboardClient` PeriodSelector** — [ValueRecapDashboardClient.tsx:135](../../../frontend/app/(authenticated)/dashboard/value-recap/ValueRecapDashboardClient.tsx): стрелки prev/next, `selectedPeriod` state, `shiftPeriodYm`/`formatPeriodYm` ([value-recap.ts:50](../../../frontend/src/domain/value-recap.ts)), `valueRecapApi.get(orgId, period?)` ([value-recap.api.ts:105](../../../frontend/src/api/value-recap.api.ts)).
- `operationsDailyDigestApi.getByDate(date)`/`getLatest()`/`generate(date)` — [operations-daily-digest.api.ts:186](../../../frontend/src/api/operations-daily-digest.api.ts). Но `useDayCompanyDigest` зовёт только `getLatest()` — [useDayCompany.ts:24](../../../frontend/src/hooks/useDayCompany.ts). `tolerantGet` → null при `digest_not_found`.
- `weeklyDigestApi.get(weekStart)/generate(weekStart)` — [weekly-digest.api.ts:106](../../../frontend/src/api/weekly-digest.api.ts) (нет `/latest`).

## Reuse-map (месяц)

`DayCompanyHero`→`MonthCompanyHero` (1:1 шаблон); `DayVerdictCover`/`DayLetter`/`GoalCompassCard`/`PeriodValue` → параметризовать период (пропс вместо хардкода «за неделю»/«todayDelta»); `DashboardCanvas rhythm='month'` остаётся нижней витриной под героем; `PeriodSelector`→вынести в общий `PeriodNavigator`; `ModernPageShell`+toolkit (glass/CardTitle/GRAD/CHART/AreaTrend) 1:1.

## Gaps (месяц/навигация)

Нет `MonthCompanyHero`, `api/operations-monthly-digest`, `domain/operations-monthly-digest`, `useMonthCompany`; нет общего `PeriodNavigator` (заперт в value-recap); `goalAlignment`-тип привязан к `todayDelta` (нужен `periodDelta`/дженерик); герой кладётся НАД canvas в `MonthDesktopClient` (Р-M2).
