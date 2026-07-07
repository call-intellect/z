---
date: 2026-07-06
tags: [эксперимент, задачи, knowledge-core, tz, планирование]
distilled: false
---

# Эксперимент → задача: blueprint + ТЗ

## Что было поставлено
Владелец: «какой-то агент создаёт сущность эксперимент». Дальше — тот же паттерн, что уже сделан для обещания и решения: сущность остаётся фактом памяти, но конвейер задач усиливается, чтобы «давайте проведём эксперимент, сделаем Y» уходило в трекер задачей. Просьба — написать ТЗ.

## Как решал
1. Нашёл агента-создателя: специалист `3-9-experiments` (`EXPERIMENT_TRACKER`) — `specialist-3-9-experiments.service.ts`, `experiment-detector.worker.ts`, `experiment-extract.prompt.ts`. Создаёт `Experiment` из `signalType ∈ {hypothesis, result, lesson}`.
2. Прошёл gate `tz-author`: не было одобренной архитектуры → сначала `solution-blueprint` (`plans/architecture/2026-07-06-experiment-to-task.md`), владелец одобрил → затем ТЗ (`plans/tz/2026-07-06-experiment-to-task.md`).
3. ТЗ на 4 фазы: `specialists-combined.prompt.ts` (встречи) + `block-ingest.prompt.ts` дуальная эмиссия (вход) + `ExperimentTaskLink` как зеркало `DecisionTaskLink` + golden-фикстуры/метрика.

## Что вышло
Два документа, закоммичены и запушены (`0e79b48d`). Кода нет — вход для `tz-orchestrator`. Прод-операций нет.

## Чему научился (грабли/факты кода)
- **`specialist-3-15-tasks.service.ts` частично мёртв:** его `processBlock` НИКТО не вызывает (жив только `runClarifySweep` — follow-up на `IntakeIssue` про исполнителя/срок). В `specialist-routing-dispatcher.worker.ts` он НЕ зарегистрирован; в `router.service.ts` нет `case 'action_item'` и `SPECIALIST.TASKS`. `task-extract.prompt.ts` — спящий (только регистрация `taskType` в `llm-router`). Живой мост «обещание/действие → задача» — в **промптах-извлекателях**: встречи через `specialists-combined.prompt.ts:620` (`tasks[]`), не через 3-15.
- **Архитектурный док может врать про live-статус:** signal-bridges (п.1) уверял «чат → задача через 3-15» — по коду устарело. Приоритет: реальный код > док. Проверять `.processBlock`-вызовы, а не наличие файла.
- **Провенанс задача↔знание уже есть паттерном:** `DecisionTaskLink` + `linkDerivedDecisionsForIssue` + вызов в `intake-auto-triage.worker.ts:540`, дерив по пересечению `sourceBlockIds`. Любую новую связь «задача ← X» делать зеркалом, а не изобретать.
- **vexp free-cap** снова кусал по backend — искал через `Bash grep`/`sed`, не Grep-tool (демон блокирует). Подтверждает [[project_vexp-not-indexed]].

Связано: [[project_prisma-migration-age-searchpath]] (миграция новой таблицы `ExperimentTaskLink` — `SET search_path TO public` первой строкой).
