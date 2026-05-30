---
name: tracker-to-knowledge
title: Активити трекера → граф знаний (RawEvent → IdeaBlock → специалисты)
trigger_type: event
status_overall: implemented
last_audited: 2026-05-29
owners_human:
  - инженер knowledge-core
  - продакт трекера
related_plans:
  - plans/tz/2026-05-23-tracker-phase-1-models-api.md
  - plans/tz/2026-05-22-final-roadmap.md
  - plans/tz/2026-05-27-tracker-project-documents.md
  - plans/sprints/2026-05-24-sprint-plan-wave-1.md
related_projects:
  - 01_projects/tracker.md
  - 01_projects/ingest-and-sources.md
  - 02_architecture/knowledge-core.md
  - 01_projects/llm-router.md
---

# Активити трекера → граф знаний

> **Как читать:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Номера шагов между разделами 3 и 5 синхронизированы.

## 1. О чём это (бытовой рассказ)

Главный принцип трекера в Z: **«трекер — источник для второго мозга»**. Это значит, что каждое значимое действие в трекере (создали задачу, перевели в новый статус, оставили комментарий, упомянули человека, заблокировали задачу, закрыли её, отредактировали документ проекта) не остаётся «жить» только внутри трекера, а превращается в **сырое событие памяти компании** и попадает в общий конвейер графа знаний — туда же, куда попадают расшифровки видеовстреч, заметки из Telegram, входящие письма и звонки.

Зачем это нужно. Платформа Z собирает память компании из любых источников. Если задача «Поговорить с клиентом Смирновым по новому контракту» переведена в «выполнено», и в комментарии написано «договорились на 12% скидку при предоплате» — это **факт**, который должен попасть и в карточку клиента «Смирнов», и в реестр решений компании. То же самое со словом «заблокирована» — повторяющиеся блокировки по одному человеку → сигнал в радар проблем (специалист 3-5). Упоминание сотрудника в задаче по теме «маркетинг» → сигнал в клон должности маркетолога. Закрытие задачи «выкатили на прод релиз 1.4» → событие, которое могут забрать тематические отчёты и дашборд COO.

Бытовой смысл: **трекер автоматически рассказывает «второму мозгу», что в нём происходит**. Не надо отдельно копировать данные, не надо вручную добавлять задачи в реестры — связка работает событийно: щёлкнул кнопку → событие → ingest → разбор LLM → попадание в нужный реестр или карточку.

Сейчас эта цепочка **реализована и работает в проде** для 8 типов событий задач (task_*), отдельным контуром — для документов проекта (project_document.changed). 7 событий helpfulness и 3 события gamification — описаны в `SignalType` enum'е, но эмитятся из других модулей (Specialist 3.8 Helpfulness Agent, Recognition Agent — Wave 2). Связь с CardSpecialist (карточки клиентов/проектов через chat-v2) и с эмбеддингами задач для KNN — отдельные параллельные конвейеры.

## 2. Что запускает (триггер)

- **Тип:** внутренняя событийная шина (`@nestjs/event-emitter` v2 — synchronous fire-and-forget) + `@OnEvent` listener в `IngestModule`.
- **Кто или что инициирует:** любое значимое изменение задачи в `IssuesService` / `CommentsService` / просрочка через cron / изменение `ProjectDocument`.
- **Технический источник:** event-name'ы `tracker.event_occurred` и `tracker.project_document_changed` (см. `TrackerEmitterService.EVENT_NAME` и `PROJECT_DOCUMENT_EVENT_NAME`). Слушатель — `TrackerAdapter.handleTrackerEvent` и `handleProjectDocumentEvent` в `backend/src/modules/ingest/adapters/tracker/tracker.adapter.ts`.

## 3. Шаги процесса (общий список)

1. **Tracker эмитит событие.** После транзакции в `IssuesService.create` / `update` / `transitionState` / `CommentsService.create` / `IssueOverdueDetectorCron` вызывается соответствующий `TrackerEmitterService.emit*` — синхронный publish в `EventEmitter2`. Бизнес-транзакция в этот момент уже зафиксирована.
2. **`TrackerAdapter` принимает событие.** Слушатель `@OnEvent('tracker.event_occurred', { async: true })` валидирует payload, мапит тип события → `SignalType` (8 task_* значений), парсит `occurredAt`, лениво upsert'ит `Source(type=tracker_event, name='Трекер Z')` для tenant'а.
3. **Сборка `RawEvent` payload.** Адаптер собирает компактный JSON: `signalTypeHint`, `eventType`, `issue` (минимальная информация), `actor`, `meta`. Для `issue.created` и `comment.created` дополнительно кладёт `fullText` (title + description / contentStripped), чтобы LLM мог извлечь решения/коммитменты/идеи.
4. **`IngestService.ingest` идемпотентно создаёт `RawEvent`.** Ключ дедупа `sourceExternalId = tracker:issue:<id>:<type>:<isoOccurredAt>:<metaShortHash>`. Если такой уже есть — возвращается существующий, событие не дублируется. Затем ставится в очередь `core.raw-events`.
5. **`BlockIngestWorker` берёт `RawEvent` из очереди.** Сегментирует payload, дёргает LLM `block-ingest` — извлечение `IdeaBlock`-ов (с `signalType`, `confidence`, `roleHint`). Если в payload есть `signalTypeHint` — override первого блока (или синтетический блок при 0 блоках от LLM).
6. **Запись блоков в БД и эмбеддинги.** Для каждого блока — `persistBlock` (`IdeaBlock` + `IdeaBlockEvidence` + `IdeaBlockEntity`) + эмбеддинг в `pgvector`. Дальше — `core.block-distill` (clean-up) и `core.block-linker` (связи между блоками).
7. **Маршрутизация в специалистов.** `RouterService` для каждого блока решает, какой специалист Слоя 3 его обработает (по `signalType`), и ставит job в `core.specialist-routing` с jobName=`3-3-decisions` / `3-5-insights` / `3-6-ideas` / `3-4-project-customer` / `3-1-regulations` / `3-2-knowledge-clone`.
8. **Card-rollup затронутых карточек.** Если блоки задели карточки клиентов / проектов / целей / процессов — `core.card-rollup-v2` (debounce 60s) пересчитывает их саммари (см. [[meeting-post-processing]] Шаг 8 — тот же путь).
9. **Метрика и логи.** Адаптер инкрементит `tracker_events_to_knowledge_core_total{tenant, type}`, пишет лог с `rawEventId`, `signalType`, `idempotent`.

## 4. Что получается на выходе

- **Граф знаний:** новые `IdeaBlock`-и с `sourceType='tracker_event'`, связанные с участниками задачи (`Entity`), проектом, целью.
- **Реестры:** обновлённые `Decision` (если в комментарии было «решили: …»), `Idea` (если «предложил X»), `Insight` (по `task_blocked` от одного assignee 5+ раз за неделю — паттерн от β-4), новые `Regulation` (если в комментарии описан процесс).
- **Карточки:** `Card(kind=client|project)` — пересчёт саммари + опц. версия в `CardVersion` для куратора.
- **Клон должности (γ-1):** реактивно НЕ дёргается, но `RawEvent.payload.actor.userId` идёт в данные клона при следующем cron-rebuild (см. [[specialist-gamma-1-skill-clone]]).
- **Видно пользователю:**
  - граф связей задачи в `/projects/[slug]/...` (если включён),
  - реестры `/decisions`, `/insights`, `/ideas`, `/regulations` — пополняются новыми записями с источником = tracker_event,
  - карточки в `/cards/...` — обновлённые саммари.

## 5. Технический разрез (по шагам)

| # | Шаг | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Emit в `TrackerEmitterService` | После транзакции `IssuesService.create/update/transitionState/softDelete` / `CommentsService.create` / `IssueOverdueDetectorCron` вызывает `emitIssueCreated/StatusChanged/Blocked/Completed/AssigneeChanged/CommentCreated/MentionCreated/OverdueDetected`. Все методы — fire-and-forget; `EventEmitter2.emit` синхронный, ошибки слушателей не пробрасываются | `backend/src/modules/tracker/services/tracker-emitter.service.ts:69-244`; точки эмита — `services/issues.service.ts:261,953,991,1284,1294,1302`, `services/comments.service.ts:133,140`, `workers/issue-overdue-detector.cron.ts:85` | event-name `tracker.event_occurred` | — | ✅ |
| 2 | `TrackerAdapter` принимает | `@OnEvent('tracker.event_occurred', { async: true })` валидирует `tenantId` + `issue.id`, мапит `payload.type` → `SignalType` по `SIGNAL_TYPE_MAP` (8 task_*), парсит `occurredAt`, `upsertDefaultTrackerSource(tenantId)` lazy создаёт `Source(type='tracker_event', name='Трекер Z')` per tenant (race-safe try/catch на P2002) | `backend/src/modules/ingest/adapters/tracker/tracker.adapter.ts:128-145,404-439`, `backend/src/modules/ingest/ingest.module.ts:10,61` | event-emitter listener | `Source` (lazy upsert) | ✅ |
| 3 | Сборка payload для RawEvent | `buildPayload` собирает `{signalTypeHint, eventType, tenantId, occurredAt, issue, actor, meta}` + опционально `fullText`. `extractFullText` для `issue.created` = title + description; для `comment.created` = title + (commentStripped \|\| commentContent \|\| voiceTranscript); для `mention.created` = title + meta.contextText; для остальных — `null` (контекста заголовка + meta достаточно). `shortHash(meta)` (sha256-short8) для различения событий в одну секунду | `backend/src/modules/ingest/adapters/tracker/tracker.adapter.ts:241-313,320-398,451-459` | — | — | ✅ |
| 4 | `IngestService.ingest` создаёт RawEvent | Идемпотентный create по `sourceId + sourceExternalId` (формат `tracker:issue:<id>:<type>:<isoOccurredAt>:<metaShortHash>`). Если RawEvent уже есть — возвращает существующий с `idempotent: true`, новый job в очередь не ставится. Иначе — INSERT в `RawEvent` + enqueue в BullMQ `core.raw-events`. `dataClass='internal'` | `backend/src/modules/ingest/ingest.service.ts` (метод `ingest`) | enqueue в `core.raw-events` | `RawEvent` | ✅ |
| 5 | `BlockIngestWorker` обрабатывает | Consumer `core.raw-events`: `loadPayload` → `segments.buildSegments(payload)` (для tracker один сегмент с `fullText`) → `extractor.extractFull` (LLM `block-ingest`). Затем `applySignalTypeHint(extraction.blocksInOrder, signalHint, payload)` — переопределяет `signalType` первого блока на `signalTypeHint` из payload; если 0 блоков — создаёт синтетический блок с hint-ом, чтобы факт события не потерялся в графе | `backend/src/modules/knowledge-core/workers/block-ingest.worker.ts:170-260,623-700` | consumer `core.raw-events` | — (промежуточный шаг) | ✅ |
| 6 | Запись блоков + эмбеддинги | Цикл по `blocksInOrder`: `embeddings.embedBlocks` (через `text-embedding-3-small`), `persistBlock` создаёт `IdeaBlock` + `IdeaBlockEvidence` (со ссылкой на RawEvent / segment span) + `IdeaBlockEntity` (упомянутые персоны, проекты, цели). Дальше — enqueue в `core.block-distill` (clean-up дублей) и `core.block-linker` (связи) | `backend/src/modules/knowledge-core/workers/block-ingest.worker.ts:220-280`, `services/extractor.service.ts`, `services/embeddings.service.ts` | `core.block-distill`, `core.block-linker` | `IdeaBlock`, `IdeaBlockEvidence`, `IdeaBlockEntity`, `IdeaBlockLink` | ✅ |
| 7 | Маршрутизация в специалистов | `RouterService.routeFromBlock` по `block.signalType` решает, какие jobs в `core.specialist-routing` запустить (jobName='3-3-decisions' / '3-1-regulations' / '3-4-project-customer' / '3-5-insights' / '3-6-ideas' / '3-2-knowledge-clone'). Дедуп через `jobId` (rebuild-resource-* или block-*). Каждый specialist worker — отдельный consumer | `backend/src/modules/knowledge-core/services/router.service.ts`, `workers/specialist-3-1-regulations.worker.ts`, `specialist-3-3-decisions.worker.ts`, `specialist-3-4-project-customer.worker.ts`, `specialist-3-5-insights.worker.ts`, `specialist-3-6-ideas.worker.ts` | `core.specialist-routing` | `Decision`, `Regulation`, `Insight`, `Idea`, `Card(kind=client|project)`, `KnowledgeCloneFact` | ✅ для базовых signalType; для всех 8 task_* — работает |
| 8 | Card-rollup затронутых карточек | `block-linker` определяет затронутые карточки → debounce 60s в `core.card-rollup-v2` → `CardRollupV2Worker` собирает все блоки → LLM пересчитывает summary, `CurationService.triage` решает auto-apply vs pending. Тот же путь, что в [[meeting-post-processing]] Шаг 8 | `backend/src/modules/knowledge-core/services/card-rollup-v2.service.ts`, `workers/card-rollup-v2.worker.ts` | `core.card-rollup-v2` | `Card.summary`, `CardVersion`, `CurationItem` | ✅ |
| 9 | Метрика | `BusinessMetricsService.incTrackerEventToKnowledgeCore({tenant, type})` после успешного `IngestService.ingest`. Логи через `Logger(TrackerAdapter.name)` с полями `rawEventId`, `signalType`, `issueId`, `tenantId`, `idempotent` | `backend/src/modules/ingest/adapters/tracker/tracker.adapter.ts:297-312` | counter `tracker_events_to_knowledge_core_total{tenant, type}` | — | ✅ |

### 5.1 Отдельный контур — Project Documents (2026-05-27)

Документы проекта (`ProjectDocument` — wiki-страницы в трекере) идут **отдельным event-name'ом** `tracker.project_document_changed`, потому что у документа нет `issue.id` — общий контракт `tracker.event_occurred` не подходит:

| # | Шаг | Где живёт код | Особенности |
|---|---|---|---|
| 1 | Эмит | `services/project-documents.service.ts:162,292` → `TrackerEmitterService.emitProjectDocumentChanged` | На create + на update auto-save (changeType: 'created' / 'updated') |
| 2 | Приём | `TrackerAdapter.handleProjectDocumentEvent` (`tracker.adapter.ts:154-239`) | Отдельный listener |
| 3 | `sourceExternalId` | `tracker:project-document:<documentId>:<changeType>:<isoOccurredAt>` | Дедуп оконный — auto-save каждые 3s НЕ создаёт лишние RawEvent (один на occurredAt-секунду) |
| 4 | `signalTypeHint` | Не проставляется — block-ingest сам классифицирует фрагменты (decision / idea / note / rule) | LLM-extraction по `fullText = title + contentStripped` |

### 5.2 LLM-вызовы внутри процесса

| Шаг | taskType | Primary | Fallback | Где промпт |
|---|---|---|---|---|
| 5 (extract) | `block-ingest` | DeepSeek V4 Flash | OpenAI gpt-5.4-mini → Ollama qwen3.5:9b | `backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts:445-448` (упоминает task_created / task_blocked / task_completed) |
| 7 (специалисты) | `decision-extract`, `decision-supersede-detect`, `regulation-extract`, `insight-extract`, `idea-extract`, `card-rollup-summary` (×5 kinds), `knowledge-clone-extract` | DeepSeek V4 Flash / Pro | OpenAI mini/nano → Ollama qwen3:30b / qwen3.5:9b | `backend/src/modules/knowledge-core/prompts/<specialist>-*.prompt.ts` |
| 6 (embeddings) | — | `text-embedding-3-small` | — | inline в `EmbeddingsService` |

## 6. Точки отказа и наблюдаемость

**Prometheus метрики:**
- `tracker_events_to_knowledge_core_total{tenant, type}` — успешно поставленные RawEvent (главная метрика adapter'а)
- `core_block_ingest_total{tenant_top, status}` — извлечение блоков
- `core_specialist_routing_total{job_name, status}` — маршрутизация
- `core_card_rollup_v2_total{kind, status}` — пересборка карточек
- `raw_events_idempotent_hits_total{tenant, source_type}` — повторные эмиты (если есть)

**BullMQ очереди** (видно в `/admin/platform/workers`):
- `core.raw-events` (consumer = `BlockIngestWorker`)
- `core.block-distill`, `core.block-linker`
- `core.specialist-routing` (multi-job-name)
- `core.card-rollup-v2`
- `core.entity-resolver`

**Логи:** имена логгеров `TrackerAdapter`, `TrackerEmitterService`, `IngestService`, `BlockIngestWorker`, `RouterService`, контекстное поле `trace`.

**Известные грабли:**
- **Эмит — синхронный, listener — `{ async: true }`**, то есть основной поток не ждёт ingest. Это намеренно (бизнес-транзакция не должна падать из-за ingest'а), но цена — потенциальная потеря события при падении адаптера (best-effort).
- **`signalTypeHint` override** — `BlockIngestWorker.applySignalTypeHint` переопределяет signalType **первого** блока. Если LLM извлёк несколько блоков, остальные сохраняют свой LLM-определённый signalType — это правильно для `task_comment` (где в комментарии могут быть и decisions, и ideas).
- **`metaShortHash`** в sourceExternalId критичен для двух комментариев подряд в ту же секунду — без него произошла бы ложная дедупликация.
- **`ProjectDocument` auto-save** каждые ~3s — может создавать много `RawEvent` для одной страницы. Окно дедупа — `occurredAt`-секунда; всё, что меняется быстрее, идёт одной записью. Если редактор шлёт occurredAt от клиента (а не от сервера) — возможен дрифт; проверять на проде.
- **`IssueWebhook.allowedDataClasses` outbound gating** — отдельный сервис `DataClassPolicyService` фильтрует http-webhook'и по классу данных payload'а. На сам `tracker.event_occurred` → RawEvent эта фильтрация **не распространяется** (внутренняя шина — `dataClass='internal'`).

**Кнопки админки:**
- `/admin/platform/workers` — очередь `core.raw-events`, ретрай упавших jobs.
- `/admin/raw-events/[id]` (если есть) — посмотреть конкретное событие и его дочерние `IdeaBlock`-и.
- `/admin/platform/routing-decisions` (β-4 routing) — для отладки маршрутизации в специалистов.

## 7. Связанные процессы

- [[issue-lifecycle]] — Шаг 2c там продолжается здесь подробно (этот процесс — продолжение).
- [[raw-event-to-graph]] — общий процесс ingest → IdeaBlock → Entity → links; этот процесс — частный случай с `sourceType='tracker_event'`.
- [[meeting-post-processing]] — Шаги 6-8 (ingest + специалисты + card-rollup) выполняются по тому же пути; различается только источник (`meeting` vs `tracker_event`) и payload (`transcript` vs `task_event`).
- [[card-rollup-v2]] — Шаг 8 здесь, описан подробно отдельно.
- [[specialist-3-3-decisions]], [[specialist-3-5-insights]], [[specialist-3-6-ideas]], [[specialist-3-4-project-customer]], [[specialist-3-1-regulations]], [[specialist-3-2-knowledge-clone]] — Шаг 7, каждый отдельный процесс.

## 8. Расхождения «задумано vs реализовано»

**Заложено в ТЗ и реализовано:**
- `TrackerAdapter` создан в Sprint 3 B1-3.1 (commit `3c547f7`, 2026-05-24) — НЕ план, реально работает в коде, есть unit-тесты (`tracker.adapter.spec.ts`).
- 8 task_* `SignalType` в Prisma enum (`schema.prisma:307-309`).
- block-ingest prompt знает про task_created / task_blocked / task_completed (`block-ingest.prompt.ts:52-55, 445-448`) и `signalTypeHint` override (`block-ingest.worker.ts:183-207, 623-700`).
- Source `tracker_event` в Prisma enum `SourceType` (`schema.prisma:218`).
- ProjectDocument отдельный контур (commit от 2026-05-27, ТЗ `2026-05-27-tracker-project-documents.md`).
- Метрика `tracker_events_to_knowledge_core_total` в `BusinessMetricsService.incTrackerEventToKnowledgeCore`.

**Реализовано, но не описано в ТЗ (или описано неявно):**
- **`signalTypeHint` фолбэк на синтетический блок** (если LLM вернул 0 блоков) — в ТЗ B1-3.1 это не было детализировано, придумано во время реализации, чтобы факт `status_changed_to_blocked` не пропал из графа при компактном payload'е без `fullText`.
- **`metaShortHash` в `sourceExternalId`** — детализация идемпотентности, добавлена для различения двух комментариев в одну секунду.
- **Отдельный handler для `ProjectDocument`** (а не общий `tracker.event_occurred`) — компромисс с типизацией: контракт `TrackerEventPayloadShape` требует `issue.id`, у документа его нет; создан второй event-name `tracker.project_document_changed`.

**Заложено в ТЗ, не реализовано / отложено:**
- **`task_overdue` событие** эмитится из `IssueOverdueDetectorCron`, но фактический cron-frequency и пороги (1 / 3 / 7 дней) — в `tracker.md` обозначены, в коде есть только базовая логика «`dueDate < now` и не completed». **Эскалация overdue с разными signalType-ами не реализована** — все просрочки уходят как `task_overdue` равнозначно.
- **7 helpfulness `SignalType`** (`help_provided`, `proactive_hint`, `mentoring`, `emotional_support`, `constructive_feedback`, `question_unanswered`, `question_acknowledged_no_action`) — определены в enum'е, но эмитятся НЕ из `TrackerAdapter`, а из отдельного Specialist 3.8 Helpfulness Agent (Wave 2, см. `tracker.md`). Здесь — не относятся к tracker-to-knowledge напрямую.
- **3 gamification `SignalType`** (`helped_by`, `helped_to`, `thanks_explicit`) — аналогично, через Recognition Agent (Wave 2).
- **Реактивная пересборка клона (γ-1)** по событию `task_*` — не реализована. Клон должности пересобирается крон-ом `weekly persona snapshot person+role`. Реактивный режим — заявлен в `2026-05-25-clone-reliability-hardening.md` (Фаза 5).
- **`comment.created` для voice-комментариев с длинным transcript'ом** — может вылезти за лимит сегмента LLM (нет явного гарда на size). При обнаружении проблем — добавить chunking.

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-29 | Карточка создана | этот документ |
| 2026-05-27 | Отдельный контур `tracker.project_document_changed` | [[01_projects/tracker]] §ProjectDocuments |
| 2026-05-24 | Sprint 3 B1-3.1 — `TrackerAdapter` + `TrackerEmitterService` + 8 task_* SignalType + signalTypeHint override в block-ingest | commit `3c547f7` |
| 2026-05-22 | Roadmap финал — все specialist-routing включены в core.specialist-routing | [[01_projects/llm-router]] |
