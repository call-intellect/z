---
date: 2026-07-06
feature: admin-dashboard-charts-filters
status: done
---

# ТЗ: инфографика + фильтры на «Пульс компании» (`/admin`)

## Контекст

Скриншот владельца: секции «Расход по провайдерам» и «Топ функций по расходу» на главной admin-странице — обычные списки, единственный фильтр — period (сутки/неделя/месяц). Запрос: «хотелось бы инфографику... в виде графиков... с возможностью отфильтровать по временному периоду, модулю, модели, организации и т.д. все возможные фильтры».

Важно отличать от уже готового `/admin/analytics/llm-cost` (сегодняшняя работа, источник `AiCostDaily`, уже есть реальный тренд/фильтры/провайдер+модель breakdown) — эта страница другая: `/admin` домашняя, источник `AiUsageLog` напрямую, использовалась для KPI-пульса (расход/ошибки/орг+юзеры). Sparkline-графики за 30 дней там сейчас — **фейк** (`buildMockSeries`, псевдослучайный шум от seed, не реальные данные).

## Объём

**Backend** — `AdminUsageService.getDashboard()` (источник остаётся `AiUsageLog`, единый для totals/failRate/всех breakdown — не мешать с `AiCostDaily`, чтобы цифры при фильтрации не расходились):
- [x] DTO `DashboardQuerySchema` += `provider?`, `model?`, `taskType?`, `orgId?` (опциональные строки-фильтры, независимо от `scope`).
- [x] `baseWhere` += эти опциональные фильтры.
- [x] Новая секция `byModel: Array<{provider,model,costUsd,calls}>` — `groupBy(['provider','model'])`.
- [x] Новая секция `trend: Array<{date,costUsd,calls,failedCalls}>` — реальный дневной тренд через `$queryRaw` (`date_trunc('day', "createdAt")`), с теми же фильтрами. Заменяет фейковый мок на фронте.
- [x] `fetchTopOrgsByCost` — применить те же фильтры.
- [x] Controller прокидывает новые query-параметры.
- [x] Тесты `admin-usage.service.spec.ts`: фильтры сужают totals/byProvider/byModel/byTaskType/trend согласованно.

**Frontend** — `AdminDashboardClient.tsx`:
- [x] Панель фильтров: period (day/week/month/custom + date-инпуты) + провайдер + модель + модуль(taskType) + организация. Опции provider/model/taskType — из «unfiltered» запроса (паттерн `optionsQ`, как на company-detail сегодня). Организации — из `adminOrgsApi.list()`.
- [x] Реальный тренд — `AreaTrend` (уже есть компонент, реюз) вместо fake sparklines.
- [x] «Расход по провайдерам» / «Топ функций по расходу» / «Топ организаций по расходу» → `BarTrend` (уже есть компонент, реюз) вместо `<ul>`.
- [x] Новая секция «Расход по моделям» (`byModel`) → `BarTrend`.
- [x] CSV-экспорт функций/организаций — без изменений состава колонок (провайдер/модель туда не относится по смыслу).

## Не в объёме (осознанно)

- `/admin/analytics/llm-cost` не трогаем — отдельная, уже полностью реализованная сегодня страница.
- UI для `scope=org` (нет отдельного экрана, использующего `getDashboard(scope:'org')` с этим новым фильтром/графиками) — не расширяем, т.к. не запрашивалось.
- Гранулярность тренда (день/неделя) — всегда по дням, без переключателя (не просили, day-level и так достаточно для period ≤ месяц).

## Итог

Реализовано целиком, обе части (backend + frontend). Живая QA в браузере (Playwright, QA-суперадмин): фильтр по провайдеру корректно сузил totals ($0.210→$0.113) и все срезы одновременно (byProvider/byModel/byTaskType), опции модели сузились до моделей выбранного провайдера; custom-период с датами отработал (пустой стейт «Укажите период» при незаполненных датах — по дизайну); графики (`BarTrend`) рендерятся корректно после layout-reflow (первый paint иногда даёт width=-1 у `ResponsiveContainer` — известная особенность recharts под Turbopack dev, самовосстанавливается при любом resize/взаимодействии, не регрессия). 0 console-ошибок на всех проверенных состояниях.

Backend: 5 новых тестов в `admin-usage.service.spec.ts` (фильтры, byModel, trend) + полный прогон `src/modules/admin/` — 525/525 зелёных. Frontend: typecheck/lint чисты, `test:unit` — 595/599 (4 пре-существующих сбоя в неродственном `tracker/*`, не задеты этой работой).

Не потребовало ни Prisma-миграции, ни новых ENV/AdminSetting, ни новых scripts — `docs/operations/prod-deploy-log.md` без изменений (prod-операций нет).
