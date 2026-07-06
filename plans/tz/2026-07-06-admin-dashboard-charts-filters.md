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

## Фаза 2 (по фидбеку после первой живой QA)

Владелец увидел фильтры в браузере, попросил доработать:
- [x] Организации — поиск + мультиселект вместо одиночного select.
- [x] Модуль (taskType) — замапить недостающие русские названия в `TASK_TYPE_LABELS` + мультиселект.
- [x] Модель и провайдер — тоже мультиселект + поиск.
- [x] Дата — всегда должна отображать РЕАЛЬНО применённый диапазон (выбрали «неделя» → в дате видно фактические числа), не только при custom. UI фильтр-бара переработать.

**Backend:** `provider`/`model`/`taskType`/`orgId` — из одиночной строки в CSV-массив (`?provider=a,b`), `baseWhere` — `{in: [...]}` вместо равенства, то же для raw SQL тренда (`IN (...)` через `Prisma.join`) и `fetchTopOrgsByCost`, `cacheKey()` учитывает отсортированный список.

**Frontend:** новый переиспользуемый `MultiSelectCombobox` (Popover+Command, чекбоксы, локальный поиск по уже загруженному списку опций — без доп. запросов к бэку, т.к. масштаб Org/провайдеров/моделей пока не требует server-side поиска) в `src/ui/components/admin/`. Состояние фильтров — массивы. Блок с датой — всегда показывает фактический `period.from/to` из ответа API (текстом при day/week/month, редактируемые input при custom).

## Итог

Реализовано целиком, обе части (backend + frontend). Живая QA в браузере (Playwright, QA-суперадмин): фильтр по провайдеру корректно сузил totals ($0.210→$0.113) и все срезы одновременно (byProvider/byModel/byTaskType), опции модели сузились до моделей выбранного провайдера; custom-период с датами отработал (пустой стейт «Укажите период» при незаполненных датах — по дизайну); графики (`BarTrend`) рендерятся корректно после layout-reflow (первый paint иногда даёт width=-1 у `ResponsiveContainer` — известная особенность recharts под Turbopack dev, самовосстанавливается при любом resize/взаимодействии, не регрессия). 0 console-ошибок на всех проверенных состояниях.

Backend: 5 новых тестов в `admin-usage.service.spec.ts` (фильтры, byModel, trend) + полный прогон `src/modules/admin/` — 525/525 зелёных. Frontend: typecheck/lint чисты, `test:unit` — 595/599 (4 пре-существующих сбоя в неродственном `tracker/*`, не задеты этой работой).

Не потребовало ни Prisma-миграции, ни новых ENV/AdminSetting, ни новых scripts — `docs/operations/prod-deploy-log.md` без изменений (prod-операций нет).

## Итог Фазы 2

Реализовано целиком. Бэкенд: фильтры `provider`/`model`/`taskType`/`orgId` переведены с одиночных строк на CSV-массивы (`?provider=a,b`) → `{in:[...]}` во всех groupBy/aggregate/raw SQL (`fetchDailyTrend` — `IN (...)` через `Prisma.raw`+`Prisma.join`) и `fetchTopOrgsByCost`; `cacheKey()` сортирует массив для стабильности кэша. 2 новых теста (multi-value provider/taskType, multi-value orgId → IN). Полный прогон `src/modules/admin/` — по-прежнему зелёный.

Фронтенд: новый `MultiSelectCombobox` (`src/ui/components/admin/MultiSelectCombobox.tsx`, Popover+Command+чекбоксы, локальный поиск через встроенный фильтр cmdk) заменил все 4 одиночных `Select`; состояние — массивы, при смене провайдеров автоматически подрезаются уже выбранные модели, ставшие невалидными. Дата теперь ВСЕГДА показывает фактически применённый диапазон (`period.from/to` из ответа API, бейдж рядом с селектом периода), редактируемые поля — только при `custom`. `TASK_TYPE_LABELS` пополнен 8 недостающими переводами (`company-summary-compile`, `executable-persona-compile`, `issue-progress-draft`, `probe-formulate`, `probe-quality-judge`, `probe-value-gate`, `sprint-helper-suggest`, `team-health-analyzer`).

**Побочная находка — реальный баг в общем UI-примитиве.** При живом QA мышью (не только keyboard) клики по второй и последующим опциям `CommandItem` зависали — Playwright показал «`<div role="group" cmdk-group-items="">` intercepts pointer events». Причина: `frontend/src/ui/shadcn/command.tsx` использовал Tailwind-вариант `data-[disabled]:pointer-events-none`, а cmdk всегда рендерит атрибут `data-disabled="false"` (не убирает его) — Tailwind же `data-[disabled]` матчит по ПРИСУТСТВИЮ атрибута, а не по значению, поэтому `pointer-events:none` навешивался на КАЖДЫЙ item, независимо от реального disabled-состояния. Клавиатурная навигация (Enter) не задевала этот путь, поэтому баг был незаметен во всех прежних usage (`CommandPalette`, `SprintCreateWizard` — судя по всему, всегда использовались с клавиатуры). Пофикшено на `data-[disabled=true]:...` — затрагивает ВСЕ существующие места использования `Command`/`CommandItem` в приложении (правка в общем примитиве, не только в новом компоненте).

Живая QA (Playwright, мышь): мультиселект провайдера (deepseek+openai-via-proxy, чекбоксы, суммирование обратно к полным totals), поиск по организациям (пустой результат на несуществующий запрос корректно показывает «Ничего не найдено»), модуль-мультиселект с русскими подписями — всё подтверждено скриншотами. 0 console-ошибок (кроме ожидаемых после намеренной остановки dev-бэкенда в конце QA).
