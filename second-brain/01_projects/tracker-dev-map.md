# Трекер — карта разработчика

> Документ для навигации по коду трекера. Не «что делает продукт», а «где
> это лежит и как с этим работать». Актуально по состоянию на 2026-05-27.
>
> Общий обзор, история реализации, связи с другими модулями —
> [`01_projects/tracker.md`](tracker.md).

---

## 1. Backend — структура модуля

Весь backend-код трекера сосредоточен в одном месте:

```
backend/src/modules/tracker/
├── tracker.module.ts                    # NestJS-модуль, регистрирует всё
├── queues.ts                            # константы имён BullMQ-очередей
│
├── controllers/                         # REST — 15 контроллеров
│   ├── projects.controller.ts           # /api/v1/projects
│   ├── issues.controller.ts             # /api/v1/issues/:id + /projects/:pid/issues
│   ├── cycles.controller.ts             # /api/v1/cycles + /projects/:pid/cycles
│   ├── intake.controller.ts             # /api/v1/intake
│   ├── comments.controller.ts           # /api/v1/issues/:id/comments + /comments/:id
│   ├── labels.controller.ts             # /api/v1/labels
│   ├── relations.controller.ts          # /api/v1/issues/:id/relations
│   ├── attachments.controller.ts        # /api/v1/issues/:id/attachments (S3)
│   ├── states.controller.ts             # /api/v1/projects/:id/states
│   ├── webhooks.controller.ts           # /api/v1/tracker/webhooks
│   ├── team-templates.controller.ts     # /api/v1/team-templates + /projects/from-template
│   ├── holidays.controller.ts           # /api/v1/holidays (производственный календарь)
│   ├── imports.controller.ts            # /api/v1/tracker/imports
│   ├── me-inbox.controller.ts           # /api/v1/me/inbox + /api/v1/me/inbox/count
│   └── my-mentions.controller.ts        # /api/v1/me/mentions
│
├── services/                            # Бизнес-логика — 38 файлов
│   ├── issues.service.ts                # CRUD задач + transitions + assignees + labels
│   ├── projects.service.ts              # CRUD проектов + members
│   ├── cycles.service.ts                # CRUD циклов + complete (auto-rollover)
│   ├── intake.service.ts                # CRUD входящих + triage
│   ├── comments.service.ts              # CRUD комментариев
│   ├── relations.service.ts             # CRUD связей (auto-создаёт обратную парную)
│   ├── attachments.service.ts           # upload → S3 + presigned URL + delete
│   ├── labels.service.ts                # CRUD меток
│   ├── states.service.ts                # CRUD статусов per project
│   ├── webhooks.service.ts              # CRUD outgoing webhooks
│   ├── holiday.service.ts               # isHoliday / nextBusinessDay / adjustDueDate
│   ├── import.service.ts                # запуск/отмена импортов
│   │
│   ├── activity-recorder.service.ts     # пишет IssueActivity — вызывается везде при мутациях
│   ├── tracker-emitter.service.ts       # эмитит tracker.event_occurred → knowledge-core
│   ├── tracker-events.service.ts        # отправляет WS-события через TrackerGateway
│   │
│   ├── issue-meetings.service.ts        # POST /issues/:id/start-meeting → LiveKit JWT
│   ├── projects-from-template.service.ts # POST /projects/from-template
│   │
│   ├── similar-issues.service.ts        # KNN cosine по embedding vector(1536)
│   ├── issue-embed-queue.service.ts     # ставит задачу в очередь core.issue-embed
│   ├── issue-infer-fields.service.ts    # AI-подсказки при создании задачи
│   ├── issue-goal-suggest.service.ts    # AI-предложение цели для задачи
│   ├── intake-auto-triage-queue.service.ts # ставит IntakeIssue в очередь авто-триажа
│   └── meeting-extract-actions.service.ts  # создаёт IntakeIssue после AI-отчёта встречи
│
├── workers/                             # BullMQ-воркеры и Cron
│   ├── webhook-delivery.worker.ts       # доставка outgoing webhooks (retry exp backoff)
│   ├── issue-embed.worker.ts            # генерация embedding через text-embedding-3-small
│   ├── intake-auto-triage.worker.ts     # авто-триаж IntakeIssue при confidence ≥ 0.92
│   ├── import-tracker.worker.ts         # фоновый импорт (Trello, заглушки Bitrix/ЯТ)
│   ├── issue-overdue-detector.cron.ts   # 09:00 ежедневно — ищет просроченные задачи
│   ├── issue-state-gauge.cron.ts        # каждые 5 мин — обновляет Prometheus gauge
│   └── goal-alignment-low.cron.ts       # каждый понедельник 06:00 — probe-trigger
│
├── gateways/
│   └── tracker.gateway.ts               # WebSocket namespace /ws/tracker
│
└── seed/
    └── team-templates-data.ts           # JSON-данные 10+5 шаблонов команд
```

### Соседние модули, тесно связанные с трекером

```
backend/src/modules/ingest/adapters/tracker/
└── tracker.adapter.ts                   # @OnEvent('tracker.event_occurred') → RawEvent

backend/src/modules/mail-inbound/        # Email-to-task (IMAP polling → IntakeIssue)

backend/src/modules/conversational/adapters/telegram-bot/
├── telegram-bot-message.handler.ts      # роутер входящих: text/voice/forward/reply
└── telegram-task-parser.service.ts      # LLM-парсер → IntakeIssue/IssueComment

backend/src/common/idempotency/          # IdempotencyService (Redis TTL 86400)
                                         # применён к POST /issues, /comments, /intake
```

---

## 2. Prisma-модели трекера

Все модели — в одной схеме: `backend/prisma/schema.prisma`.

Для навигации: модели трекера идут блоком начиная примерно с `Project`. Список:

| Модель | Назначение |
|---|---|
| `Project` | Проект (slug, identifier-префикс, feature-flags, teamTemplateId) |
| `ProjectMember` | M2M user↔project, role: 20=Admin / 15=Member / 5=Guest |
| `IssueState` | Статусы задач per project (category: backlog/started/completed/cancelled) |
| `Cycle` | Рабочая неделя/спринт; `POST /cycles/:id/complete` переносит незакрытые |
| `Issue` | Задача. Ключевые поля: `identifier` (PROJ-123), `sequenceId`, `parentId`, `goalId`, `embedding vector(1536)`, `externalSource` |
| `IssueAssignee` | M2M issue↔users |
| `Label` + `IssueLabel` | Метки (per-project или global при `projectId=null`) |
| `IssueSubscriber` | Подписка на уведомления по задаче |
| `IssueMention` | `@`-упоминания (issue + опц. comment) |
| `IssueComment` | Комментарий: rich-text JSON + `voiceUrl/voiceDuration/voiceTranscript` + threading |
| `IssueAttachment` | S3-файлы; 25 MB лимит; MIME whitelist |
| `IssueLink` | Внешние URL прикреплённые к задаче |
| `IssueRelation` | blocks/blocked_by/duplicates/duplicated_by/relates_to |
| `IssueActivity` | Audit-trail (verb, field, oldValue/newValue, `epoch BigInt` микросекунды) |
| `IssueVersion` | Исторический снимок задачи в JSON |
| `IntakeIssue` | Входящая задача перед триажем; поля `suggested*` заполняет AI |
| `IssueWebhook` | Outgoing webhook (secretKey с префиксом `kora_wh_`) |
| `IssueWebhookLog` | Лог каждой попытки доставки |
| `TeamTemplate` | Шаблон команды (`tenantId=null` = системный) |
| `HolidayCalendar` | Производственный календарь РФ (`tenantId=null` = платформенный) |
| `ImportLog` | Лог импорта задач из внешних систем (прогресс, ошибки) |

**Расширения существующих моделей:**
- `Meeting.linkedIssueId` — видеовстреча запущена из задачи
- `Goal.linkedIssues[]` — стратегическое согласование задача↔цель
- `MeetingType.task_discussion` — новое значение enum
- `Project.emailInboxAlias` + `.emailInboxEnabled` — Email-to-task

**pgvector-индексы** (не в schema.prisma, применяются вручную):
```bash
bun run apply-postgres-init   # или docker compose exec backend bun run apply-postgres-init
```
Файл: `backend/scripts/postgres-init.sql` — HNSW partial-index по `Issue.embedding`.

---

## 3. Frontend — структура

### Страницы (App Router)

```
frontend/app/(authenticated)/
├── projects/
│   ├── page.tsx                          # список проектов организации
│   ├── ProjectsListClient.tsx
│   ├── new/                              # создание (с FromTemplateWizard)
│   └── [slug]/
│       ├── page.tsx                      # дашборд проекта → редирект на /board
│       ├── ProjectViewShell.tsx          # общий layout для всех видов
│       ├── board/                        # канбан с DnD (@dnd-kit)
│       ├── list/                         # список с сортировкой/фильтрами
│       ├── calendar/                     # по dueDate
│       ├── gantt/                        # Ганта (если timeTrackingEnabled)
│       ├── cycles/                       # список + [cycleId]
│       ├── intake/                       # входящие задачи (admin/manager)
│       └── settings/                     # настройки проекта, members, email-inbox
├── issues/[id]/                          # страница задачи (+ IssueChat, KnnSimilar)
├── me/
│   ├── inbox/                            # мои задачи через все проекты
│   └── dashboard/                        # личный дашборд
├── intake/                               # общий intake по org
├── feed/                                 # лента активности
└── team-templates/                       # каталог шаблонов команд
```

### UI-компоненты трекера

```
frontend/src/ui/tracker/
├── Board.tsx                    # канбан-доска (DnD, inline QuickAdd)
├── IssueCard.tsx                # карточка задачи (priority + title + avatar + срок)
├── IssueHeader.tsx              # шапка страницы задачи (status + assignees + dates)
├── IssueSidebar.tsx             # правая панель страницы задачи (meta)
├── IssueDescription.tsx         # rich-text редактор описания (TipTap)
├── IssueComments.tsx            # комментарии: presence widget + typing indicator
├── IssueChat.tsx                # чат-в-задаче (voice + @mentions + файлы)
├── IssueActivity.tsx            # лента изменений (audit-trail)
├── IssueAttachments.tsx         # drag-n-drop файлы
├── IssueRelations.tsx           # связи blocks/duplicates/relates_to
├── IssueSimilar.tsx             # блок «Похожие задачи» (KNN)
├── IssueList.tsx                # табличный вид
├── IntakeBoard.tsx              # карточки incoming + triage
├── CycleProgress.tsx            # виджет прогресса цикла
├── QuickAdd.tsx                 # inline Enter → создать задачу
├── StartMeetingButton.tsx       # кнопка «Видеовстреча» → LiveKit
├── AssigneeAvatar.tsx           # аватарка с tooltip
├── IssuePriorityIcon.tsx
├── IssueStateBadge.tsx
├── MentionAutocompletePopup.tsx  # выпадашка при `@`
└── TrackerBottomNav.tsx         # нижняя навигация на мобиле (≤md)
```

### Концьерж (Кора-помощник)

```
frontend/src/ui/concierge/
├── ConciergeFloatingButton.tsx  # плавающая кнопка — главный вход (desktop)
├── ConciergeSheet.tsx           # mobile fullscreen / desktop боковая панель
└── ConciergeVoice.tsx           # голосовой ввод (зажми и говори)

frontend/src/ui/components/command-palette/
├── CommandPaletteProvider.tsx   # global state (Ctrl/Cmd+K, опт. desktop shortcut)
├── CommandPalette.tsx           # модал ≤600px: >/? каналы, Recent, Pinned
└── Trigger.tsx                  # кнопка-открывашка
```

### API-клиент и доменные модели

```
frontend/src/api/
├── projects.api.ts              # ApiDto для /projects
├── issues.api.ts                # ApiDto для /issues
├── cycles.api.ts
├── intake.api.ts
└── team-templates.api.ts

frontend/src/domain/
├── project.ts                   # DomainModel + маппер из ApiDto
├── issue.ts
├── cycle.ts
└── intake.ts
```

### Хуки SWR

```
frontend/src/hooks/
├── useIssues.ts                 # список задач (SWR + live-refresh)
├── useCycles.ts
├── useCommandPalette.ts         # global state открытия палитры
├── usePwaInstall.ts             # событие beforeinstallprompt
└── usePushNotifications.ts      # подписка на Web Push

frontend/src/hooks/useTrackerLiveRefresh.ts  # socket.io → SWR mutate (debounce 150ms)
```

---

## 4. WebSocket

**Namespace:** `/ws/tracker`  
**Auth:** JWT из `handshake.auth.token` (или cookie `z_session`, или Authorization).

При подключении клиент автоматически входит в room `tenant:${tenantId}`.  
Опционально: `socket.emit('subscribe.project', { projectId })` и `subscribe.issue`.

**Исходящие события с сервера:**

| Событие | Когда |
|---|---|
| `issue.created` | POST /issues |
| `issue.updated` | PATCH /issues/:id + transitions + assignees + labels |
| `issue.deleted` | DELETE /issues/:id |
| `comment.created/updated/deleted` | мутации комментариев |
| `cycle.created/progressUpdated/completed` | мутации + cron IssueStateGaugeCron |
| `intake.newItem` | создание IntakeIssue |
| `activity_feed.newItem` | новая запись в ActivityFeed |
| `issue.chat.presence` | join/leave чата задачи |
| `issue.chat.typing` | индикатор набора (throttle 800ms) |
| `import.progress/completed/failed` | прогресс импорта |

**Где frontend подключается:**  
`frontend/src/hooks/useTrackerLiveRefresh.ts` — создаёт socket.io-client соединение,
слушает события и вызывает `mutate(key)` нужных SWR-кешей.

---

## 5. Outgoing webhooks

- **Очередь:** `tracker.webhook-delivery` (BullMQ, воркер `webhook-delivery.worker.ts`)
- **Retry:** 5 попыток, задержки 60s → 300s → 1500s → 7500s → 37500s
- **Подпись:** `X-Kora-Signature: sha256=<hex>` (HMAC-SHA256 через `webhook-signer.service.ts`)
- **Заголовки запроса:** `X-Kora-Event`, `X-Kora-Webhook-Id`, `X-Kora-Delivery` (nanoid), `X-Kora-Timestamp`
- **Body:** `{ event, tenantId, webhookId, enqueuedAt, data }`
- После 5 неудач: `webhook.isActive=false`, уведомление владельцу через ConversationalService
- Каждая попытка пишется в `IssueWebhookLog` (ответ truncate 10KB)

---

## 6. Ingest в knowledge-core (трекер = источник второго мозга)

Каждая мутация задачи/комментария проходит через цепочку:

```
IssuesService / CommentsService
  → TrackerEmitterService.emit('tracker.event_occurred', { type, payload, tenantId })
    → TrackerAdapter (@OnEvent) → creates RawEvent in DB → enqueues to core.raw-events
      → block-ingest.worker → IdeaBlock с signalType из таблицы ниже
```

Маппинг событий → signalType:

| `TrackerEventType` | `IdeaBlock.signalType` |
|---|---|
| `issue.created` | `task_created` |
| `issue.status_changed` | `task_status_changed` |
| `issue.status_changed_to_blocked` | `task_blocked` |
| `issue.status_changed_to_done` | `task_completed` |
| `issue.overdue_detected` (из cron) | `task_overdue` (дедуп 7 дней) |
| `issue.assignee_changed` | `task_reassigned` |
| `comment.created` | `task_comment` |
| `mention.created` | `task_mention` |

Адаптер: `backend/src/modules/ingest/adapters/tracker/tracker.adapter.ts`

---

## 7. AI-фичи трекера

### LlmTaskType и где они вызываются

| LlmTaskType | Вызывается из | Что делает |
|---|---|---|
| `issue-infer-fields` | `IssueInferFieldsService` при `POST /issues?inferSuggestions=true` | Предлагает assignee/dueDate/priority/goal/labels (timeout 8s, inline в response) |
| `issue-goal-suggest` | `IssueGoalSuggestService` | KNN top-10 + LLM fallback — предлагает цель |
| `meeting-extract-actions` | `MeetingExtractActionsService` после ai_ready встречи | Создаёт IntakeIssue с suggested* из транскрипта |
| `intake-auto-triage` | `IntakeAutoTriageWorker` (consumer `core.intake-auto-triage`) | confidence ≥ 0.92 + source=meeting + assigneeId → авто-Issue |
| `concierge-parse` | `DialogService` (concierge) | NL-запрос → structured-команда (create/find/navigate) |
| `telegram-create-task` | `TelegramTaskParserService` | Текст/голос в TG → IntakeIssue |
| `telegram-forward-to-task` | `TelegramBotMessageHandler` | Forward → IntakeIssue |
| `telegram-reply-classify` | `TelegramBotMessageHandler` | Определяет: команда статуса / комментарий / новое |
| `telegram-digest-formulate` | `TelegramDigestCron` | Утренняя сводка в TG (09:00 ежедневно) |

### Embeddings (похожие задачи)

- `Issue.embedding vector(1536)` — генерируется через `text-embedding-3-small`
- Воркер: `issue-embed.worker.ts` (consumer очереди `core.issue-embed`)
- Пропускает если `embeddingHash` не изменился (sha256 от title+description)
- KNN-поиск: `SimilarIssuesService` → cosine threshold 0.18, top-5 закрытых
- Endpoint: `GET /api/v1/tracker/issues/:id/similar`
- Frontend: `IssueSimilar.tsx` на странице задачи

### Seed LLM-маршрутов

После деплоя нужно запустить seed-скрипты для регистрации LlmTaskType в БД:
```
backend/scripts/seed-llm-task-routes-tracker-phase3.ts    # issue-infer-fields, issue-goal-suggest, ...
backend/scripts/seed-llm-task-routes-tracker-phase3-c.ts  # intake-auto-triage, meeting-extract-actions
backend/scripts/seed-llm-task-routes-tracker-phase4-telegram.ts  # telegram-* типы
```

---

## 8. Telegram-бот для задач

Код: `backend/src/modules/conversational/adapters/telegram-bot/`

| Файл | Назначение |
|---|---|
| `telegram-bot-message.handler.ts` | Роутер входящих: text / voice / forward / reply |
| `telegram-task-parser.service.ts` | LLM-парсинг → IntakeIssue (4 LlmTaskType) |
| `telegram-digest.cron.ts` | `@Cron('0 9 * * *')` — утренний дайджест (Redis dedup) |

**5 реализованных сценариев:**
1. Уведомление при назначении задачи / дедлайне
2. Создание задачи одной фразой или голосом
3. Reply на уведомление бота → `IssueComment`
4. Forward сообщения из любого чата → IntakeIssue
5. Утренний дайджест задач на день

**Интеграция с ASR:** голосовое сообщение → `VoxService` → текст → `TelegramTaskParserService`.

---

## 9. Email-to-task

Модуль: `backend/src/modules/mail-inbound/`

Как работает:
1. IMAP polling каждые 2 минуты (`@Cron(MAIL_INBOX_POLL_CRON)`)
2. Письмо на `<alias>@inbox.kora.app` → находит Project по `emailInboxAlias`
3. Создаёт IntakeIssue (или сразу Issue если `intakeViewEnabled=false`)
4. Вложения → S3

Включение через API (или UI в `/projects/[slug]/settings`):
```
POST /api/v1/projects/:id/email-inbox/enable       # генерирует alias
POST /api/v1/projects/:id/email-inbox/disable
POST /api/v1/projects/:id/email-inbox/regenerate-alias
GET  /api/v1/projects/:id/email-inbox              # статус + последние 10 писем
```

---

## 10. Скрипты для первоначального развёртывания

```bash
# Шаблоны команд (10 системных + 5 опциональных)
docker compose exec backend bun run scripts/seed-team-templates.ts

# Производственный календарь РФ 2026 (14 праздников)
docker compose exec backend bun run scripts/seed-holiday-calendar-ru-2026.ts

# LLM-маршруты Phase 3 AI (issue-infer-fields, issue-goal-suggest и др.)
docker compose exec backend bun run scripts/seed-llm-task-routes-tracker-phase3.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-tracker-phase3-c.ts

# LLM-маршруты Phase 4 Telegram
docker compose exec backend bun run scripts/seed-llm-task-routes-tracker-phase4-telegram.ts

# Миграция legacy Task → Issue (если есть старые данные)
docker compose exec backend bun run scripts/migrate-task-to-issue.ts --dry-run
docker compose exec backend bun run scripts/migrate-task-to-issue.ts --apply

# pgvector HNSW индекс по Issue.embedding
docker compose exec backend bun run apply-postgres-init
```

---

## 11. ENV-переменные трекера

В `backend/src/common/config/env.schema.ts`:

| Переменная | Default | Назначение |
|---|---|---|
| `WEBHOOK_HMAC_PREFIX` | `kora_wh_` | Префикс секрета webhook'ов |
| `TRACKER_INGEST_QUEUE` | `core.raw-events` | BullMQ очередь ingest |
| `IDEMPOTENCY_KEY_TTL_SECONDS` | `86400` | TTL Idempotency-Key в Redis |
| `TRACKER_WEBHOOK_MAX_RETRIES` | `5` | Макс. попыток доставки webhook |
| `TRACKER_WEBHOOK_RETRY_BACKOFF_INITIAL_MS` | `60000` | Начальная задержка retry |
| `MAIL_IMAP_HOST` | — | IMAP-сервер для email-to-task |
| `MAIL_IMAP_PORT` | `993` | |
| `MAIL_IMAP_USER` | — | |
| `MAIL_IMAP_PASSWORD` | — | |
| `MAIL_IMAP_TLS` | `true` | |
| `MAIL_IMAP_MAILBOX` | `INBOX` | |
| `MAIL_INBOX_POLL_CRON` | `*/2 * * * *` | Расписание IMAP polling |
| `MAIL_INBOX_DOMAIN` | `inbox.kora.app` | Домен для email alias'ов |
| `MAIL_ATTACHMENT_MAX_BYTES` | `26214400` | Лимит вложения (25 MB) |

---

## 12. Prometheus метрики трекера

Экспортируются через `BusinessMetricsService` на `/metrics`.

**Counters:**
- `issues_created_total{tenant, project, source}` — создание задач
- `issues_completed_total{tenant, project}`
- `intake_triaged_total{tenant, decision}` — accept/reject/snooze/duplicate
- `tracker_webhook_delivery_total{tenant, event, success}`
- `tracker_webhook_retry_count{tenant, webhook_id}`
- `tracker_events_to_knowledge_core_total{tenant, type}`
- `tracker_issue_embed_total{status}` — генерация embeddings
- `tracker_issue_similar_search_total` — запросы KNN
- `telegram_tasks_created_total{tenant}`, `telegram_voice_transcribed_total{tenant}`, `telegram_forwards_total`, `telegram_digest_sent_total`, `telegram_reply_classified_total`
- `team_template_used_total{slug}`
- `holiday_due_date_adjusted_total`
- `import_started_total{source}`, `import_completed_total{source, success}`, `import_issues_processed_total{source}`
- `ai_meeting_actions_extracted_total{status, by}`, `ai_intake_auto_accepted_total`
- `ai_issue_inferred_total{accepted}`, `ai_issue_goal_suggested_total{accepted, source}`

**Gauges** (обновляются `IssueStateGaugeCron` каждые 5 мин):
- `issues_by_state_count{tenant, project, state}`
- `issues_overdue_count{tenant, project}`
- `intake_pending_count{tenant}`

⚠ Cardinality-риск: label `tenant` / `project` / `webhook_id` прямые. До Grafana recording rules — не масштабируется за ~100 тенантов.

---

## 13. RBAC

6 `ResourceType` в `backend/policies/policy.csv` (Casbin):

| ResourceType | Кто что может |
|---|---|
| `project` | owner/admin/manager — write; member — read |
| `issue` | assignee + project_member — read; manager — write all; creator/manager — delete self |
| `cycle` | manager — write; project_member — read |
| `intake_issue` | admin/manager/coo — read + triage |
| `team_template` | все — read; admin — write |
| `issue_webhook` | admin — full CRUD (tenant-scope) |
| `import_tracker` | owner/admin — запуск импортов |

`TenantGuard` на каждом endpoint — `tenantId` из `X-Org-Id` заголовка или `:orgId` в пути.

---

## 14. Что НЕ реализовано (известные gaps)

| Функция | Статус |
|---|---|
| E2E-тесты Playwright (создание проекта/задачи, чат, видеовстреча, концьерж) | Не написаны |
| Уведомление владельцу при `webhook.isActive=false` | TODO (`ConversationalService`) |
| Thumbnails для `IssueAttachment` (sharp) | TODO (отдельный воркер) |
| Отдельный AI-промпт для `task_discussion` (сейчас переиспользует `team`) | TODO |
| Импорт из Bitrix24 / Яндекс.Трекер (есть DTO + заглушки) | NotImplemented |
| `HolidayService.adjustDueDate` вызов из `IssuesService` при создании | TODO (только service готов) |
| `AssigneeResolverService` + Goal hint в Telegram-боте | Частично (TODO в handler) |

---

_Создан: 2026-05-27. При значительных изменениях кода — обновить этот файл._
