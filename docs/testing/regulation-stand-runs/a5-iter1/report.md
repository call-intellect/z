# regulation-stand — baseline scorecard (ось A5 · Решения задач / TaskSolution)

Прогон: `a5-iter1` · сценариев: 12 · PASS 11/12 (92%) · HEAD `af400a2e` · orgId `cmrb1zhh300018nslf0t7unmc`.

> Синтез-режим: блоки how-solved воссозданы из корпуса (ground truth входа), запускался реальный `TaskSolutionBuildService`. Классификация сигналов (ось A1) здесь НЕ проверяется — только билдер решений.

## Итоговое распределение

| Вердикт | n |
|---|---:|
| PASS | 11 |
| PARTIAL | 0 |
| FAIL | 0 |
| N/A | 1 |

## Было → стало

Сравнение с прошлой итерацией `a5-baseline`:

| Вердикт | было | стало |
|---|---:|---:|
| PASS | 9 | 11 |
| PARTIAL | 0 | 0 |
| FAIL | 2 | 0 |
| N/A | 1 | 1 |

| сценарий | было → стало |
|---|---|
| a5-no-answer | FAIL → **PASS** |
| a5-multi-solver | FAIL → **PASS** |

## Метрики A5 (ТЗ §6)

| Метрика | pass | всего | % | N/A |
|---|---:|---:|---:|---:|
| created_correctly (плодим только по делу) | 12 | 12 | 100% |  |
| owner_is_solver (владелец = решавший) | 9 | 9 | 100% |  |
| no_cross_clone_leak (упомянувший ≠ владелец) | 2 | 2 | 100% |  |
| subject_accuracy (рост к правильным клонам) | 3 | 3 | 100% |  |
| one_per_task (идемпотентность сборки) | 2 | 2 | 100% |  |
| source_issue_linked (привязка к задаче) | 2 | 2 | 100% |  |
| preservation (старое не потеряно) | 1 | 1 | 100% |  |
| extension_adds_new (новое добавлено) | 1 | 1 | 100% |  |
| repeat_candidate (повтор ×N → флаг) | 0 | 0 | N/A | 1 |
| dual_purpose (клон по-прежнему кормится) | 2 | 2 | 100% |  |

## Confusion — материализация (created_correctly)

| ожид.\факт | создано | НЕ создано |
|---|---:|---:|
| **надо создать** | 9 ✓ | 0 ✗ (пропуск) |
| **НЕ надо** | 0 ✗ (лишнее) | 3 ✓ |

## Scorecard по ячейкам A5.1–A5.8

| Ячейка | n | PASS | PARTIAL | FAIL | N/A |
|---|---:|---:|---:|---:|---:|
| A5.1 | 2 | 2 | 0 | 0 | 0 |
| A5.2 | 1 | 1 | 0 | 0 | 0 |
| A5.3 | 2 | 2 | 0 | 0 | 0 |
| A5.4 | 1 | 1 | 0 | 0 | 0 |
| A5.5 | 1 | 1 | 0 | 0 | 0 |
| A5.6 | 3 | 3 | 0 | 0 | 0 |
| A5.7 | 1 | 0 | 0 | 0 | 1 |
| A5.8 | 1 | 1 | 0 | 0 | 0 |

## Идемпотентность (2-й прогон Δ=0)

- create: {"candidates":13,"created":11,"updated":0,"skippedNoOwner":0,"skippedGate":1,"skippedNoNew":0}
- extend: {"candidates":13,"created":0,"updated":2,"skippedNoOwner":0,"skippedGate":1,"skippedNoNew":9}
- idempotency (повтор): {"candidates":13,"created":0,"updated":0,"skippedNoOwner":0,"skippedGate":1,"skippedNoNew":11} → ✅ Δ=0 (created=0, updated=0)

## Таблица диагнозов — атрибуция к агенту

_Провалов не зафиксировано._

## Панель судей (суть решения · владелец)

Консенсус: good 5 · flawed 4 · wrong 0 · no-quorum 0. LLM-вызовов 27 (ошибок 1).

> Судья оценивает КАЧЕСТВО уже созданного решения (суть/владелец/полнота), а не факт «надо ли было создавать». Ложную материализацию (`a5-no-answer`) ловит детерминированный слой (match), поэтому у судьи она может быть «good».

| сценарий | консенсус | суть (majority) | владелец (majority) |
|---|---|:---:|:---:|
| a5-create-from-probe | good | ✓ | ✓ |
| a5-daily-mentions | good | ✓ | ✓ |
| a5-one-per-task | good | ✓ | ✓ |
| a5-ownership-solver | good | ✓ | ✓ |
| a5-repeat-candidate-instruction | flawed | ✓ | ✓ |
| a5-dual-purpose | flawed | ✓ | ✓ |
| a5-owner-not-mentioner | flawed | ✓ | ✓ |
| a5-extend-daily | flawed | ✓ | ✓ |
| a5-multi-solver | good | ✓ | ✓ |

## Конфигурация прогона

- HEAD-commit: `af400a2e`
- эмбеддингов записано: 0 (репит-группа тестируема при >0)

| крутилка | значение |
|---|---|
| taskSolution.lookbackHours | 48 |
| taskSolution.minSignalChars | 40 |
| taskSolution.repeatThreshold | 3 |
| taskSolution.repeatSimilarity | 0.85 |
| taskSolution.refineEnabled | true |
| aiFeatures.docCompilerEnabled | true |

## Полная сверка по сценариям

| сценарий | ячейка | trap | вердикт | ключ. метрика | диагноз |
|---|---|:---:|---|---|---|
| a5-create-from-probe | A5.1 |  | PASS | created_correctly | соответствует эталону |
| a5-daily-mentions | A5.2 |  | PASS | built_from_daily | соответствует эталону |
| a5-one-per-task | A5.3 | ⚑ | PASS | one_per_task | три захода за день -> ОДНА TaskSolution (апдейт/дополнение), не три; идемпотентность |
| a5-no-answer | A5.4 | ⚑ | PASS | created_correctly (НЕ плодим) | нет содержательного «как решалось» -> сущность НЕ плодим |
| a5-trivial-gated | A5.5 | ⚑ | PASS | created_correctly (НЕ плодим) | тривиальная задача под гейтом сложности -> материализатор не срабатывает |
| a5-ownership-solver | A5.6 | ⚑ | PASS | owner_is_solver | владелец = решавший Михаил, НЕ рассказавший Сергей (anti-cross-clone, ось A4) |
| a5-repeat-candidate-instruction | A5.7 | ⚑ | N/A | repeat_candidate | похожий способ ×N -> repeatGroupKey + флаг кандидата в Инструкцию; инструкция НЕ создаётся авто |
| a5-dual-purpose | A5.8 |  | PASS | dual_purpose | двойное назначение: тот же блок кормит клон Дарьи И рождает TaskSolution |
| a5-owner-not-mentioner | A5.6 | ⚑ | PASS | owner_is_solver | рассказала Дарья, решал Иван -> владелец Иван |
| a5-extend-daily | A5.3 | ⚑ | PASS | one_per_task | опрос + дневное уточнение -> одна сущность, старое сохранено (дополнение) |
| a5-no-issue-link | A5.1 | ⚑ | PASS | created_correctly (НЕ плодим) | не привязано к конкретной задаче (sourceIssue) -> это топливо клона, НЕ TaskSolution; кормит только клон |
| a5-multi-solver | A5.6 | ⚑ | PASS | subject_accuracy (multi-solver) | соисполнители -> оба в subject (растут оба клона); владелец = основной исполнитель задачи |
