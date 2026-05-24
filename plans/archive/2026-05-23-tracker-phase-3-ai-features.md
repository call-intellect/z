---
type: tz
status: done
feature: Таск-трекер Z/Кора — Фаза 3 — AI-фичи (автозадачи из встреч, AI-suggest при создании, AI Q&A по задачам, auto-triage Intake)
date: 2026-05-23
phase: 3 / 6
parent: plans/tz/2026-05-23-tracker-phase-1-models-api.md
---

# Фаза 3 трекера: AI-фичи

## TL;DR

5 AI-фич, которые делают трекер «живым»: (1) **автозадачи из встреч** (one-click из карточки встречи), (2) **AI-suggest при создании** задачи (исполнитель, срок, приоритет, цель, метки), (3) **похожие задачи** (KNN-поиск + «эта похожа на закрытую №X»), (4) **AI-чат по задачам** (через chat-v2), (5) **auto-triage Intake** (классификация в проект/назначение AI). Все через LlmRouter с тройной цепочкой. Срок: 4 человеко-недели.

## Зависимости

- **Фаза 1 трекера** — модели + ingest в knowledge-core.
- **Фаза 2 трекера** — UI для отображения suggest.
- **α-3 axis-classifier** + **knowledge-core** — для семантического поиска похожих.
- **chat-v2 + dialog-layer** (α-5) — для AI-чата по задачам.
- **Embeddings** (через text-embedding-3-small) — уже есть.

## Фича 1. Автозадачи из встреч

### UX

На карточке встречи (страница `/m/[id]` после её завершения):
- **Блок «Извлечено AI: N задач»** под AI-отчётом.
- Каждая предложенная задача:
  - Чекбокс (по умолчанию ✅)
  - Title (редактируемый)
  - Suggested assignee (по упоминаниям + графу знаний)
  - Suggested due date (если LLM нашёл)
  - Suggested project (по теме встречи + истории)
- Кнопка **«Создать N задач»** — массовое создание.

### Backend

Расширение существующего `analyze.worker` (AI-pipeline встреч):

1. После генерации AI-отчёта — новый шаг `meeting-extract-actions`:
   - Принимает: транскрипт + AI-отчёт + контекст организации (текущие проекты, цели).
   - Возвращает: список `{ title, suggestedAssigneeId, suggestedDueDate, suggestedProjectId, suggestedGoalId, confidence, sourceQuote }`.
2. Сохраняет как `IntakeIssue` с `source='meeting'`, `externalId=meetingId`, `status='pending'`.
3. На frontend появляется в блоке встречи + в `/me/inbox` пользователя который указан как assignee.

### LlmTaskType `meeting-extract-actions`

- Primary: DeepSeek (через proxy.agent-lia.ru) — нужна capable
- Secondary: OpenAI gpt-4o (через proxy)
- Tertiary: Ollama qwen3.5:9b

### Где это уже частично есть

В текущем коде уже извлекаются action items как часть AI-отчёта встречи (legacy `Task.meetingId`). **Что нового:**
- Не просто плоский список, а структурированный с `suggestedAssigneeId/Date/Project` через axis-classifier.
- Идёт в `IntakeIssue` (новая модель Фазы 1), не сразу в `Task`.
- Пользователь может **подтвердить или отклонить** до создания.

## Фича 2. AI-suggest при создании задачи

### UX

При создании задачи через inline-форму (Phase 2):
1. Пользователь ввёл title и нажал Enter.
2. Backend `POST /issues` с `inferSuggestions: true`.
3. После создания (с smart defaults) — backend асинхронно вызывает LLM `issue-infer-fields`:
   - Smart defaults остаются как есть.
   - LLM возвращает уточнения: `{ suggestedAssigneeId, suggestedDueDate, suggestedPriority, suggestedGoalId, suggestedLabels, confidence }`.
   - Если confidence ≥ 0.7 — toast в углу: «AI предлагает: исполнитель Иванов, срок завтра, цель «Запуск v2». Принять?»
   - Tap «Принять» — обновление через PATCH /issues/:id.

### LlmTaskType `issue-infer-fields`

- Primary: DeepSeek-flash (дёшево, быстро)
- Secondary: OpenAI gpt-4o-mini
- Tertiary: Ollama qwen3.5:9b

### Контекст для LLM

Промпт включает:
- Title задачи
- Project name + identifier
- Список ролей и людей в проекте
- Активные цели проекта
- Последние 10 задач проекта с их метками и assignees (для паттернов)
- Текущая дата

## Фича 3. Похожие задачи

### UX

- На странице задачи `/issues/[id]` — блок «Похожие задачи (закрытые)» — до 3 задач.
- Каждая с заголовком + статусом + датой закрытия + ссылкой.
- Кнопка «Посмотреть как решили» — открывает похожую с её комментариями.

### Backend

- Каждая Issue имеет `embedding vector(1536)` (генерируется через text-embedding-3-small при создании/обновлении title+description).
- При открытии задачи: `GET /issues/:id/similar` — KNN-поиск (HNSW индекс) по closed issues того же tenant + cosine threshold ≥ 0.82.

### Дополнительное расширение модели Issue

```
model Issue {
  // ... существующие поля из Фазы 1
  embedding Unsupported("vector(1536)")?
  
  @@index(... + GIN/HNSW индекс через postgres-init.sql)
}
```

### Воркер `issue-embed.worker`

- Consumer очереди `core.issue-embed`
- При создании / обновлении Issue (после смены title/description) — генерирует embedding через `embeddings.service.ts` (уже есть).
- Сохраняет в `Issue.embedding`.

## Фича 4. AI-чат по задачам (поверх chat-v2)

### UX

В рамках AI-чата компании (`/chat-v2`) пользователь может спросить:
- «Покажи все мои просроченные задачи»
- «Какие задачи по проекту X сейчас в работе?»
- «Что обсуждали по задаче KORA-123 в комментариях?»
- «Кто чаще всего закрывает задачи в команде разработки?»

### Backend

- Регистрация `CardSpecialistRegistry` для `Issue` и `Project`:
  - `getCitations(blockIds)` возвращает выжимку из задач с ссылками.
  - `formatForChat(issue)` — отформатированная карточка для встраивания в ответ.
- Поиск задач в `chat-v2-retrieval.service.ts` расширен: помимо IdeaBlock — ищет в Issue по title+description (BM25 + cosine).
- Темпоральные фильтры через `validAt` (из α-5 dialog-layer).

### LlmTaskType (расширяется существующий)

`chat-v2-synthesize` — промпт расширяется так, чтобы знал что задачи и проекты тоже могут быть источниками ответа.

## Фича 5. Auto-triage Intake

### UX

На странице `/intake` (для admin / project_manager):
- Каждый `IntakeIssue` показан карточкой с:
  - Source (email / telegram / meeting / checkin / manual)
  - Raw content
  - AI-suggested: project, assignee, priority, goal, due date (с confidence)
- Кнопки: **«Принять»** (создаёт Issue с принятыми suggested), **«Отклонить»**, **«Отложить»** (snooze до даты), **«Дубликат»** (выбор существующей задачи).

### Backend

При создании `IntakeIssue` (через любой канал) — вызывается `intake-auto-triage`:
1. LLM анализирует raw content + контекст организации.
2. Заполняет все `suggested*` поля.
3. Если confidence очень высокая (≥ 0.92) И источник = `meeting` + assignee явно упомянут → создаёт Issue **автоматически**, ставит `IntakeIssue.status='auto_accepted'`, уведомляет автора.
4. Иначе — ждёт ручного триажа.

### LlmTaskType `intake-auto-triage`

- Primary: DeepSeek (capable)
- Secondary: OpenAI gpt-4o-mini
- Tertiary: Ollama qwen3.5:9b

## Связь с Goals → Strategic Alignment

### LlmTaskType `issue-goal-suggest`

Вызывается:
- При создании задачи (Фича 2)
- При расширении description задачи (через debounce 5s)

Логика:
1. KNN-поиск по embedding среди закрытых задач с привязанной целью.
2. Если найдены задачи с одинаковой целью → возвращает её ID с confidence.
3. Если нет — LLM анализирует title+description + список активных целей организации и предлагает.

### Расширение `strategic-alignment` воркера

Существующий воркер (из phase-9) расширяется:
- Дополнительно считает прогресс цели через привязанные Issue:
  - `total_linked_issues`, `completed`, `in_progress`, `not_started`
  - `time_progress_ratio` = (today - goal.startDate) / (goal.dueDate - goal.startDate)
  - `issue_progress_ratio` = completed / total_linked_issues
  - `alignment_score` = (issue_progress / time_progress) * 100 (если < 80 → отстаём)

- Сохраняет snapshot в `Goal.progressSnapshot Json`.

### Probe-trigger «80% задач не привязаны к целям»

- Cron `0 6 * * MON` — проверяет для каждого активного пользователя процент задач с `goalId == null`.
- Если ≥ 80% → `ProbeService.suggest({ type: 'goal_alignment_low', targetUserId })`.

## Метрики Prometheus

```
ai_issue_inferred_total{tenant, agent, accepted_or_rejected}
ai_intake_auto_accepted_total{tenant}
ai_meeting_actions_extracted_total{tenant, accepted_count, total_count}
ai_similar_issues_search_total{tenant}
ai_issue_goal_suggested_total{tenant, accepted}
```

## DoD

- [x] 5 новых LlmTaskType зарегистрированы (`meeting-extract-actions`, `issue-infer-fields`, `intake-auto-triage`, `issue-goal-suggest`, плюс расширение `chat-v2-synthesize`) с тройной цепочкой
- [x] Embeddings на Issue работают, HNSW индекс создан
- [x] Автозадачи из встреч: после AI-отчёта появляются IntakeIssue с suggested-полями
- [x] AI-suggest при создании задачи: toast с предложением через 1-2 сек после Enter
- [x] Похожие задачи на странице задачи отображаются
- [x] AI-чат отвечает на вопросы про задачи (e2e тест)
- [x] Auto-triage Intake: при confidence ≥ 0.92 + meeting источник → авто-создание Issue
- [x] Strategic alignment воркер учитывает задачи в прогрессе цели
- [x] Probe-trigger «goal_alignment_low» работает
- [x] Метрики Prometheus
- [x] Тесты: unit + integration (создание задачи → асинхронный suggest → toast)

## Срок

**4 человеко-недели.**

## Следующая фаза

[Фаза 4: РФ must-have](2026-05-23-tracker-phase-4-rf-musthave.md) — Telegram-бот, email-to-task, локализация.

---

_2026-05-23: AI вшит в каждую точку взаимодействия. Не «пришит сбоку», а часть workflow._

## Ревизия от 2026-05-24

**Статус:** done
**Реализовано:**
- 5 LlmTaskType зарегистрированы в `llm-router.service.ts` (issue-infer-fields, issue-goal-suggest, meeting-extract-actions, intake-auto-triage + расширение chat-v2-synthesize); seed-маршруты в `seed-llm-task-routes-tracker-phase3.ts`/`*-phase3-c.ts`.
- `Issue.embedding vector(1536)` + HNSW индекс через `postgres-init.sql`; `issue-embed.worker.ts` + `IssueEmbedQueueService` генерируют embedding через `text-embedding-3-small`.
- KNN-похожие: `SimilarIssuesService` + `GET /issues/:id/similar` + frontend блок на странице задачи (`KnnSimilar` компонент).
- Авто-задачи из встреч: `MeetingExtractActionsService` создаёт `IntakeIssue` с suggested-полями после AI-отчёта; видимы в `/intake` и `/me/inbox`.
- AI-suggest при создании: `IssueInferFieldsService` + toast после Enter в Board.
- Auto-triage Intake: `IntakeAutoTriageWorker` + `IntakeAutoTriageQueueService`; при confidence ≥ 0.92 + source=meeting → авто-Issue.
- `IssueGoalSuggestService` (KNN + LLM fallback); `GoalAlignmentLowCron` (понедельник 06:00 UTC) probe-trigger.
- CardSpecialist для Issue/Project зарегистрирован в `chat-v2/specialists/` — задачи отвечают в AI-чате.
- Метрики Prometheus + 13+ unit/integration тестов.

**Коммиты:** 1c49eea, c8d6ecc, 7c036b0 (Agent A/B/C/H iteration).
