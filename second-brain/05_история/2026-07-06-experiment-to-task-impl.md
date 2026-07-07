---
date: 2026-07-06
tags: [эксперимент, задачи, knowledge-core, tracker, реализация, ExperimentTaskLink]
distilled: false
---

# Эксперимент → задача: реализация ТЗ

## Что было поставлено
Реализовать ТЗ [`plans/tz/2026-07-06-experiment-to-task.md`](../../plans/tz/2026-07-06-experiment-to-task.md) — тот же контур «память + исполнение», что уже сделан для решения→задачи и обещания→задачи, распространить на эксперименты. `Experiment` (специалист 3-9-experiments) остаётся фактом памяти; когда эксперимент содержит конкретное действие, конвейер задач должен вдобавок заводить задачу в трекер. Абстрактный призыв «надо больше экспериментировать» → задачи нет. Blueprint и ТЗ были написаны отдельной сессией (см. [[2026-07-06-experiment-to-task-tz]]).

## Как решал
Четыре фазы силами кодеров-суб-агентов с независимой приёмкой:

1. **Промпт combined-экстрактора встреч** `specialists-combined.prompt.ts` — эксперимент с конкретным действием даёт И запись эксперимента (память), И задачу; абстрактная гипотеза без действия — только память.
2. **Промпт классификатора входа** `block-ingest.prompt.ts` — дуальная эмиссия для блока-эксперимента с действием: `hypothesis` (память) + `action_item` (трекер), по образцу «idea + поручение».
3. **Провенанс `ExperimentTaskLink`** — новая Prisma-модель (зеркало `DecisionTaskLink`, таблица `experiment_task_link`, `linkType='derived'`), миграция `20260706130000_add_experiment_task_link` (аддитивный `CREATE TABLE` + 2 FK CASCADE на `experiments`/`Issue`). Связь авто-деривится в `intake-auto-triage.worker.ts` (утилита `linkDerivedExperimentsForIssue`) по пересечению `IntakeIssue.sourceBlockIds` с `Experiment.sourceBlockIds`.
4. **Метрика** `experiment_tasks_extracted_total{tenant_top, surface}` (surface = meeting | ingest).

## Что вышло
- `typecheck` / `build` зелёные.
- 89 тестов passed.
- Миграция применена локально.
- Документация обновлена: `data-model.md` (§ExperimentTaskLink), `ai-jobs.md` (§«Эксперимент с конкретным действием → задача»), `tracker.md` (строка в §«Combo — единый источник задач»), `prod-deploy-log.md` (Шаг 4 + Шаг 12 smoke метрики).

## Чему научился
- **`Experiment` беднее `Decision` по полям исполнения:** у эксперимента НЕТ `deletedAt` и НЕТ `linkedTaskCount` (в отличие от `Decision`). Поэтому утилита линковки `linkDerivedExperimentsForIssue` короче зеркального решения — нет фильтра `deletedAt: null` и нет инкремента счётчика задач на родителе.
- **`tenantTop` не в scope метода `autoAccept`** воркера `intake-auto-triage` — для метки метрики его надо считать явно через `tenantTopOf(tenantId)`, а не тянуть из локальной переменной.
- **AGE search_path** (см. [[project_prisma-migration-age-searchpath]]): для новой таблицы migration.sql должна начинаться с `SET search_path TO "public"`, иначе на БД с Apache AGE неквалифицированный `CREATE TABLE` уходит в `ag_catalog`. Проверка после выката — `table_schema='public'`.

## Связанное
- [[2026-07-06-experiment-to-task-tz]] — написание blueprint + ТЗ (предшествующая сессия).
- [[project_prisma-migration-age-searchpath]] — грабля AGE search_path для новых таблиц.
