---
title: Доводка редизайна дашбордов до полного стеклянного языка + максимум дата-виз (Ф0–Ф7)
date: 2026-06-10
type: reflection
branch: feature/query-understanding-and-support-desk
covers: ТЗ plans/tz/2026-06-09-dashboards-redesign-completion-full-dataviz.md (Ф0–Ф7)
distilled: false
---

# Доводка редизайна дашбордов до полного стеклянного языка + дата-виз (Ф0–Ф7)

## Что было поставлено

ТЗ [`plans/tz/2026-06-09-dashboards-redesign-completion-full-dataviz.md`](../../plans/tz/2026-06-09-dashboards-redesign-completion-full-dataviz.md) — доводка редизайна дашбордов Коры до конца. После Батча 5 остался класс «новый градиентный фон + старые плоские `shadcn`-карточки»: фон `MODERN_PAGE_BG` накатан почти везде, а карточки мигрировали выборочно. Задача — привести 5 экранов к единому современному языку из готовой библиотеки `frontend/src/ui/components/dashboard/modern/*` (эталоны `/dashboard/portfolio`, `/dashboard/value-recap`, `/goals`, `/maturity`, `/actions`), с **максимумом дата-виз**: списки→таблицы/диаграммы, числа→KPI-карточки со спарклайнами, доли→пончики, тренды→area/bar. Недостающие временные ряды — добавить на бэке **только из реальных данных** (не выдумка). Тема только тёмная, Ship-On (без новых флагов), OFF-ветки kill-switch не трогать.

Экраны: `/dashboard/operations` (Ф2), `/me` (Ф3), `/dashboard` Director ON-ветка (Ф4), `/dashboard/operations/daily` (Ф5), `/dashboard/operations/weekly` (Ф6). Плюс фундамент библиотеки (Ф0), два бэк-обогащения трендами (Ф1 `weeklyInflow`, Ф1b `digest.trend`) и уборка мёртвого кода (Ф7).

## Как решал

Оркестрация волнами по графу зависимостей фаз, силами суб-агентов-кодеров, с **авторитетной приёмкой оркестратором** (свой typecheck/lint/build/vitest, не доверяясь самопроверке кодеров):

- **Картография** — перед каждой фазой суб-агенту давалась точная карта файлов, якорей секций и контрактов (8 кодеров суммарно на Ф0–Ф7), с обязательным re-Read модели/сервиса перед правкой (номера строк в ТЗ могли сдвинуться от мерджа).
- **Волна 1 — фундамент Ф0** (frontend, библиотека `modern/*`): `StatCard` (опциональные `spark`/`delta`/`up` + `href`), новый `ModernPageShell`, хелпер `kpiTone` в `tokens.ts`. Раньше всех — Ф2–Ф6 на нём стоят.
- **Волна 2 — бэк Ф1 ∥ Ф1b** (независимы, разные файлы): `weeklyInflow` в overview (паттерн `buildSparkline`, чистая `bucketizeWeeklyInflow`); `trend[]` в daily/weekly дайджесты из истории persisted-снимков `metricsJson` (чистые мапперы `mapDailyDigestRowsToTrend`/`mapWeeklyDigestRowsToTrend`, читаются в `enrichDto`).
- **Волна 3 — фронт-миграции Ф2–Ф6** (после Ф0 + бэка): каждый экран отдельным кодером, отдельным коммитом, по карте миграции секций из ТЗ. OFF-ветки `reworkEnabled`/`mainReworkEnabled` исключались грепом.
- **Волна 4 — уборка Ф7**: удаление мёртвого `DashboardClient.tsx` после грепа «0 импортёров», финальный греп по всем мигрированным экранам (`KpiHero`/`shadcn/card`/`bg-bg-card` = 0 вне OFF-веток), проверка что `KpiHero` не стал мёртвым (остался у `/teams`, `/persons/pulse`, `KnowledgeVelocityKpi`).

Между волнами — зелёная верификация → коммит → следующая волна, без остановок (9 коммитов `e57b3b3d..5a07143b`).

## Что вышло

- **9 коммитов** на ветке `feature/query-understanding-and-support-desk`, все фазы Ф0–Ф7 закрыты.
- **Backend:** `typecheck` + `build` + `vitest` (47 файлов / 355 тестов) — зелёные. Новые unit-тесты на чистые агрегаторы/мапперы (`bucketizeWeeklyInflow`, `mapDailyDigestRowsToTrend`, `mapWeeklyDigestRowsToTrend`).
- **Frontend:** `typecheck` + `lint` (0 errors) + `build` — зелёные. Render-smoke `StatCard.spec.tsx` на вызов без `spark/delta/up`.
- **Схема БД не менялась** — только DTO-интерфейсы + сервис-методы; миграции и прод-операции не нужны (достаточно `docker compose up -d --build`).
- Документация обновлена: `01_projects/{frontend-pages,api-layer,director-dashboard}.md`, «Итог» в ТЗ, строка в `04_не-сделано` (отложенный индекс).

**Осталось:** визуальная QA со скриншотами (требует выкаченного приложения — `qa-tester` ходит в прод, где пока старый код); условный индекс `@@index([tenantId,createdAt])` на `BlockerSynthesis`/`EntityLink` — отложен до seq-scan в `EXPLAIN` (ТЗ §Б).

## Чему научился

- **Vitest-only самопроверка кодеров пропускает кросс-спек регрессии.** Кодер запускает только «свой» файл-тест и видит зелёное, но соседний спек ломается из-за общего кода. Авторитетный модульный `vitest` всего набора у оркестратора их ловит. Пример: правка `getOverview` (добавление `weeklyInflow`) уронила `resolved-counts.spec` из-за немокнутого `findMany` в этом же сервисе — кодер этого не увидел бы. Вывод закреплён: после суб-агента оркестратор гоняет полный набор, а не доверяет «у меня зелёное».
- **`noUncheckedIndexedAccess` требует явного гарда `counts[idx]`.** При раскладке по недельным bucket'ам доступ к элементу массива по вычисленному индексу даёт `T | undefined` — TS заставляет защитить (`counts[idx] ?? 0` / проверка границ), иначе build красный. Та же ловушка во всех in-memory-bucket агрегаторах (паттерн `buildSparkline`).
- **Зеркало контракта на фронте бывает асимметрично по слоям.** У daily-дайджеста есть `api`+`domain`, у weekly — только API-тип (domain-слоя у weekly нет вообще). Поэтому новое поле `weekly.trend` добавляется напрямую в API-тип (`weekly-digest.api.ts`), без маппера — иначе кодер пойдёт искать несуществующий `weekly-digest.ts` в `domain/`. Перед добавлением FE-зеркала надо сверять, какие слои реально есть у конкретного эндпоинта.
- **Реальные тренды дешевле, чем кажется, если данные уже persisted.** `digest.trend` строится одним `findMany` по уже существующим снимкам `DailyOperationsDigest`/`WeeklyOperationsDigest` (`metricsJson`), индексы `@@index([tenantId,dateLocal])`/`@@index([tenantId,weekStart])` уже были — не пришлось ни выдумывать ряды, ни добавлять индексы. «Максимум дата-виз» из требования владельца лёг на честные данные без новой инфраструктуры.
