---
type: project
---

# AI Analysis — шаблоны по типу встречи

Каждый тип встречи (см. [[meeting-types]]) применяет свой шаблон извлечения. Ниже — поля, которые AI должен вытащить.

## Общие AI-функции (для любой встречи)

1. Расшифровка встречи
2. Разделение по спикерам
3. Краткое саммари
4. Подробный протокол
5. Задачи, ответственные, сроки
6. Решения встречи
7. Follow-up письмо
8. AI-чат по встрече
9. Smart chapters (главы встречи)
10. Поиск по встрече
11. Анализ возражений (для продаж)
12. Next-best-action
13. CRM-заметка
14. Оценка риска / интереса / результата

## Шаблоны по типу

### `team` — Командная встреча
- что обсудили
- решения
- задачи
- ответственные
- дедлайны
- блокеры

### `standup` — Планёрка
- текущие приоритеты
- кто что делает
- новые задачи
- блокеры
- что нужно решить руководителю
- следующая контрольная точка

### `plan_fact` — План / факт по задачам
- что было запланировано
- что реально сделано
- что не сделано
- причины отклонений
- ответственные
- риски
- следующий план

### `project` — Проектная встреча
- договорённости сторон
- зоны ответственности
- сроки
- риски
- открытые вопросы
- следующий шаг

### `sales` — Продажная встреча
- боль клиента
- интерес
- возражения
- бюджет
- ЛПР
- срочность
- следующий шаг
- follow-up письмо

### `custdev` — CustDev / интервью
- боли
- сценарии использования
- цитаты клиента
- текущие альтернативы
- частотность проблемы
- готовность платить
- инсайты

### `partner` — Партнёрская встреча
- выгода для нашей стороны
- выгода для партнёра
- модель партнёрства
- совместная механика
- пилот
- риски
- следующий шаг

### `interview` — Собеседование
- опыт кандидата
- сильные стороны
- слабые стороны
- риски
- мотивация
- соответствие роли
- итоговая оценка
- следующий этап

### `customer_success` — Customer Success
- результат клиента
- проблемы
- риск оттока
- возможности апсейла
- что нужно сделать
- следующий контакт

## Кастомный промпт (override шаблона)

При создании встречи можно передать поле `custom_prompt: string`. Если заполнено — AI на этапе `analyze` использует **его** вместо стандартного шаблона по типу.

- **Где задаётся:** в API при создании встречи (Crossmark или сам Z UI), в раскрывающейся секции «Свой промпт отчёта».
- **Что меняется:** этап `analyze` берёт `custom_prompt` как system-инструкцию для Claude Sonnet, диалог-транскрипт идёт в user-сообщение, ответ сохраняется в `ai_result.custom_output_md` (markdown-текст), `structured_data` остаётся `null`.
- **Что не меняется:** `summary` (краткое содержание 2-3 предложения) генерится всегда отдельным вызовом — это не зависит от типа.
- **Тип всё равно нужен** — для статистики, группировки, тарифных лимитов. Просто содержание отчёта определяется промптом.

**Что отложено в V2:**
- Сохранённые промпты на пользователя/команду («Мой шаблон CustDev»).
- Повторный прогон отчёта на странице результата с другим промптом.
- Редактор промптов с подсветкой и подсказками.

## AI Pipeline

```
1. Забираем аудиодорожки из S3
2. Транскрибация
3. Склейка диалога по времени
4. Разделение по спикерам
5. Применяем шаблон анализа по типу
6. Формируем итоговый отчёт
7. Генерируем follow-up
8. Генерируем задачи
9. Сохраняем результат в БД
```

## Tasks-промты — единый builder (F5, ТЗ 2026-05-24 prompts-hardening)

С 2026-05-24 все три исторических tasks-промта собираются из **единого источника правды** — [`backend/src/modules/ai/services/prompts/tasks-unified.ts`](../../backend/src/modules/ai/services/prompts/tasks-unified.ts). Файл предоставляет:

- `buildTasksPromptUnified(input, opts)` — system + user.
- `buildTasksToolUnified(opts)` — `LlmTool` с JSON-Schema.
- `buildTasksSchemaUnified(opts)` / `buildTaskItemSchemaUnified(opts)` — Zod-схема.
- `TASKS_UNIFIED_TOOL_NAME = 'extract_tasks'` — единое имя tool'а.

Опции (`TasksPromptOptions`):

| Опция | Эффект |
|---|---|
| `enriched` | `suggestedAssigneeHint`, `suggestedDueDate`, `suggestedPriority` + блок про контекст организации |
| `withConfidence` | `confidence ∈ [0,1]` (required) + `CONFIDENCE_CALIBRATION` в system (F2) |
| `withSourceQuote` | `sourceQuote` (required) — обязательная цитата |
| `withFragmentBounds` | `sourceStartMs`/`sourceEndMs` — миллисекунды от начала встречи |
| `useAssigneeRaw` | `assigneeRaw` + `description` вместо `assignee` (контракт модели `Task`) |
| `responseAsBareArray` | Ответ голым JSON-массивом (без tool-use) — для `responseFormat: json_object` |
| `meetingDateIso` | Дата встречи (ISO) — опора для относительных сроков |
| `orgContext` | `projects` / `goals` / `people` подмешиваются в user |

### 3 legacy-обёртки (для обратной совместимости)

Caller'ы продолжают работать через тонкие обёртки — менять их не нужно:

| Caller | Legacy-обёртка | Опции unified |
|---|---|---|
| `analyze.worker.runTasks` | `buildTasksPrompt` ([tasks.ts](../../backend/src/modules/ai/services/prompts/tasks.ts)) | `{ enriched: false, withConfidence: true }` |
| `MeetingExtractActionsService.extract` (Wave 3) | `buildMeetingExtractActionsPrompt` ([tasks.ts](../../backend/src/modules/ai/services/prompts/tasks.ts)) | `{ enriched: true, withConfidence: true, withSourceQuote: true }` |
| `TaskExtractionService.extractTasks` | `buildTasksStructuredPrompt` ([tasks-structured.ts](../../backend/src/modules/ai/services/prompts/tasks-structured.ts)) | `{ useAssigneeRaw: true, withFragmentBounds: true, withSourceQuote: true, withConfidence: true, responseAsBareArray: true }` |

### Правило для нового кода

При создании нового caller'а (новый воркер / сервис), которому нужно извлечь задачи из встречи, — использовать `buildTasksPromptUnified` напрямую. Не плодить новых обёрток, не дублировать system-текст. Если требуется новая опция (например, `withGoalHint`) — добавлять её в `TasksPromptOptions`, а не в caller.

`MEETING_EXTRACT_ACTIONS_SYSTEM` помечена `@deprecated` — это синхронизированный getter (вычисляется через builder при загрузке модуля), оставлен только для backward-compat существующих внешних скриптов и тестов, которые могли импортировать SYSTEM-текст напрямую.

[[../index|← index]]
