# Golden-set knowledge-core

Эталонный набор размеченных встреч для регресс-проверки качества knowledge-core
(`BlockExtractionService` + `EntityResolutionService` + `SearchService`).

Источник: ТЗ `plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md`,
раздел «W2.1 — Golden-set + regression».

## Зачем

Любое изменение промптов knowledge-core (`backend/src/modules/knowledge-core/prompts/**`)
или ключевых сервисов извлечения (`block-extraction.service.ts`,
`entity-resolution.service.ts`) **обязано** прогоняться против этого набора.
Цель — поймать деградацию качества до того, как она доехала до прода.

## Структура

```
backend/tests/golden/knowledge-core/
  meetings/                   # RawEvent-подобные фикстуры (вход)
    001-sales-call.json
    002-team-standup.json
    ...
  expected/                   # размеченные ожидаемые результаты
    001-sales-call.expected.json
    002-team-standup.expected.json
    ...
  fixtures/
    golden.config.ts          # пороги, версия, типы
  golden.spec.ts              # vitest-suite (см. ниже)
  README.md                   # этот файл
```

## Как добавить новую встречу

1. Возьми реальный (анонимизированный!) или синтетический транскрипт встречи.
   Запрещено хранить персональные данные клиентов — заменяй имена/компании
   на вымышленные.
2. Создай `meetings/NNN-короткое-имя.json` со схемой `GoldenMeeting`
   (см. `fixtures/golden.config.ts`):
   ```jsonc
   {
     "id": "003-feature-feedback",
     "tenantId": "test-tenant",
     "meetingTitle": "Обратная связь по новой фиче",
     "dataClass": "internal",
     "payload": {
       "meetingId": "003-feature-feedback",
       "type": "team_sync",
       "title": "Обратная связь по новой фиче",
       "transcript": {
         "turns": [
           { "speaker": "Анна",  "text": "Запустили вчера...", "startSec":   0, "endSec":  8 },
           { "speaker": "Игорь", "text": "У клиентов вопрос...", "startSec":  8, "endSec": 20 }
         ]
       },
       "participants": [{ "name": "Анна", "role": "PM" }, { "name": "Игорь", "role": "Lead" }]
     }
   }
   ```
3. Создай парный `expected/003-feature-feedback.expected.json` со схемой
   `GoldenExpected`:
   ```jsonc
   {
     "id": "003-feature-feedback",
     "configVersion": "1.0.0",
     "blocks": [
       {
         "id": "block-1",
         "name": "Клиенты не понимают новую кнопку",
         "signalType": "pain",
         "evidenceQuote": "У клиентов вопрос — куда теперь жать"
       }
     ],
     "entities": [
       { "type": "feature", "canonicalName": "новая кнопка экспорта", "aliases": ["новая кнопка"] }
     ],
     "searchQueries": [
       { "q": "что не так с новой кнопкой?", "expectedBlockId": "block-1" }
     ],
     "notes": "размечала <автор>, 2026-MM-DD"
   }
   ```
4. Запусти `cd backend && bun run golden:knowledge-core` — suite должен пройти
   (с учётом, что встреч < 50 — suite предупредит, но не упадёт).
5. Перед первой блокирующей CI-проверкой нужно набрать ≥ 50 встреч
   (`GOLDEN_CONFIG.minMeetingsForRun`). Цель — расти до 200-300.

## Что считается метриками

Из ТЗ §W2.1, пороги в `fixtures/golden.config.ts → GOLDEN_CONFIG.thresholds`:

| Метрика                       | Что значит                                                                                                       | Порог |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----- |
| `signalTypeMacroF1`           | Макро-F1 (unweighted) по enum `SignalType` (55 значений). Сравнение предсказанных vs ожидаемых блоков по классу. | 0.7   |
| `entityRecallAt10`            | Доля ожидаемых entities, найденных в top-10 извлечённых (точное совпадение `type` + `canonicalName`/`alias`).    | 0.85  |
| `blockNameCosineSimilarity`   | Среднее cosine между embedding'ом предсказанного `name` блока и ожидаемого (text-embedding-3-small, 1536-dim).   | 0.8   |
| `top3SearchHitRate`           | Доля эталонных search-запросов, у которых `expectedBlockId` попал в top-3 SearchService. Опц. поле в фикстуре.   | 0.8   |

## Как обновить expected после изменения промптов

Если промпт намеренно поменялся и новый результат корректен:

```bash
cd backend
bun run golden:knowledge-core:update
```

Команда перегенерирует `expected/*.json` по текущему прогону пайплайна.

**ВНИМАНИЕ:** после обновления — ОБЯЗАТЕЛЬНО ручной review diff'а expected/:
если у тебя поехало по 30 встречам сразу — значит не «промпт улучшился»,
а «поехала классификация». Обновлять только то, что осмысленно вырастило
качество. Все коммиты с update — отдельные, не в одном пакете с правкой
промпта.

## Команды

```
bun run golden:knowledge-core           # запустить suite (читает текущий expected/)
bun run golden:knowledge-core:update    # перегенерировать expected/ (после ручной проверки!)
```

## Что в S1 (scaffolding) НЕ работает

В этой фазе создана только структура. Реальный вызов `BlockExtractionService`
ещё не подключён — функция `runKnowledgeCorePipeline(...)` в `golden.spec.ts`
бросает осмысленную ошибку. Это безопасно, потому что пока `meetings/` пуст,
suite целиком помечается skip и CI не падает.

Подключение реального пайплайна и первая разметка 50 встреч — задача S2.

## Связанные документы

- ТЗ: `plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md`
- Baseline-документ: `docs/benchmarks/knowledge-core-baseline.md`
- Архитектура knowledge-core: `second-brain/02_architecture/knowledge-core.md`
