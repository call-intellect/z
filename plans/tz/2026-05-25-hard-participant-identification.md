---
status: draft
owner: TBA (передаём агенту)
created: 2026-05-25
type: feature
depends-on: —
related-modules: knowledge-core, ai, participants, tasks
---

# Жёсткая идентификация участников встречи (User.id вместо matching by name)

## 0. Кратко

Сейчас AI извлекает задачи из транскрипта и записывает в `Task.assigneeRaw` строку («Иван», «Маркетинг»). Поле `Task.assigneeUserId` в Prisma **уже есть**, но **никогда не заполняется** — ни в `meeting-analyze-v2.worker`, ни в `tasks-extract.worker`. При этом host'ы заходят в LiveKit с identity `host:<userId>`, и `Participant.userId` хранится в БД. То есть жёсткая связь технически доступна, но не доходит до AI и до Task'ов.

Решение: передавать в AI-промпт extraction список участников с `userId`, просить LLM возвращать `assigneeUserId` когда это «свой» (registered), а на выходе ещё дополнительно резолвить `assigneeRaw → userId` через имена участников встречи (fallback).

Гости (нет User.id) — остаются строкой; на vNext возможен матчинг по email из календаря, но **не в этой задаче**.

## 1. Основание

Аудит на 2026-05-25 (агент-исследователь):

- [backend/prisma/schema.prisma](../../backend/prisma/schema.prisma) — `Participant.userId String?` (опц., заполняется для host'ов), `Participant.livekitIdentity` хранит `host:<userId>` или `guest:<nanoid>`.
- [backend/prisma/schema.prisma](../../backend/prisma/schema.prisma) — `Task.assigneeRaw String?` + `Task.assigneeUserId String?` — оба поля уже объявлены.
- `grep assigneeUserId backend/src/modules/{knowledge-core,ai}` → **0 совпадений.** Поле не заполняется.
- [backend/src/modules/ai/workers/tasks-extract.worker.ts](../../backend/src/modules/ai/workers/tasks-extract.worker.ts) — пишет только `assigneeRaw`.
- [backend/src/modules/knowledge-core/workers/meeting-analyze-v2.worker.ts](../../backend/src/modules/knowledge-core/workers/meeting-analyze-v2.worker.ts) — пишет только `assigneeRaw`.
- [backend/src/modules/ai/services/prompts/tasks-unified.ts](../../backend/src/modules/ai/services/prompts/tasks-unified.ts) и [backend/src/modules/knowledge-core/prompts/tasks-v2.prompt.ts](../../backend/src/modules/knowledge-core/prompts/tasks-v2.prompt.ts) — на вход НЕ передаётся список участников с userId, поэтому LLM физически не может вернуть `assigneeUserId`.
- [backend/src/modules/ai/services/behavior-metrics-calculator.ts:253-268](../../backend/src/modules/ai/services/behavior-metrics-calculator.ts) — единственное место, где сейчас матчинг идёт по `livekitIdentity` (жёстко) с fallback на `displayName` (мягко). Это эталон того подхода, который надо распространить на задачи.
- [backend/src/modules/participants/participants.service.ts:98-143](../../backend/src/modules/participants/participants.service.ts) — `livekitIdentity = "host:${userId}"` для зарегистрированных, `"guest:${nanoid()}"` для гостей.

Жалоба пользователя: «AI сейчас сопоставляет сотрудников ПРОСТО ПО ИМЕНАМ, хотя если человек зарегистрирован — у него есть свой userId. Мы должны жёстко понимать, кто что». Это не гипотеза, это подтверждённый аудитом баг продукта.

## 2. Цель

После реализации:

- В `Task.assigneeUserId` стоит реальный `User.id` для каждого случая, когда исполнитель — зарегистрированный сотрудник, **на котором есть аудио-дорожка в этой встрече** или который **явно упомянут именно как участник**.
- В `Task.assigneeRaw` сохраняется как и раньше — строка из транскрипта, для UI fallback и для гостей.
- UI задач может показывать User-аватар, ссылку на профиль, фильтрацию «мои задачи», когда `assigneeUserId` известен.
- Граф знаний (`Entity` для участников) опционально получает `userId` (см. §4.5 — отдельная подзадача, can-skip в этой волне).

## 3. Архитектурное решение

### Сейчас

```
LiveKit join (host:userId)
  → Participant{userId, name, livekitIdentity}
       → транскрипт (только speakerName — строка)
            → AI-prompt (только dialog/blocks, БЕЗ списка участников с userId)
                 → Task{assigneeRaw="Иван"}   ← assigneeUserId всегда null
```

### Станет

```
LiveKit join (host:userId)
  → Participant{userId, name, livekitIdentity}
       → транскрипт
            → AI-prompt (теперь ДОПОЛНИТЕЛЬНО получает participants[])
                 → LLM возвращает {assigneeRaw, assigneeUserId | null}
                      → TaskAssigneeResolver (fallback по имени, если LLM не вернул)
                           → Task{assigneeRaw="Иван", assigneeUserId="user_abc"}
```

Принцип жёсткости — как в [behavior-metrics-calculator.ts](../../backend/src/modules/ai/services/behavior-metrics-calculator.ts):
1. Если LLM вернул `assigneeUserId` И этот User.id есть в списке participants встречи → принимаем.
2. Если LLM вернул только `assigneeRaw` → резолвер ищет точное совпадение имени в participants (case-insensitive). Если ровно один матч с непустым `userId` → ставим userId.
3. Если матчей >1 (два «Сергея») → `assigneeUserId = null`, оставляем только `assigneeRaw` + лог-warning + метрика `z_task_assignee_ambiguous_total`.
4. Если матч 0 (имя не в участниках — гость, упомянутый в речи, или вообще роль типа «маркетинг») → `assigneeUserId = null`.

## 4. Конкретные изменения

### 4.1 Контракт `ParticipantContext` для AI-промптов

Файл: `backend/src/modules/ai/services/prompts/participant-context.ts` (создать).

```typescript
export interface AiParticipantContext {
  /** "host:<userId>" или "guest:<nanoid>" — стабильный ключ из LiveKit */
  livekitIdentity: string;
  /** Display name как ввёл пользователь — то же, что speaker в транскрипте */
  displayName: string;
  /** Заполнено только для зарегистрированных сотрудников */
  userId: string | null;
  /** Полное имя из User (если зарегистрирован) — для подсказки LLM */
  fullName: string | null;
  /** 'host' | 'guest' */
  role: 'host' | 'guest';
}
```

Конструктор + сервис `ParticipantContextService`:
- `loadForMeeting(meetingId): Promise<AiParticipantContext[]>` — джойнит `Participant` + `User` (по `Participant.userId`), возвращает плоский список.
- Покрыт unit-тестами: пустой список, только host, host+guest, два сотрудника с одинаковым display name.

### 4.2 Передача контекста в промпты задач

#### 4.2.1 `tasks-v2.prompt.ts` (knowledge-core)

[backend/src/modules/knowledge-core/prompts/tasks-v2.prompt.ts](../../backend/src/modules/knowledge-core/prompts/tasks-v2.prompt.ts):

- Добавить в `BuildArgs`: `participants: AiParticipantContext[]`.
- В системный промпт добавить блок:
  ```
  Участники этой встречи (используй для жёсткой идентификации исполнителя):
  - "Анна Иванова" (userId=user_abc, role=host)
  - "Сергей" (userId=user_def, role=host)
  - "Иван (гость)" (userId=null, role=guest)
  
  Правила:
  - Если в речи прозвучало имя, точно совпадающее с участником из списка с непустым userId,
    в поле assigneeUserId верни ЭТОТ userId.
  - Если совпадений >1 или имя — это роль/команда («маркетинг»), assigneeUserId = null.
  - assigneeRaw возвращай всегда — это исходная фраза из транскрипта.
  ```
- В tool-схему `tasks_v2` добавить `assigneeUserId: z.string().nullable()`.

#### 4.2.2 `tasks-unified.ts` (ai/prompts) и его structured-вариант

[backend/src/modules/ai/services/prompts/tasks-unified.ts](../../backend/src/modules/ai/services/prompts/tasks-unified.ts) + [backend/src/modules/ai/services/prompts/tasks-structured.ts](../../backend/src/modules/ai/services/prompts/tasks-structured.ts):

- То же: `participants` в BuildArgs, блок в системном промпте, `assigneeUserId` в zod-схеме.

### 4.3 Сервис `TaskAssigneeResolverService`

Файл: `backend/src/modules/knowledge-core/services/task-assignee-resolver.service.ts` (создать).

API:
```typescript
resolve(
  rawTasks: Array<{ assigneeRaw: string | null; assigneeUserId: string | null }>,
  participants: AiParticipantContext[],
): Array<{ assigneeRaw: string | null; assigneeUserId: string | null; ambiguous: boolean }>
```

Алгоритм — см. §3 (4 ветки). Каждая ветка покрыта unit-тестом. На ambiguous-кейсе инкрементить метрику `z_task_assignee_ambiguous_total{tenant}`.

**Защита:** если LLM вернул `assigneeUserId`, но этого userId нет в списке participants встречи (галлюцинация) → сбрасываем в null + warning-лог. Это критично.

### 4.4 Подключение к воркерам

#### 4.4.1 `tasks-extract.worker.ts`

[backend/src/modules/ai/workers/tasks-extract.worker.ts](../../backend/src/modules/ai/workers/tasks-extract.worker.ts):
- Подгрузить `participants = await participantContextService.loadForMeeting(meetingId)`.
- Передать в `extractTasks({ ..., participants })`.
- После LLM-ответа пропустить через `taskAssigneeResolver.resolve(...)`.
- При сохранении в `prisma.task.create` записать `assigneeUserId` из резолвера.

#### 4.4.2 `meeting-analyze-v2.worker.ts`

[backend/src/modules/knowledge-core/workers/meeting-analyze-v2.worker.ts](../../backend/src/modules/knowledge-core/workers/meeting-analyze-v2.worker.ts):
- То же: participants → prompt → resolver → save.

### 4.5 (Опционально) Entity для участников

Подзадача, **которую можно сделать отдельной волной** — НЕ блокирует основную задачу.

В `block-ingest` сейчас создаются `Entity` для упомянутых людей. Когда `Entity.canonicalName` совпадает с display name участника с известным `userId` — добавлять `Entity.userId = userId` (нужно добавить новое поле в schema).

Это нужно для:
- Drill-down «все встречи и задачи Сергея» по графу.
- Связи Person ↔ User (сейчас `Entity.persons` есть, но без User).

Если делаем — добавить в `Entity`:
```prisma
userId  String?
user    User?  @relation(...)
```

**В этой волне — пропускаем.** Будет отдельный план, если пользователь подтвердит приоритет.

### 4.6 Prisma — изменения

В этой задаче изменения Prisma **минимальные или нулевые**:
- `Task.assigneeUserId` — уже есть.
- `Task.assignee` (relation на User) — проверь, есть ли. Если нет — добавить:
  ```prisma
  assignee  User?  @relation("TaskAssignee", fields: [assigneeUserId], references: [id], onDelete: SetNull)
  ```
  и в `User` симметричное `assignedTasks Task[] @relation("TaskAssignee")`.
- Применить через `bun run prisma:push && bun run prisma:generate` (НЕ migrate, см. skill `prisma-db-push-rules`).

### 4.7 API + UI (минимально)

В этой волне UI **не трогаем** — только backend. Но:
- В DTO ответа `TaskResponseDto` уже наверняка есть `assigneeUserId` (раз поле было в schema). Проверь — если нет, добавь как `string | null` без break-changes.
- Если есть GraphQL/REST-сериализатор — он должен возвращать `assignee.id, assignee.fullName, assignee.avatarUrl` (lazy join) для UI.

UI-задача (отдельный план): аватар и фильтр «мои задачи» — **не в этой волне**.

## 5. Фазы реализации

### Фаза 1 — Контракт + сервис participants (1 час)
- [ ] Создать `participant-context.ts` (тип + сервис).
- [ ] Unit-тест: 4 кейса (пусто / только host / host+guest / два host с одинаковым name).

### Фаза 2 — Резолвер (1-2 часа)
- [ ] Создать `task-assignee-resolver.service.ts`.
- [ ] Unit-тест: 6 кейсов (LLM вернул валидный userId / LLM вернул userId не из списка / только assigneeRaw, точный матч / совпадений 2 / совпадений 0 / participants пустые).
- [ ] Метрика `z_task_assignee_ambiguous_total`.

### Фаза 3 — Промпты (1-2 часа)
- [ ] `tasks-v2.prompt.ts`: BuildArgs + блок в системном промпте + tool-схема.
- [ ] `tasks-unified.ts` + `tasks-structured.ts`: то же.
- [ ] Snapshot-тесты builder'ов.

### Фаза 4 — Воркеры (1-2 часа)
- [ ] `tasks-extract.worker.ts`: подгрузка participants + резолвер + save assigneeUserId.
- [ ] `meeting-analyze-v2.worker.ts`: то же.

### Фаза 5 — Prisma и DTO (30 минут)
- [ ] Проверить наличие relation `Task.assignee → User`, добавить если нет.
- [ ] `bun run prisma:push && bun run prisma:generate`.
- [ ] `TaskResponseDto.assigneeUserId` — проверить, что отдаётся.

### Фаза 6 — Регрессионный smoke (1 час)
- [ ] На любой dev-встрече с двумя зарегистрированными участниками: задачи получают `assigneeUserId` для прямых обращений по имени.
- [ ] Логи: ambiguous-метрика по факту инкрементилась.
- [ ] `bun run typecheck && bun run lint && bun run test:unit` зелёные.

### Фаза 7 — Обновление second-brain (30 минут)
- [ ] [01_projects/ai-jobs.md](../../second-brain/01_projects/ai-jobs.md) — добавить упоминание ParticipantContext + TaskAssigneeResolver.
- [ ] [02_architecture/data-model.md](../../second-brain/02_architecture/data-model.md) — пометить, что `Task.assigneeUserId` теперь активно используется.
- [ ] Добавить новый файл `01_projects/participant-identification.md` с описанием подхода.

## 6. Acceptance criteria

- [ ] На 10 dev-встречах с зарегистрированными участниками доля задач с заполненным `assigneeUserId` ≥ 80% (когда имя в `assigneeRaw` совпадает с участником встречи).
- [ ] Метрика `z_task_assignee_ambiguous_total` инкрементируется на тестовом кейсе «два Сергея».
- [ ] Гость (без User.id) не получает фейковый `assigneeUserId` — остаётся null.
- [ ] LLM-галлюцинация `assigneeUserId` (User вне встречи) отрезается резолвером, в warning-лог.
- [ ] `bun run typecheck && bun run lint && bun run test:unit` зелёные.
- [ ] Никаких изменений в `Issue`/Tracker-модуле — это другой домен (он уже использует `assigneeUserId` правильно).

## 7. Что НЕ делать

- НЕ трогать Tracker/Issue — это другой модуль, у него своя логика и не пересекается с knowledge-core/Task.
- НЕ менять `Participant.userId` логику захода в LiveKit — она работает.
- НЕ делать матчинг гостей по email/calendar — отдельный план vNext.
- НЕ добавлять `Entity.userId` (см. §4.5) — отдельная подзадача.
- НЕ менять UI задач — только backend.
- НЕ делать post-hoc сопоставление для исторических задач (`assigneeUserId = null` на старых) — backfill отдельным скриптом, если потребуется.

## 8. Риски и митигация

| Риск | Митигация |
|---|---|
| LLM возвращает чужой `userId` (галлюцинация) | Резолвер сверяет с participants и отрезает невалидное. Покрыто тестом. |
| Два сотрудника с одинаковым display name | Резолвер ставит null + ambiguous-метрика. UI покажет `assigneeRaw` и предложит ручной выбор (vNext). |
| Промпт стал длиннее → возможно подорожание | participants — это компактный JSON-блок, обычно 5-10 строк. Прирост <100 токенов на запрос. Замерить `AiUsageLog` после Фазы 4. |
| Конфликт с волной `meeting-report-fast` | Не пересекается: эта волна правит `tasks-v2` и `tasks-unified`, та — создаёт новый `meeting-report-fast.prompt.ts`. На всякий случай — мержить в порядке: сначала meeting-report-fast, потом эта. |
| `Task.assignee` relation отсутствует и `bun run prisma:push` упадёт | Сначала read schema, потом patch, потом push. Тест на dev-БД. |

## 9. Артефакты-эталоны

- Жёсткий + мягкий матчинг: [behavior-metrics-calculator.ts:253-268](../../backend/src/modules/ai/services/behavior-metrics-calculator.ts) — копировать паттерн `byIdentity` + `byName`.
- LiveKit identity convention: [participants.service.ts:98-143](../../backend/src/modules/participants/participants.service.ts).
- Текущая Task-extraction цепочка (что меняем): [tasks-extract.worker.ts](../../backend/src/modules/ai/workers/tasks-extract.worker.ts), [meeting-analyze-v2.worker.ts](../../backend/src/modules/knowledge-core/workers/meeting-analyze-v2.worker.ts).

## 10. Передача агенту

Этот файл — самодостаточное ТЗ. Агент:
1. Читает ТЗ целиком.
2. Вызывает skills: `core-engineering-standards`, `nestjs-rules`, `z-ai-agent-rules`, `prisma-db-push-rules`.
3. Идёт по фазам 1→7 строго по порядку. После каждой фазы — `bun run typecheck && bun run lint`.
4. На развилках — спрашивает у пользователя (особенно по §4.7 — нужны ли relation/DTO правки прямо сейчас).
5. В финальный отчёт обязательно: список изменённых файлов, `git status`, `git diff --stat`, результат typecheck/lint/test:unit.
6. НЕ КОММИТИТ. Решение о коммите — после факт-чека пользователем.
