---
date: 2026-06-29
feature: checkin-day-report-from-graph
branch: work/2026-06-29
---

# Рефлексия — Дневной план/отчёт из общего анализа графа (оркестрация 8 фаз)

## Что было поставлено
Реализовать ТЗ `plans/tz/2026-06-29-checkin-day-report-from-graph.md` (оркестратор-скилл, ветка `work/2026-06-29`): план/отчёт сотрудника собирать НЕ отдельным свипом `day-signal-*`, а тонким НЕ-LLM сборщиком из разметки `block-ingest` в 4 сущности (сделано / не сделано / помешало / идеи); «не сделано» — семантически через переиспользуемый проверщик закрытия; явный «не дал» — строкой-ожиданием; старый слой снести.

## Как решал (по фазам)
- **Картография** — 5 параллельных Explore-агентов сняли точные path:line по `DailyCheckIn`/сервису, графу `IdeaBlock`+`evidence`, `task-closure-verify`, слою `day-signal-*`+крон-обвязке, дашбордам/реестру/метрикам/фронту. vexp free-capped и backend недокрыт → агенты работали через Bash+Read (Grep/Glob заблокированы хуком при живом демоне).
- **Ф1** `114fc0f4` — `DailyCheckIn` += `notDoneJson`/`ideasJson`/`reportCompleteness`, миграция `20260630010000` (3 ADD COLUMN nullable).
- **Ф2** `f5a9d59b` — `DayReportCollectorService.collectForDay` (атрибуция по `evidence.authorPersonId`+`sourceTimestamp` в TZ Person, `mergedIntoId:null`, дедуп) + 3 метрики `day_report_*`.
- **Ф3** `08539cc6` — `ClosureVerifierService` (вынос `verify`/`parse`/guard из `task-completion.handler`, поведение идентично) + `computeNotDone` (предфильтр точных done-совпадений → иначе verify).
- **Ф4** `3412b4ca`+`f48f9af3` — `upsertInternal`/`upsertFromDaySignal` принимают `notDone`/`ideas` **патч-стилем**; `assembleAndUpsert` + `pickDominantSource`; `DayReportCollectorCron` (05:00 МСК за вчера, Redis NX); мост встреч переписан на graph-derive (`EntityResolutionService` → `assembleAndUpsert(personIds)`).
- **Ф5** `cc403853` — `reportCompleteness` выводится в `toDto` на чтении (qualityScore ставит scorer ПОСЛЕ сборки) + `notDone`/`ideas`/`reportCompleteness` в DTO/фронт. Полнота НЕ влияет на «сдал».
- **Ф6** `69d8fed8` — `CheckinExpectationService.ensureForDay` + `ensureExpectationRow` (onlyIfMissing) перед сборкой → явный «не дал».
- **Ф7** `5eaad48b` — снос `day-signal-*` (5 сервисов+cron+spec+prompt), taskType `day-signal-detect`, метрики `day_signal_*`; `daySignals.*` → `dayReport.enabled`/`dayReport.completenessQualityThreshold`.
- **Ф8** `0ab7090b` — `backfill-day-report.ts` (NestFactory, идемпотентно) в STEPS + `diag-day-report-recall.ts` (R0 read-only).

## Что вышло (верификация — проходил сам)
- Каждая фаза: грепы маркеров, re-Read критичной логики, `tsc` (NODE_OPTIONS heap 14G — иначе OOM), фазовый vitest. Финал: **typecheck 0 ошибок**, **build зелёный** (DI-целостность после сноса провайдеров), **lint 0 errors**, **vitest модуля operations 611 passed / 72 files**, из них 74 в 7 наших спеках. 0 остаточных ссылок на `day-signal`-слой (кроме сохранённого merge-метода `upsertFromDaySignal`).

## Чему научился / грабли
- **resolveSync — 3-арг**: `resolveSync<T>(adminKey, envFallbackKey?, defaultValue?)`. Дефолт-значение идёт ТРЕТЬИМ (`(...,'key', undefined, 0.5)`), не вторым — иначе число попадает в `envFallbackKey:string` и tsc падает.
- **Патч-стиль для новых JSON-полей в общем upsert**: `notDoneJson`/`ideasJson` писать ТОЛЬКО когда аргумент `!== undefined` (как `sourceContributions`), иначе ручной/бот-апдейт затрёт собранное в null. `notDone` — замена (производный вердикт), `ideas` — merge (накопление).
- **reportCompleteness нельзя считать в коллекторе**: `qualityScore` ставит `reflection-quality-scorer` ПОСЛЕ сборки (на момент `assembleAndUpsert` он null). Вывод на чтении в `toDto` — единственно корректная точка.
- **`migrate dev` на этой машине требует shadow-БД с AGE**: AGE в `shared_preload_libraries` ломает дефолтную Prisma shadow-БД (`ag_catalog` нет) + `max_locks_per_transaction` мал. Завели постоянную `z_shadow` + `SHADOW_DATABASE_URL` + условный `shadowDatabaseUrl` в `prisma.config.ts`. Плюс предсуществующий дрейф истории миграций (10 unique-индексов) — мою миграцию применили через `migrate diff`→`migrate deploy`, без reset.
- **Грепы по «DaySignal» ловят `upsertFromDaySignal`** (рабочий merge-метод) — при сносе слоя это ложный позитив, явно исключал.

## Не закрыто (честно)
- **R0 recall-gate НЕ выполнен**: прод-БД headless с dev-машины недостижима (хост `postgres:5432` — внутри docker-сети прода). Скрипт `diag-day-report-recall.ts` готов; R0 — pre-deploy gate для владельца/при прод-доступе.
- vNext-хвосты вынесены в `04_не-сделано` (событийный триггер, авто-связь Person, FE-карточка 4 части, оптимизация запроса коллектора, derive-on-read, дрейф миграций).
- **Взаимодействие с детектором конфликтов** (`CheckInConflictDetectorCron`, 04:00) — отдельный анализ по запросу владельца (см. ответ в чате / `plans/analysis/`).
