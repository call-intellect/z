# regulation-stand — baseline scorecard (ось A5 · Решения задач / TaskSolution)

Прогон: `verify-2` · сценариев: 16 · PASS 16/16 (100%) · HEAD `ed2f5621` · orgId `cmrbv53kb000136slzy8zo06a`.

> Синтез-режим: блоки how-solved воссозданы из корпуса (ground truth входа), запускался реальный `TaskSolutionBuildService`. Классификация сигналов (ось A1) здесь НЕ проверяется — только билдер решений.

## Итоговое распределение

| Вердикт | n |
|---|---:|
| PASS | 16 |
| PARTIAL | 0 |
| FAIL | 0 |
| N/A | 0 |

## Было → стало

Сравнение с прошлой итерацией `verify-1`:

| Вердикт | было | стало |
|---|---:|---:|
| PASS | 14 | 16 |
| PARTIAL | 0 | 0 |
| FAIL | 2 | 0 |
| N/A | 0 | 0 |

| сценарий | было → стало |
|---|---|
| a5-repeat-candidate-instruction | FAIL → **PASS** |
| a5-extend-daily | FAIL → **PASS** |

## Метрики A5 (ТЗ §6)

| Метрика | pass | всего | % | N/A |
|---|---:|---:|---:|---:|
| created_correctly (плодим только по делу) | 16 | 16 | 100% |  |
| owner_is_solver (владелец = решавший) | 13 | 13 | 100% |  |
| no_cross_clone_leak (упомянувший ≠ владелец) | 3 | 3 | 100% |  |
| no_subject_leak (рассказавший ∉ субъекты) | 4 | 4 | 100% |  |
| subject_accuracy (рост к правильным клонам) | 13 | 13 | 100% |  |
| one_per_task (идемпотентность сборки) | 2 | 2 | 100% |  |
| source_issue_linked (привязка к задаче) | 5 | 5 | 100% |  |
| preservation (старое не потеряно) | 1 | 1 | 100% |  |
| extension_adds_new (новое добавлено) | 1 | 1 | 100% |  |
| repeat_candidate (повтор ×N → флаг) | 1 | 1 | 100% |  |
| dual_purpose (клон по-прежнему кормится) | 2 | 2 | 100% |  |

## Confusion — материализация (created_correctly)

| ожид.\факт | создано | НЕ создано |
|---|---:|---:|
| **надо создать** | 13 ✓ | 0 ✗ (пропуск) |
| **НЕ надо** | 0 ✗ (лишнее) | 3 ✓ |

## Scorecard по ячейкам A5.1–A5.8

| Ячейка | n | PASS | PARTIAL | FAIL | N/A |
|---|---:|---:|---:|---:|---:|
| A5.1 | 2 | 2 | 0 | 0 | 0 |
| A5.2 | 1 | 1 | 0 | 0 | 0 |
| A5.3 | 2 | 2 | 0 | 0 | 0 |
| A5.4 | 1 | 1 | 0 | 0 | 0 |
| A5.5 | 1 | 1 | 0 | 0 | 0 |
| A5.6 | 7 | 7 | 0 | 0 | 0 |
| A5.7 | 1 | 1 | 0 | 0 | 0 |
| A5.8 | 1 | 1 | 0 | 0 | 0 |

## Идемпотентность (2-й прогон Δ=0)

- create: {"candidates":17,"created":15,"updated":0,"skippedNoOwner":1,"skippedGate":0,"skippedNoMethod":1,"skippedNoNew":0,"skippedCompilerUnavailable":0}
- extend: {"candidates":17,"created":0,"updated":2,"skippedNoOwner":1,"skippedGate":0,"skippedNoMethod":1,"skippedNoNew":13,"skippedCompilerUnavailable":0}
- idempotency (повтор): {"candidates":17,"created":0,"updated":0,"skippedNoOwner":1,"skippedGate":0,"skippedNoMethod":1,"skippedNoNew":15,"skippedCompilerUnavailable":0} → ✅ Δ=0 (created=0, updated=0)

## Гейты отсева (видимость)

| гейт | create | extend | idempotency |
|---|---:|---:|---:|
| skippedGate (пусто, предфильтр длины) | 0 | 0 | 0 |
| skippedNoMethod (нет содержательного метода, смысл) | 1 | 1 | 1 |
| skippedCompilerUnavailable (компилятор OFF/сбой на дополнении → defer) | 0 | 0 | 0 |

## T-ось — качество текста решения (плейсхолдеры · signals)

Порог доли строк-плейсхолдеров «[требует уточнения]»: ≤ 20% (крутилка `taskSolution.maxPlaceholderRatio`). Средняя доля: 0%. Свыше порога: 0/13.

> T-ось меряет КАЧЕСТВО текста решения (вода/плейсхолдеры), а не корректность материализации. Рост плейсхолдеров роняет метрику, но не меняет вердикт корректности (тот считает детерминированный слой match).

| сценарий | плейсхолдеров (строк) | доля | signals |
|---|---|---:|---:|
| a5-create-from-probe | 0/8 | 0% | 1 |
| a5-daily-mentions | 0/7 | 0% | 1 |
| a5-one-per-task | 0/8 | 0% | 0 |
| a5-trivial-gated | 0/7 | 0% | 1 |
| a5-ownership-solver | 0/8 | 0% | 1 |
| a5-repeat-candidate-instruction | 0/8 | 0% | 2 |
| a5-dual-purpose | 0/10 | 0% | 1 |
| a5-owner-not-mentioner | 0/7 | 0% | 0 |
| a5-extend-daily | 0/7 | 0% | 1 |
| a5-multi-solver | 0/8 | 0% | 1 |
| a5-b5-infer-no-assignee | 0/9 | 0% | 2 |
| a5-b5-divergence | 0/7 | 0% | 1 |
| a5-b5-multi-assignee | 0/9 | 0% | 2 |

## Таблица диагнозов — атрибуция к агенту

_Провалов не зафиксировано._

## Панель судей (суть решения · владелец)

Консенсус: good 13 · flawed 0 · wrong 0 · no-quorum 0. LLM-вызовов 39 (ошибок 0).

> Потерянных голосов нет — кворум полный на всех сценариях.

> Судья оценивает КАЧЕСТВО уже созданного решения (суть/владелец/полнота), а не факт «надо ли было создавать». Ложную материализацию (`a5-no-answer`) ловит детерминированный слой (match), поэтому у судьи она может быть «good».

| сценарий | консенсус | суть (majority) | владелец (majority) | потеряно голосов |
|---|---|:---:|:---:|:---:|
| a5-create-from-probe | good | ✓ | ✓ |  |
| a5-daily-mentions | good | ✓ | ✓ |  |
| a5-one-per-task | good | ✓ | ✓ |  |
| a5-trivial-gated | good | ✓ | ✓ |  |
| a5-ownership-solver | good | ✓ | ✓ |  |
| a5-repeat-candidate-instruction | good | ✓ | ✓ |  |
| a5-dual-purpose | good | ✓ | ✓ |  |
| a5-owner-not-mentioner | good | ✓ | ✓ |  |
| a5-extend-daily | good | ✓ | ✓ |  |
| a5-multi-solver | good | ✓ | ✓ |  |
| a5-b5-infer-no-assignee | good | ✓ | ✓ |  |
| a5-b5-divergence | good | ✓ | ✓ |  |
| a5-b5-multi-assignee | good | ✓ | ✓ |  |

## Конфигурация прогона

- HEAD-commit: `ed2f5621`
- эмбеддингов записано: 15 (репит-группа тестируема при >0)

| крутилка | значение |
|---|---|
| taskSolution.lookbackHours | 48 |
| taskSolution.minSignalChars | 15 |
| taskSolution.repeatThreshold | 3 |
| taskSolution.repeatSimilarity | 0.25 |
| taskSolution.refineEnabled | true |
| taskSolution.howSolvedSignalTypes | ["reasoning","rationale","decision_basis","methodology_step"] |
| taskSolution.ownerInferenceEnabled | true |
| taskSolution.maxPlaceholderRatio | 0.2 |
| aiFeatures.docCompilerEnabled | true |

## Полная сверка по сценариям

| сценарий | ячейка | trap | вердикт | ключ. метрика | диагноз |
|---|---|:---:|---|---|---|
| a5-create-from-probe | A5.1 |  | PASS | created_correctly | соответствует эталону |
| a5-daily-mentions | A5.2 |  | PASS | built_from_daily | соответствует эталону |
| a5-one-per-task | A5.3 | ⚑ | PASS | one_per_task | три захода за день -> ОДНА TaskSolution (апдейт/дополнение), не три; идемпотентность |
| a5-no-answer | A5.4 | ⚑ | PASS | created_correctly (НЕ плодим) | нет содержательного «как решалось» -> сущность НЕ плодим |
| a5-trivial-gated | A5.5 | ⚑ | PASS | created_correctly | краткое-но-конкретное решение (32 симв, «Перезапустил под, всё поднялось») — раньше резалось предфильтром длины (40), теперь проходит по смыслу (hasConcreteMethod=true) и материализуется; длина осталась лишь грубым отсевом совсем пустого (<15) |
| a5-ownership-solver | A5.6 | ⚑ | PASS | owner_is_solver | владелец = решавший Михаил, НЕ рассказавший Сергей (anti-cross-clone, ось A4) |
| a5-repeat-candidate-instruction | A5.7 | ⚑ | PASS | repeat_candidate | похожий способ ×N -> repeatGroupKey + флаг кандидата в Инструкцию; инструкция НЕ создаётся авто |
| a5-dual-purpose | A5.8 |  | PASS | dual_purpose | двойное назначение: тот же блок кормит клон Дарьи И рождает TaskSolution |
| a5-owner-not-mentioner | A5.6 | ⚑ | PASS | owner_is_solver | рассказала Дарья, решал Иван -> владелец Иван |
| a5-extend-daily | A5.3 | ⚑ | PASS | one_per_task | опрос + дневное уточнение -> одна сущность, старое сохранено (дополнение). contentMustContain — стем «восстановлени» (робастно к склонению: LLM пишет «проверку восстановления») |
| a5-no-issue-link | A5.1 | ⚑ | PASS | created_correctly (НЕ плодим) | не привязано к конкретной задаче (sourceIssue) -> это топливо клона, НЕ TaskSolution; кормит только клон |
| a5-multi-solver | A5.6 | ⚑ | PASS | subject_accuracy (multi-solver) | соисполнители -> оба в subject (растут оба клона); владелец = основной исполнитель задачи |
| a5-b5-infer-no-assignee | A5.6 | ⚑ | PASS | owner_is_solver | B1: задача без assignee, один явный решатель → владелец выведен из текста (Иван) |
| a5-b5-two-solvers | A5.6 | ⚑ | PASS | created_correctly (НЕ плодим) | B1: без assignee, двое решателей → не приписываем одному → skippedNoOwner (лучше пропуск, чем чужая задача) |
| a5-b5-divergence | A5.6 | ⚑ | PASS | owner_is_solver | B2: assignee=координатор Дарья ≠ единственный решатель Иван → владелец Иван (kill-switch ownerInferenceEnabled) |
| a5-b5-multi-assignee | A5.6 | ⚑ | PASS | owner_is_solver | B3: несколько assignee (Михаил, Дарья), решала Дарья → она владелец детерминированно; со-assignee Михаил не растит клон |
