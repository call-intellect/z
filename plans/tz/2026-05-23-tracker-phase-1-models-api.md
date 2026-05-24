---
type: tz
status: draft
feature: Таск-трекер Z/Кора — Фаза 1 — модели данных + REST API + Webhooks + Ingest в knowledge-core
date: 2026-05-23
phase: 1 / 6
parent: plans/analysis/2026-05-23-tracker-as-entry-wedge.md
related:
  - plans/analysis/2026-05-23-ai-coo-readiness-analysis.md
  - plans/analysis/2026-05-23-product-overview-simple.md
  - plans/tz/2026-05-10-phase-9-goals-strategic-alignment.md
---

# Фаза 1 трекера: модели данных + REST + Webhooks + Ingest

## TL;DR

Фаза-фундамент. Расширяем legacy `tasks` модуль до полноценного трекера: `Project / Issue / Cycle / Intake / Comment / Activity / Version / Webhook`. Делаем публичный REST API + WebSocket-события для живого UI + Webhooks с HMAC-подписью для внешних интеграций. Главное: **каждое событие трекера попадает в knowledge-core как RawEvent** — трекер становится первоклассным источником для «второго мозга». Связь с Goals (целями) — сразу, не откладываем. Срок: 6 человеко-недель.

## Зависимости

- **α-1 ConversationalChannels** — готов (нужен для inbound webhooks).
- **knowledge-core** — готов (расширяется новым TrackerAdapter в `modules/ingest/adapters/tracker/`).
- **α-2 signalType расширение** — должно быть сделано ДО или параллельно (8 новых signalType: `task_created, task_status_changed, task_blocked, task_completed, task_overdue, task_reassigned, task_comment, task_mention`).
- **legacy `tasks/` модуль** — мигрируется.
- **goals/** модуль — готов, расширяется.

## Модели Prisma

> Все модели имеют `tenantId String` (multi-tenancy), `createdAt`, `updatedAt`, soft-delete через `deletedAt`. `entityId` для связи с графом знаний — opt.

### Project (новая модель)

```
model Project {
  id                String   @id @default(cuid())
  tenantId          String
  slug              String                          // короткий уникальный slug per tenant
  identifier        String                          // префикс задач: PROJ, SALES, DEV (до 5 симв.)
  name              String
  description       String?  @db.Text
  ownerId           String
  defaultAssigneeId String?
  defaultStateId    String?
  network           Int      @default(0)            // 0=Private, 2=Public-внутри-org
  archivedAt        DateTime?
  timezone          String   @default("Europe/Moscow")
  
  // Feature flags per project
  cycleViewEnabled   Boolean @default(true)
  intakeViewEnabled  Boolean @default(true)
  gantViewEnabled    Boolean @default(false)
  timeTrackingEnabled Boolean @default(false)
  
  // Шаблон команды, из которого создан
  teamTemplateId    String?
  teamTemplate      TeamTemplate? @relation(fields: [teamTemplateId], references: [id])
  
  // Связь с графом
  entityId          String?
  
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  deletedAt         DateTime?
  
  @@unique([tenantId, slug])
  @@index([tenantId, archivedAt])
}
```

### ProjectMember

```
model ProjectMember {
  id         String   @id @default(cuid())
  projectId  String
  userId     String
  role       Int      // 20=Admin, 15=Member, 5=Guest
  joinedAt   DateTime @default(now())
  
  @@unique([projectId, userId])
  @@index([userId])
}
```

### IssueState (статусы задач)

```
model IssueState {
  id         String   @id @default(cuid())
  tenantId   String
  projectId  String
  name       String              // «Бэклог», «В работе», «Готово»
  color      String   @default("#94A3B8")
  category   String              // backlog | unstarted | started | completed | cancelled
  sequence   Int
  isDefault  Boolean  @default(false)
  
  @@index([projectId, sequence])
}
```

### Cycle (циклы — «недели работы»)

```
model Cycle {
  id              String   @id @default(cuid())
  tenantId        String
  projectId       String
  name            String              // «Неделя 23», «Спринт продаж — июнь»
  startDate       DateTime
  endDate         DateTime
  ownedById       String?
  description     String?  @db.Text
  
  // Снимок прогресса (агрегированный, обновляется cron'ом)
  progressSnapshot Json?              // { total: N, completed: M, inProgress: K, ... }
  
  version         Int      @default(1)
  timezone        String   @default("Europe/Moscow")
  
  completedAt     DateTime?
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@index([projectId, startDate])
}
```

### Issue (расширение legacy Task)

```
model Issue {
  id              String   @id @default(cuid())
  tenantId        String
  projectId       String
  identifier      String              // PROJ-123 (уникален per project)
  sequenceId      Int                 // 123 — внутренний порядковый номер per project
  
  title           String              // ранее name
  description     String?  @db.Text   // rich-text JSON через TipTap
  descriptionHtml String?  @db.Text
  descriptionStripped String? @db.Text // plain text для поиска / индексации AI
  
  priority        String   @default("none") // urgent | high | medium | low | none
  stateId         String?
  
  parentId        String?             // для иерархии подзадач
  
  estimatePoints  Int?
  sortOrder       Int      @default(0)
  
  startDate       DateTime?
  dueDate         DateTime?
  completedAt     DateTime?
  
  // Циклы и модули
  cycleId         String?
  
  // СВЯЗИ С ДРУГИМИ СИСТЕМАМИ — критично для второго мозга
  goalId          String?             // связь с Goal! (FK opt.)
  meetingId       String?             // legacy compatibility
  linkedMeetingIds String[]           // видеовстречи из задачи
  
  // AI metadata
  sourceBlockIds  String[]            // если задача создана AI — откуда вытащил
  confidence      Decimal? @db.Decimal(4,3)
  createdManually Boolean  @default(true)
  
  // Внешний источник
  externalSource  String?             // email | telegram | checkin | meeting | api | manual
  externalId      String?
  
  // Граф знаний
  entityId        String?
  
  // RBAC и owner
  createdById     String
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  archivedAt      DateTime?
  deletedAt       DateTime?
  
  @@unique([projectId, sequenceId])
  @@unique([tenantId, identifier])
  @@index([tenantId, stateId, deletedAt])
  @@index([tenantId, dueDate])
  @@index([tenantId, goalId])
  @@index([tenantId, cycleId])
}
```

### IssueAssignee (M2M: задача↔исполнители)

```
model IssueAssignee {
  id        String   @id @default(cuid())
  issueId   String
  userId    String
  assignedById String?
  assignedAt DateTime @default(now())
  
  @@unique([issueId, userId])
  @@index([userId])
}
```

### IssueLabel + Label

```
model Label {
  id        String   @id @default(cuid())
  tenantId  String
  projectId String?              // null = глобальная метка организации
  name      String
  color     String
  
  @@index([projectId])
}

model IssueLabel {
  id      String @id @default(cuid())
  issueId String
  labelId String
  
  @@unique([issueId, labelId])
}
```

### IssueSubscriber

```
model IssueSubscriber {
  id        String   @id @default(cuid())
  issueId   String
  userId    String
  subscribedAt DateTime @default(now())
  
  @@unique([issueId, userId])
}
```

### IssueMention (для @-упоминаний)

```
model IssueMention {
  id        String   @id @default(cuid())
  issueId   String
  commentId String?               // упоминание в комментарии
  mentionedUserId String
  mentionedByUserId String
  createdAt DateTime @default(now())
  
  @@index([mentionedUserId])
}
```

### IssueComment

```
model IssueComment {
  id              String   @id @default(cuid())
  issueId         String
  authorId        String
  parentCommentId String?              // для тредов
  
  content         String   @db.Text    // rich-text JSON
  contentHtml     String?  @db.Text
  contentStripped String?  @db.Text    // plain для поиска / AI
  
  access          String   @default("internal") // internal | external (гость)
  
  // Голосовое сообщение
  voiceUrl        String?
  voiceDuration   Int?                 // секунды
  voiceTranscript String?  @db.Text    // транскрипт от Vox/GigaAM
  
  createdAt       DateTime @default(now())
  editedAt        DateTime?
  deletedAt       DateTime?
  
  @@index([issueId, createdAt])
}
```

### IssueAttachment

```
model IssueAttachment {
  id           String   @id @default(cuid())
  issueId      String
  commentId    String?              // если приложен к комментарию
  uploaderId   String
  fileName     String
  fileUrl      String
  fileSize     Int
  mimeType     String
  thumbnailUrl String?              // для картинок
  createdAt    DateTime @default(now())
  
  @@index([issueId])
}
```

### IssueLink (внешние ссылки на задаче)

```
model IssueLink {
  id        String   @id @default(cuid())
  issueId   String
  title     String
  url       String
  addedById String
  createdAt DateTime @default(now())
}
```

### IssueRelation (блокирует / связана / дублирует)

```
model IssueRelation {
  id            String   @id @default(cuid())
  sourceIssueId String
  targetIssueId String
  relationType  String              // blocks | blocked_by | duplicates | duplicated_by | relates_to
  createdById   String
  createdAt     DateTime @default(now())
  
  @@unique([sourceIssueId, targetIssueId, relationType])
}
```

### IssueActivity (audit-trail)

```
model IssueActivity {
  id          String   @id @default(cuid())
  tenantId    String
  issueId     String
  actorUserId String?
  actorType   String              // user | ai_agent | system
  agentName   String?             // если actor — AI, какой именно
  
  verb        String              // created | updated | status_changed | assigned | commented | linked | ...
  field       String?             // если updated — какое поле
  oldValue    Json?
  newValue    Json?
  
  metadata    Json?               // доп. контекст (например, кто упомянут)
  epoch       BigInt              // микросекунды для сортировки
  
  createdAt   DateTime @default(now())
  
  @@index([issueId, epoch])
  @@index([tenantId, createdAt])
}
```

### IssueVersion (исторические снимки)

```
model IssueVersion {
  id              String   @id @default(cuid())
  issueId         String
  versionNumber   Int
  snapshot        Json                 // полный снимок Issue + связей на момент версии
  createdByUserId String
  createdAt       DateTime @default(now())
  
  @@unique([issueId, versionNumber])
}
```

### IntakeIssue (входящие задачи перед триажем)

```
model IntakeIssue {
  id                  String   @id @default(cuid())
  tenantId            String
  projectId           String?              // если уже определён, иначе AI suggest
  
  status              String   @default("pending") // pending | snoozed | accepted | rejected | duplicate
  source              String              // in_app | email | telegram | checkin | meeting | api | concierge
  sourceEmail         String?
  externalSource      String?
  externalId          String?
  
  rawContent          String   @db.Text   // исходный текст
  extractedTitle      String?
  extractedDescription String? @db.Text
  
  // AI-предложения
  suggestedProjectId    String?
  suggestedAssigneeId   String?
  suggestedGoalId       String?
  suggestedPriority     String?
  suggestedDueDate      DateTime?
  suggestedLabels       String[]
  
  confidence            Decimal? @db.Decimal(4,3)
  
  // Триаж
  triagedByUserId       String?
  triagedAt             DateTime?
  rejectedReason        String?
  snoozedUntil          DateTime?
  
  // Если принят — создаётся Issue
  createdIssueId        String?
  
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  
  @@index([tenantId, status])
  @@index([source, createdAt])
}
```

### IssueWebhook (исходящие webhooks для внешних интеграций)

```
model IssueWebhook {
  id          String   @id @default(cuid())
  tenantId    String
  name        String
  url         String
  secretKey   String              // с префиксом `kora_wh_` + 32 байта
  
  events      String[]            // issue.created, issue.updated, comment.created, cycle.completed, ...
  
  isActive    Boolean  @default(true)
  isInternal  Boolean  @default(false)
  version     Int      @default(1)
  
  createdByUserId String
  createdAt   DateTime @default(now())
  
  @@index([tenantId, isActive])
}
```

### IssueWebhookLog

```
model IssueWebhookLog {
  id              String   @id @default(cuid())
  webhookId       String
  eventType       String
  
  requestMethod   String
  requestUrl      String
  requestHeaders  Json
  requestBody     Json
  
  responseStatus  Int?
  responseBody    String?  @db.Text
  responseTime    Int?                 // мс
  
  retryCount      Int      @default(0)
  success         Boolean
  errorMessage    String?
  
  createdAt       DateTime @default(now())
  
  @@index([webhookId, createdAt])
}
```

### TeamTemplate (10–15 готовых шаблонов команд — детально в отдельном sub-ТЗ)

```
model TeamTemplate {
  id          String   @id @default(cuid())
  tenantId    String?              // null = системный шаблон (платформенный)
  slug        String              // sales | development | installation | marketing | management | ...
  name        String              // «Команда продаж», «Команда разработки», ...
  description String   @db.Text
  category    String
  
  definition  Json                // { roles[], states[], laneTemplates[], typicalTasks[], regulationStubs[], kpiTemplates[] }
  
  isPublic    Boolean  @default(true)
  usageCount  Int      @default(0)
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@unique([tenantId, slug])
}
```

### Расширения существующих моделей

```
// Goal — добавить reverse relation
model Goal {
  // ... существующие поля
  linkedIssues  Issue[]      // НОВОЕ
}

// Meeting — добавить linkedIssueId (для видеовстреч из задачи)
model Meeting {
  // ... существующие поля
  linkedIssueId String?      // НОВОЕ — из какой задачи запущена
  linkedIssue   Issue?       // НОВОЕ
}

// IdeaBlock.signalType enum — добавить:
//   task_created, task_status_changed, task_blocked, task_completed,
//   task_overdue, task_reassigned, task_comment, task_mention
// (делается в α-2 доделке)
```

## REST API endpoints

> Все endpoints под глобальным префиксом `/api/v1`, защищены `TenantGuard` + `RbacGuard`. DTO через Zod (`nestjs-zod`). Swagger автоматически.

### Projects

```
GET    /projects                          # список проектов организации (с фильтрами)
POST   /projects                          # создание (опц. из шаблона: { teamTemplateId })
GET    /projects/:id
PATCH  /projects/:id
DELETE /projects/:id                      # soft-delete
POST   /projects/:id/archive
POST   /projects/:id/unarchive
GET    /projects/:id/members
POST   /projects/:id/members              # пригласить (email)
DELETE /projects/:id/members/:userId
```

### Issues (под проектом)

```
GET    /projects/:projectId/issues        # список с фильтрами (state, assignee, label, cycle, goal)
POST   /projects/:projectId/issues
GET    /issues/:id                        # без projectId — issue ID глобален
PATCH  /issues/:id
DELETE /issues/:id
POST   /issues/:id/transitions            # сменить статус { stateId }
POST   /issues/:id/assignees              # добавить исполнителя
DELETE /issues/:id/assignees/:userId
POST   /issues/:id/labels
DELETE /issues/:id/labels/:labelId
POST   /issues/:id/subscribe
DELETE /issues/:id/subscribe
GET    /issues/:id/comments
POST   /issues/:id/comments
PATCH  /comments/:commentId
DELETE /comments/:commentId
POST   /issues/:id/attachments            # multipart upload
GET    /issues/:id/relations
POST   /issues/:id/relations
DELETE /issues/:id/relations/:relationId
GET    /issues/:id/activity               # лента изменений
GET    /issues/:id/versions
POST   /issues/:id/start-meeting          # видеовстреча из задачи! → создаёт Meeting с linkedIssueId
POST   /issues/:id/link-goal              # связать с целью
DELETE /issues/:id/link-goal
```

### Cycles

```
GET    /projects/:projectId/cycles
POST   /projects/:projectId/cycles
GET    /cycles/:id
PATCH  /cycles/:id
POST   /cycles/:id/complete               # закрытие цикла с авто-rollover незакрытых
GET    /cycles/:id/issues
```

### Intake (входящие задачи)

```
GET    /intake                            # admin + project_manager
POST   /intake/:id/triage                 # accept / reject / snooze / duplicate
POST   /intake                            # создание (внутреннее — из webhook чек-инов и т.д.)
PATCH  /intake/:id
```

### Webhooks

```
GET    /webhooks
POST   /webhooks
PATCH  /webhooks/:id
DELETE /webhooks/:id
GET    /webhooks/:id/logs
POST   /webhooks/:id/test                 # тестовый запрос
```

### Templates

```
GET    /team-templates                    # список доступных
GET    /team-templates/:slug              # детали
POST   /projects/from-template            # создание проекта { templateSlug, name, identifier }
```

## WebSocket events (для live UI)

Через существующий `hulypulse`-аналог или `@nestjs/websockets`. Канал per-tenant.

События:
- `issue.created`, `issue.updated`, `issue.deleted`
- `comment.created`, `comment.updated`, `comment.deleted`
- `cycle.progress_updated`
- `intake.new_item`
- `activity_feed.new_item` (см. отдельное sub-ТЗ Activity Feeds)

## Webhooks (исходящие — по образцу Plane)

- **HMAC-SHA256** подпись в заголовке `X-Kora-Signature`.
- **Secret**: при создании генерируется с префиксом `kora_wh_` + 32 случайных байта.
- **Retry policy**: max 5 попыток, exponential backoff (60s → 300s → 1500s → 7500s → 37500s).
- После 5 неудач — webhook деактивируется (`isActive=false`), уведомление автору.
- **Все запросы пишутся в `IssueWebhookLog`** для аудита.
- События: `issue.created/updated/deleted`, `comment.created/updated`, `cycle.created/completed`, `project.created/archived`, `intake.created/triaged`.

## Ingest в knowledge-core (трекер = источник для второго мозга)

### Архитектура

1. **EventEmitter** в `modules/tracker/`:
   ```typescript
   this.eventBus.emit('tracker.event_occurred', { type, payload, tenantId, ... })
   ```

2. **TrackerAdapter** — новый адаптер в `modules/ingest/adapters/tracker/tracker.adapter.ts`:
   - Слушает `tracker.event_occurred`
   - Создаёт `Source` (один per tenant) + `RawEvent` с типом `tracker_event` и payload
   - Отправляет в очередь `core.raw-events`

3. **block-ingest.worker** (уже есть):
   - Получает RawEvent
   - Использует расширенный prompt (signalType учитывает новые типы)
   - Создаёт IdeaBlock с правильным signalType:

| Событие трекера | Создаваемый IdeaBlock.signalType |
|---|---|
| `issue.created` | `task_created` (плюс блоки извлечённые из title+description) |
| `issue.status_changed → blocked` | `task_blocked` |
| `issue.dueDate passed + open` | `task_overdue` (от cron) |
| `issue.completed` | `task_completed` |
| `issue.assignee changed` | `task_reassigned` |
| `comment.created` | `task_comment` (плюс блоки из текста: ideas/questions/decisions/blockers) |
| `mention created` | `task_mention` |

### Что это даёт

- Специалист «Сигналы» (Insights Radar β-4) автоматически замечает «у Иванова 5 задач в `task_blocked` за неделю» — это паттерн.
- Специалист «Решения» (β-3) видит обсуждения решений в комментариях.
- Специалист «Регламенты» (α-7) видит как обычно решаются повторяющиеся задачи.
- COO Operations Dashboard (β-8) имеет данные для дневной/недельной сводки.

## Связь с Goals (стратегическое согласование с Фазы 1!)

### Что реализуется

- Поле `Issue.goalId` — задача может быть привязана к цели.
- `Goal.linkedIssues[]` — обратная связь.
- Endpoints `/issues/:id/link-goal` и `/issues/:id/unlink-goal`.
- **AI-suggest при создании задачи:** новый LlmTaskType `issue-goal-suggest` (в Фазе 3 детально). Из α-3 axis-classifier + KNN-поиск похожих задач с привязанной целью.
- **Расширение существующего `strategic-alignment` воркера:**
  - Дополнительно считает: задач привязано к цели N, выполнено M, осталось K, прошло % времени, опережаем/отстаём.
  - Сохраняет snapshot в `Goal.progressSnapshot Json` (или новой связанной модели `GoalAlignmentSnapshot`).
- **Probe-trigger** «80% задач не привязаны к целям» — в β-5 Probe Agent добавляется новый тип через ProbeService.

## RBAC ResourceType (новые)

- `project` — owner / admin создаёт; member читает свои; guest вход по ссылке
- `issue` — наследует от project; assignee всегда видит свои
- `cycle` — наследует от project
- `intake_issue` — admin / project_manager видят и триажат
- `team_template` — все читают; admin создаёт свои
- `issue_webhook` — admin создаёт; tenant-scope

Регистрация в `policy.csv` Casbin (RbacService.ResourceType).

## Метрики Prometheus

```
issues_created_total{tenant, project, source}
issues_completed_total{tenant, project}
issues_by_state_count{tenant, project, state}
issues_overdue_count{tenant, project}
intake_pending_count{tenant}
intake_triaged_total{tenant, decision}
webhook_delivery_total{tenant, event, success}
webhook_retry_count{tenant, webhook_id}
tracker_events_to_knowledge_core_total{tenant, type}
```

## Миграция legacy `Task` модуля

Скрипт `backend/scripts/migrate-task-to-issue.ts`:

1. Для каждой Org создаётся виртуальный `Project` с `slug='from-meetings'`, `identifier='MTG'`, `name='Из встреч'`.
2. Каждый существующий `Task` → новый `Issue` с:
   - `projectId` = ID виртуального проекта Org
   - `externalSource = 'meeting_legacy'`
   - `linkedMeetingIds = [task.meetingId]`
   - `title = task.title`, `description = task.description`
   - `assigneeRaw` → пытаемся найти User в Org по совпадению email/имени, если не найдено — оставляем в `metadata.legacyAssigneeRaw`
   - `dueDate`, `status`, `createdAt` — переносим как есть
3. **Старый `/api/v1/tasks/*` endpoint** помечается `@deprecated`, остаётся работать ещё 1-2 фазы (для legacy frontend), но новый код использует `/api/v1/issues/*`.
4. **Frontend `/tasks` страница** — обновляется в Фазе 2 на новый API.

## Что НЕ делаем в Фазе 1 (откладываем)

- Frontend страницы (Фаза 2)
- AI-фичи (Фаза 3): автозадачи из встреч, AI-suggest при создании, AI Q&A
- Telegram-бот для задач (Фаза 4)
- Email-to-task (Фаза 4)
- Шаблоны команд кроме модели (контент шаблонов — Фаза 4 / отдельное sub-ТЗ)
- Импорт из Битрикс24/Trello/Я.Трекер (Фаза 5)
- Нативная мобилка (параллельный поток)

## DoD (Definition of Done)

- [ ] Все модели Prisma созданы, `bun run prisma:push` прошёл без ошибок
- [ ] Все REST endpoints отвечают, OpenAPI/Swagger автоматически собран
- [ ] WebSocket события эмитятся при изменениях
- [ ] Webhooks работают: тестовый POST на `https://webhook.site/...`, HMAC подпись валидируется внешним инструментом
- [ ] Retry policy: упавший webhook получает 5 попыток с exp backoff, после — деактивация + email уведомление автору
- [ ] **Ingest в knowledge-core работает**: создаём задачу через API → проверяем что появился `RawEvent` → через 30 сек появился `IdeaBlock` с `signalType='task_created'` и `sourceRef` указывает на Issue
- [ ] Связь с Goals: можно привязать задачу к цели, отвязать; `strategic-alignment` воркер считает прогресс с учётом задач
- [ ] Миграция legacy Task прошла на тестовых данных без потерь
- [ ] Все API защищены TenantGuard, RBAC ResourceType зарегистрированы
- [ ] Idempotency-Key поддерживается на POST `/issues`, `/comments`, `/intake`
- [ ] Audit log пишется через `IssueActivity` для всех мутаций
- [ ] Integration tests (vitest + testcontainers PostgreSQL): создание/обновление/удаление Issue, Cycle, Project; webhook delivery; ingest в knowledge-core
- [ ] Unit tests для services, mappers, validators
- [ ] Все метрики Prometheus экспортируются на `/metrics`
- [ ] Документация: новые ENV переменные в `env.schema.ts`, README модуля `issues/`

## Срок

**6 человеко-недель** (1 backend + 0.5 шаг в продуктовой части = по факту 4-5 нед параллельной работы).

## Следующая фаза

[Фаза 2: Frontend mobile-first](2026-05-23-tracker-phase-2-frontend-mobile-first.md) — страницы трекера в нашем дизайне, концьерж (плавающий значок + опц. Cmd+K), чат-в-задаче, PWA.

---

_2026-05-23: фундаментная фаза трекера, без UI. Основа для остальных фаз._
