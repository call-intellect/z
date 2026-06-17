---
title: Жёсткая идентификация участников встречи
created: 2026-05-25
status: active
---

# Жёсткая идентификация участников встречи (Task.assigneeUserId)

## Зачем

Раньше AI извлекал задачи из транскрипта и заполнял только `Task.assigneeRaw` строкой («Иван»). Поле `Task.assigneeUserId` существовало в БД, но никогда не заполнялось — даже когда host'ы заходили в LiveKit с identity `host:<userId>`. Из-за этого:

- UI задач не показывал аватар/ссылку на профиль исполнителя.
- Не работал фильтр «мои задачи» по `User.id`.
- AI-чат компании и Employee Clones не могли связать обсуждение с конкретным сотрудником.

ТЗ 2026-05-25 [`hard-participant-identification`](../../plans/archive/2026-05-25-hard-participant-identification.md) добавил жёсткую цепочку: LiveKit → Participant → AI-промпт → LLM → Task.assigneeUserId.

## Архитектура цепочки

```
LiveKit join (livekitIdentity="host:<userId>")
   → Participant{userId, name, livekitIdentity, role}
       → транскрипт + IdeaBlock
            → ParticipantContextService.loadForMeeting(meetingId)
                  → AiParticipantContext[] { livekitIdentity, displayName, userId, fullName, role }
                       → buildTasksV2Prompt / buildTasksStructuredPrompt
                           (system: правила, user: блок участников, schema: assigneeUserId)
                            → LLM возвращает { assigneeRaw, assigneeUserId | null }
                                 → TaskAssigneeResolverService.resolve(...)
                                      → Task { assigneeRaw, assigneeUserId } в БД
```

## Компоненты

- **`AiParticipantContext`** (`backend/src/modules/ai/services/prompts/participant-context.ts`) — единый тип контекста участника для AI-промптов. Helper `formatParticipantsForPrompt()` собирает компактный текстовый блок «- "Анна" (userId=user_abc, role=host)».
- **`ParticipantContextService`** (`backend/src/modules/ai/services/participant-context.service.ts`) — загрузка из БД (`Participant JOIN User`). Гость → `userId=null`. Хост'ы первыми, потом гости. Зарегистрирован в `@Global() AiModule`.
- **`TaskAssigneeResolverService`** (`backend/src/modules/knowledge-core/services/task-assignee-resolver.service.ts`) — 4 ветки:
  1. LLM вернул валидный `assigneeUserId` (есть в participants) → принимаем.
  2. LLM вернул `assigneeUserId`, которого нет в participants → null + метрика `llm_hallucination` + fallback по имени.
  3. Только `assigneeRaw` → точный case-insensitive матч по `displayName` или `fullName`. Один матч → ставим userId.
  4. ≥2 матчей → null + ambiguous=true + метрика `duplicate_name`.
- **Промпты** (3 точки):
  - `backend/src/modules/knowledge-core/prompts/tasks-v2.prompt.ts` — для `tasks-v2` (knowledge-core, `meeting-analyze-v2.worker`).
  - `backend/src/modules/ai/services/prompts/tasks-unified.ts` — единый builder, опция `participants?: AiParticipantContext[]`.
  - `backend/src/modules/ai/services/prompts/tasks-structured.ts` — обёртка для `TaskExtractionService` (legacy `tasks-extract.worker`). Принимает `participants` через `TasksStructuredPromptInput`.
- **Воркеры**:
  - `backend/src/modules/ai/workers/tasks-extract.worker.ts` — legacy путь поверх сырого диалога.
  - `backend/src/modules/knowledge-core/workers/meeting-analyze-v2.worker.ts` — v2 путь поверх IdeaBlock'ов. Оба загружают participants и резолвят результат.

## Prisma

- `Task.assigneeUserId String?` — уже существовало.
- `Task.assignee User? @relation("TaskAssignee", fields: [assigneeUserId], references: [id], onDelete: SetNull)` — добавлена в ТЗ.
- `User.assignedTasks Task[] @relation("TaskAssignee")` — симметричная.
- `@@index([assigneeUserId])` — для фильтра «мои задачи».
- `onDelete: SetNull` — при удалении User'а `assigneeUserId` обнуляется, но Task остаётся (`assigneeRaw` хранит историческую строку).

## Метрики

- `z_task_assignee_ambiguous_total{tenant, reason}`:
  - `reason='duplicate_name'` — два host'а с одинаковым display name в одной встрече.
  - `reason='llm_hallucination'` — LLM вернул userId не из списка participants.

Cardinality безопасна: tenant + 2 reason = ~2N рядов на N тенантов.

## Edge cases

- **Гость** (без `User.id`) — всегда `assigneeUserId=null`, остаётся только `assigneeRaw`.
- **Имя — роль/команда** («маркетинг», «продажи») — `assigneeUserId=null`, не ambiguous (нет матча → ок).
- **LLM не вернул `assigneeUserId`** (старая модель, провайдер игнорит schema) — `null` + fallback по `assigneeRaw`.
- **Backfill старых задач** — НЕ делаем автоматически, исторические задачи остаются с `assigneeUserId=null`. Скрипт по запросу.
- **Issue/Tracker модуль** — отдельный домен, у него своя логика с `assigneeUserId`, мы его НЕ трогали.

## Что НЕ сделано в этой волне (vNext)

- **Entity.userId** для графа знаний — отдельный план.
- **Матчинг гостей по email/календарю** — отдельный план.
- **Frontend UI**: аватар, ссылка на профиль, фильтр «мои задачи» — отдельная UI-волна. Backend уже отдаёт `assigneeUserId` в `TaskResponseDto`.

## Закрытые gap'ы

- **Динамическая JSON Schema для `tasks-structured`** — закрыто follow-up'ом к ТЗ 2026-05-25. Раньше `TASKS_STRUCTURED_JSON_SCHEMA` была module-level const без `participants` — на strict-провайдерах (OpenAI/DeepSeek через `response_format: json_schema strict`) LLM физически не мог вернуть `assigneeUserId`. Теперь схема собирается через `buildTasksStructuredJsonSchema(participants)` в `task-extraction.service.ts`: при непустом списке участников поле `assigneeUserId` (nullable string) включается в strict-схему. Без participants — поведение прежнее (обратная совместимость).

## Связь с другими заметками

- [ai-jobs.md](ai-jobs.md) — общая карта AI-jobs и провайдеров.
- [conversational-channels.md](conversational-channels.md) — правила one-user-one-org (host'ы всегда зарегистрированы в Org).
- [../02_architecture/data-model.md](../02_architecture/data-model.md) — Prisma-схема.

[[../index|← index]]
