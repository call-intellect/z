# regulation-stand — стенд качества агентов регламентов/инструкций/решений

Синтетический стенд для замера качества LLM-агентов «Специалиста 3.1» и связанных сущностей.
Корпус+эталон — 521 сценарий (`regulation-stand-corpus.json` / `regulation-stand-ruler.json`),
покрытие карты 360° (`plans/analysis/2026-07-03-regulation-instruction-stand-situation-matrix.md`).
Контракт стенда — `plans/tz/2026-07-03-regulation-instruction-stand.md`.

Прод не трогается: всё на throwaway-тенанте локальной dev-БД; `assertNotProd` — первым вызовом
каждого режима.

## Реализованная ось: A5 — «Решения задач» (TaskSolution)

Гоняется ПОСЛЕ реализации сущности (`plans/tz/2026-07-07-task-solution-entity.md`). Проверяет
**материализатор** `TaskSolutionBuildService` — суточную сборку «Решения задачи» из сигналов дня:
что решение создаётся только по делу, владелец = решавший (не упомянувший), одно на задачу,
дополнение сохраняет старое, повтор ×N → кандидат в инструкцию, дубль-назначение (клон тоже кормится).

**Режим подачи входа — синтез блоков (детерминированный).** Блоки `how-solved` (signalType
`methodology_step`/`reasoning`/`rationale`/`decision_basis`) воссоздаются из корпуса как ground
truth входа, привязываются к посеянной задаче через `RawEvent.payload.contextCardId = issueId`,
запускается реальный `TaskSolutionBuildService.runForOrg`. Классификация текста в сигнал (ось A1)
здесь НЕ проверяется — только билдер решений.

## Файлы

```
backend/scripts/regulation-stand/
  stand.ts          # диспетчер: prepare | build | match | judge | report | all
  seed-reg-feed.ts  # prepare (тенант+4 персоны+конфиг) + build (посев + прогон билдера + наблюдения)
  corpus.ts         # загрузчик corpus+ruler, фильтр agentFocus=task-solution
  match.ts          # детерминированная сверка TaskSolution ↔ эталон A5 → вердикт + атрибуция
  judge.ts          # панель 3 LLM-судей (линзы: суть / владелец / полнота) по созданным решениям
  report.ts         # scorecard A5 → docs/testing/regulation-stand-report.md
  types.ts          # типы
docs/testing/
  regulation-stand-corpus.json   # 521 сценарий (готов)
  regulation-stand-ruler.json    # 521 эталон 1:1 (готов)
  regulation-stand-manifest.json # id тенанта/персон/проекта (пишет prepare)
  regulation-stand-runs/<stamp>/ # raw.json · match.json · judged.json · report.md
  regulation-stand-report.md     # актуальный baseline (пишет report)
```

## Runbook

Предпосылки: dev-инфра поднята (`docker compose -f docker-compose.dev.yml up -d` из корня —
Postgres :55435 `z_main`, Redis :56381); `backend/.env` смотрит на **локальную** БД; реальные
LLM-ключи в `.env` (компилятор документа + судья). Запуск из `backend/`.

```bash
cd backend

# 1. подготовка: throwaway-тенант + 4 персоны (Михаил, Сергей, Дарья, Иван) + конфиг → манифест
bun run scripts/regulation-stand/stand.ts prepare

# 2. прогон: посев задач+блоков из корпуса → 3 прохода билдера (create→extend→idempotency) → наблюдения
bun run scripts/regulation-stand/stand.ts build <stamp>

# 3. сверка с эталоном (детерминированно) → match.json
bun run scripts/regulation-stand/stand.ts match <stamp>

# 4. панель судей (LLM) по созданным решениям → judged.json
bun run scripts/regulation-stand/stand.ts judge <stamp>

# 5. scorecard → docs/testing/regulation-stand-report.md
bun run scripts/regulation-stand/stand.ts report <stamp>

# всё разом (кроме prepare): build → match → judge → report
bun run scripts/regulation-stand/stand.ts all <stamp>
```

`prepare` создаёт НОВЫЙ тенант каждый раз (throwaway). Для повторного батча в тот же тенант —
не пере-`prepare`, а сразу `build/all` (манифест сохранён).

## Метрики A5 (ТЗ §6)

- `created_correctly` — плодим только по содержательному «как решалось» (нет ответа/тривиальное → НЕ создаём).
- `owner_is_solver` (ключевая, ось A4) — владелец = исполнитель задачи (`Issue.assignee`), а не упомянувший.
- `no_cross_clone_leak` — упоминание ≠ владение (рассказавший не становится владельцем).
- `subject_accuracy` — растёт к правильным клонам (соисполнители → все в `personSubjectIds`).
- `one_per_task` — идемпотентность суточной сборки (несколько заходов за день → одна сущность).
- `preservation` / `extension_adds_new` — дополнение сохраняет старое и добавляет новое.
- `repeat_candidate` — повтор ×N → `repeatGroupKey` + флаг кандидата в инструкцию (инструкция не создаётся авто).
- `dual_purpose` — тот же блок кормит клон И рождает решение (source-блоки остаются canonical).

Каждый провал атрибутируется к агенту/корню: `A5-materializer` (гейт / рост к клонам / репит) /
`A4-ownership` (владелец=решавший) / `A3-compiler` (сохранение при дополнении) / `infra`.

## Изоляция

Все 12 A5-сценариев гоняются в ОДНОМ тенанте: `TaskSolution` уникален по `(tenantId, sourceIssueId)`,
кросс-слияния между сценариями нет (в отличие от регламентов). Для репит-кластера в `build` досеваются
2 праймера-«429», чтобы группа достигла порога ≥3.

## Ограничения текущего прогона

- Репит-группа (`a5-repeat-candidate-instruction`) требует эмбеддингов `TaskSolution`. В локальной
  z_main отсутствует таблица `embedding_providers` → эмбеддинги не пишутся → метрика помечается `N/A`.
  Для замера нужен настроенный embedding-провайдер локально.
- Оси A1–A4 (экстрактор/арбитр/компилятор/владение регламентов) в harness ещё не реализованы —
  `regulation-stand` пока покрывает только ось A5. Расширение — по ТЗ.
