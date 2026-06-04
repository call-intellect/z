---
status: draft
owner: TBA (передаём агенту)
created: 2026-05-25
type: architecture-refactor
depends-on: 2026-05-25-ai-real-eval-harness.md (эксперимент-основание)
related-modules: knowledge-core, ai
---

> 📦 **АРХИВ (аудит 2026-06-04): ✅ реализовано — 98%.**
> Все 7 фаз реализованы и подтверждены кодом: промпт на 12 типов + тест, воркер + очередь + метрики, Prisma-поля, producer с ENV kill-switch, admin compare UI, frontend pickPrimary* переключение, @deprecated на v2, обновлё
> ⚠️ Хвосты (см. реестр приоритетов): Полное удаление v2-агентов после 2 недель A/B без регрессий и положительной обратной связи продакта (Фаза 3/6, §4.3 'Стр · Acceptance-критерии по продовым замерам (отчёт ≤3 мин, стоимость ≤$0.015, 10 dev-встреч без partial/failed, cache_hit_ra
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`


# Разделение «отчёта пользователю» и «памяти компании» в pipeline встречи

## 0. Кратко

Сейчас цепочка отчёта по встрече (главы + задачи + резюме + оценка качества) ждёт результат шага `block-ingest`. Эксперимент на 3 фикстурах показал: один объединённый вызов на сыром транскрипте даёт **сравнимое или лучшее качество** при **в 4 раза меньшей стоимости и в 3.5 раза меньшем времени**, плюс убирает три класса багов цепочки v2.

Решение: разделить два независимых pipeline — «быстрый отчёт пользователю» (новый, на сыром транскрипте) и «фоновое построение графа знаний» (текущий `block-ingest`). Они работают параллельно и не блокируют друг друга.

## 1. Основание (зачем это делаем)

Полная сводка эксперимента: [test/eval/sales-merge-experiment/reports/SUMMARY-ALL.md](../../backend/test/eval/sales-merge-experiment/reports/SUMMARY-ALL.md).

Ключевые цифры (Pro со скидкой 75%):

| Метрика | Текущий pipeline (5 шагов) | Объединённый вызов (1 шаг) |
|---|---|---|
| Время на встречу 15k знаков | ~385 секунд | ~116 секунд |
| Стоимость | ~$0.040 | ~$0.009 |
| Кол-во точек отказа | 5 | 1 |

Найденные баги текущего pipeline (без правок прод-логики могут повториться):
1. На холодной встрече `meeting-quality-score` вернул quality_score как строку с экранированным JSON вместо объекта → `overallScore=undefined` в проде.
2. На сложной встрече `tasks-v2` схлопнул 6+ обязательств в 2 задачи без цитат → потеря смысла.
3. На простой встрече пропущено одно явное поручение клиента.

Вердикт Claude Opus 4.7 (независимый судья, метки A/Б скрыты): объединённый вызов выиграл 2 из 3 фикстур (на одной — формальная ничья).

## 2. Цель

Перестроить pipeline так, чтобы:
- **Пользователь видит отчёт через ~2 минуты** после встречи (вместо ~7 минут).
- **block-ingest продолжает работать** как самостоятельный процесс для построения графа знаний.
- **Не теряем функционал** памяти компании (IdeaBlock, Entity, Theme, специалисты 3-1…3-9).

## 3. Архитектурное решение

### Сейчас

```
транскрипт
  → block-ingest (1 LLM-вызов, медленно ~5 мин)
       → blocks[]
            → chapters-v2 (LLM)
            → tasks-v2 (LLM)
            → summary-v2 (LLM)
       → meeting-quality-score (LLM, на transcript)
```

5 LLM-вызовов последовательно (block-ingest блокирует всех).

### Станет

```
транскрипт
  ├── meeting-report-fast (новый — 1 LLM-вызов)
  │        → главы + задачи + резюме + оценка качества → пользователь
  │
  └── block-ingest (как есть — отдельная очередь)
           → blocks[] → специалисты 3-1…3-9 → граф знаний
```

Два независимых pipeline, оба стартуют сразу после расшифровки транскрипта. Не блокируют друг друга.

## 4. Конкретные изменения в коде

### 4.1 Новый промпт `meeting-report-fast`

Файл: `backend/src/modules/ai/services/prompts/meeting-report-fast.prompt.ts` (создать).

Эталонная реализация — [run-variant-b-single.ts](../../backend/scripts/eval/run-variant-b-single.ts), скопировать из неё:
- системный промпт `SYSTEM_PROMPT` (~80 строк, описывает 4 секции);
- структуру tool `submit_meeting_analysis` (combined JSON Schema на 4 секции);
- адаптацию под `LlmTaskType` registry проекта Z (новый key `'meeting-report-fast'`).

**ВАЖНО:** промпт должен быть **по типу встречи** (как сейчас `type-sales.ts`, `type-interview.ts` и т.д.). Эксперимент сделан только для `sales` — нужно расширить на все 11 типов. Структура: один builder с параметром `meetingType: MeetingType` + словарь шаблонов для секции "summary_markdown" (где формат зависит от типа). Остальные 3 секции (главы, задачи, оценка качества) — общие для всех типов.

### 4.2 Новый воркер `MeetingReportFastWorker`

Файл: `backend/src/modules/knowledge-core/workers/meeting-report-fast.worker.ts` (создать). Эталон — структура текущего [meeting-analyze-v2.worker.ts](../../backend/src/modules/knowledge-core/workers/meeting-analyze-v2.worker.ts).

Триггер: `core.meeting-report-fast` очередь (новая, добавить в [core-queue/queues.ts](../../backend/src/modules/knowledge-core/core-queue/queues.ts)). Producer — после успешной расшифровки транскрипта (см. [transcribe.worker.ts](../../backend/src/modules/ai/workers/transcribe.worker.ts) или triggering cron).

Логика:
1. Получить `meetingId` из job.
2. Достать `transcript` напрямую (НЕ через `block-fetch.service.ts`) — из `Meeting.transcriptJson` или эквивалентного поля.
3. Один вызов `LlmRouterService.complete()` с `taskType: 'meeting-report-fast'`, моделью DeepSeek-V4-Pro, tool `submit_meeting_analysis`, `tool_choice: 'auto'`.
4. Распарсить ответ, записать:
   - `chapters` → `MeetingChapter` с `extractorVersion='fast'`;
   - `tasks` → `Task` с `extractorVersion='fast'`;
   - `summary_markdown` → `AiResult.summaryFast` (новое поле в Prisma);
   - `quality_score` → `MeetingQualityScore` (отдельная таблица или JSON в `AiResult`, что уже есть).
5. Обновить `Meeting.reportFastStatus = 'ready' | 'failed' | 'partial'`.
6. Метрики: `z_meeting_report_fast_total{tenant, status}`, latency p50/p95.

Concurrency=2 (есть rate-limit на LLM-провайдере).

### 4.3 Деприкация v2-агентов

Файлы под депрекацию (не удалять сразу, пометить как deprecated в JSDoc + удалить из основной цепочки):
- `backend/src/modules/knowledge-core/prompts/chapters-v2.prompt.ts`
- `backend/src/modules/knowledge-core/prompts/tasks-v2.prompt.ts`
- `backend/src/modules/knowledge-core/prompts/summary-v2.prompt.ts`
- `backend/src/modules/knowledge-core/services/chapters-extractor-v2.service.ts`
- `backend/src/modules/knowledge-core/services/tasks-extractor-v2.service.ts`
- `backend/src/modules/knowledge-core/services/summary-extractor-v2.service.ts`
- `backend/src/modules/knowledge-core/workers/meeting-analyze-v2.worker.ts`

**Стратегия удаления:** оставить рабочими ещё на 1 спринт (до подтверждения метрик), запускать параллельно с `meeting-report-fast` для A/B-сравнения на реальном трафике. После 2 недель без регрессий — полностью удалить v2-агентов и заменить в UI ссылку с `aiResult.summaryV2` на `aiResult.summaryFast`.

### 4.4 `block-ingest` остаётся как есть

Никаких изменений в:
- [block-ingest.prompt.ts](../../backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts)
- [block-distill.worker.ts](../../backend/src/modules/knowledge-core/workers/block-distill.worker.ts)
- Цепочка специалистов 3-1…3-9 (они продолжают работать на блоках для графа).

Просто `block-ingest` перестаёт быть зависимостью для отчёта.

### 4.5 Изменения в Prisma-схеме

Добавить в `AiResult`:
```prisma
summaryFast           String?   @db.Text
summaryFastModel      String?
summaryFastGeneratedAt DateTime?
```

Добавить в `Meeting`:
```prisma
reportFastStatus      String?   // null | 'processing' | 'ready' | 'failed' | 'partial'
reportFastError       String?   @db.Text
reportFastGeneratedAt DateTime?
```

Добавить в `MeetingChapter.extractorVersion`: поддержать значение `'fast'` (сейчас там null/v1/v2).

Добавить в `Task.extractorVersion`: то же.

**Применение:** через `bun run prisma:push` (НЕ migrate — см. CLAUDE.md и skill `prisma-db-push-rules`).

### 4.6 Регистрация в LlmRouter

В `seed-llm-task-routes*.ts` добавить новую `LlmTaskType`:
```typescript
'meeting-report-fast' → DeepSeek-Pro → fallback OpenAI-mini → Ollama
```

Формат вывода — tools+tool_choice='auto' (только так работает strict-вывод на DeepSeek-V4-Pro с thinking, см. [probe-deepseek-formats.ts](../../backend/scripts/eval/probe-deepseek-formats.ts)).

## 5. Фазы реализации

### Фаза 1 — Промпт и tool (1-2 часа)
- [ ] Создать `meeting-report-fast.prompt.ts` на базе скрипта Б, адаптировать под 11 типов встреч.
- [ ] Подключить к prompt-registry (admin-editable, см. skill `z-ai-agent-rules`).
- [ ] Unit-test промпта: snapshot + zod-валидация выхода.

### Фаза 2 — Воркер и очередь (2-3 часа)
- [ ] Создать `meeting-report-fast.worker.ts`.
- [ ] Добавить очередь `core.meeting-report-fast` в `core-queue/queues.ts`.
- [ ] Подписать на событие готовности транскрипта.
- [ ] Метрики Prometheus.

### Фаза 3 — Prisma-поля (30 минут)
- [ ] Добавить поля в `AiResult` и `Meeting`.
- [ ] `bun run prisma:push && bun run prisma:generate`.
- [ ] Smoke на пустой БД — поля создались.

### Фаза 4 — Параллельный запуск (1 час)
- [ ] Включить `meeting-report-fast` параллельно с `meeting-analyze-v2` (старая цепочка остаётся работать).
- [ ] Логировать обе цепочки в один `AiUsageLog` (разные `taskType`).
- [ ] Запустить на dev-среде на 5-10 встречах.

### Фаза 5 — Сравнение в admin-UI (2-3 часа)
- [ ] В админке добавить превью обеих сводок (v2 и fast) рядом, чтобы продакт-менеджер мог сравнить.
- [ ] За 1 неделю собрать обратную связь.

### Фаза 6 — Свёртка v2 (1-2 часа)
- [x] После положительной обратной связи — UI переключить на `fast`. **Сделано safe-compromise-стратегией:** UI пользователя приоритезирует `summaryFast` через `pickPrimarySummary` (`@/domain/ai-result`), главы через `pickPrimaryChapters` (`@/domain/chapter`), задачи через `pickPrimaryTasks` (`@/domain/task`). Fallback на `summaryV2` / `extractorVersion='v2'` / legacy. Admin compare UI не тронут. Сводки рендерятся через общий компонент `MeetingSummaryRender` (react-markdown + rehype-sanitize).
- [x] v2-агенты пометить `@deprecated`, через 2 недели удалить. **JSDoc-deprecation проставлен** на: `MeetingAnalyzeV2Worker`, `TasksExtractorV2Service`, `ChaptersExtractorV2Service`, `SummaryExtractorV2Service`, `buildTasksV2Prompt`, `buildChaptersV2Prompt`, `buildSummaryV2Prompt`. Воркер и сервисы продолжают работать параллельно с `meeting-report-fast` — будут удалены после 2 недель A/B и положительной обратной связи от продакта.

### Фаза 7 — Обновление second-brain (30 минут)
- [ ] [01_projects/ai-jobs.md](../../second-brain/01_projects/ai-jobs.md) — добавить `meeting-report-fast` в реестр.
- [ ] [01_projects/workers-queues.md](../../second-brain/01_projects/workers-queues.md) — добавить новую очередь.
- [ ] [02_architecture/module-map.md](../../second-brain/02_architecture/module-map.md) — описать новое разделение pipeline.
- [ ] Добавить новый файл `01_projects/meeting-report-pipeline.md` — карта «быстрый отчёт vs граф знаний».

## 6. Acceptance criteria (как понять что готово)

- [ ] На встрече длиной 15-50 минут пользовательский отчёт появляется через ≤ 3 минут после завершения встречи (сейчас 5-10 минут).
- [ ] Стоимость отчёта на 1 встречу — ≤ $0.015 (сейчас ~$0.04 со скидкой).
- [ ] На 10 dev-встречах разных типов отчёт строится без `partial`/`failed` статусов.
- [ ] `block-ingest` и граф знаний работают как раньше — никаких регрессий в `IdeaBlock`/`Entity`/`Theme`.
- [x] Старые поля `aiResult.summaryV2` и `meetingChapter.extractorVersion='v2'` либо помечены deprecated, либо удалены полностью (по итогам Фазы 6). **Помечены `@deprecated` через JSDoc на классах сервисов / воркера / prompt builder'ов.** Поля БД остаются — будут удалены вместе с воркером через 2 недели A/B.
- [ ] Обновлены 3 файла в second-brain.

## 7. Что НЕ делать в этой задаче

- НЕ удалять `block-ingest` — он критически нужен для графа.
- НЕ трогать специалистов 3-1…3-9 — они работают на блоках, и продолжают.
- НЕ менять цепочку памяти компании (knowledge-core) кроме добавления нового pipeline рядом.
- НЕ менять UI карточки встречи кроме переключения с `summaryV2` на `summaryFast` на финальной фазе.
- НЕ удалять v2-агентов **до** положительной обратной связи в Фазе 5.

## 8. Риски и митигация

| Риск | Митигация |
|---|---|
| На каких-то типах встреч (interview, retrospective) объединённый промпт даст худшее качество, чем v2 | Параллельный запуск в Фазе 4-5. Если хуже — гоняем ещё эксперимент и решаем по типам. |
| Объединённый промпт длинный, проигрывает в кэшировании по сравнению с раздельными | Замерять `cache_hit_ratio` в проде; если ниже 50% и неэффективно — рассмотреть split на 2 вызова (главы+задачи отдельно от резюме+оценка). |
| Pro-модель может перестать поддерживать `tool_choice='auto'` или сменить лимиты | Адаптер протокола (`backend/src/modules/ai/services/protocol-adapter/`) уже есть — добавить fallback на `json_object` (см. probe-результаты). |
| Размер итогового JSON > 30k токенов выхода — обрезка | В скрипте Б стоит `max_tokens=32000`. Если на длинных встречах обрезается — снижать число глав в инструкции или использовать новые модели с большим выходом. |

## 9. Зависимости

- Эксперимент-основание: [plans/tz/2026-05-25-ai-real-eval-harness.md](2026-05-25-ai-real-eval-harness.md).
- Skill для проектной разработки AI-агентов: `z-ai-agent-rules`.
- Skill для backend-кода: `nestjs-rules`.
- Skill для безопасных скриптов: `safe-seed-rules`.
- Skill для Prisma-изменений: `prisma-db-push-rules`.

## 10. Артефакты эксперимента (что использовать как референс)

- Скрипт-эталон Variant Б: [backend/scripts/eval/run-variant-b-single.ts](../../backend/scripts/eval/run-variant-b-single.ts) — там готовый системный промпт, tool-схема и логика парсинга.
- 3 фикстуры на разные сценарии: [backend/test/eval/sales-merge-experiment/fixtures/](../../backend/test/eval/sales-merge-experiment/fixtures/) — можно использовать для регрессионных тестов нового агента.
- 3 отчёта судьи: [reports/fixture-XX-SUMMARY.md](../../backend/test/eval/sales-merge-experiment/reports/) — какие именно проблемы текущей v2-цепочки нужно избежать.
- Probe форматов DeepSeek: [backend/scripts/eval/probe-deepseek-formats.ts](../../backend/scripts/eval/probe-deepseek-formats.ts) — какие комбинации `response_format` и `tool_choice` работают на Pro с thinking.

## 11. Передача агенту

Этот файл — самодостаточное ТЗ. Агент, получивший задачу, должен:
1. Прочитать этот файл целиком.
2. Прочитать `SUMMARY-ALL.md` и хотя бы один `fixture-XX-SUMMARY.md` для понимания контекста.
3. Открыть `run-variant-b-single.ts` как эталон промпта и tool.
4. Вызвать скилы `z-ai-agent-rules`, `nestjs-rules`, `prisma-db-push-rules`, `core-engineering-standards` для свежей сверки правил проекта.
5. Идти по фазам 1-7 в порядке. После каждой фазы — `bun run typecheck && bun run lint`.
6. На развилках — спрашивать у пользователя (особенно по типам встреч в Фазе 1 и по deprecation-стратегии в Фазе 6).
