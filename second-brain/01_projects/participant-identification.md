---
title: Жёсткая идентификация участников встречи
created: 2026-05-25
updated: 2026-07-05
status: active
related:
  - 01_projects/tracker.md
  - 01_projects/task-closure-method-capture-flow.md
---

# Жёсткая идентификация участников встречи

> ⚠️ **Актуализировано 2026-07-05.** Модель `Task` и `enum TaskStatus` **дропнуты 2026-06-25** (коммит `ec41a025`, Ф8 «снести модель Task»). Задача теперь = `IntakeIssue` → `Issue`, исполнитель — через M:M `IssueAssignee` (не `Task.assigneeUserId`). Извлечение задач встреч идёт **не** отдельными воркерами, а через combo `knowledge-specialists-combined` → `TaskDraftMaterializerService` → `IntakeIssue`. Резолв исполнителя в combo-пути делает `AssigneeResolverService` (tracker, `via: 'name' | 'memory'`). См. [[tracker]] §«Combo — единый источник задач», [[task-closure-method-capture-flow]]. Ниже — исходная логика жёсткой идентификации; идентификация участника встречи (`ParticipantContextService`) **жива**, а `TaskAssigneeResolverService` остался в knowledge-core как провайдер, но сейчас никем не инжектится (dormant).

## Зачем (исходная мотивация)

Раньше AI извлекал задачи из транскрипта и заполнял только `assigneeRaw` строкой («Иван»), без связи с `User.id` — даже когда host'ы заходили в LiveKit с identity `host:<userId>`. Из-за этого:

- UI задач не показывал аватар/ссылку на профиль исполнителя.
- Не работал фильтр «мои задачи» по `User.id`.
- AI-чат компании и Employee Clones не могли связать обсуждение с конкретным сотрудником.

ТЗ 2026-05-25 [`hard-participant-identification`](../../plans/archive/2026-05-25-hard-participant-identification.md) добавил жёсткую цепочку: LiveKit → Participant → AI-промпт → LLM → исполнитель по `User.id`.

## Архитектура цепочки

```
LiveKit join (livekitIdentity="host:<userId>")
   → Participant{userId, name, livekitIdentity, role}
       → транскрипт + IdeaBlock
            → ParticipantContextService.loadForMeeting(meetingId)   ← жив
                  → AiParticipantContext[] { livekitIdentity, displayName, userId, fullName, role }
                       → combo knowledge-specialists-combined (блок участников в шапке)
                            → task-черновик { assigneeRaw }
                                 → TaskDraftMaterializerService → AssigneeResolverService.resolve(...)
                                      → IntakeIssue → Issue + IssueAssignee (M:M) в БД
```

## Компоненты

- **`AiParticipantContext`** (`backend/src/modules/ai/services/prompts/participant-context.ts`) — единый тип контекста участника для AI-промптов. Helper `formatParticipantsForPrompt()` собирает компактный текстовый блок «- "Анна" (userId=user_abc, role=host)».
- **`ParticipantContextService`** (`backend/src/modules/ai/services/participant-context.service.ts`) — загрузка из БД (`Participant JOIN User`). Гость → `userId=null`. Хост'ы первыми, потом гости. Зарегистрирован в `@Global() AiModule`.
- **`AssigneeResolverService`** (`backend/src/modules/tracker/services/assignee-resolver.service.ts`) — активный резолвер исполнителя в combo-пути. `resolve(tenantId, rawName)` → точный матч по имени (`via:'name'`) → память субъекта (`via:'memory'`) → `needsAssignee`+candidates (probe `task.assignee_unresolved`, см. [[probe-agent]]).
- **`TaskAssigneeResolverService`** (`backend/src/modules/knowledge-core/services/task-assignee-resolver.service.ts`) — **dormant**: остался как провайдер в `KnowledgeCoreModule`, но ни один потребитель его больше не инжектит (в `intake.service.ts` — только исторический комментарий). Логика 4 веток (валидный userId / hallucination-fallback / точный матч по имени / ambiguous `duplicate_name`) сохранена в файле, метрика `z_task_assignee_ambiguous_total` из него больше не пишется.
- **Промпт участников:** блок участников (`AiParticipantContext[]`) собирает `formatParticipantsForPrompt()` и кладёт в шапку combo-извлечения (`knowledge-specialists-combined`). Старые точки `tasks-v2.prompt.ts` / `tasks-structured.ts` / `tasks-unified.ts` удалены вместе с моделью Task.
- **Воркеры:** отдельные `tasks-extract.worker.ts` и `meeting-analyze-v2.worker.ts` **удалены**. Анализ встречи идёт через `ai/workers/analyze.worker.ts` + `meeting-speaker-analyzer.worker.ts`; задачи — через combo (см. [[workers-queues]] `core.specialists-combined`).

## Prisma (актуально)

Модели `Task` и `enum TaskStatus` **дропнуты 2026-06-25** (коммит `ec41a025`) — полей `Task.assigneeUserId` / `Task.assignee` / `User.assignedTasks` в схеме больше НЕТ. Исполнитель задачи хранится в M:M:

- `IntakeIssue` — черновик задачи из combo-извлечения (до подтверждения / auto-triage).
- `Issue` — материализованная задача; исполнитель — через связку `IssueAssignee` (M:M, `Issue` × `User`), а не скалярным полем.
- Идентификация участника встречи по-прежнему живёт в `Participant{userId, livekitIdentity, role}` (её читает `ParticipantContextService`).

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

- [tracker.md](tracker.md) — §«Дроп legacy-модели Task» и §«Combo — единый источник задач»: актуальная архитектура извлечения/назначения задач (Issue/IssueAssignee, combo→IntakeIssue).
- [task-closure-method-capture-flow.md](task-closure-method-capture-flow.md) — сквозная карта атрибуции реплик (`evidence.authorPersonId`) и петли извлечения задач.
- [ai-jobs.md](ai-jobs.md) — общая карта AI-jobs и провайдеров.
- [conversational-channels.md](conversational-channels.md) — правила one-user-one-org (host'ы всегда зарегистрированы в Org).
- [../02_architecture/data-model.md](../02_architecture/data-model.md) — Prisma-схема.

[[../index|← index]]
