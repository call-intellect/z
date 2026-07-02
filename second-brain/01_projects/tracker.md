# Tracker — задачный модуль Z/Кора

> **Назначение:** бесплатный таск-трекер как PLG-точка входа в платформу Z/Кора. Каждое событие трекера → RawEvent → knowledge-core (принцип «трекер = источник для второго мозга»). Срок Wave 1 — 6 нед (2026-05-26 → 2026-07-06).

## Стратегический контекст

См. [`plans/analysis/2026-05-23-tracker-as-entry-wedge.md`](../../plans/analysis/2026-05-23-tracker-as-entry-wedge.md) — выбор сценария C (свой трекер на NestJS+Prisma+pgvector+Next.js, не Huly и не Plane). Главное отличие — простота YouGile + глубина Linear + AI вшит в knowledge-core (а не пришит сбоку).

## Расположение кода

- **Backend:** `backend/src/modules/tracker/` — 38+ файлов созданы Sprint 1.
- **Tracker module:** `tracker.module.ts` экспортирует `IssuesService`, `ActivityRecorderService`, `TrackerEventsService` (другие модули могут публиковать события и активность).
- **WebSocket gateway:** `gateways/tracker.gateway.ts` (namespace `/ws/tracker`, tenant rooms).
- **BullMQ worker:** `workers/webhook-delivery.worker.ts` (in-process, queue `tracker.webhook-delivery`).

## Модели Prisma (20 шт., 2026-05-24)

См. [`02_architecture/data-model`](../02_architecture/data-model.md) для полей. Список:

| Модель | Назначение |
|---|---|
| `Project` | Проект с slug/identifier/network/feature-flags/teamTemplateId |
| `ProjectMember` | M2M user↔project с role (20=Admin, 15=Member, 5=Guest) |
| `IssueState` | Статусы задач (Backlog/In Progress/Done/Cancelled) per project |
| `Cycle` | Недели работы с auto-rollover незакрытых задач |
| `Issue` | **Единственный слой задач** (после дропа legacy-`Task` 2026-06-25). Задача с parent (иерархия), sequenceId, identifier (KORA-123), goalId, `linkedMeetingIds` (канон связи встреча↔задача, GIN-индекс), externalSource. Фильтр `GET /api/v1/issues?linkedMeetingId` — задачи конкретной встречи; вкладка задач встречи пишет/читает Issue. |
| `IssueAssignee` | M2M issue↔assignees |
| `Label` + `IssueLabel` | Метки (per-project или global) |
| `IssueSubscriber` | Подписка на изменения задачи |
| `IssueMention` | `@`-упоминания в комментариях |
| `IssueComment` | Rich-text JSON + voice (voiceUrl/voiceDuration/voiceTranscript) + threading |
| `IssueAttachment` | S3 файлы (25 MB лимит, MIME whitelist) |
| `IssueLink` | Внешние ссылки |
| `IssueRelation` | blocks/blocked_by/duplicates/duplicated_by/relates_to (с auto-обратной парной) |
| `IssueActivity` | Audit-trail (actorType, verb, field, oldValue/newValue, epoch BigInt) |
| `IssueVersion` | Исторические снимки задачи (snapshot Json) |
| `IntakeIssue` | Входящие задачи перед триажем (status, source, AI suggestions) |
| `IssueWebhook` | Outgoing webhooks (secretKey префикс `kora_wh_`) |
| `IssueWebhookLog` | Лог доставки (success/fail, retry, response) |
| `TeamTemplate` | 10 шаблонов команд (sales/development/installation/marketing/management/customer_support/hr/finance/operations/product) |
| `IssueProgressUpdate` | **(2026-06-21, Волна 2)** Датированное обновление прогресса (health on_track/at_risk/off_track + body + done/next); авто-черновик `authorType=ai_agent`/`draftState=pending` из графа; колонки-снимок провенанса `previewQuote`/`previewSourceRef` |
| `IssueFieldDef` / `IssueFieldValue` | **(Ф9)** Кастом-поля задачи: дефиниция (`config Json`, per-project/Org, фракционный `order`) + значение per `(issueId, fieldId)` |
| `IssueAutomationRule` | **(Ф10)** Правила «если—то» (`trigger`/`conditions`/`actions` Json); движок на событии `tracker.event_occurred` + guard анти-рекурсии (appliedRuleIds + MAX_DEPTH) |
| `IssueRecurrence` / `IssueTemplate` | **(Ф11)** Повторяющиеся задачи (`rrule` freq/interval + cron материализации `recurrence-materialize`) + шаблоны задач |
| `IssueWorklog` | **(Ф12)** Учёт минут (`minutes`/`startedAt`) под флагом `Project.timeTrackingEnabled` |

**Расширения:**
- `Meeting.linkedIssueId` — для видеовстреч из задачи (`POST /issues/:id/start-meeting`).
- `Goal.linkedIssues[]` — стратегическое согласование с Фазы 1.
- `MeetingType.task_discussion` — новое значение enum.

## 2026-06-21 — Редизайн карточки + датированный прогресс + паритет (Волны 0-3)

ТЗ `plans/tz/2026-06-20-tracker-card-redesign-and-progress.md` (реализован, запушен `b1e9d3bc..a29b1516`). Подробности прод-выката — `docs/operations/prod-deploy-log.md` (блоки Трекер 2026-06-21).

- **Карточка/лицо (Волна 1):** `IssueCard` компакт-дефолт, 5 сигналов (чип-приоритет цвет+иконка+текст, прогресс-бар, дедлайн-чип срочности, чип источника «из встречи/решения» бренд-цветом, исполнитель), 2-строчный заголовок; тумблер «Компактно/Широко» (`useCardDensity`, localStorage, дефолт компакт) на Board+OrgBoard; широкий вид = превью описания + сниппет цитаты-источника + бейджи 💬/📎 (opt-in `includeEngagementCount`→`_count`). Sidebar: «Срок начала»/«Выполнена» + названия спринта/цели (не cuid). Крошка `/issues/[id]` → доска проекта (`projectSlug`/`projectName` в detail-DTO). Гант ON по умолчанию (`gantViewEnabled` default true + backfill).
- **Датированный прогресс (Волна 2):** сущность `IssueProgressUpdate`; воркер `progress-auto-draft.cron` (kill-switch) собирает дельта-сигналы (закрытые чек-пункты + `status_changed` + упоминания в графе через `TaskClosureCandidate`) → LLM `issue-progress-draft` → черновик `pending` (**НЕ авто-постинг — Р2**); провенанс-снимок через `ProvenanceService.computePreviewSnapshot`; в детали — лента+форма+подтверждение черновика; черновик всплывает в колокольчике (pending-source `progress_draft`, видим **исполнителю** задачи); catch-up `issue-activity-digest` (кнопка «Что произошло по задаче», on-demand, без хранения).
- **Паритет (Волна 3):** кастом-поля (`IssueFieldDef/Value`, валидация по type/config) · автоматизации (`IssueAutomationRule` + `automation-engine` на `tracker.event_occurred` + guard анти-рекурсии) · повторения+шаблоны (`recurrence-materialize.cron`, свой rrule-парсер daily/weekly/monthly) · worklog (`IssueWorklog` под `Project.timeTrackingEnabled`).
- **Новые REST:** `issues/:id/progress-updates`(+`progress-updates/:id/confirm`), `issues/:id/activity-digest`, `issues/:id/field-values`+`projects/:id/field-defs`, `automation-rules`, `templates`(+`/instantiate`)+`recurrences`, `issues/:id/worklogs`.
- **Новые воркеры/cron/движки:** `progress-auto-draft.cron` (07:00 UTC), `recurrence-materialize.cron` (06:00 UTC), `automation-engine` (`@OnEvent tracker.event_occurred`).
- **Новые LLM-taskType:** `issue-progress-draft`, `issue-activity-digest` (оба DEFAULT-цепочка DeepSeek/OpenAI-proxy; промпт-файлы cache-friendly).
- **Крутилки (страница `/admin/tracker`, каркас DomainSettings, все ON/Ship-On):** `tracker.progressAutoDraft{Enabled,MinSignals,Cron}`, `tracker.activityDigestEnabled`, `tracker.automationsEnabled`, `tracker.recurrence{Enabled,CronCadence}` (реестр — `docs/operations/feature-flags.md`).

## Спайн-специалист задач (unified-task-extraction, 2026-06-23)

ТЗ [`plans/tz/2026-06-23-unified-task-extraction.md`](../../plans/tz/2026-06-23-unified-task-extraction.md) (4 фазы, strangler-fig). _(Заход B извлекающего слоя, 2026-06-30: извлечение задач переведено на **combo** — единый разборщик `knowledge-specialists-combined` достаёт задачи/обещания тем же проходом, что граф, из canonical-блоков **встречи И чата**; per-block извлекающий спайн `Specialist315TasksWorker` снесён. См. ниже «Combo — единый источник задач».)_

- **Спайн-специалист `3-15-tasks`** (`Specialist315TasksWorker`/`Specialist315TasksService`, knowledge-core; см. [[../02_architecture/knowledge-core]] §RouterService, [[ai-jobs]]): canonical `IdeaBlock(signalType='action_item')` → LLM `task-extract` → `IntakeIssue` → `IntakeAutoTriageQueue` → `Issue`. RouterService: `action_item` → `SPECIALIST.TASKS` (PRIORITY 3.9, НЕ в `COMBINED_COVERED`); meeting/meeting_report пропускаются. Гейт уверенности `tracker.taskExtractMinConfidence` (0.45). **С захода B (2026-06-30) извлекающий спайн снесён:** `Specialist315TasksWorker` и роут `action_item→TASKS` (TASKS убран из `RouterService.SPECIALIST`/`PRIORITY`) удалены — задачи извлекает combo. **`Specialist315TasksService` ЖИВ** — держит `runClarifySweep` для `TaskClarifySweepCron` (см. §«Задачная часть» 2026-06-29); `action_item`-блоки по-прежнему строит нарезчик и читает граф (day-report-collector). _(До захода B: единственный путь извлечения задач из текстовых каналов — после дропа legacy-`Task` 2026-06-25 kill-switch `tracker.taskExtractionMode` и legacy chatbox task-extraction удалены.)_
- **Единый резолвер исполнителя** (Ф2): для текстовых каналов — канонический `tracker/AssigneeResolverService.resolve(tenantId, hint)` (substring-резолверы telegram-task-parser + intake-auto-triage удалены). Встречи сохраняют участник-резолвер `TaskAssigneeResolverService` (по identity ограниченного набора — НЕ дубль); chatbox сохраняет identity (`responsibleExternalId`).
- **Единый дедуп + LINK-семантика** (Ф3): общий cosine+judgeSame вынесен в DI-free util `knowledge-core/util/task-dedup-matcher.util.ts` (прежние сервисы `MeetingTaskDedupeService` + `CrossSourceTaskDedupeService` **удалены 2026-06-25** при дропе legacy-`Task` — дедуп задач теперь только через этот util). Серая зона → `tracker.taskDedupGrayBand` (0.07). Спайн-специалист дедупит кандидата против **открытых Issue** (`TaskDedupService.evaluate`, вне лока); на вердикт 'same' источник линкуется к существующему Issue через `TaskSource{issueId}` **без дубль-Issue** (kill-switch `tracker.taskDedupLinkSemantics`, link|delete, ON=link). Гонка «встреча+чат параллельно» закрыта: `pg_advisory_xact_lock(tenant+normTitle)` + in-lock exact-title + pending-IntakeIssue re-check (LLM вне лока). `autoAccept` пишет `TaskSource`-провенанс на каждый Issue. Схема `TaskSource` — [[../02_architecture/data-model]] §«TaskSource».
- **Task = явный пред-слой** (Ф4, Р-1): был однонаправленный промоут Task→Issue (`triageChatboxTask` при accept) с провенансом `TaskSource{issueId}`. **Дроп выполнен 2026-06-25** (ТЗ [`drop-legacy-task-model-unify-on-issue`](../../plans/tz/2026-06-25-drop-legacy-task-model-unify-on-issue.md)): `model Task` / `enum TaskStatus` снесены, задача — только `Issue`. `TaskSource` остался провенанс-моделью (только `issueId`). См. [[../02_architecture/module-map]] §«Дроп legacy-модели Task», [[../02_architecture/data-model]] §«Дроп legacy-модели Task».

## Combo — единый источник задач (заход B извлекающего слоя, 2026-06-30)

ТЗ [`plans/tz/2026-06-30-extraction-layer-rewrite.md`](../../plans/tz/2026-06-30-extraction-layer-rewrite.md) (заход B, ветка `work/2026-06-29`). Задачи/обещания извлекает **общий разборщик** `knowledge-specialists-combined` (combo) тем же проходом, что граф — из canonical-блоков **встречи И чата**. Tool combo переименован `submit_all_8_entities`→`submit_all_entities` (9-й выход — `tasks[]`). Промпт combo: правило «обещание = задача» (само-назначение автору реплики) + группировка соседних поручений одного автора в `subtasks[]` (шаги одного дела → одна задача + чек-лист, не N карточек). См. [[ai-jobs]] §«Переписывание извлекающего слоя — заход B».

- **`TaskDraftMaterializerService`** (`tracker/services/task-draft-materializer.service.ts`, провайдер+export в `TrackerModule`, инжектится в combo: knowledge-core→tracker, оба `@Global`, без цикла) — **канало-агностичный** материализатор task-черновиков combo → `IntakeIssue`. Идемпотентность `externalId=mat_<sha1(channel:sourceId:quote|title)>`; резолв исполнителя org-wide (`AssigneeResolverService`→skill-routing); дедуп-suggest против открытых Issue (`TaskDedupService.evaluate` → `suggestedDuplicateOfIssueId`); подзадачи → `IntakeIssue.checklistJson`; enqueue auto-triage. Метрика `task_draft_materialized_total{channel,status}`. Заменил прежний `persistTasks`.
- **Чек-лист до промоута:** `IntakeIssue.checklistJson Json?` (миграция `20260630030000_add_intake_issue_checklist_json`, форма `[{title?, items:[{text}]}]`) → материализуется в `IssueChecklist`/`IssueChecklistItem` при accept (util `intake-checklist-materialize.util.ts`, вызов из `intake-auto-triage.worker` + `intake.service`). Канон `TaskItemSchema` (`common.ts`) += `subtasks[]`. Схема — [[../02_architecture/data-model]] §IntakeIssue.
- **`MeetingExtractActionsService` снесён** — combo достаёт задачи встреч сам; caller в `analyze.worker` и метрика `ai_meeting_actions_extracted_total` retired. **Сохранено:** `prompts/tasks.ts` (code-fallback) и llm-router taskType `meeting-extract-actions` (пассивный, не вызывается).
- **Откат задач = рубильник combo** `knowledge.specialistsCombinedEnabled` — **отдельного фолбэка задач после сноса спайна/meeting-extract НЕТ** (принято владельцем, Ship-On). Выкат сноса gated на разовую прод-проверку (build-then-delete).

## Задачная петля: разговор → трекер → доуточнение → отклонение → закрытие (2026-06-23)

ТЗ [`plans/tz/2026-06-23-meeting-tasks-assignee-probe-closure-tz.md`](../../plans/tz/2026-06-23-meeting-tasks-assignee-probe-closure-tz.md) (Ф1–Ф9). Ветка `feature/2026-06-23-meeting-tasks-assignee-probe-closure`. Доводит задачную петлю до канона: задача из разговора → трекер с 4 сущностями, авто-уточнение **автору реплики**, отклонение/доработка словами, gate закрытия, уведомление постановщику, живая карточка. REALITY-CHECK: двухканальная доставка probe + закрытие при ОТВЕТЕ + создание задачи со встречи ВСЕГДА + движение карточки в «Готово» + gate конкретики для пути граф/чат уже были (PR #55 и ранее) — здесь надстроено.

- **Авторство реплик (Ф1):** `IdeaBlockEvidence` получил `authorPersonId`/`authorLabel` (миграция `20260623083858_evidence_author_person`, см. [[../02_architecture/data-model]] §IdeaBlockEvidence). `block-ingest` пишет автора реплики в evidence (`resolveEvidenceAuthor`), specialist-3-15 показывает автора каждой цитаты агенту; `SegmentBuilder.Segment.authorExternalLabel` несёт метку внешнего автора чат-бокса (`'Клиент'`). Фундамент для само-назначения и адресации probe.
- **Само-назначение «мне» (Ф3):** правило в промпте `tasks-unified` (BASE/STRUCTURED SYSTEM) — честное «задача мне / я сделаю / беру на себя» ставит исполнителем автора реплики; пересказ чужих слов агент отличает по смыслу (без жёсткого кода). meeting-extract enrich имён спикеров (`livekitIdentity→Person.fullName`).
- **Резолвер исполнителя встреч (Ф4):** meeting-extract резолвит исполнителя единым Org-wide `AssigneeResolverService` (все сотрудники Org, не только участники встречи); fallback на автора реплики при `assignee=null` — kill-switch `tracker.selfAssignAuthorFallbackEnabled` (ON).
- **Probe автору реплики + отклонение/доработка (Ф5):** probe `task.assignee_unresolved` со встречи адресуется **автору реплики** (не владельцу встречи). Новые reason `task.poorly_specified` («распиши подробнее») и `task.false_positive` («не задача»); текст probe содержит опцию «удалить». Мягкое обратимое удаление переиспользует существующее (`IssuesService.softDelete` / intake reject) — **без новой миграции**; окно возврата — крутилка `tracker.taskDismissUndoWindowHours` (24).
- **Общий диспетчер ответов задачи И решения (Ф6):** `ProbeResponseHandler` — отрицательная ветка для любого task-reason («удали/не задача» → мягкое удаление), `task.poorly_specified/false_positive` → дозапись в описание; новый `maybeApplyDecisionProbeAnswer` (решение: ответственный/срок/итог; «не решение» → `Decision.deletedAt`).
- **Gate закрытия в помощнике (Ф7):** `MeTasksService.completeTask` — при пустом note/непрошедшем LLM-gate `task-closure-verify` кандидат НЕ создаётся молча, поднимается probe `task.completion_detail_missing`; ответ на него создаёт `TaskClosureCandidate`. Kill-switch `tracker.completionDetailGateEnabled` (ON); `PostCompleteTaskResponseDto.candidateId` стал nullable + поля `needsDetail`/`clarificationQuestion`.
- **Уведомление постановщику (Ф8):** при подтверждении закрытия (`confirmTaskClosure`) постановщик (`Issue.createdById`) получает двухканальное уведомление «исполнитель закрыл — проверьте» (новый eventType `task.closed_for_review`, каналы in_app+telegram_bot+max_bot, рендереры в telegram/max адаптерах), кроме само-закрытия (создатель == подтвердивший, Р-7). Kill-switch `tracker.closureNotifyCreatorEnabled` (ON).
- **Живая карточка (Ф9):** `TaskCompletionHandler` при матче блока с открытой задачей + verdict «не выполнено» дописывает запись хода выполнения; описание/ручной ввод не перезатираются; идемпотентность по блоку-источнику. Kill-switch `tracker.livingCardEnabled` (ON). **Доработка 2026-06-27 (task-decision-execution-unified Ф3):** not-done-ветка вместо лёгкой `IssueActivity` пишет полноценный `IssueProgressUpdate` (`authorType='ai_agent'`, `draftState='pending'`, `health` on_track/at_risk по блокер-сигналу, `sourceBlockIds=[block.id]`, evidence/preview-цитата) — ход выполнения попадает в датированную ленту прогресса как pending-черновик, а не в audit-trail. Гейт уверенности `tracker.progressFromConversationMinConfidence` (0.6, анти-fatigue). Авто-переходов статуса из разговора нет (только pending). Заодно P7-фикс: embed-ретрай до `taskClosure.embedMaxAttempts` (3) — единичный флап эмбеддера больше не теряет матч кандидата закрытия. См. [[ai-jobs]] §«Задача·решение·исполнение».
- **Двухканальность + взаимное закрытие (Ф2):** `dismissProbe` гасит все `NotificationDelivery` (взаимное закрытие при отклонении); дедуп probe учитывает адресата за kill-switch `probe.recipientAwareDedupEnabled` (ON). Дозапросы/исполнение ответа для задач — см. [[probe-agent]].

Крутилки/флаги — реестр [feature-flags](../../docs/operations/feature-flags.md); прод-выкат — `docs/operations/prod-deploy-log.md` (блок 2026-06-23 «Задачная петля…»).

## SignalType — расширение для ingest

18 новых значений в Prisma enum `SignalType` (см. [`01_projects/llm-router`](llm-router.md) для общего списка):

- **8 task_***: `task_created, task_status_changed, task_blocked, task_completed, task_overdue, task_reassigned, task_comment, task_mention` — для tracker.adapter (B1-3.1, Sprint 3).
- **7 helpfulness**: `help_provided, proactive_hint, mentoring, emotional_support, constructive_feedback, question_unanswered, question_acknowledged_no_action` — для Specialist 3.8 Helpfulness Agent (Wave 2). Последние два — only-private-to-admin (этическая защита).
- **3 gamification**: `helped_by, helped_to, thanks_explicit` — для Recognition Agent (Wave 2).

## REST API endpoints

См. [`01_projects/api-layer`](api-layer.md) если есть, или [`plans/archive/2026-05-23-tracker-phase-1-models-api.md`](../../plans/archive/2026-05-23-tracker-phase-1-models-api.md). Сводка:

```
GET    /api/v1/projects                          # список + фильтры
POST   /api/v1/projects                          # + опц. teamTemplateId
GET    /api/v1/projects/:id
PATCH  /api/v1/projects/:id
DELETE /api/v1/projects/:id                      # soft-delete
POST   /api/v1/projects/:id/archive
POST   /api/v1/projects/:id/unarchive
GET/POST/DELETE /api/v1/projects/:id/members

GET    /api/v1/projects/:projectId/issues        # фильтры: state, assignee, label, cycle, goal
POST   /api/v1/projects/:projectId/issues
GET    /api/v1/issues/:id
PATCH  /api/v1/issues/:id
DELETE /api/v1/issues/:id
POST   /api/v1/issues/:id/transitions
POST/DELETE /api/v1/issues/:id/assignees
POST/DELETE /api/v1/issues/:id/labels
POST/DELETE /api/v1/issues/:id/subscribe
POST   /api/v1/issues/:id/link-goal
DELETE /api/v1/issues/:id/link-goal
POST   /api/v1/issues/:id/move                   # перенос в другой проект (2026-06-15): ре-аллокация sequenceId/identifier, ремап state по category, board=дефолт, cycle=null; запрет переноса задач с подзадачами; RBAC issue/write
GET    /api/v1/issues/:id/activity               # audit-trail
GET    /api/v1/issues/:id/versions

GET    /api/v1/issues/:id/comments
POST   /api/v1/issues/:id/comments               # rich-text + voice
PATCH  /api/v1/comments/:commentId
DELETE /api/v1/comments/:commentId

GET    /api/v1/issues/:id/relations              # blocks/duplicates/relates_to
POST   /api/v1/issues/:id/relations              # авто-парная обратная
DELETE /api/v1/relations/:relationId

POST   /api/v1/issues/:id/attachments            # multipart S3
GET    /api/v1/attachments/:id                   # presigned URL
DELETE /api/v1/attachments/:id

POST   /api/v1/issues/:id/start-meeting          # LiveKit JWT + Meeting.task_discussion

GET    /api/v1/projects/:projectId/cycles
POST   /api/v1/projects/:projectId/cycles
GET    /api/v1/cycles/:id
PATCH  /api/v1/cycles/:id
POST   /api/v1/cycles/:id/complete               # auto-rollover незакрытых
GET    /api/v1/cycles/:id/issues

GET    /api/v1/intake
POST   /api/v1/intake
POST   /api/v1/intake/:id/triage                 # accept | reject | snooze | duplicate
PATCH  /api/v1/intake/:id

GET    /api/v1/tracker/webhooks
POST   /api/v1/tracker/webhooks
PATCH  /api/v1/tracker/webhooks/:id
DELETE /api/v1/tracker/webhooks/:id
GET    /api/v1/tracker/webhooks/:id/logs
POST   /api/v1/tracker/webhooks/:id/test         # 202 enqueued

GET    /api/v1/team-templates
GET    /api/v1/team-templates/:slug
POST   /api/v1/projects/from-template            # 501 пока (Phase 4 / Sprint 9)
```

## WebSocket events (`/ws/tracker`)

- Auth: JWT из `handshake.auth.token` → cookie `z_session` → Authorization.
- Подключение автоматически subscribe на `tenant:${tenantId}` room.
- Опционально: `subscribe.project` / `subscribe.issue` (с tenant cross-check).

События:
- `issue.created/updated/deleted` (с `changedFields` для update)
- `issue.movedToProject` (`IssueMovedToProjectEvent`, 2026-06-15) — задача перенесена в другой проект; метрика `issue_moved_to_project_total`
- `comment.created/updated/deleted`
- `cycle.created/progressUpdated/completed`
- `intake.newItem`
- `activity_feed.newItem`

## Outgoing webhooks (HMAC SHA256 + retry)

- Очередь: `tracker.webhook-delivery` (BullMQ, in-process worker, concurrency: 8).
- Retry: 5 попыток, exp backoff 60s → 300s → 1500s → 7500s → 37500s.
- Headers: `X-Kora-Signature: sha256=<hex>`, `X-Kora-Event`, `X-Kora-Webhook-Id`, `X-Kora-Delivery`, `X-Kora-Timestamp`.
- Body: JSON `{ event, tenantId, webhookId, enqueuedAt, data }`.
- После 5 неудач: `webhook.isActive=false` + Notification владельцу (TODO Sprint 2-3).
- Каждая попытка → `IssueWebhookLog` (success/fail, requestHeaders/body, responseStatus/body 10KB truncate, responseTime ms).

## RBAC ResourceType

6 новых в `policy.csv` (Casbin):
- `project` — owner/admin/manager (write всем), member (read)
- `issue` — assignee + project_member (read), manager (write all), creator/manager (delete self)
- `cycle` — manager (write), project_member (read)
- `intake_issue` — admin/manager/coo (read + triage)
- `team_template` — all (read), admin (write)
- `issue_webhook` — admin (full CRUD), tenant-scope

## ENV-переменные (`backend/src/common/config/env.schema.ts`)

| Переменная | Default | Назначение |
|---|---|---|
| `WEBHOOK_HMAC_PREFIX` | `kora_wh_` | Префикс secret webhook'ов |
| `TRACKER_INGEST_QUEUE` | `core.raw-events` | BullMQ очередь ingest tracker_event (Sprint 3) |
| `IDEMPOTENCY_KEY_TTL_SECONDS` | `86400` | TTL Idempotency-Key в Redis (Sprint 2) |
| `TRACKER_WEBHOOK_MAX_RETRIES` | `5` | Макс. попыток |
| `TRACKER_WEBHOOK_RETRY_BACKOFF_INITIAL_MS` | `60000` | Начальная задержка retry, ms |

## Prometheus метрики

9 метрик (см. [`02_architecture/module-map`](../02_architecture/module-map.md)):
- Counter: `issues_created_total{tenant, project, source}`, `issues_completed_total{tenant, project}`, `intake_triaged_total{tenant, decision}`, `tracker_webhook_delivery_total{tenant, event, success}`, `tracker_webhook_retry_count{tenant, webhook_id}`, `tracker_events_to_knowledge_core_total{tenant, type}`.
- Gauge: `issues_by_state_count{tenant, project, state}`, `issues_overdue_count{tenant, project}`, `intake_pending_count{tenant}`.

⚠ Cardinality риск (TODO Sprint 7): label `tenant`/`project`/`webhook_id` напрямую. Миграция на top-100 hash bucket + 'other' — при подключении Grafana recording rules.

## Что осталось до DoD Phase 1 трекера

| Тикет | Что | Sprint | Статус |
|---|---|---|---|
| B1-3.1 | `tracker.adapter.ts` в `modules/ingest/adapters/tracker/` — слушает `tracker.event_occurred` → создаёт RawEvent с правильным signalType (8 task_*) | Sprint 3 | ✅ commit 3c547f7 (2026-05-24) |
| B1-3.2 | Goals integration: `goals/cron/strategic-alignment.cron.ts` issue-based (06:00 UTC), `StrategicAlignmentIssuesService` + Redis cache + AuditLog, probe-trigger `strategic_misalignment_high` (≥80% задач без goalId за 30д, минимум 5 задач), `GET /goals/:id/alignment-snapshot` cache-first | Sprint 3 | ✅ commit c628f80 (2026-05-24) |
| B1-3.3 | `backend/scripts/migrate-task-to-issue.ts` идемпотентный CLI (--dry-run/--apply/--org-id), assignee resolution 4 ступени, legacy `/api/v1/tasks` помечен @deprecated | Sprint 3 | ✅ commit 6b83cbb (2026-05-24) |
| Idempotency middleware на POST | `backend/src/common/idempotency/` — `IdempotencyService` (Redis TTL 86400) + middleware (Idempotency-Key header, кэшируются только 2xx + заголовок Idempotency-Replay: true). Применён к POST /api/v1/projects/:projectId/issues, /api/v1/issues/:id/comments, /api/v1/intake | Sprint 2 | ✅ commit 60def77 (2026-05-24) |
| WebSocket live refresh (frontend) | `socket.io-client@4.8.3` + `useTrackerLiveRefresh` — auto-revalidate `useIssues`/`useIssue`/`useCycles` через global SWR mutate при WS events (debounce 150ms) | Sprint 2 | ✅ commit 60def77 (2026-05-24) |
| Notification владельцу при webhook.isActive=false | Через ConversationalService | Sprint 2-3 | TODO |
| Sharp thumbnails для IssueAttachment | Отдельный воркер `attachment-thumbnail` | Sprint 3+ | TODO |
| task_discussion отдельный AI-промпт | Сейчас переиспользует `team` промпт | Sprint 3 | TODO |

## Frontend (F1 — отдельный поток с Sprint 3)

- `app/(authenticated)/projects/`, `/issues/`, `/me/inbox`, `/feed/` — заглушки + DTO-типы.
- Компоненты `<IssueCard>`, `<KanbanColumn>`, `<QuickAdd>`, `<IssueChat>`, `<ConciergeFloatingButton>`, `<ConciergeSheet>` — mobile-first.
- **Концьерж — главный вход через плавающий значок «Кора-помощник»**: на десктопе — правый нижний угол любой страницы; на мобиле — вкладка в bottom navigation. NL-парсинг через `concierge-parse` LLM из DialogService (после α-5).
- Cmd+K / Ctrl+K — **опциональный** desktop shortcut, открывает то же окно. Не блокирует MVP; ЦА (прорабы, менеджеры объектов, владельцы малого бизнеса) не запоминают горячие клавиши.
- Кнопки «+ Проект», «+ Задача», FAB «+ Задача» на мобиле — остаются как есть, параллельно с концьержем.
- PWA — manifest + service worker + web push.

См. [`plans/archive/2026-05-23-tracker-phase-2-frontend-mobile-first.md`](../../plans/archive/2026-05-23-tracker-phase-2-frontend-mobile-first.md).

## Mobile native (R1 — параллельный поток)

- React Native + Expo SDK 51+. Отдельный репозиторий `kora-mobile/`.
- Магазины: App Store + Google Play + RuStore (подтверждено владельцем 2026-05-24).
- Sprint 1 R1-1.1 (Bootstrap) — ожидает RN-среду владельца.

См. [`plans/tz/2026-05-23-tracker-mobile-native.md`](../../plans/tz/2026-05-23-tracker-mobile-native.md).

## Связь с другими модулями

| Модуль | Связь |
|---|---|
| [knowledge-core](../02_architecture/knowledge-core.md) | Tracker events → RawEvent → IdeaBlock через signalType (Sprint 3) |
| [chat-v2](chat-v2.md) | Чат-в-задаче (Sprint 5 — Phase 2) |
| [livekit](../02_architecture/ai-integration.md) | `POST /issues/:id/start-meeting` → LiveKit JWT |
| [decisions](decisions.md) | `Decision.linkedIssueIds[]` (Sprint 3+) |
| [insights](insights.md) | Pattern «5 задач в blocked у Иванова за неделю» через β-4 |
| [regulations](regulations.md) | Process steps извлекаются из чата задач |
| [conversational-channels](conversational-channels.md) | Telegram-бот для задач (Phase 4, Sprint 9-10) |
| **[sprints](sprints.md)** | Cycle расширен: AI-помощник (Specialist 3-13) + финальный AI-отчёт через CardVersion(resourceType='cycle'); Project получил 4 scope-поля; Meeting.linkedCycleId; MeetingType.sprint_review (2026-05-27). |

## Wave 3 — Phase 3 (AI) + Phase 4 (РФ) + Phase 5 (импорт) backend (2026-05-24)

7 параллельных subagent'ов в одной сессии оркестрации закрыли почти весь Phase 3+4+5 backend + frontend Wave 2 polish. ~14.5k строк + 162 теста. Главное открытие сессии: **handoff устарел** — β-8 (COO Dashboard), γ-2 (Concierge backend), α-8 (Role Map), α-9 (Company Foundation), δ-1 (Orchestrator), δ-2 (ProactiveWatcher), γ-3 (Cross-Functional) ВСЕ оказались реализованными до этой сессии. Реальный gap = Tracker Phase 3+4+5.

### Phase 3 — AI features (backend)

| Фича | Что реализовано |
|---|---|
| **KNN похожие задачи** | `Issue.embedding vector(1536)` + `embeddingHash` (commit 1c49eea). IssueEmbedWorker (sha256-skip). SimilarIssuesService (KNN cosine threshold 0.18). `GET /api/v1/tracker/issues/:id/similar`. HNSW partial-index в postgres-init.sql. |
| **meeting-extract-actions** | ~~После ai_ready встречи → MeetingExtractActionsService → IntakeIssue с suggested*.~~ **`MeetingExtractActionsService` снесён (заход B, 2026-06-30)** — задачи встреч извлекает combo (`knowledge-specialists-combined`) → `TaskDraftMaterializerService` → IntakeIssue (`suggested*` + `checklistJson`). LlmTaskType `meeting-extract-actions` оставлен пассивным; метрика `ai_meeting_actions_extracted_total` retired. См. §«Combo — единый источник задач». |
| **Ф7-калибровка интента (2026-06-15)** | Вопросы/команды сотрудников («какие у меня задачи?», `/actions`, запросы статуса) **больше НЕ становятся `IntakeIssue`/кандидатами в задачи**. Константа `NOT_A_TASK_DISCRIMINATOR` в хвосте SYSTEM-промптов (`common.ts` → `telegram-task-parser.service.ts` главный источник + `tasks-unified.ts` встречи/ChatBox); ChatBox теперь пишет в `Task`, не в `IntakeIssue`. ТЗ [`2026-06-15-intent-questions-are-not-commitments`](../../plans/archive/2026-06-15-intent-questions-are-not-commitments.md), коммит `dfb82a6f`. |
| **intake-auto-triage** | IntakeAutoTriageWorker (consumer `core.intake-auto-triage`). **A2 (2026-06-22):** задача со встречи (`source=meeting`) промоутится в `Issue` **ВСЕГДА** — без требования `assigneeId`/`projectId`/порога confidence: при `assigneeId=null` → Issue неназначенным, при `projectId=null` → дефолт-проект «Из встреч» (MTG, fallback «Входящие»), `lowQuality` тоже промоут (с лейблом); дедуп и `autoAcceptSources` сохранены. Закрывает корень «фильтр 4» (задачи висли в `/intake`, replay 0→7 PASS). Kill-switch `tracker.meetingTasksAlwaysPromote` (ON). ТЗ [`meeting-to-tracker-and-models-unified-fix`](../../plans/tz/2026-06-22-meeting-to-tracker-and-models-unified-fix.md) A2. LlmTaskType `intake-auto-triage`. |
| **issue-infer-fields** | POST /issues с `inferSuggestions: true` → IssueInferFieldsService → `aiSuggestions` inline в response (timeout 8s). LlmTaskType `issue-infer-fields`. |
| **issue-goal-suggest** | KNN (top-10, distance ≤ 0.20, voting ≥ 60%) → LLM fallback. LlmTaskType `issue-goal-suggest`. |
| **CardSpecialist для tracker** | IssueCardHandler + ProjectCardHandler в chat-v2 — AI-чат теперь отвечает на «покажи мои просроченные», «что обсуждали по KORA-123». |

### Phase 4 — РФ must-have (backend)

| Фича | Что реализовано |
|---|---|
| **Telegram-бот для задач** | TelegramTaskParserService — 4 LlmTaskType. TelegramBotMessageHandler — рутер text/voice/forward/reply, инжектится в TelegramBotChannelAdapter через @Optional. TelegramDigestCron `@Cron('0 9 * * *')` с Redis dedup. ASR через существующий VoxService. |
| **10 шаблонов команд** | sales / development / installation / marketing / management / customer_support / hr / finance / operations / product + 5 опц. (quality_control / legal / procurement / logistics / events). Системные (tenantId=null). Seed `scripts/seed-team-templates.ts`. |
| **POST /projects/from-template** | ProjectsFromTemplateService — Project + IssueState + ProjectMember + Regulation-заглушки + опц. примеры задач в транзакции. |
| **HolidayCalendar модель** | (commit 43253b2) Производственный календарь РФ 2026 (14 праздников). Seed `scripts/seed-holiday-calendar-ru-2026.ts`. HolidayService.isHoliday/nextBusinessDay/adjustDueDate. Интеграция в IssuesService — TODO Sprint 10. |

### Phase 5 — импорт (backend)

| Фича | Что реализовано |
|---|---|
| **ImportLog модель** | (commit 4b009cd) progress + errors + paramsJson + unmatchedJson. |
| **Trello JSON импорт** | TrelloImportStrategy — boards→Project, lists→IssueState, cards→Issue (идемпотент по externalSource+externalId), members→IssueAssignee, comments, attachments→S3 (best-effort). |
| **Битрикс24/Я.Трекер** | DTO + REST + strategies заглушки (NotImplemented). Реализация — Phase 5 part 2. |
| **Wizard endpoints** | POST `/api/v1/tracker/imports/{trello,bitrix24,yandex-tracker}` + GET list/`:id` + POST `:id/cancel`. WebSocket events `import.progress/completed/failed`. RBAC `import_tracker` (owner/admin only). |

### Frontend Wave 2 polish (Agent G)

5 быстрых wins:
1. **TTS озвучка ответа AI в IssueChat** — кнопка «🔊 Озвучить» через `voiceApi.synthesize`.
2. **/chat-v2?conversationId= deep-link** — `useSearchParams()` preselect + автопереключение архивного фильтра.
3. **Голосовой ввод в CommandPalette** — иконка-микрофон + `voiceApi.transcribe` → query.
4. **Recent/Pinned в Cmd+K idle** — localStorage `z:command-palette:recent/pinned` (max 10 each).
5. **Reorder в канбане** — `@dnd-kit/sortable` SortableContext + `arrayMove` + sortOrder=idx×1000 через PATCH /issues/:id.

### Метрики Prometheus (новые)

- `tracker_issue_embed_total{status}`, `tracker_issue_similar_search_total`.
- `ai_meeting_actions_extracted_total{status,by}`, `ai_intake_auto_accepted_total`, `ai_intake_suggested_total{status}`.
- `ai_issue_inferred_total{accepted}`, `ai_issue_goal_suggested_total{accepted,source}`.
- `telegram_{tasks_created,voice_transcribed,forwards,digest_sent,reply_classified}_total`.
- `team_template_used_total{slug}`, `holiday_due_date_adjusted_total`.
- `import_started_total{source}`, `import_completed_total{source,success}`, `import_issues_processed_total{source}`.

## Финальный handoff Wave 1-3 — Email-to-task + Multi-user чат (2026-05-25)

### Email-to-task (T5)

Новый модуль `backend/src/modules/mail-inbound/` — IMAP polling + routing на проекты по уникальному alias.

- Расширение Project: `emailInboxAlias String? @unique` + `emailInboxEnabled Boolean @default(false)`.
- Новая модель `MailInboundLog` + enum `MailInboundStatus` (см. [`02_architecture/data-model`](../02_architecture/data-model.md) §«MailInboundLog»).
- Cron `@Cron(MAIL_INBOX_POLL_CRON)` — default каждые 2 минуты (`*/2 * * * *`).
- Идемпотентность — `MailInboundLog.messageId @unique`.
- Routing: `To: <alias>@inbox.kora.app` → `Project` → `IntakeIssue` (если intakeViewEnabled) или прямо `Issue`. Attachments → S3 (тот же bucket, MIME whitelist 25 MB).
- 4 REST endpoint:
  - `POST /api/v1/projects/:id/email-inbox/enable` — включает + генерирует alias.
  - `POST /api/v1/projects/:id/email-inbox/disable`.
  - `POST /api/v1/projects/:id/email-inbox/regenerate-alias`.
  - `GET /api/v1/projects/:id/email-inbox` — текущее состояние (alias, enabled, поток последних 10 писем).
- 4 метрики `z_mail_inbound_{received,routed,rejected,duplicates}_total`.
- UI — секция в `/projects/[slug]/settings`: переключатель + копи-кнопка адреса + кнопка «Сгенерировать новый адрес».
- 9 новых ENV: `MAIL_IMAP_HOST/PORT/USER/PASSWORD/TLS/MAILBOX`, `MAIL_INBOX_POLL_CRON`, `MAIL_INBOX_DOMAIN`, `MAIL_ATTACHMENT_MAX_BYTES`.

### Multi-user чат в задаче (T8)

Расширение `tracker.gateway.ts` + новый `comments`-flow с @mentions.

- WS events (namespace `/ws/tracker`):
  - `issue.chat.join { issueId }`, `issue.chat.leave { issueId }`.
  - `issue.chat.typing { issueId, typing }` (throttle 800ms).
  - `issue.chat.presence { issueId, users: [{userId, name, since}] }` (broadcast по issue-room).
- `CommentsService.create` детектит `@mention` (через `IssueMention.create`) → `ConversationalService.sendNotification({ eventType: 'issue.mention', payload })`. Payload schema в `event-payload.registry.ts`.
- Новый сервис `my-mentions.service.ts` + endpoint `GET /api/v1/me/mentions?cursor=&limit=&issueId=`.
- Frontend `src/ui/tracker/IssueComments.tsx` переписан (был stub):
  - Presence widget сверху (аватары + tooltip с last-seen).
  - Typing indicator («Иван печатает…»).
  - `<MentionAutocompletePopup>` (комбобокс) на `@` — выпадашка с members проекта.
  - Live-update через `useTrackerLiveRefresh`.
- 15 backend + 4 frontend тестов.

### Связь с другими T-тикетами handoff Wave 1-3

| T | Что это значит для tracker |
|---|---|
| T1 | `feed/spotlights/page.tsx` теперь интегрирован с RecognitionWidget |
| T2 | `/admin/helpfulness-overview` использует ту же UI-base, что трекер-админка |
| T6a | `useMyInboxCount` теперь работает на реальном `/api/v1/me/inbox/count` endpoint (badge цифры в TrackerBottomNav) |
| T6b | `IssueChat.tsx` использует `scope='issue'` (нативный) вместо workaround `scope='card'` |

## История реализации

- **2026-06-29 (Пересмотр уточняющих вопросов Коры — задачная часть):** ТЗ [`2026-06-29-kora-clarify-questions-overhaul.md`](../../plans/tz/2026-06-29-kora-clarify-questions-overhaul.md) (6 фаз, ветка `work/2026-06-29`). Что изменилось в задачах: (Ф3) **адресат probe задачи = ПОСТАНОВЩИК (автор реплики)** — `task.assignee_unresolved`/`task.due_date_missing` уходят автору реплики через резолвер `resolveSetterRecipient` (`authorPersonId` ведущей evidence → `Person.userId`, tenant-scoped), фолбэк на owner Org только если автор не определён (раньше уходило первому owner Org — был баг); (Ф4) **probe про срок на извлечении** — если исполнитель есть, а `dueDate==null`, при извлечении поднимается `task.due_date_missing` постановщику + новый **`TaskClarifySweepCron`** (`task-clarify-sweep.cron.ts`, `@Cron` hourly МСК, в `src/modules/ai/workers.module.ts`) → `Specialist315TasksService.runClarifySweep` (ежедневный добор pending `IntakeIssue` старше N часов без исполнителя/срока → probe постановщику, дедуп = идемпотентность); (Ф5) **НОВЫЙ probe `task.method_capture` «расскажи, как решал»** — хук в `IssuesService.transitionState` при ПЕРВОМ переходе задачи в completed (gate `!existing.completedAt`) → `maybeRaiseMethodCaptureProbe` на ЗНАЧИМЫХ задачах (эвристика `computeMethodCaptureComplexity` по длине описания/числу `IssueActivity`/времени жизни/приоритету ≥ порога) шлёт **исполнителю** вопрос «расскажи пошагово, как решал (можно голосом)» без inline-кнопок; старый узкий probe `task.completion_detail_missing` (`me-tasks.completeTask`) **снят** (остаётся синхронный inline-гейт `needs_detail`; reason+apply-handler сохранены для совместимости); эмиттеры `task-method-capture`/`specialist-3-15-tasks-sweep`; (Ф6) ответ на `task.method_capture` помечается `signalTypeHint:'reasoning'` → метод-знание. 5 новых крутилок (все kill-switch ON / Ship-On): `tracker.taskClarifySweep.{enabled,hourMsk(10),minAgeHours(20)}` + `tracker.methodCaptureEnabled` + `tracker.methodCaptureMinComplexity(0.5)` + `tracker.methodCapturePriorityHint(0.7)`. Параллельно снесены probe-инспекторы решений (Ф1) и обещаний (Ф2) — это вне трекера, см. [[probe-agent]] §«Пересмотр уточняющих вопросов» и [[probe-observers-catalog]]. Крутилки/флаги — [feature-flags](../../docs/operations/feature-flags.md); cron/триггер — [[workers-queues]].
- **2026-06-29 (Утренняя сводка задач — персональный дайджест открытых задач):** новый проактивный ритм — каждое утро по МСК каждый активный сотрудник получает ОДНО уведомление со всеми своими открытыми задачами (eventType `tasks.daily_open`), сгруппированными Просрочено/Срок сегодня/В работе/Запланировано; пустой день → «всё чисто». Лёг на готовые рельсы (единый «почтальон» `ConversationalService`, мультиканальная доставка, AdminSetting) — **без новых Prisma-моделей/колонок/миграций** (идемпотентность рассылки = дедуп по существующей `Notification` за МСК-сутки). Новое: `MorningTasksDigestService` (чистый сбор/группировка, юнит-тесты) + `MorningTasksDigestCron` (`@Cron('0 * * * *', Europe/Moscow)` — ежечасный тик + гейт по часу-крутилке МСК, закрывает D4 для этого крона) + payload-схема + рендер `tasks.daily_open` в telegram/max/email + фронт (label + сгруппированный рендер в `/me/notifications`) + 5 крутилок `tracker.morningDigest.{enabled,hourMsk,channels,maxItemsTotal,sendWhenEmpty}` (kill-switch ON, Ship-On). Метрика `z_tracker_morning_digest_total{is_empty}`. vNext (в [[../04_не-сделано/README|реестре не-сделано]]): руководительский разрез по команде; вынос доставки в BullMQ-очередь при >2000 активных сотрудников/тенант. ТЗ [`2026-06-29-morning-tasks-digest.md`](../../plans/tz/2026-06-29-morning-tasks-digest.md) (ветка `feature/morning-tasks-digest`). См. [[workers-queues]] §`morning-tasks-digest`.
- **2026-06-23 (задачная петля «разговор→трекер→доуточнение→отклонение/закрытие», Ф1–Ф9):** авторство реплик в `IdeaBlockEvidence` (`authorPersonId`/`authorLabel`, миграция `20260623083858_evidence_author_person`) → само-назначение «мне» в промпте `tasks-unified` → Org-wide резолвер исполнителя встреч → probe `task.assignee_unresolved` адресуется автору реплики + новые reason `task.poorly_specified`/`task.false_positive` + опция «удалить» (мягкое обратимое удаление, переиспользует существующее, без миграции) → общий `ProbeResponseHandler` для задач И решений (`maybeApplyDecisionProbeAnswer`) → gate конкретики в concierge-закрытии (`completeTask`→probe `task.completion_detail_missing`) → уведомление постановщику при закрытии (eventType `task.closed_for_review`, кроме само-закрытия) → живая карточка (`IssueActivity verb='conversation_note'` из разговоров, идемпотентно). 6 kill-switch/крутилок (`tracker.{selfAssignAuthorFallbackEnabled,taskDismissUndoWindowHours,completionDetailGateEnabled,closureNotifyCreatorEnabled,livingCardEnabled}` + `probe.recipientAwareDedupEnabled`). REALITY-CHECK: половина Ф1/Ф2 уже была в PR #55. Подробности — §«Задачная петля…» выше. ТЗ [`2026-06-23-meeting-tasks-assignee-probe-closure-tz.md`](../../plans/tz/2026-06-23-meeting-tasks-assignee-probe-closure-tz.md) (ветка `feature/2026-06-23-meeting-tasks-assignee-probe-closure`).
- **2026-06-23 (унификация извлечения задач на спайн, strangler-fig):** извлечение задач из НЕ-meeting-каналов переведено на общий спайн графа — новый специалист `3-15-tasks` (`signalType=action_item` → LLM `task-extract` → IntakeIssue), единый `AssigneeResolverService` для текстовых каналов, единый дедуп с LINK-семантикой (`TaskSource{issueId}`, без дубль-Issue) + advisory-lock race-guard, Task = явный пред-слой с провенанс-промоутом Task→Issue. Kill-switch `tracker.taskExtractionMode`/`taskDedupLinkSemantics` (оба ON) + крутилки `taskExtractMinConfidence`/`taskDedupGrayBand`. 2 миграции (`action_item` enum, `TaskSource.issueId`). _(Позже, 2026-06-25, `model Task` дропнута целиком, `tracker.taskExtractionMode` удалён — см. §«Спайн-специалист задач» и [[../02_architecture/module-map]] §«Дроп legacy-модели Task».)_ Сверх фичи — chatbox-анализ не зависает (enqueue после синка + самолечащий sweep каждые 10 мин, gauge `z_chatbox_stuck_analyzing_sessions`) + сквозной chain-тест (8 сценариев). Подробности — §«Спайн-специалист задач» выше. ТЗ [`2026-06-23-unified-task-extraction.md`](../../plans/tz/2026-06-23-unified-task-extraction.md) (ветка `feature/unified-task-extraction`, коммиты `72249ebe`/`ee6ef1fa`/`658b3194`/`3dbd2627`/`e17a3cf6`/`764bd39c`).
- **2026-06-22 (задачная подсистема — единый фикс A→C→B→D):** ключевой сдвиг поведения — **задача создаётся ВСЕГДА** (не 404/409): при неясном исполнителе/сроке создаётся Issue (без исполнителя) и поднимается уточняющий вопрос (probe `task.assignee_unresolved` / `task.due_date_missing`); ответ на probe исполняется (исполнитель через резолвер+`addAssignee`, срок через `parseRussianDueDate`) и **обучает `SubjectMemory`** (отдел/роль→человек, retrieve-before-ask — в следующий раз не переспрашивает). Резолвер `AssigneeResolverService` расширен (`via:'name'|'memory'`, `kind:'collective'`, детект отдел/роль). Не теряем задачи: гейт качества задачи встречи НЕ дропает (IntakeIssue создаётся всегда, `suggestedPriority='low'`, дедуп против открытых Issue → `suggestedDuplicateOfIssueId`); переписочные задачи (`Task`) видны в триаже `/intake` (read-union, без дубль-записи) + промоут Task→Issue. Напоминания: задачи без срока в утренней сводке (push `priorityTier:1`), просрочка исполнителю (`issue.overdue`, дедуп `lastOverdueDetectedAt`), вечерняя сверка плана дня названиями незакрытых пунктов, «ждёт подтверждения» в кабинет (in_app). Юзер-facing суточные кроны переведены на МСК (`timeZone: 'Europe/Moscow'`). Новые kill-switch (ON, Ship-On) + крутилки — см. [feature-flags](../../docs/operations/feature-flags.md). Метрики `task_assignee_clarify_total{outcome}` / `z_chatbox_tasks_owner_missing_total`. ТЗ [`2026-06-22-tasks-subsystem-unified-fix`](../../plans/tz/2026-06-22-tasks-subsystem-unified-fix.md) + QA-пачка [`2026-06-22-qa-feedback-batch`](../../plans/tz/2026-06-22-qa-feedback-batch.md) (Ф2: фильтр «Мои» + все члены Org в выпадашке + скролл доски + дефолт-список).
- **2026-05-25 (финальный handoff Wave 1-3):** 7 тикетов закрыто, 11 push-коммитов. Email-to-task + Multi-user чат + KIE/GRSAI providers + Voice WS + Recognition/Helpfulness frontend + Prompts-hardening P1 + SPO discovery. См. [`05_история/2026-05-25-handoff-full-close.md`](../05_история/2026-05-25-handoff-full-close.md) (если создан).
- **2026-05-24:** Sprint 1 + большая часть Sprint 2 закрыты за 1 сессию оркестрации (9 параллельных subagent'ов, ~10 200 строк). См. [`05_история/2026-05-24-tracker-sprint-1-orkestratsiya-9-agentov.md`](../05_история/2026-05-24-tracker-sprint-1-orkestratsiya-9-agentov.md).
- **2026-05-24 (Sprint 3 finishing):** B1-3.2 + B1-3.3 + общий IdempotencyService + socket.io-client live refresh закрыты за 3 параллельных subagent'ов (~3 900 строк). См. [`05_история/2026-05-24-sprint3-finishing.md`](../05_история/2026-05-24-sprint3-finishing.md).
- **2026-05-24 (Wave 2 backend + Phase 2 frontend):** Activity Feeds + Specialist 3.8 Helpfulness + Recognition + Gamification + Phase 2 канбан drag-n-drop + PWA закрыты за 6 параллельных subagent'ов (~13 100 строк, 9 Prisma моделей + 12 cron + 4 worker + 14 controllers + 6 хуков + 188 тестов). Открытие сессии: α-5 DialogService уже полностью был реализован — Agent 18 не запускался. См. [`05_история/2026-05-24-wave2-backend-frontend.md`](../05_история/2026-05-24-wave2-backend-frontend.md).
- **2026-05-24 (Wave 2 finishing + Phase 2 polish):** 8 параллельных subagent'ов закрыли мелкие связки и большие новые модули — Helpfulness→Recognition bridge, Recognition→ActivityFeed publish, HNSW pgvector index, seed helpfulness LlmTaskRoute, backend web-push (PushSubscription модель + endpoints + worker + cron), IssueChat реальный AI-чат с голосовым вводом, Cmd+K CommandPalette с AI ask, Toast/Pagination/Badge мелкие polish. ~3 700 строк, 9 коммитов. См. [`05_история/2026-05-24-wave2-finishing.md`](../05_история/2026-05-24-wave2-finishing.md).
- **2026-05-24 (Wave 3 — Phase 3+4+5 backend + frontend Wave 2 polish):** 7 параллельных subagent'ов за одну сессию закрыли почти весь Tracker Phase 3 AI features + Phase 4 РФ + Phase 5 импорт + 5 frontend polish wins. Главное открытие — handoff устарел: β-8/α-8/α-9/γ-2/δ-1/δ-2/γ-3 УЖЕ реализованы до этой сессии (см. tracker, conversational, processes, role-map, company-foundation, orchestrator, operations, proactive модули). ~14.5k строк, 7 коммитов, 162 теста passed, оба typecheck зелёные. См. [`05_история/2026-05-24-wave3-phase3-4-5-orchestration-7-agents.md`](../05_история/2026-05-24-wave3-phase3-4-5-orchestration-7-agents.md).

## Активные планы

- [Sprint Plan Wave 1](../../plans/sprints/2026-05-24-sprint-plan-wave-1.md) — детальный план 3 спринтов × 2 нед.
- [Зонтичный план COO + Tracker](../../plans/archive/2026-05-23-coo-and-tracker-umbrella.md) — карта всех sub-ТЗ.
- [Phase 1 sub-ТЗ](../../plans/archive/2026-05-23-tracker-phase-1-models-api.md), [Phase 2](../../plans/archive/2026-05-23-tracker-phase-2-frontend-mobile-first.md), [Phase 3](../../plans/archive/2026-05-23-tracker-phase-3-ai-features.md), [Phase 4](../../plans/tz/2026-05-23-tracker-phase-4-rf-musthave.md), [Phase 5](../../plans/archive/2026-05-23-tracker-phase-5-import.md).

---

_Создан: 2026-05-24 (Sprint 1 финал)._
