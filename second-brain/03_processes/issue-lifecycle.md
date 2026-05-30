---
name: issue-lifecycle
title: Жизнь задачи в трекере (от создания до закрытия)
trigger_type: user_action
status_overall: implemented
last_audited: 2026-05-29
owners_human:
  - продакт трекера
  - инженер tracker-модуля
related_plans:
  - plans/tz/2026-05-23-tracker-phase-1-models-api.md
  - plans/tz/2026-05-23-tracker-phase-2-frontend-mobile-first.md
  - plans/tz/2026-05-23-tracker-phase-3-ai-features.md
  - plans/tz/2026-05-23-coo-and-tracker-umbrella.md
  - plans/sprints/2026-05-24-sprint-plan-wave-1.md
related_projects:
  - 01_projects/tracker.md
  - 01_projects/ingest-and-sources.md
---

# Жизнь задачи в трекере

> **Как читать:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Номера шагов между разделами 3 и 5 синхронизированы.

## 1. О чём это (бытовой рассказ)

Трекер — это место, где живут задачи компании: что надо сделать, кто отвечает, к какому сроку, на каком шаге работа. Любая задача в Z проходит один и тот же путь от момента «человек придумал, что надо сделать» до момента «задача закрыта, всё готово». По дороге задача меняет статус (например, «в работе» → «на проверке» → «готово»), к ней назначают людей, добавляют метки и приоритет, прикрепляют файлы, открывают подзадачи, связывают её с другими задачами («эта блокирует ту», «эти две — одно и то же»), пишут комментарии. Все эти действия видны в ленте активности задачи, чтобы потом можно было поднять историю и понять, кто что и когда сделал.

Главная идея: **задача в трекере — это не только запись в базе, это поток событий**. Каждое изменение задачи (создали, перевели в новый статус, оставили комментарий, добавили @упоминание) одновременно делает три вещи: (1) обновляет саму задачу; (2) рассылает обновления подключённым клиентам (страница задачи у другого человека автоматически перерисовывается); (3) посылает наружу события для тех, кто на эту задачу «подписан» — это могут быть внешние системы по http-вебхукам и собственный «второй мозг» Z, который из этих событий собирает память компании.

Задача может родиться разными путями: человек нажал «+ Задача» в интерфейсе; пришёл вебхук из внешней системы (например, импорт из Trello); упало письмо на специальный адрес почты проекта; AI извлёк действие (action item) из встречи и положил в «Входящие» (Intake) для триажа. Закрывается задача переводом в статус категории `completed` или soft-удалением. Между этими двумя точками — длинная цепочка действий, и каждое из них должно быть атомарным, идемпотентным и записанным в аудит.

## 2. Что запускает (триггер)

- **Тип:** действие пользователя (основной) + webhook внешней системы (импорт / email) + AI-агент (Intake / meeting-extract-actions).
- **Кто или что инициирует:**
  - человек жмёт «+ Задача» / голосовая команда / Cmd+K из интерфейса;
  - письмо на `<alias>@inbox.kora.app` (модуль `mail-inbound`);
  - импорт из Trello / Битрикс24 / Я.Трекер (`POST /api/v1/tracker/imports/...`);
  - AI извлёк action item из встречи → `IntakeIssue` → авто-триаж или ручной accept.
- **Технический источник:** `POST /api/v1/projects/:projectId/issues` (основная точка). Дальше — серия `PATCH /api/v1/issues/:id`, `POST /api/v1/issues/:id/transitions`, `POST /api/v1/issues/:id/comments` и так далее.

## 3. Шаги процесса (общий список)

1. **Создание задачи.** Пользователь (или адаптер) шлёт POST с заголовком, проектом, опц. описанием/исполнителями/метками/целью. Сервис проверяет права, валидирует, в транзакции создаёт `Issue` + назначения + метки + первую запись в ленте активности.
2. **Рассылка «задача создана».** Сразу после транзакции — три fire-and-forget сигнала: (а) WebSocket-событие `issue.created` в комнату tenant'а и проекта; (б) исходящие webhook'и подписчикам (HMAC SHA256 + ретраи); (в) шина `tracker.event_occurred` → ingest в «второй мозг».
3. **AI-подсказки** (если попросили флагом `inferSuggestions=true`). Параллельно дёргаются два LLM-сервиса: предложение исполнителя/срока/приоритета/меток и предложение цели. Если успевают за 8 секунд — `aiSuggestions` подмешиваются в ответ.
4. **Переходы статуса.** Через `POST /api/v1/issues/:id/transitions` или PATCH. Сервис записывает в `IssueActivity` (verb='status_changed'), эмитит событие в шину; для категорий `blocked` и `completed` — дополнительные узкие события. Метрики `issues_by_state_count` обновляются гейджем.
5. **Назначения, метки, подписки.** Каждая операция — отдельный POST/DELETE, каждая пишет строку в `IssueActivity`, рассылает `issue.updated` с `changedFields`, эмитит специфическое событие (`assignee_changed`).
6. **Комментарии и @упоминания.** Rich-text JSON + опционально голосовая запись с транскриптом. На каждое @ — `IssueMention` + личная нотификация (in-app/telegram/max) через `ConversationalService.sendNotification`. Параллельно — два события в шину: `comment.created` и `mention.created` для каждого упомянутого.
7. **Связи между задачами.** Создание `IssueRelation` транзакционно создаёт парную обратную (если `A blocks B` → `B blocked_by A`). Идемпотентно. Каждая сторона получает запись в ленте активности.
8. **Файлы.** Multipart-загрузка, лимит 25 MB, MIME-whitelist. Файл идёт в S3, возвращается presigned URL.
9. **Подзадачи (sub-tasks).** Через `parentId` при создании; валидация против циклов; метрика `subtasks_created_total`. Дерево хранится плоско, с обходом по `parentId`.
10. **Старт встречи из задачи.** `POST /api/v1/issues/:id/start-meeting` создаёт `Meeting(type=task_discussion, linkedIssueId=…)` + host-Participant, идемпотентно создаёт LiveKit room, генерирует host JWT, пишет в ленту активности (`meeting_started`).
11. **Просрочка.** Крон `issue-overdue-detector` сам обнаруживает задачи с прошедшим `dueDate` и эмитит `issue.overdue_detected` от actor='system'.
12. **Закрытие.** Перевод в статус категории `completed` (= шаг 4 + специфичное событие `task_completed`) или soft-delete (`DELETE /api/v1/issues/:id`).

## 4. Что получается на выходе

- **На странице задачи** `/projects/[slug]/issues/[id]` (или прямой ссылке) — карточка с тегами, комментариями, лентой активности, связями, файлами, кнопкой «Запустить встречу».
- **В лентах** `/projects/[slug]/board` (Kanban), `/projects/[slug]/list`, `/projects/[slug]/cycles/[cycleId]`, `/me/inbox` — обновляются live через WebSocket (`useTrackerLiveRefresh`).
- **В аудите** `IssueActivity` — полная история действий с epoch (BigInt микросекунд), доступна через `GET /api/v1/issues/:id/activity`.
- **Снаружи** — на каждое событие летят http-webhook'и подписчикам (HMAC-подпись).
- **В «втором мозге»** — отдельный процесс [[tracker-to-knowledge]] делает из этих же событий `RawEvent` → `IdeaBlock`.

## 5. Технический разрез (по шагам)

| # | Шаг | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Создание задачи | Проверка прав через `RbacService.canWrite('issue')`, валидация Zod, опциональное смещение `dueDate` через `HolidayService`, генерация `sequenceId`/`identifier` (`KORA-N`), `prisma.$transaction` создаёт `Issue` + `IssueAssignee[]` + `IssueLabel[]` + `IssueActivity(verb='created')` | `backend/src/modules/tracker/controllers/issues.controller.ts:108`, `backend/src/modules/tracker/services/issues.service.ts:131-261` | `POST /api/v1/projects/:projectId/issues` | `Issue`, `IssueAssignee`, `IssueLabel`, `IssueActivity` | ✅ |
| 2a | WebSocket «issue.created» | `TrackerEventsService.publishIssueCreated` → `TrackerGateway` рассылает в rooms `tenant:<id>` и `project:<id>` | `backend/src/modules/tracker/services/tracker-events.service.ts:72-90`, `backend/src/modules/tracker/gateways/tracker.gateway.ts:1-120` | namespace `/ws/tracker`, событие `issue.created` | — | ✅ |
| 2b | Outgoing webhooks | `WebhookDispatcher.dispatch(tenantId, 'issue.created', payload)` → находит активные `IssueWebhook` с подписью на событие → кладёт jobs в BullMQ. `WebhookDeliveryWorker` шлёт HTTP с `X-Kora-Signature: sha256=<hex>`, ретраит 5 попыток (60s→300s→1500s→7500s→37500s), пишет каждую попытку в `IssueWebhookLog`. После исчерпания — `webhook.isActive=false` | `backend/src/modules/tracker/services/webhook-dispatcher.service.ts:71-100`, `backend/src/modules/tracker/workers/webhook-delivery.worker.ts:46-80`, `backend/src/modules/tracker/services/webhook-signer.service.ts` | `tracker.webhook-delivery` (concurrency 8) | `IssueWebhookLog`, `IssueWebhook.isActive` | ✅ |
| 2c | Эмит в шину `tracker.event_occurred` | `TrackerEmitterService.emitIssueCreated(issue, userId)` через `EventEmitter2.emit` (синхронный) — слушатель в `IngestModule`. Подробности — [[tracker-to-knowledge]] | `backend/src/modules/tracker/services/issues.service.ts:261`, `backend/src/modules/tracker/services/tracker-emitter.service.ts:86-98` | event-name `tracker.event_occurred` | — | ✅ |
| 3 | AI-подсказки | Если `dto.inferSuggestions=true` — `collectAiSuggestions()` параллельно вызывает `IssueInferFieldsService.inferFields` (assignee/dueDate/priority/labels) и `IssueGoalSuggestService.suggestGoal` (KNN по эмбеддингам целей + LLM-fallback). Таймаут 8s, ошибки игнорируются | `backend/src/modules/tracker/services/issues.service.ts:281-340`, `issue-infer-fields.service.ts`, `issue-goal-suggest.service.ts` | LLM `taskType=issue-infer-fields` + `issue-goal-suggest` | — (inline в response) | ✅ |
| 4 | Переход статуса | `transitionState(id, dto)` или PATCH `stateId` → транзакция: `Issue.stateId` update + `IssueActivity(verb='status_changed', oldValue, newValue)`. После транзакции — `emitStateChangeIfNeeded` грузит old/new `IssueState`, эмитит общее `issue.status_changed` + специфичное `issue.status_changed_to_blocked` / `_to_done` по `newState.category`. WS `issue.updated` с `changedFields=['stateId']`, webhook `issue.updated` | `backend/src/modules/tracker/services/issues.service.ts:1264-1308`, `controllers/issues.controller.ts:193` | `POST /api/v1/issues/:id/transitions` или `PATCH /api/v1/issues/:id` | `Issue`, `IssueActivity` | ✅ |
| 5 | Назначения / метки / подписки | `addAssignees`, `removeAssignee`, `addLabels`, `removeLabel`, `subscribe`, `unsubscribe` — каждый POST/DELETE, транзакция + `IssueActivity` + emit. `emitIssueAssigneeChanged` шлёт `task_reassigned` сигнал | `backend/src/modules/tracker/services/issues.service.ts:953,991`, `services/labels.service.ts`, `controllers/issues.controller.ts:210-298` | `POST/DELETE /api/v1/issues/:id/assignees`, `…/labels`, `…/subscribe` | `IssueAssignee`, `IssueLabel`, `IssueSubscriber`, `IssueActivity` | ✅ |
| 6 | Комментарии и @упоминания | `CommentsService.create` — транзакция: парсит @mentions из rich-text → создаёт `IssueComment` + `IssueMention[]` + `IssueActivity(verb='commented')`. После — WS `comment.created`, эмитит `comment.created` + `mention.created` для каждого упомянутого. Для каждого `@user` — `ConversationalService.sendNotification(eventType='issue.mention', preferredChannelKinds=['in_app','telegram_bot','max_bot'])` (себя не нотифицирует) | `backend/src/modules/tracker/services/comments.service.ts:50-180`, `controllers/comments.controller.ts` | `POST /api/v1/issues/:id/comments` | `IssueComment`, `IssueMention`, `IssueActivity`, `Notification` (через ConversationalService) | ✅ |
| 7 | Связи (blocks/duplicates/relates_to) | `RelationsService.createRelation` — транзакция: создаёт прямую + парную обратную связь (`oppositeRelationType()`), идемпотентно (если уже есть — возвращает существующую). `IssueActivity(verb='related')` для обеих сторон. WS-события | `backend/src/modules/tracker/services/relations.service.ts:80-200`, `controllers/relations.controller.ts` | `POST /api/v1/issues/:id/relations`, `DELETE /api/v1/relations/:id` | `IssueRelation` (×2), `IssueActivity` (×2) | ✅ |
| 8 | Файлы | `AttachmentsService.upload` валидирует MIME (whitelist 9 префиксов) и размер (25 MB), кладёт через `S3Service` (key=`tracker/<tenantId>/<issueId>/<nanoid>-<name>`), создаёт `IssueAttachment`, возвращает presigned URL. Thumbnails через Sharp — TODO Sprint 3+ | `backend/src/modules/tracker/services/attachments.service.ts:1-100`, `controllers/attachments.controller.ts` | `POST /api/v1/issues/:id/attachments` (multipart), `GET /api/v1/attachments/:id` | `IssueAttachment` | ✅ (без thumbnails) |
| 9 | Подзадачи | `validateParent()` в `IssuesService` блокирует cyclic-parent и cross-tenant-parent. Метрика `subtasks_created_total{tenant,project}` инкрементится после транзакции. Frontend компонент `<SubtasksBlock>` ведёт обход через `GET /issues/:id/children` | `backend/src/modules/tracker/services/issues.service.ts:237-255,1324-1380`, `controllers/issues.controller.ts:134` | `POST /api/v1/projects/:projectId/issues` с `parentId`, `GET /api/v1/issues/:id/children` | `Issue.parentId` | ✅ |
| 10 | Старт встречи из задачи | `IssueMeetingsService.startMeeting` — транзакция: `Meeting(id=ulid, type='task_discussion', linkedIssueId=issue.id, ownerId=user.id)` + host `Participant` + опц. invite participants (валидация membership). Дальше `LivekitService.createRoomIfMissing` + `generateAccessToken`, `IssueActivity(verb='meeting_started')`. Возвращает `{ meetingId, meetingUrl, token }` | `backend/src/modules/tracker/services/issue-meetings.service.ts:51-180`, `controllers/issues.controller.ts:330` | `POST /api/v1/issues/:id/start-meeting` | `Meeting`, `Participant`, `IssueActivity` | ✅ |
| 11 | Просрочка | Cron `IssueOverdueDetectorCron @Cron(...)` ходит по `Issue` с `dueDate < now` и категорией ≠ `completed`/`cancelled`. Для каждой — эмитит `issue.overdue_detected` с `actorType='system'` и `daysOverdue` | `backend/src/modules/tracker/workers/issue-overdue-detector.cron.ts:85`, `services/tracker-emitter.service.ts:184-200` | `@Cron(...)` (ежедневный) | — (только эмит) | ✅ |
| 12 | Закрытие | Перевод в статус `completed` (= шаг 4) или `softDelete` (`Issue.deletedAt=now`, `IssueActivity(verb='deleted')`). Метрика `issues_completed_total{tenant,project}` для completed | `backend/src/modules/tracker/services/issues.service.ts:softDelete`, `controllers/issues.controller.ts:177` | `DELETE /api/v1/issues/:id` (soft), `POST /transitions` (completed) | `Issue.deletedAt`, `IssueActivity` | ✅ |

### 5.1 Структуры данных, через которые проходит процесс

```
Project (slug, identifier, network, teamTemplateId)
  ↓ POST /projects/:id/issues
Issue (sequenceId, identifier='KORA-N', parentId, goalId, linkedMeetingIds, externalSource)
  ├→ IssueAssignee[], IssueLabel[], IssueSubscriber[]
  ├→ IssueAttachment[] (S3, 25 MB whitelist)
  ├→ IssueComment[] → IssueMention[] (@ → ConversationalService)
  ├→ IssueRelation[] (auto-парная обратная)
  ├→ IssueActivity[] (audit-trail, epoch BigInt)
  └→ IssueVersion[] (исторические снимки)
  ↓ transitions / PATCH
IssueState (category: backlog | started | unstarted | completed | cancelled | blocked)
  ↓ TrackerEmitterService.emit*  (после транзакции)
EventEmitter2 → 'tracker.event_occurred' → TrackerAdapter (см. [[tracker-to-knowledge]])
  ↓ параллельно
TrackerEventsService → WebSocket /ws/tracker (tenant: + project: + issue: rooms)
  ↓ параллельно
WebhookDispatcher → tracker.webhook-delivery → IssueWebhook (HMAC SHA256, 5 retries)
  → IssueWebhookLog
```

### 5.2 LLM-вызовы внутри процесса

| Шаг | taskType | Primary | Fallback | Где промпт |
|---|---|---|---|---|
| 3 (поля задачи) | `issue-infer-fields` | DeepSeek V4 Flash | OpenAI gpt-5.4-mini → Ollama qwen3.5:9b | `backend/src/modules/tracker/services/issue-infer-fields.service.ts` (промпт inline) |
| 3 (цель) | `issue-goal-suggest` | KNN top-10 (порог 0.20 + voting 60%) → DeepSeek V4 Flash fallback | OpenAI mini → Ollama | `backend/src/modules/tracker/services/issue-goal-suggest.service.ts` |

## 6. Точки отказа и наблюдаемость

**Prometheus метрики:**
- `issues_created_total{tenant, project, source}`
- `issues_completed_total{tenant, project}`
- `issues_by_state_count{tenant, project, state}` (gauge)
- `issues_overdue_count{tenant, project}` (gauge)
- `subtasks_created_total{tenant, project}`
- `tracker_webhook_delivery_total{tenant, event, success}`
- `tracker_webhook_retry_count{tenant, webhook_id}`
- `tracker_issue_embed_total{status}`
- `ai_issue_inferred_total{accepted}`, `ai_issue_goal_suggested_total{accepted, source}`

⚠ Cardinality риск: `tenant`/`project`/`webhook_id` напрямую — миграция на top-100 hash bucket TODO Sprint 7.

**BullMQ очереди** (видно в `/admin/platform/workers`):
- `tracker.webhook-delivery` — исходящие http-webhook'и (concurrency 8)
- `core.issue-embed` — эмбеддинги задач для KNN (Phase 3)
- `core.intake-auto-triage` — авто-триаж предложений из встреч

**WebSocket namespace:** `/ws/tracker` — события `issue.created/updated/deleted`, `comment.created/updated/deleted`, `cycle.*`, `intake.newItem`, `activity_feed.newItem`, presence `issue.chat.*`.

**Логи:** имена логгеров `IssuesService`, `CommentsService`, `RelationsService`, `WebhookDeliveryWorker`, `WebhookDispatcher`, `TrackerEmitterService`, `TrackerGateway`, `IssueMeetingsService`.

**Известные грабли** (см. [[02_architecture/code-pitfalls]]):
- WebSocket-аутентификация — JWT берётся из `handshake.auth.token` → cookie `z_session` → `Authorization`. На production CORS закрывается через `TypedConfigService`, а не декоратор.
- Эмит в `tracker.event_occurred` идёт **после** транзакции — это намеренно (чтобы ingest никогда не увидел не-сохранённую задачу). Цена: при падении ingest'а событие потеряется (best-effort).
- `IssueRelation`-парность создаётся в той же транзакции — если не положить вторую запись в tx, граф связей рассинхронится.
- `IssueActivity.epoch` — BigInt микросекунд, не Int. Сортировка только по `epoch desc`, не по `createdAt` (последний имеет секундную точность).

**Кнопки админки:**
- `/admin/platform/workers` — повторить упавший job из `tracker.webhook-delivery`.
- `/projects/[slug]/settings` — webhook'и проекта, тестовая доставка (`POST /webhooks/:id/test`).
- `/admin/platform/issue-webhooks` — глобальный список (если есть).

## 7. Связанные процессы

- [[tracker-to-knowledge]] — Шаг 2c в этом процессе раскрыт там подробно: как событие шины превращается в `RawEvent` → `IdeaBlock` → специалисты Слоя 3.
- [[raw-event-to-graph]] — общий поток ingest в граф знаний, продолжение шага 2c.
- [[meeting-create-and-invite]] — Шаг 10 (старт встречи из задачи) — частный случай создания встречи.
- [[meeting-post-processing]] — на встрече из задачи могут возникнуть новые задачи (через `meeting-extract-actions` → `IntakeIssue` → авто-триаж).
- [[email-to-task]] — один из способов создания задачи (Шаг 1, alternative path).
- [[notification-dispatch]] — Шаг 6 (@упоминания) использует общий канал доставки.

## 8. Расхождения «задумано vs реализовано»

**Заложено в ТЗ, но реализовано частично:**
- **Sharp thumbnails для IssueAttachment** (Шаг 8) — image-файлы кладутся в S3, но превью не генерируются. ТЗ Sprint 3+, отдельный воркер `attachment-thumbnail` не создан.
- **Отдельный AI-промпт для `task_discussion` встреч** — пока переиспользуется `team` промпт (см. `tracker.md` § DoD Phase 1).
- **Notification владельцу при `webhook.isActive=false`** — деактивация работает (`WebhookDeliveryWorker.handleFinalFailure` ставит флаг), но уведомление через `ConversationalService` не отправляется. TODO Sprint 2-3.

**Реализовано, но не описано в ТЗ:**
- **`issue.status_changed` (общее) + специфичные `_to_blocked`/`_to_done`** одновременно — намеренный дубль, чтобы можно было разделять обработку «любая смена статуса» и «именно блок/готово». См. комментарий в `TrackerEmitterService`.
- **Cardinality risk на webhook метриках** — `webhook_id` napramyую попадает в label (риск для Prometheus). Mitigation Sprint 7.
- **`emitter.emit` — после транзакции, не в ней.** В ТЗ это сформулировано неявно; реализация делает явный shift «после `await prisma.$transaction(...)`» чтобы ingest не увидел не-сохранённое.
- **`IssueMention` в БД + `ConversationalService.sendNotification`** — связка in-app/telegram/max нотификаций по @упоминанию работает. В ТЗ Phase 1 этого не было — добавлено в T8 (Multi-user чат) handoff Wave 1-3.

**Заложено в ТЗ, не реализовано:**
- **POST `/api/v1/projects/from-template` — статус 501** (см. `tracker.md`). Phase 4 / Sprint 9, есть backend `ProjectsFromTemplateService`, но контроллерный путь возвращает Not Implemented.

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-29 | Карточка создана | этот документ |
| 2026-05-27 | Subtasks UI + `subtasks_created_total` + parent-cycle validation | [[01_projects/tracker]] §2026-05-27 |
| 2026-05-25 | Multi-user чат (presence/typing/mention popup) + Email-to-task | [[01_projects/tracker]] §T8 |
| 2026-05-24 | Sprint 1 — все ключевые модели, контроллеры, WS-gateway, webhook-delivery, AI-подсказки | [[05_история/2026-05-24-tracker-sprint-1-orkestratsiya-9-agentov]] |
| 2026-05-24 | `TrackerEmitterService` → шина `tracker.event_occurred` (B1-3.1) | commit 3c547f7 |
