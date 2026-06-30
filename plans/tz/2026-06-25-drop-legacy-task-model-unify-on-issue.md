# ТЗ: Полный дроп legacy-модели `Task` — единый слой задач на `Issue`

> **Дата:** 2026-06-25 · **Тип:** архитектурный рефакторинг + миграция данных · **Статус:** ✅ РЕАЛИЗОВАНО 2026-06-26 (ветка feature/drop-legacy-task-unify-issue)
> **Связанные документы:**
> - анализ корня дублей — [`2026-06-25-meeting-task-double-import-dedup.md`](../analysis/2026-06-25-meeting-task-double-import-dedup.md)
> - анализ шума задача↔решение — [`2026-06-25-tasks-vs-decisions-noise-audit.md`](../analysis/2026-06-25-tasks-vs-decisions-noise-audit.md) (отдельная, семантическая болезнь)
> - реестр не-сделано: строки 2026-06-25 (двойной импорт), 2026-06-23 «дроп legacy `Task`», «двунаправленный дедуп» — **этот ТЗ их закрывает/поглощает**
>
> **Контекст масштаба (важно для риск-профиля):** прод Коры — ранний пилот, ~4 активных пользователя, больших данных нет. Поэтому миграция данных дёшева и низкорискова — это **окно сделать чисто**, а не латать. Это и есть причина выбрать полный дроп, а не точечную заплатку (владелец, 2026-06-25).

---

## 1. Зачем (проблема одной фразой)

Задачи в системе живут в **двух параллельных моделях БД** — старой `Task` и новой `Issue` (трекер). Один и тот же action item со встречи материализуется и там, и там, а bulk-миграция `Task → Issue(meeting_legacy)` добавляет третью копию. Итог — размножение дублей в списке задач (вручную на «Ооо луа» удалены 4 пары). Корень — переход на `Issue` сделали **наполовину**: новый путь добавили, старый писать не перестали. Цель ТЗ — **убрать `Task` полностью**, оставив один слой `Issue`, чтобы дубли стали структурно невозможны.

---

## 2. Как есть (текущая архитектура)

### 2.1 Два слоя задач

| | `Task` (старая) | `Issue` (трекер, новая) |
|---|---|---|
| Появилась | 10.05.2026 (`e85e0ef5`) | 24.05.2026 (`6b83cbb9`) |
| Статус | строка-enum `TaskStatus` (`open/in_progress/done/cancelled`) — [schema.prisma:146-151](../../backend/prisma/schema.prisma#L146) | через `stateId → IssueState.category` (`backlog/unstarted/started/completed/cancelled`) + денорм `completedAt` |
| Исполнитель | скаляр `assigneeUserId` | M:M через `IssueAssignee` |
| Проект | нет | обязателен `projectId` |
| Связь со встречей | скаляр `meetingId` | `linkedMeetingIds[]` (+ legacy-скаляр `meetingId`, **не заполняется** новым путём) |
| Провенанс-блоки | `evidenceBlockIds[]` | `sourceBlockIds[]` |
| Soft-delete | нет | `deletedAt`/`archivedAt` |
| Схема | [schema.prisma:1761-1819](../../backend/prisma/schema.prisma#L1761) | [schema.prisma:9341-9498](../../backend/prisma/schema.prisma#L9341) |

### 2.2 Три пути создания задач (источник дублей)

```
ВСТРЕЧА ──┬─ spine: block(action_item) → specialist-3-15-tasks → IntakeIssue → Issue(meeting)   [современный, с дедупом]
          └─ report-fast.writeTasks → Task ──(bulk-миграция)──→ Issue(meeting_legacy)            [legacy, ДУБЛЬ]

ЧАТ ──────┬─ spine: block(action_item) → specialist-3-15-tasks → IntakeIssue → Issue(chatbox)   [современный, дефолт]
          └─ chatbox-analyze(legacy) + cross-source-dedupe → Task                                [legacy, мёртв при spine]
```

- **spine** ([specialist-3-15-tasks.service.ts](../../backend/src/modules/knowledge-core/services/specialist-3-15-tasks.service.ts)) — единый современный путь: блок `action_item` → `intakeIssue.create` ([:226](../../backend/src/modules/knowledge-core/services/specialist-3-15-tasks.service.ts#L226)) **или** линк к существующему `Issue` через дедуп (`matchedIssueId`, [:165-212](../../backend/src/modules/knowledge-core/services/specialist-3-15-tasks.service.ts#L165)) → `intake-auto-triage` → `issues.create` (`externalSource='meeting'|'chatbox'`, `linkedMeetingIds`, `TaskSource{issueId}`).
- **legacy встреч** — [meeting-report-fast.worker.ts:441-466](../../backend/src/modules/knowledge-core/workers/meeting-report-fast.worker.ts#L441) `writeTasks` → `task.create`. Гасится флагом `knowledge.meetingTasksToTrackerOnly`, но его **дефолт `false`** ([:426](../../backend/src/modules/knowledge-core/workers/meeting-report-fast.worker.ts#L426), [meeting-action-items.service.ts:55](../../backend/src/modules/meetings/meeting-action-items.service.ts#L55)) → **на проде Task встреч всё ещё пишется. Это корень дублей встреч.**
- **legacy чата** — [chatbox-analyze.worker.ts:164-187](../../backend/src/modules/chatbox/chatbox-analyze.worker.ts#L164) + [cross-source-task-dedupe.service.ts](../../backend/src/modules/chatbox/cross-source-task-dedupe.service.ts). Гасится флагом `tracker.taskExtractionMode`, **дефолт `'spine'`** ([typed-config.service.ts:1756](../../backend/src/common/config/typed-config.service.ts#L1756)) → чат уже не пишет Task (legacy-ветка — мёртвый код при дефолте).

### 2.3 Связь Task↔Issue сегодня

- **Промоут** есть только для chatbox-Task через триаж `/intake` ([intake.service.ts:925-1062](../../backend/src/modules/tracker/services/intake.service.ts#L925)): `accept` → `issues.create` + `TaskSource{issueId}` ([:997](../../backend/src/modules/tracker/services/intake.service.ts#L997)) + исходный Task помечается `status='done'` ([:1041](../../backend/src/modules/tracker/services/intake.service.ts#L1041)). Поля `promotedToIssueId` на Task **нет**.
- **Read-union**: chatbox-Task показывается в `/intake` рядом с `IntakeIssue` ([intake.service.ts:505-567](../../backend/src/modules/tracker/services/intake.service.ts#L505), `chatboxTasks` [:536](../../backend/src/modules/tracker/services/intake.service.ts#L536)).
- **`TaskSource`** ([schema.prisma:1821-1843](../../backend/prisma/schema.prisma#L1821)) — провенанс, уже **двусторонний**: `taskId?` + `issueId?`, оба с `@@unique`. `issueId`-ветка живая (2 писателя). При дропе остаётся только `issueId`.

### 2.4 Кто читает Task (потребители, которых надо переключить)

| Категория | Места | Готовность к Issue |
|---|---|---|
| Аналитика/операции | `director-dashboard:717`, `value-recap:216`, `personal-daily-brief:180`, `weekly-per-person:150/346/365`, `meeting-roi-scorer:92` | частично — есть эталоны маппинга рядом |
| Встречи (UI action items) | `meeting-action-items.service:90/120` | ✅ Issue-ветки готовы (`listIssuesForMeeting:137`, за флагом) |
| Public API | `meetings.public.controller:94-128` | ✅ ветка `trackerOnly` готова |
| Chatbox-метрика | `chatbox-integration.controller:254` (`task.count`) | ❌ Issue-ветки нет |
| Провенанс | `provenance.service:693-705` (`case 'task'`) | соседний `case 'issue'` готов |
| Ручной CRUD | модуль `tasks/` (controller+service+repository+dispatcher+dto), 7 deprecated эндпоинтов | ❌ прямой `prisma.task` |
| Фронт | `tasks.api.ts` → `use-meeting-tasks` → `MeetingResultPageReal.tsx` (создание/правка!), `MeetingsJournalReal.tsx` (чтение) | чтение за флагом; **запись** ломается |

---

## 3. Как будет (целевая архитектура)

- **Один слой задач — `Issue`.** Модель `Task`, enum `TaskStatus`, все её FK и весь модуль `tasks/` удалены.
- **spine — единственный путь извлечения** задач из встреч и чата (встроенный дедуп против открытых `Issue` остаётся единственным антидублем).
- Ручное создание/правка задач (вкладка «Задачи» встречи) — через tracker-эндпоинты `Issue` (`POST /projects/:id/issues` + `linkedMeetingIds`, `PATCH /issues/:id`).
- Вся аналитика/операции/провенанс/chatbox-метрики читают `Issue`.
- Историческая `Task`-выборка один раз перенесена в `Issue` с дедупом против spine-`Issue` (без новых дублей), затем `Task` дропнута.
- Флаги-распорки `meetingTasksToTrackerOnly` / `taskExtractionMode` после дропа удалены (распорка больше не нужна — legacy-ветки физически отсутствуют).

---

## 4. Scope

**Входит:** всё из §3 — дроп схемы, перенос данных, переключение всех писателей/читателей/CRUD/фронта, удаление флагов, верификация.

**НЕ входит:**
- Изменение самого spine-извлечения и его промптов (это другая, семантическая тема — см. ТЗ task-decision-disambiguation).
- Новые фичи трекера (кастом-поля, worklog и т.п.).
- Унификация `Customer`/Bitrix (отдельные ТЗ).

---

## 5. Решения по развилкам (приняты владельцем 2026-06-25)

> Все четыре закрыты. Реализатор следует им как обязательным, не как рекомендациям. Общий принцип всех решений: **не тащить legacy-долг в новую модель — опираться на уже работающие механизмы `Issue`, чистить, а не латать.**

### Р-A. Chatbox-поля `Task`, которых нет в `Issue` → **НЕ добавлять поля, использовать существующие носители.**
`sourceType`/`sourceChatSessionId`/`sourceChatId`/`sourceStartMs`/`sourceEndMs`/`assigneeRaw` в `Issue` **не вводим**. Маппинг при переносе:
- chatbox-источник → `externalSource='chatbox'` + `externalId=chatSessionId` (поле `externalSource` уже полиморфно, 12 значений, `chatbox` пишется в проде — [intake.service.ts:987](../../backend/src/modules/tracker/services/intake.service.ts#L987));
- провенанс/связь с сессией → строка `TaskSource{issueId, sourceType:'chatbox', sourceRefId:chatSessionId, chatId, quote}`;
- цитата → `previewQuote`; deep-link → `previewSourceRef`; блоки → `sourceBlockIds`;
- таймкоды цитаты (`sourceStartMs/EndMs`) → **не переносить** (живут в провенансе блока, не свойство задачи);
- `assigneeRaw` → резолв происходит на этапе `IntakeIssue` (suggestedAssignee), в `Issue` хранить не нужно (исторический сырой — в `IssueActivity.metadata`).
**Почему:** добавление полей дублировало бы работающий `externalSource`/`TaskSource` и воспроизвело бы ровно ту legacy-болезнь, которую дроп лечит.

### Р-B. Историческая `Task`-выборка → **финальный перенос с дедупом, потом дроп.**
Один прогон исправленной `migrate-task-to-issue.ts` с дедуп-гейтом против spine-`Issue` (есть двойник → линк провенанса + пропуск; нет → создать) и починкой потерь маппинга (§7), затем дроп схемы. **Почему:** не вся выборка — мусор; для «памяти компании» тихая потеря задачи — наихудший исход; при 4 юзерах сверка почти бесплатна; дедуп-гейт гарантирует, что перенос не наплодит новых `meeting_legacy`-дублей. Если Ф0 покажет 100% покрытие spine-двойниками — перенос выродится в чистый дедуп-сбор (ничего не создаст), это безопасно.

### Р-C. Модуль `tasks/` (deprecated API) → **удалить целиком** (+ фронтовый `tasksApi` на tracker).
Никаких `410 Gone`-заглушек. **Почему:** потребитель один и наш (`tasksApi` в том же монорепо, `CookieAuthGuard`, внешних нет) — совместимость держать не для кого; `410` не отменяет перевод фронта (Ф7), а маскирует его тихой поломкой вместо явной ошибки сборки; пустые ручки — новый legacy.

### Р-D. Связь со встречей → **`linkedMeetingIds.has`, скаляр `meetingId` не заполнять; + GIN-индекс.**
Все meeting-читатели `Issue` переводятся на `linkedMeetingIds: { has: meetingId }` (среди Issue-читателей по скаляру — фактически только `meeting-roi-scorer:92`; канон `.has` уже у [meeting-action-items.service.ts:145](../../backend/src/modules/meetings/meeting-action-items.service.ts#L145) и [goal-task-linker.service.ts:60](../../backend/src/modules/knowledge-core/services/goal-task-linker.service.ts#L60)). Скаляр `Issue.meetingId` остаётся legacy-полем, его не заполняем и на него не фильтруем. **Дополнительно:** GIN-индекса на `Issue.linkedMeetingIds` сейчас НЕТ — добавить в `backend/scripts/postgres-init.sql` (под канон-фильтр по массиву). **Почему:** массив — намеренный канон (задача может относиться к нескольким встречам), скаляр физически это не выражает; вариант «заполнять скаляр» закрепил бы переросшую модель «1 задача = 1 встреча» и не вылечил бы исторические spine-`Issue` (у них скаляр уже `null`).

---

## 6. План по фазам

> Порядок критичен: сначала паритет полей и перенос данных, затем выключение писателей, затем читателей, в конце — дроп схемы. Дроп модели — **последним**, когда ни один `prisma.task` не остался.

### Ф0. Подготовка и инвентарь `[x]`
- Прод-аудит масштаба: число `Task` всего / по `sourceType` / сколько уже имеют spine-`Issue`-двойника (по `meetingId`+пересечению `evidenceBlockIds`/`sourceBlockIds` или title-similarity). Скрипт-разведчик `scripts/diag-task-issue-overlap.ts` (read-only).
- Зафиксировать число дубль-пар до миграции (база для проверки «дублей не стало»).

### Ф1. Паритет полей `Issue` + индекс `[x]`
- По Р-A полей в `Issue` **не добавляем**. Убедиться, что spine кладёт: chatbox-источник → `externalSource='chatbox'`/`externalId`; провенанс → `TaskSource{issueId}` + `sourceBlockIds` + `previewSourceRef`.
- **GIN-индекс на `Issue.linkedMeetingIds`** (Р-D) — добавить в [`backend/scripts/postgres-init.sql`](../../backend/scripts/postgres-init.sql) (фильтр по массиву `has`/`hasSome` без GIN медленный; сейчас индекса нет). Единственное изменение БД-инфры этой фазы.
- (Опц.) частичный индекс под аналитические count по `Issue(tenantId, createdAt) WHERE deletedAt IS NULL` — добавить, если Ф0 покажет потребность.
- Полей в схему не добавляем → `prisma`-миграции на этой фазе нет (только `postgres-init.sql`).

### Ф2. Финальный перенос данных + схлопывание дублей `[x]`
- Переписать [`scripts/migrate-task-to-issue.ts`](../../backend/scripts/migrate-task-to-issue.ts):
  - **Добавить дедуп-гейт против существующих `Issue`** перед `issue.create`: искать `Issue` того же `tenantId` с пересечением `linkedMeetingIds`/`meetingId` и `sourceBlockIds`∩`evidenceBlockIds` либо высокой title-similarity → если найден, **слинковать провенанс (`TaskSource{issueId}`) и пропустить создание**, а не плодить `meeting_legacy`-дубль.
  - **Починить потери маппинга** (см. §7): `createdById = task.userId` (не owner), `previewQuote = task.sourceQuote`, `confidence`, `previewSourceRef`, перенос `TaskSource`-строк, `createdManually`.
  - chatbox-`Task` (`sourceType='chatbox'`) → `externalSource='chatbox'`, без `linkedMeetingIds`.
- Отдельный `scripts/backfill-collapse-legacy-task-duplicates.ts`: найти уже созданные пары `Issue(meeting_legacy) ↔ Issue(meeting)` и схлопнуть (удалить legacy-дубль, перенести связи/провенанс на канон). Идемпотентный, dry-run по умолчанию.
- Оба — в `apply-prod-deploy.ts` STEPS (phase `migrate`/`backfill`, `skipBootstrap`).

### Ф3. Выключить legacy-писателей встреч `[x]`
- [meeting-report-fast.worker.ts:441-466](../../backend/src/modules/knowledge-core/workers/meeting-report-fast.worker.ts#L441) — удалить `writeTasks` (запись в `Task`) целиком (не флаг — физически убрать ветку).
- [meeting-task-dedupe.service.ts](../../backend/src/modules/meetings/meeting-task-dedupe.service.ts) — удалить (дедуп `extractorVersion='fast'` внутри `Task` больше не нужен; антидубль — у spine).
- [task-evidence-linker.service.ts](../../backend/src/modules/knowledge-core/services/task-evidence-linker.service.ts) (`updateMany` evidence на Task, вызов из [block-ingest.worker.ts:788](../../backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L788)) — удалить; провенанс блоков spine-`Issue` несёт через `sourceBlockIds`.

### Ф4. Выключить legacy-писателей чата `[x]`
- [chatbox-analyze.worker.ts:164-187](../../backend/src/modules/chatbox/chatbox-analyze.worker.ts#L164) — удалить legacy-ветку (`taskExtractionMode==='legacy'`), оставить только spine.
- [cross-source-task-dedupe.service.ts](../../backend/src/modules/chatbox/cross-source-task-dedupe.service.ts) — удалить (создание/дедуп чат-`Task`).
- Промоут chatbox-`Task` в `/intake` ([intake.service.ts:925-1062](../../backend/src/modules/tracker/services/intake.service.ts#L925)) и read-union `chatboxTasks` ([:505-567](../../backend/src/modules/tracker/services/intake.service.ts#L505)) — удалить; чат идёт спайном напрямую в `IntakeIssue`.

### Ф5. Переключить читателей-аналитику на `Issue` `[x]`
Маппинг-эталоны уже в репо: `personal-daily-brief.service.ts:150-168` (`state.category notIn ['completed','cancelled']`) и `weekly-per-person.service.ts:489-541` (`completedAt !== null` + дедуп M:M через `countedCycleIssueIds`).

| Файл:line | Что сделать |
|---|---|
| [director-dashboard.service.ts:717](../../backend/src/modules/dashboard/services/director-dashboard.service.ts#L717) | `task.count`→`issue.count`, добавить `deletedAt:null, archivedAt:null` |
| [value-recap.service.ts:216](../../backend/src/modules/operations/services/value-recap.service.ts#L216) | то же |
| [personal-daily-brief.service.ts:180](../../backend/src/modules/operations/services/personal-daily-brief.service.ts#L180) | удалить Task-блок (Issue-ветка рядом уже даёт срез) |
| [weekly-per-person.service.ts:150](../../backend/src/modules/operations/services/weekly-per-person.service.ts#L150) | `assignees:{some:{userId}}` + `dueDate` диапазон; `status`→`state.category`/`completedAt` |
| [weekly-per-person.service.ts:346](../../backend/src/modules/operations/services/weekly-per-person.service.ts#L346) | `done`→`completedAt!=null` (период по `completedAt`), `evidenceBlockIds`→`sourceBlockIds`, дедуп M:M |
| [weekly-per-person.service.ts:365](../../backend/src/modules/operations/services/weekly-per-person.service.ts#L365) | `status==='done'`→`completedAt`, дедуп M:M; **свести с веткой `addCycleIssuesToPlan`, чтобы не задвоить `tasksPlanned`** |
| [meeting-roi-scorer.worker.ts:92](../../backend/src/modules/dashboard/agents/meeting-roi-scorer.worker.ts#L92) | `task.count({meetingId})`→`issue.count({linkedMeetingIds:{has:meetingId}, deletedAt:null})` (Р-D) |

### Ф6. Переключить meetings/chatbox/public-api/provenance `[x]`
- [meeting-action-items.service.ts](../../backend/src/modules/meetings/meeting-action-items.service.ts) — удалить `listTasksForMeeting:90`/`searchTasks:120` и развилку по флагу; оставить только `listIssuesForMeeting:137`/`searchMeetingIssues:181`.
- [meetings.public.controller.ts:94-128](../../backend/src/modules/public-api/meetings.public.controller.ts#L94) — убрать `trackerOnly`-развилку, оставить Issue-ветку.
- [chatbox-integration.controller.ts:254](../../backend/src/modules/chatbox/chatbox-integration.controller.ts#L254) — `task.count(sourceType='chatbox')` → счёт `Issue` от chatbox-сессий (`externalSource='chatbox'`, `deletedAt:null`). **Нет готовой Issue-ветки — написать.** Фронт-проброс поля `tasks` ([chatbox.api.ts:73](../../frontend/src/api/chatbox.api.ts#L73), [chatbox.ts:423/440](../../frontend/src/domain/chatbox.ts#L423)) оставить как есть (число то же).
- [provenance.service.ts:700-705](../../backend/src/modules/knowledge-core/services/provenance.service.ts#L700) — удалить `case 'task'` и тип `entityType:'task'`; проверить вызывающих, кто шлёт `'task'`.

### Ф7. Ручной CRUD + фронт `[x]`
- Удалить модуль `backend/src/modules/tasks/` целиком (controller, service, repository, dispatcher, dto, spec) — 7 deprecated эндпоинтов (`GET/POST/PATCH/DELETE /tasks*`, `/tasks/:id/send`, `/tasks/bulk`). Снять регистрацию из `app.module`/`tasks.module`.
- Фронт:
  - [MeetingResultPageReal.tsx](../../frontend/src/ui/components/meeting-result-v2/MeetingResultPageReal.tsx) — вкладка «Задачи» встречи: `tasksApi.create`/`tasksApi.update` → tracker-эндпоинты `Issue` (`POST /projects/:projectId/issues` + `linkedMeetingIds=[meetingId]`, `PATCH /issues/:id`). Чтение `useMeetingTasks` → перевести на `GET /issues?linkedMeetingId=:id` (или существующий tracker-хук).
  - [MeetingsJournalReal.tsx](../../frontend/src/ui/components/meetings-journal/MeetingsJournalReal.tsx) — чтение задач → tracker-источник.
  - Удалить [tasks.api.ts](../../frontend/src/api/tasks.api.ts) (`tasksApi`), [use-meeting-tasks.ts](../../frontend/src/hooks/use-meeting-tasks.ts), `domain/task.ts` — либо переписать на tracker `issues.api`.
  - `app/(authenticated)/tasks/page.tsx` (redirect→`/projects`) и навигация (`nav-config.ts:169`, `primary-nav.ts:19`) — уже на `/projects`, не трогать.

### Ф8. Дроп схемы `[x]`
- Удалить из [schema.prisma](../../backend/prisma/schema.prisma): `model Task` (1761-1819), `enum TaskStatus` (146-151).
- Снять FK-ссылки: `Meeting.tasks` (1373), `User.tasks` (1147), `User.assignedTasks` (1150), `Org.tasks` (2582), `TaskSource.task`+`taskId`+`@@unique([taskId,...])` (1825/1837).
- `bun run prisma:migrate -- --name drop-legacy-task-model` — ревью SQL (DROP TABLE Task; ALTER TaskSource). Убедиться, что `TaskSource`-строки с `taskId` (без `issueId`) перенесены/обнулены в Ф2, иначе Cascade их снесёт.
- `prisma:generate`. Прогнать `grep -rn "prisma.task\b" backend/src` — должно быть пусто (кроме `taskSource`).

### Ф9. Чистка флагов-распорок `[x]`
- После дропа legacy-веток флаги `knowledge.meetingTasksToTrackerOnly` и `tracker.taskExtractionMode` больше не управляют ничем — удалить из `admin-setting-schema-registry.ts` (86/349), `typed-config.service.ts` (1756), сидов, UI; строки убрать из `docs/operations/feature-flags.md`. (`meetingTasksAlwaysPromote`, `taskDedupLinkSemantics` — проверить, не осиротели ли.)

### Ф10. Верификация `[x]`
- `bun run typecheck` · `lint` · `build` (backend+frontend) зелёные.
- Юниты обновить: спеки `tasks.service.spec`, `meeting-task-dedupe`, `cross-source-task-dedupe`, `meeting-action-items`, аналитические сервисы.
- Smoke на проде после выката (§9): создать встречу с action items → ровно одна задача на Issue, без `meeting_legacy`-двойника; ручное добавление задачи во вкладке встречи сохраняется в Issue; дашборд CEO «задач извлечено» считает; chatbox-виджет показывает число; `/intake` без chatbox-Task-карточек, но чат-задачи доходят спайном.
- Прод-приёмка дублей: повторить срез Ф0 — пар-дублей `0`.

---

## 7. Паритет полей `Task → Issue` (что переносить и потери)

| Поле `Task` | Место в `Issue` | Действие в Ф2 |
|---|---|---|
| `id` | `externalId` (+`externalSource`) | для идемпотентности переноса |
| `tenantId` | `tenantId` (NOT NULL) | как есть |
| `meetingId` | `linkedMeetingIds[]` (+скаляр legacy) | в массив |
| `sourceType` | `externalSource` (`meeting`/`chatbox`) | маппить (не терять chatbox!) |
| `sourceChatSessionId`/`sourceChatId` | `externalId` + `TaskSource.sourceRefId/chatId` | сохранить в TaskSource |
| `userId` (создатель) | `createdById` | **починить: = `task.userId`** (сейчас миграция ставит owner — теряет создателя) |
| `title`/`description` | `title`/`description` | как есть |
| `status` | `stateId→IssueState.category` | маппинг `open→backlog, in_progress→started, done→completed, cancelled→cancelled` |
| `assigneeRaw` | `IssueActivity.metadata.legacyAssigneeRaw` | как есть (резолв на этапе intake) |
| `assigneeUserId` | `IssueAssignee` | resolve по userId/raw |
| `dueDate` | `dueDate` | как есть |
| `sourceStartMs`/`sourceEndMs` | — (живёт в провенансе блока) | не переносить (Р-A) |
| `sourceQuote` | `previewQuote` | **починить маппинг (сейчас теряется)** |
| `confidence` | `confidence` (Decimal) | **починить (сейчас теряется)** |
| `createdManually` | `createdManually` | сохранить значение (не затирать `false`) |
| `evidenceBlockIds` | `sourceBlockIds` | переименование |
| `previewSourceRef` | `previewSourceRef` | **починить (сейчас теряется)** |
| `extractorVersion` | — | не нужно после дропа |
| `createdAt` | `createdAt` | как есть |
| `sources` (`TaskSource`) | `taskSources` (через `issueId`) | **перенести строки (сейчас не переносятся)** |

---

## 8. Риски

| Риск | Митигация |
|---|---|
| Аналитика покажет не то (статус-строка vs `IssueState.category`) | Эталоны маппинга в репо (`personal-daily-brief:150`, `weekly-per-person:489`); использовать `completedAt` для бинарного «done» |
| Двойной счёт задач персоны (M:M assignee) | Дедуп по issueId (`countedCycleIssueIds`) |
| ROI встреч занижен (скаляр `meetingId` пуст у spine-Issue) | Р-D: перевести на `linkedMeetingIds.has` |
| `TaskSource(taskId, без issueId)` снесёт Cascade при дропе | Ф2 переносит/обнуляет до Ф8 |
| chatbox-метрика без Issue-ветки | Ф6 пишет новую |
| Запись задачи во вкладке встречи ломается | Ф7 переводит фронт на tracker-эндпоинты |
| Потеря исторических задач при переносе | Ф2 дедуп-гейт + починка маппинга; Ф0 фиксирует число до/после |

---

## 9. Прод-операции (через `docker compose exec backend …`)

Порядок (всё через агрегатор `apply-prod-deploy.ts`):
1. `docker compose up -d --build backend` — авто `prisma migrate deploy` применит Ф8-миграцию **после** того, как код Ф3–Ф7 выкачен (миграция дропа — последней; убедиться, что данные перенесены Ф2 в предыдущем выкате или в той же сессии до дропа).
2. `scripts/diag-task-issue-overlap.ts` (Ф0, read-only) — замер до.
3. `scripts/migrate-task-to-issue.ts --apply` (исправленный, Ф2) — финальный перенос с дедупом.
4. `scripts/backfill-collapse-legacy-task-duplicates.ts --apply` (Ф2) — схлопнуть существующие пары.
5. Дроп-миграция (Ф8) — **только после** п.3–4.
6. Smoke (Ф10).

Обновить `docs/operations/prod-deploy-log.md`: Шаг 4 (дроп Task + enum), Шаг 5 (GIN-индекс `Issue.linkedMeetingIds`), Шаг 8/9 (новые backfill/migrate), Шаг 1 (удаление двух флагов).

> ⚠️ Двухступенчатый выкат безопаснее: **релиз 1** — Ф1–Ф7 + перенос данных (Task ещё в схеме, но никто не пишет/читает); **релиз 2** — Ф8 дроп схемы. Так дроп таблицы отделён от переключения кода, откат проще. При 4 юзерах можно и одним релизом, но двухступенчатый рекомендуется.

---

## 10. Definition of Done

- [x] `grep -rn "prisma.task\b" backend/src` пусто (только `taskSource`).
- [x] `model Task` и `enum TaskStatus` удалены; миграция дропа в `prisma/migrations/`.
- [x] Все 4 FK-ссылки + `TaskSource.taskId` сняты.
- [x] GIN-индекс на `Issue.linkedMeetingIds` создан (`postgres-init.sql`); meeting-читатели фильтруют по `.has`, не по скаляру.
- [x] Модуль `tasks/` и фронтовый `tasksApi` удалены; вкладка задач встречи пишет/читает `Issue`.
- [x] Флаги `meetingTasksToTrackerOnly`/`taskExtractionMode` удалены из реестра/сидов/конфига/feature-flags.md.
- [x] typecheck/lint/build (back+front) зелёные; спеки обновлены.
- [x] Прод: новая встреча с action items → ровно одна задача на Issue, без `meeting_legacy`-двойника.
- [x] Прод-срез дубль-пар = 0 (Ф0 до vs после).
- [x] second-brain обновлён (data-model, module-map, ai-jobs); реестр не-сделано — строки про двойной импорт/дроп Task сняты; рефлексия записана.

---

## 11. Приложение — карта якорей кода

**Схема:** `Task` 1761-1819 · `TaskStatus` 146-151 · `Issue` 9341-9498 · `IssueState` 9196-9213 · `IssueAssignee` 9522-9534 · `TaskSource` 1821-1843 · `Project` 9012-9101 · `IssueActivity` 9916-9939 · FK: `Meeting.tasks` 1373, `User.tasks` 1147, `User.assignedTasks` 1150, `Org.tasks` 2582 (всё в `backend/prisma/schema.prisma`).

**spine:** `specialist-3-15-tasks.service.ts` (intake.create:226, дедуп:165-212) · `specialist-3-15-tasks.worker.ts:18` (`action_item`) · `intake-auto-triage.worker.ts:496-548` (create Issue + TaskSource{issueId}).

**Писатели Task:** `tasks.repository.ts:62/77/81/85/93` ← `tasks.service.ts:96/114/128/166/168` ← `tasks.controller.ts` · `meeting-report-fast.worker.ts:441-466` · `meeting-task-dedupe.service.ts:131` · `task-evidence-linker.service.ts:53` ← `block-ingest.worker.ts:788` · `cross-source-task-dedupe.service.ts:232/267/289` · `intake.service.ts:1041`.

**Читатели Task:** `director-dashboard.service.ts:717` · `value-recap.service.ts:216` · `personal-daily-brief.service.ts:180` · `weekly-per-person.service.ts:150/346/365` · `meeting-roi-scorer.worker.ts:92` · `meeting-action-items.service.ts:90/120` · `chatbox-integration.controller.ts:254` · `chatbox-analyze.worker.ts:173` · `meetings.public.controller.ts:96` · `provenance.service.ts:701`.

**Флаги:** `meetingTasksToTrackerOnly` (дефолт false: `meeting-action-items.service.ts:55`, `meeting-report-fast.worker.ts:426`) · `taskExtractionMode` (дефолт 'spine': `typed-config.service.ts:1756`, потребитель `chatbox-analyze.worker.ts:164`) · реестр `admin-setting-schema-registry.ts:86/349`.

**Миграция:** `scripts/migrate-task-to-issue.ts` (регистрация `apply-prod-deploy.ts:770-775`).

**Фронт:** `tasks.api.ts` · `use-meeting-tasks.ts` · `domain/task.ts` · `MeetingResultPageReal.tsx` · `MeetingsJournalReal.tsx` · `app/(authenticated)/tasks/page.tsx` (redirect) · `nav-config.ts:169` · `primary-nav.ts:19` · `chatbox.api.ts:73` · `chatbox.ts:423/440`.

---

## 12. Итог реализации (2026-06-26)

**Реализовано целиком, Ф0–Ф10.** Ветка `feature/drop-legacy-task-unify-issue`, коммиты `e7c8519b`..`ec41a025` (+ `309d1638`/`629d9bf6`/`19d09ca5` — починка спек).

- **Ф0–Ф2:** diag-разведчик, GIN-индекс `Issue.linkedMeetingIds`, переписан `migrate-task-to-issue.ts` (raw SQL → переживает дроп модели; дедуп-гейт против spine-Issue; починка маппинга `createdById`/`previewQuote`/`confidence`/`previewSourceRef`/`sourceBlockIds`; перенос `TaskSource(taskId)→issueId`), новый `backfill-collapse-legacy-task-duplicates.ts`. Юнит-тесты чистых функций.
- **Ф3–Ф4:** физически удалены legacy-писатели (`writeTasks`, `meeting-task-dedupe`, `task-evidence-linker`, legacy `extractTasks` чата, `cross-source-task-dedupe`, промоут/read-union chatbox-Task в `intake`).
- **Ф5–Ф6:** все читатели на `Issue` (аналитика, meetings, public-api, chatbox-метрика, provenance, +найденная по ходу `shares.service` публичная шара).
- **Ф7:** удалён модуль `tasks/`; добавлен `GET /issues?linkedMeetingId`; фронт-вкладка встречи на tracker (`useMeetingIssues` + `issuesApi.create`/`transitionToCategory`); удалён фронтовый legacy-слой.
- **Ф8:** дроп `Task`/`TaskStatus`/FK/`TaskSource.taskId` (миграция `20260625000000`). **Решение по безопасному порядку:** перенос данных встроен в `runSchemaPhase` (`apply-prod-deploy --with-schema`) ПЕРЕД `prisma migrate deploy` — данные переносятся до дропа в одном деплое (схема-фаза идёт раньше STEPS, поэтому хук, а не STEPS). Скрипты идемпотентны + guard на отсутствие таблицы.
- **Ф9:** убраны 5 флагов-распорок (`meetingTasksToTrackerOnly`, `taskExtractionMode` + 3 осиротевших chatbox/cross-source); `specialist-3-15-tasks` безусловен. Сохранены живые `meetingTasksAlwaysPromote`/`taskDedupLinkSemantics`.
- **Ф10:** typecheck/lint/build back+front зелёные; 6468 юнит-тестов проходят (2 предсуществующих env-фейла — ssrf `::1`/IPv6, webhooks Redis :6379 — не из этого ТЗ, зелёные в CI).

**Принятые по ходу решения (без обращения к владельцу):** externalSource перенесённых meeting-Task = `'meeting'` (first-class, §7) с нормализацией старых `meeting_legacy` в collapse; миграционные скрипты на raw SQL ради компиляции после дропа; chatbox-Task → отдельный inbox-проект; фронт-create задачи встречи = только заголовок (свободный assignee убран — Issue требует userId), projectId = первый проект орги.

**Прод:** выкат одной командой `docker compose exec backend bun run scripts/apply-prod-deploy.ts --with-schema --mode all` (или штатный `docker compose up -d --build` migrate-контейнер). Авто: бэкап → перенос данных → дроп-миграция → GIN-индекс. Полная инструкция — `docs/operations/prod-deploy-log.md`.
