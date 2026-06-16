---
title: Meeting Report Pipeline — отчёт пользователю vs память компании
status: living
covers: разделение pipeline после встречи на «быстрый отчёт» и «граф знаний»
---

# Meeting Report Pipeline

Карта двух независимых AI-цепочек, которые стартуют после готовности транскрипта встречи. Введена ТЗ [`2026-05-25-meeting-report-split-from-block-ingest.md`](../../plans/tz/2026-05-25-meeting-report-split-from-block-ingest.md).

## Зачем разделение

Раньше отчёт пользователю и обновление графа знаний шли одной последовательной цепочкой: `block-ingest → chapters-v2 + tasks-v2 + summary-v2 + quality-score`. Это 5 LLM-вызовов, ~7 минут на встречу, 5 точек отказа.

Эксперимент `backend/test/eval/sales-merge-experiment` (3 фикстуры × 2 варианта × Claude Opus 4.7 как независимый judge) показал: один объединённый вызов на сыром транскрипте даёт сравнимое или лучшее качество, при этом:

- **в 3.5× быстрее** (~116 с vs ~385 с);
- **в 4.6× дешевле** (~$0.035 vs ~$0.163 на встречу 15 мин);
- режет 3 класса багов v2 (quality_score как строка, схлопывание задач, потеря явного поручения).

Но `block-ingest` критически нужен для графа знаний (IdeaBlock → Entity → Theme → специалисты 3-1...3-9). Поэтому **разделили** — а не заменили.

## Текущая архитектура

```
merge.worker (транскрипт готов)
   │
   ├── [Б] core.meeting-report-fast   ──────────→ AiResult.summaryFast
   │       (1 LLM-вызов, DeepSeek-Pro)            MeetingChapter / Task (extractorVersion='fast')
   │       ~2 мин                                 Meeting.reportFastStatus
   │       ENV kill-switch                        → пользователь видит отчёт
   │
   └── [A] ai.analyze → core.block-ingest ─────→ IdeaBlock + Entity + Theme
           (5 LLM-вызовов)                        → core.specialist-routing → специалисты 3-1...3-9
           ~7 мин                                 → граф знаний компании
           legacy v2-агенты                       legacy: AiResult.summaryV2, *.extractorVersion='v2'
           работают параллельно                   (живёт до свёртки в Фазе 6 ТЗ)
```

Цепочки **не блокируют друг друга**: producer'ы независимы, ошибка одной не валит другую (изолировано в `merge.worker.maybeEnqueueMeetingReportFast`).

## Б — Meeting Report Fast (отчёт пользователю)

**Триггер.** `merge.worker` после успешной склейки `Transcript.turns` вызывает `coreQueue.enqueueMeetingReportFast(meetingId)` — параллельно с `enqueueAnalyze` / `enqueueBehaviorMetrics`.

**ENV kill-switch.** `MEETING_REPORT_FAST_ENABLED` (default `true`), читается через `TypedConfigService.knowledgeCore.meetingReportFastEnabled`. При `false` producer пропускает enqueue с info-логом.

**Промпт.** `backend/src/modules/ai/services/prompts/meeting-report-fast.prompt.ts`:
- Builder `buildMeetingReportFastPrompt({ meetingType, meetingTitle, transcript })`.
- `SUMMARY_TEMPLATE_BY_TYPE` — 12 шаблонов summary_markdown по `MeetingType` (team, standup, plan_fact, project, sales, custdev, partner, interview, customer_success, review, retrospective, task_discussion).
- Compile-time exhaustiveness check через TypeScript.
- 3 общие секции для всех типов: `chapters`, `tasks`, `quality_score`. `summary_markdown` — по типу.
- Tool `submit_meeting_analysis` (JSON Schema), `tool_choice='auto'` (требование DeepSeek-V4-Pro с thinking).

**Воркер.** `backend/src/modules/knowledge-core/workers/meeting-report-fast.worker.ts`:
- Concurrency=2 (rate-limit LLM).
- Достаёт `Meeting.transcript.turns` напрямую — НЕ через `block-fetch.service` (не зависит от блоков).
- Один вызов `LlmRouterService.call({ taskType: 'meeting-report-fast', tools: [MEETING_REPORT_FAST_TOOL], responseFormat: 'json_object', maxTokens: 32000, ... })`.
- Парсинг: сначала `tool_calls[0].input`, затем JSON из `text` (fallback). 2 retry.
- Защита: `withInjectionGuard` + `wrapUserData`.
- Запись:
  - `chapters` → `MeetingChapter(extractorVersion='fast')` (удаляются только предыдущие fast-главы).
  - `tasks` → `Task(extractorVersion='fast')` (дедуп по title; `assigneeUserId` через `TaskAssigneeResolverService`).
  - `summary_markdown` → `AiResult.summaryFast`.
  - `quality_score` — сейчас логируется (запись в `MeetingQualityScore` — vNext, чтобы не конфликтовать с воркером `ai.quality-score`).
- Статусы `Meeting.reportFastStatus`: `processing` → `ready` / `failed` / `partial`.

**LLM routing.** `taskType='meeting-report-fast'` в `seed-llm-task-routes-knowledge-core.ts`:
- primary: `deepseek/deepseek-v4-pro` (32k output, thinking on, tool_choice='auto');
- secondary: `openai-via-proxy/gpt-5.4-mini`;
- tertiary: `kie/gemini-3.1-pro` (нормализация цепочек 2026-06-05, ollama выведен из всех боевых LLM-цепочек).

**Метрики.** `z_meeting_report_fast_total{tenant, status}` (counter) + `z_meeting_report_fast_duration_seconds` (histogram, бакеты 5..600 с).

## A — block-ingest + специалисты (память компании)

**Не изменился.** Цепочка [`02_architecture/knowledge-core.md`](../02_architecture/knowledge-core.md):

```
core.raw-events → block-ingest → blocks[] → block-distill → IdeaBlock
                                              ↓
                                  entity-resolve → Entity
                                              ↓
                                  theme-clusterer (cron) → Theme
                                              ↓
                                  specialist-routing → 3-1, 3-2, ..., 3-9
                                              ↓
                                       граф знаний компании
```

Legacy v2-агенты (`chapters-v2`, `tasks-v2`, `summary-v2`, `meeting-quality-score`) **продолжают работать** для A/B-сравнения. С Фазы 6 ТЗ они помечены `@deprecated` (JSDoc), но НЕ удалены — продолжают писать в `AiResult.summaryV2` / `extractorVersion='v2'` для admin compare UI. Полное удаление — через 2 недели параллельной работы и положительный фидбек продакта.

## Состояние во времени (фазы ТЗ)

| Фаза | Статус | Что |
|---|---|---|
| 1 — Промпт и tool | ✅ закрыто | `meeting-report-fast.prompt.ts`, 31 unit-тест |
| 2 — Воркер и очередь | ✅ закрыто | `meeting-report-fast.worker.ts`, очередь, метрики |
| 3 — Prisma-поля | ✅ закрыто | `AiResult.summaryFast*`, `Meeting.reportFastStatus*` |
| 4 — Producer + ENV | ✅ закрыто | `merge.worker.maybeEnqueueMeetingReportFast` + `MEETING_REPORT_FAST_ENABLED` |
| 4.6 — LlmRouter route | ✅ закрыто | `seed-llm-task-routes-knowledge-core.ts` |
| 5 — Admin compare UI | 🔄 в работе | Превью v2 vs fast в админке для продакта |
| 6 — Свёртка v2 | ✅ закрыто (safe compromise) | v2-агенты помечены `@deprecated` (worker + 3 сервиса + 3 prompt builder'а); пользовательский UI карточки встречи (`MeetingResultPageReal`) приоритезирует `summaryFast` / fast-главы / fast-задачи через `pickPrimarySummary` / `pickPrimaryChapters` / `pickPrimaryTasks`. v2 — fallback; legacy `summary` — fallback от fallback. Admin compare UI **не тронут**. Полное удаление v2-агентов — через 2 недели параллельной работы и фидбек продакта. |
| 7 — second-brain | ✅ закрыто | Эта заметка + правки `ai-jobs.md`, `workers-queues.md`, `module-map.md` |

## Связанные документы

- ТЗ-основание: [`plans/tz/2026-05-25-meeting-report-split-from-block-ingest.md`](../../plans/tz/2026-05-25-meeting-report-split-from-block-ingest.md).
- Эксперимент-основание: [`plans/tz/2026-05-25-ai-real-eval-harness.md`](../../plans/tz/2026-05-25-ai-real-eval-harness.md).
- Артефакты эксперимента: [`backend/test/eval/sales-merge-experiment/`](../../backend/test/eval/sales-merge-experiment/).
- Жёсткая идентификация участников (используется в `Task` обеих цепочек): [`participant-identification.md`](participant-identification.md).
- Реестр AI-jobs: [`ai-jobs.md`](ai-jobs.md).
- Реестр очередей: [`workers-queues.md`](workers-queues.md).
- Архитектура knowledge-core: [`../02_architecture/knowledge-core.md`](../02_architecture/knowledge-core.md).

[[../index|← index]]
