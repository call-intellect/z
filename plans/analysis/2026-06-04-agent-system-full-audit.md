# Технический аудит системы агентов Z (knowledge-core) — полный разбор

> **Статус: read-only аудит (код НЕ менялся).** Дата: 2026-06-04. Это документ-аудит, не ТЗ.
> **Источники:** два независимых workflow-прогона (61 суб-агент суммарно) по свежему коду `dev@1c0214e4`.
> - Большой аудит: 10 областей, 43 проверенных бага → **38 подтверждено**, 5 опровергнуто (фактура с `file:line`).
> - Первый прогон: 7 глубоких корневых причин + карта конвейера из 15 узлов (стадии «видео-встреча → второй мозг → трекер»).
>
> **Поправки после `git pull` (учтены в выводах):** аудит читал до-pull код, но merge не трогал блокеры критического пути (Vox/transcribe, specialist-routing, draft→canonical, projection skillTrait, AGE/graph, пороги) — они актуальны. По багу #7/no_person merge добавил ручную привязку Person через раздел «Команда» (`persons.service.ts` linkUserId), но корневые потребители (commitments 403, dump legacy, `createForOwner` без Person) НЕ изменены — автолинковки нет, баг открыт. По AGE: корень глубже «расширение не установлено» — рантайм-пул Prisma не делает `LOAD age` / `search_path=ag_catalog`, поэтому `cypher()` не резолвится ДАЖЕ при установленном AGE.
>
> **Инструментальная оговорка:** в окружении аудита `vexp run_pipeline` был недоступен (демон не поднят, MCP-сервер не surface'нулся; PreToolUse-блокировка Grep завязана на vexp и не активировалась). Навигация выполнена через Grep/Read/Glob по абсолютным путям; каждый факт привязан к `file:line` в исходниках.

---

## 1. Executive summary

Конвейер «второй мозг» (knowledge-core) **спроектирован целиком и подключён с обеих сторон** — мост «встреча → граф» существует и работает (`analyze.worker.ts:378 → meeting.adapter.ts → ingest.service.ts → core.raw-events → block-ingest.worker.ts:157`, consumer зарегистрирован `workers.module.ts:151`). Но цепочка рвётся **серией последовательных блокеров на критическом пути**, и из-за этого в проде «граф будто наполняется, а карточек/целей/обещаний почти нет».

Ключевая ошибка интуиции: **«починить только Vox» недостаточно**. Даже когда транскрибация заработает и встречи дойдут до моста, дальше по конвейеру стоят ещё минимум шесть независимых блокеров, каждый из которых сам по себе обнуляет результат: специалисты Слоя 3 теряют ~13/14 блоков (одна очередь, 14 воркеров), а те, что доходят, диспатчатся на `draft`-блок и молча скипаются; типизированные сущности откатываются из-за AGE; проекции не пересобираются (skillTrait.tenantId роняет весь батч); граф связей не строится из-за порога 50; ошибки моста проглатываются и не видны в статусе встречи. Это не «один баг», а **цепь обрывов в порядке конвейера**.

### КРИТИЧЕСКИЙ ПУТЬ (серия блокеров в порядке движения данных)

| # | Узел | Что происходит | Блокер | Где |
|---|------|----------------|--------|-----|
| **B1** | **Vox / transcribe** | Vox вечно `PROCESSING`, клиентский poll = 60×2с = 120с < длины аудио (~27 мин). По таймауту job падает, BullMQ ретраит **с дорожки №1** (нет per-track persist/идемпотентности). 5 заходов → `meeting=failed`. | `merge`/`analyze`/`ai_ready`/`ingestMeeting` НЕ наступают → из встречи в граф НЕ попадает ничего | `vox.service.ts:151-251`, `transcribe.worker.ts:311,139-143,174` |
| **B2** | **specialist-routing** | 14 конкурирующих Worker'ов на ОДНОЙ очереди `core.specialist-routing`; `jobName` НЕ маршрутизирует (миф BullMQ). «Чужой» воркер видит `job.name!==MY_NAME` и делает `return` (job `completed`, без retry). | ~13/14 блоков молча теряются; целевой специалист может не увидеть блок | `specialist-3-14-goals.worker.ts:60-67,91-95`, `core-queue.service.ts:443-462`, `queues.ts:87-94` |
| **B3** | **draft→canonical race** | `block-ingest` диспатчит специалистов СРАЗУ при `status='draft'` (без delay), а `block-distill` канонизирует только через ~30с. Специалист видит `draft`, делает `return` без throw. Re-dispatch после canonical нет. | Первая проекция (Goal/Decision/...) **никогда** не создаётся из живого потока | `block-ingest.worker.ts:750,559-573`, `specialist-3-14-goals.worker.ts:116-122`, `block-distill.worker.ts:164-206` |
| **B4** | **projection skillTrait** | `projection-rebuilder` делает `skillTrait.findMany({where:{tenantId}})` — у `SkillTrait` нет колонки `tenantId`. Внутри единого `Promise.all` из 10 запросов reject валит ВЕСЬ батч. | Ни одна из 10 проекций не пересобирается на `idea_block.updated`; recovery-путь мёртв | `projection-rebuilder.service.ts:204-210,154`, `schema.prisma:7087` |
| **B5** | **AGE / search_path** | `GraphService.upsertEntity` пишет Postgres-строку и `cypher('z_graph',...)` в ОДНОЙ транзакции. Рантайм-пул Prisma не делает `LOAD age`/`search_path=ag_catalog` → `cypher()` не резолвится (даже при установленном AGE) → откат всей транзакции → типизированная сущность теряется. | Process/Regulation/Policy/Tool/Metric/Decision из встречи НЕ материализуются; ошибка проглатывается (`warnTypedFail`) | `graph.service.ts:497-516,546-553`, `prisma.service.ts:43`, `block-ingest.worker.ts:1081` |
| **B6** | **пороги графа** | `block-linker` skip при `canonicalCount<50`; theme-clusterer при `<100`; entity-graph при co-mention `<3`. Пороги читаются статически из ENV (`this.get`), AdminSetting-крутилки воркером НЕ читаются (мёртвые). | На малом/пилотном тенанте граф связей, темы и граф сущностей не строятся вообще | `block-linker.worker.ts:122-133`, `typed-config.service.ts:716-757`, `env.schema.ts:515,557,543` |
| **B7** | **ingestMeeting swallow** | Единственный вызов моста (`analyze.worker.ts:378`) обёрнут в `.catch(()=>null)`. Реджект ingest не попадает в ветку `failed`, `meeting.failureReason` не пишется. | Провал моста невидим: оператор видит зелёную `ai_ready`-встречу, а RawEvent не создан | `analyze.worker.ts:378-415`, `meeting.adapter.ts:87-95` |

**Вывод:** конвейер надо чинить **серией**, в порядке B1→B7 (или хотя бы B1+B2+B3+B4+B5 как блок), иначе оживление одного узла не даёт видимого эффекта на проде. Подробный порядок — §9 (МТЗ №1).

---

## 2. Карта каналов входа в knowledge-core

Единая точка приёма всех каналов — `IngestService.ingest()` (`ingest.service.ts:81`): резолвит `Source`, считает `idempotencyKey`, пишет `RawEvent(sourceType=source.type)` и публикует job в `core.raw-events`. Consumer `block-ingest.worker` **channel-agnostic** — фильтра по `sourceType` нет, любой `RawEvent` доходит до ядра. Поэтому «доходит ли канал?» = «есть ли адаптер, реально вызывающий `IngestService.ingest()`».

### Главные каналы (детально)

**Видео-встреча (LiveKit):** `POST /webhooks/livekit` (`livekit-webhooks.controller.ts:39`) → verify подписи → dedup `webhookSeenEvent` → `LivekitEventsHandler` (FSM встречи + очереди). `egress_ended(composite)` → faststart + `maybePromoteMeetingToReady` → `recording_ready` → `enqueueTranscribe`. Далее AI-пайплайн: `TranscribeWorker`(Vox) → `MergeWorker` → `AnalyzeWorker`(AI-отчёт по типу) → **мост** `ingestMeeting` (`analyze.worker.ts:378`). `sourceType='meeting'`. **Статус: partial** — мост по контракту корректен и идемпотентен, но в проде не достигается из-за B1 (transcribe-цикл) и проглатывания ошибок (B7).

**Telegram free_note:** `POST /api/v1/webhooks/telegram-bot` (глобальный канал, `tenantId IS NULL`) → verify secret (timing-safe) → `TelegramBotChannelAdapter.ingestUpdate` (`telegram-bot.adapter.ts:240`) → резолв `ChannelBinding`+tenant → intent-классификация (LLM + эвристика) → `free_note`/`chat_query`/`daily_checkin_self`. Для `free_note`: `ConversationalFreeNoteBridge.handleFreeNote` → `ConversationalIngestAdapter.ingestFreeNote` → `Source(conversational, 'Свободные заметки')` → `IngestService.ingest`. `sourceType='conversational'`. **Статус: partial** — известный пробор «free_note» ЗАКРЫТ (мост зарегистрирован, есть зелёный spec); остаточные дефекты — #5 (JSON-обёртка в LLM) и #6 (AGE-потеря типизированных сущностей).

**«Записи мыслей» / web_form / dump:** UI `/dump` (`DumpClient.tsx:43`) → `POST /api/v1/ingest/dump` (`dump.controller.ts:60`) → `DumpService.createDump` (`dump.service.ts:47`). Развилка: есть Person → `Document{kind:text}` + `core.dump-created` (Document-путь); нет Person → **legacy-путь** (только RawEvent, без Document, `sourceExternalId='web:<userId>:<nonce>'`). `sourceType='web_form'`. **Статус: partial** — по прод-факту web_form реально доходит (3 блока, axis-classify ok), но владелец Org **всегда** идёт legacy-путём (баг #8: `createForOwner` не создаёт Person), теряя Document-контейнер и provenance.

### Матрица покрытия SourceType (enum `schema.prisma:210-231`, 10 значений)

| SourceType | Реализован? | Точка входа | Статус |
|---|---|---|---|
| `meeting` | ДА | `meeting.adapter.ts:62` ← `analyze.worker.ts:378` | partial (в проде не доходит — B1) |
| `conversational` | ДА | `conversational-ingest.adapter.ts:38` ← `conversational.module.ts:67` | works (free_note из @kora_bot/in_app) |
| `web_form` | ДА | `dump.service.ts:120` + `text.adapter.ts:106` | partial (legacy у владельца — #8) |
| `external` | ДА | `document.adapter.ts:170` (переиспользован для документов) | works |
| `email` | ДА | `email-fetch.service.ts:161` ← `EmailFetchCron` (IMAP UNSEEN) | works |
| `bot` | ДА | `telegram.controller.ts:128` (per-source telegram) | partial (деградирует при `TELEGRAM_PROXY_ENABLED=true` — #10) |
| `phone_call` | ДА | `mango.controller.ts:137` | works (metadata-only, без транскрипции звонка — vNext) |
| `tracker_event` | ДА | `tracker.adapter.ts:216,288` (`@OnEvent`) | works |
| `chat` | **НЕТ** | producer'а нет вообще | gap покрытия (заглушка под «Кора-Чат», см. §7) |

Итог: из 10 значений enum — 8 имеют рабочий приём, создающий RawEvent; `meeting` реализован, но в проде блокирован выше по цепочке; `chat` — объявлен, producer отсутствует.

---

## 3. Сквозная цепочка knowledge-core (15 узлов pipelineMap)

Цепочка «как задумана в коде»: `webhook egress_ended → faststart → transcribe(Vox) → merge → analyze(ai_ready) → МОСТ ingestMeeting → IngestService → block-ingest → IdeaBlock+Entity(GraphService Postgres+AGE) + router.dispatch + axis-classify → block-distill → block-linker → projection-rebuild → терминал задач/обещаний/трекера`.

| # | Узел | Статус | Чем блокирован |
|---|------|--------|----------------|
| 1 | `LivekitEventsHandler`: egress_ended → recording_ready → enqueueTranscribe | **works** | — (запись + composite + faststart подтверждены прод-логом) |
| 2 | `AiQueueService`: recording.faststart | **works** | — (идемпотентный job `faststart_<meetingId>`) |
| 3 | `AiQueueService`: ai.transcribe | **works** | — (идемпотентный job `<meetingId>:transcribe:1`) |
| 4 | **`TranscribeWorker` + `VoxService`** (ASR per-track) | **broken (B1)** | Vox вечно `PROCESSING`; poll 120с < длины аудио → VoxError timeout → job падает → retry с дорожки №1 (нет per-track persist) |
| 5 | `MergeWorker`: склейка → transcription_ready | **unknown** | недостижимо — transcribe не доходит до `enqueueMerge` (`transcribe.worker.ts:229`); сам воркер по коду корректен |
| 6 | `AnalyzeWorker`: AI-отчёт по типу → ai_ready | **unknown** | недостижимо — вход `transcription_ready` не наступает; логика отчёта реализована, но не исполняется |
| 7 | **МОСТ `MeetingIngestAdapter.ingestMeeting`** | **broken (B7)** | единственный вызов на `analyze.worker.ts:378` (после ai_ready); pipeline рвётся раньше → мост не зовётся; вызов обёрнут в `.catch(()=>null)` → провал невидим |
| 8 | `IngestService.ingest` → RawEvent + core.raw-events | **works** | тракт исправен (подтверждён прод-логом на web_form: 3 блока); для встреч просто не получает вызовов |
| 9 | **`BlockIngestWorker`**: RawEvent → IdeaBlock + Entity + группа Б | **broken (B5)** | IdeaBlock'и создаются (persistBlock — отдельная tx без AGE), НО типизированные сущности группы Б откатываются при падении `cypher()` (общая транзакция Postgres+AGE); ошибка проглочена `warnTypedFail` |
| 10 | `EntityResolver` / `findOrCreateEntity` | **unknown** | для встреч недостижимо (нет блоков); на web_form best-effort, не валится; явных данных нет (confidence low) |
| 11 | `AxisClassifier` | **works** | — (синхронно, idempotent upsert по `unique(tenantId,blockId,axis,label)`; прод-лог: axis-classify ok) |
| 12 | `RouterService.dispatch` (specialist-routing) | **works (enqueue)** | enqueue работает (3-14-goals enqueued), НО доставка к специалистам ломается на B2 (одна очередь, 14 воркеров) |
| 13 | `BlockLinker` (граф IdeaBlock↔IdeaBlock) | **broken (B6)** | гейт `canonicalCount<50` (`linkerMinBlocks`) — на пилотных объёмах never-fires; конфиг-порог, а не баг кода |
| 14 | `ProjectionRebuilder` (idea_block.updated → пересборка) | **broken (B4)** | `skillTrait.findMany({where:{tenantId}})` роняет весь `Promise.all` → ни одна из 10 проекций не пересобирается |
| 15 | **Терминал** задач/обещаний/трекера | **broken (B3)** | завязан на ai_ready (не достигается); специалисты диспатчатся на `draft` и скипаются; commitment-IdeaBlock рождается только из block-ingest, а из встреч блоков нет |

---

## 4. Маппинг узлов на Prisma-модели (из `areas[].prismaModels`)

| Узел / область | Какие таблицы пишет/читает |
|---|---|
| Канал встречи (FSM + AI) | `Meeting`, `MeetingEvent`, `WebhookSeenEvent`, `Participant`, `Recording`, `AudioTrack`, `Transcript`, `TranscriptTrack`, `AiResult` |
| `IngestService` → RawEvent | `Source`, `RawEvent` (`sourceType`, `idempotencyKey` unique), `IdeaBlockEvidence.sourceType` |
| Telegram free_note | `Channel`, `ChannelBinding`, `Membership`, `Person`, `Notification`, `NotificationDelivery` |
| web_form / dump | `RawEvent` (носитель «дампа»), `Source(web_form)`, `Document` (только Person-путь), `Person`, `Membership` |
| `BlockIngestWorker` (группа А) | `IdeaBlock`, `IdeaBlockEvidence`, `IdeaBlockEntity`, `Entity` (через `EntityResolutionService` — чистый Postgres) |
| `BlockIngestWorker` (группа Б, через GraphService+AGE) | `Process`, `Regulation`, `Policy`, `Tool`, `Metric`, `Decision`, `EntityLink` (Postgres = источник правды рёбер; AGE = вторичная проекция) |
| `AxisClassifier` | `IdeaBlockAxisLabel` |
| `EntityResolver` | `Entity.mergedIntoId` (union aliases, перенос `IdeaBlockEntity`) |
| `BlockDistill` / `BlockLinker` | `IdeaBlock.status` (draft→canonical), `IdeaBlockLink` (7 типов связей) |
| `ThemeClusterer` | `Theme`, `ThemeIdeaBlock`, `ThemeEntity` |
| `EntityGraphBuilder` | `EntityLink` (Postgres-only, AGE НЕ трогает — не зависит от cypher) |
| `ProjectionRebuilder` | читает `Decision`, `Insight`, `Idea`, `Card`, `Regulation`, `Process`, `Policy`, `ProcessTemplate`, `Experiment`, **`SkillTrait`** (битый запрос) |
| Терминал: обещания | `IdeaBlock(signalType='commitment')` — отдельной модели Promise НЕТ; `commitmentStatus/DueDate/RecipientPersonId/AskedAt/EscalatedAt`; `PromiseNetworkSnapshot` (аналитика) |
| Терминал: цели | `Goal` (`source='ai'`, `promotionState`), `GoalKeyResult` |
| Терминал: задачи | `Task` (`evidenceBlockIds`, `extractorVersion`) — отдельная ветка meeting-report, не специалисты |
| Терминал: карточки | `Card` (`sourceBlockIds`, `summaryCache`) — `card-rollup-v2` |
| Терминал: smart-tables | `Table`, `TableProperty`, `TableRow`, `TableCellProvenance` — entity-driven (ENTITY_CREATED/UPDATED), не commitment |
| dataClassAudit | поле есть только у 6 моделей: `AiUsageLog`, `Card`, `ConflictItem`, `ProbeEvent`, `SkillProfile`, `ExecutablePersona` |

---

## 5. ВСЕ 38 подтверждённых багов (по кластерам)

Severity указан как итоговый (verdict). `blocksChain` = блокирует ли критический путь конвейера.

### Кластер A — AGE / typed-entity граф (6 багов)

| # | Заголовок | Sev | Chain | Location | Корень | Минимальный фикс |
|---|-----------|-----|-------|----------|--------|------------------|
| 11 | Запись группы Б падает на `function cypher does not exist`, откатывает Postgres | high | нет* | `graph.service.ts:497-516,546-553` | `cypher()` живёт в `ag_catalog`, рантайм-пул без `search_path` | флаг `GRAPH_AGE_ENABLED` → no-op для всех `runRawCypher*`; чинит ВЕСЬ класс |
| 12 | Нет per-connection `LOAD age`/`search_path=ag_catalog` — `cypher()` недоступна даже при установленном AGE | high | **да** | `prisma.service.ts:43`, `graph.service.ts:551,573` | `LOAD age`/`SET search_path` только в init.sql (session-local), пул их не делает | `ALTER ROLE app SET search_path=ag_catalog,"$user",public` (+ опц. квалификация `ag_catalog.cypher`) |
| 13 | Падение группы Б проглатывается `warnTypedFail`, RawEvent безусловно `ingested` — тихая потеря без сигнала | high | **да** | `block-ingest.worker.ts:529-536,1081-1090` | per-entity catch = только `logger.warn`, нет метрики, нет re-throw | классификация ошибок (P2002=skip vs age=systemFail), не метить `ingested` при systemFail, метрика `kc_typed_entity_failed_total` |
| 14 | `addEdge(derived_from)` теряет EntityLink при недоступном AGE (cypher в той же транзакции, что upsert) | high | нет | `graph.service.ts:194-266`, `documents.service.ts:330-340` | EntityLink.upsert + cypher MERGE в одной `$transaction` | флаг `GRAPH_AGE_ENABLED` + вынести cypher из транзакции; чинить В ПАРЕ с #11 |
| 22 | Typed-entity граф: запись откатывается из-за недоступной `cypher()` | high | **да** | `graph.service.ts:497-516`, `postgres-init.sql:11-30` | то же, что #11/#12 (двойная запись + search_path) | kill-switch + квалификация `ag_catalog.cypher` ИЛИ `search_path` на пул-коннекте |
| 32 | Каждая операция через `cypher('z_graph',...)` падает, если AGE не установлен/не включён | high | **да** | `graph.service.ts:546-592`, `cypher-builder.ts:60` | hard-зависимость от внешнего расширения без флага | включить AGE на БД (`shared_preload_libraries='age'`) + флаг `GRAPH_AGE_ENABLED` для деградации на Postgres/EntityLink |
| 33 | Откат типизированных сущностей: Postgres INSERT + AGE MERGE в одной транзакции (name-keyed И decision) | high | **да** | `graph.service.ts:497-516,911-945` | интерактивная транзакция Prisma 7 → ROLLBACK при throw cypher | вынести `runCypherMergeNode` из `$transaction` в best-effort post-commit; чинить и decision-ветку |

\* #11 помечен `blocksChain:false` верификатором (IdeaBlock'и выживают), но это тот же корневой класс, что блокирующие #12/#22/#32/#33.

### Кластер B — транскрибация / Vox (1 баг)

| # | Заголовок | Sev | Chain | Location | Корень | Минимальный фикс |
|---|-----------|-----|-------|----------|--------|------------------|
| 3 | transcribe-цикл блокирует канал встречи: Vox вечно PROCESSING → 5 ретраев → `meeting=failed`; нет per-track идемпотентности | high | **да** | `vox.service.ts:151-251`, `transcribe.worker.ts:139-143,311,350` | poll 60×2с=120с < длины аудио (~27 мин); TranscriptTrack пишется только после poll; ретрай с дорожки №1 | поднять poll до 180×5с (через `VOX_POLL_*` ENV); per-track идемпотентность `@@unique([transcriptId,livekitIdentity])` + upsert; не уходить в merge при неполном наборе |

### Кластер C — specialist-layer / draft↔canonical (5 багов)

| # | Заголовок | Sev | Chain | Location | Корень | Минимальный фикс |
|---|-----------|-----|-------|----------|--------|------------------|
| 15 | 14 конкурирующих Worker'ов на одной очереди — `jobName` НЕ маршрутизирует, ~13/14 блоков теряются (job `completed` без throw) | **critical** | **да** | `specialist-3-14-goals.worker.ts:60-67`, `core-queue.service.ts:443-462`, `queues.ts:87-94` | миф BullMQ: Worker берёт ВСЕ jobs очереди, `job.name` не выбирает воркер; «чужой» → `return` (success) | ОДИН dispatcher-Worker на очередь с `switch(job.name)` (Map<jobName,handler>); неизвестный → throw; гард «ровно один Worker на очереди» |
| 16 | Специалисты диспатчатся на `draft`-блок без delay и скипают; нет re-dispatch после canonical | **critical** | **да** | `block-ingest.worker.ts:750,555-573`, `specialist-*-goals.worker.ts:116-122`, `block-distill.worker.ts:164-206` | dispatch при `draft` (без delay), canonical через ~30с; специалист видит `draft` → `return` без throw; markCanonical не re-dispatch'ит | перенести `router.dispatch` в `markCanonical` (после `status='canonical'`); убрать dispatch из block-ingest; гард canonical оставить |
| 19 | Skip-ветки специалистов (jobName-mismatch / не-canonical / signalType) завершают job как success — нет наблюдаемости и retry | high | **да** | `specialist-3-14-goals.worker.ts:93-129`, `specialist-3-3-decisions.worker.ts:105-148` | все skip = `return` (job `completed`), метрика только в `finally` → skip неотличим от обработки | не-canonical → throw (за jobName-фильтром) для retry; счётчик `core_specialist_skip_total{specialist,reason}`; B2 чинить первым |
| 20 | `linkPersonEntity` выбирает произвольную person-Entity без name-фильтра — реальный, но latent (нет call-sites) | low | нет | `entity-resolution.service.ts:781-794` | `findFirst(type=person)` без `canonicalName`/`orderBy` → берёт произвольную; асимметрия с `linkEntityPerson` | заменить на `findExactByLowerName`; разрулить мёртвый код (wire или delete + stale-comment) |
| 17 | `ProjectionRebuilder` падает на `skillTrait.findMany({tenantId})` → весь `Promise.all` реджектится | high | **да** | `projection-rebuilder.service.ts:204-210,154`, `schema.prisma:7087` | у `SkillTrait` нет `tenantId` (скоуп через `profileId→SkillProfile`); один reject валит батч | `where:{ profile:{ tenantId }, sourceBlockIds:{ has } }`; опц. `Promise.allSettled` |

### Кластер D — проекции / рекавери (4 бага)

| # | Заголовок | Sev | Chain | Location | Корень | Минимальный фикс |
|---|-----------|-----|-------|----------|--------|------------------|
| 21 | `ProjectionRebuilderService` падает на `skillTrait.findMany({tenantId})` — ни одна из 10 проекций не пересобирается | high | **да** | `projection-rebuilder.service.ts:204-210`, `schema.prisma:7087` | то же, что #17 (модель без `tenantId` в общем `Promise.all`) | `where:{ profile:{ tenantId } }` + `Promise.allSettled`; добавить реальный where в spec |
| 24 | Ordering-баг: терминалы (Goal/Decision/Insight/Idea) диспатчатся при `draft`, обрабатывают только `canonical` → первая проекция не создаётся | **critical** | **да** | `block-ingest.worker.ts:740-750,559-573`, `block-distill.worker.ts:164-206` | dispatch на draft (без delay) vs gate canonical; markCanonical не вызывает dispatch | `router.dispatch(canonicalBlock)` в `markCanonical` после `status:'canonical'`; убрать dispatch из block-ingest |
| 25 | `ProjectionRebuilderService` крашит весь recovery: `skillTrait.findMany` с несуществующим `tenantId` | high | **да** | `projection-rebuilder.service.ts:204-210` | дубль #17/#21 (фиксируется одной правкой) | `where:{ profile:{ tenantId } }` + `Promise.allSettled` |
| 26 | `ProjectionRebuilder` не покрывает `Goal` в карте rebuild; первая проекция создаётся другим путём (by-design) | low | нет | `projection-rebuilder.service.ts:54-64,143-225`, `router.service.ts:375-378` | `ProjectionKind` не включает goal (хотя `Goal.sourceBlockIds` есть); `processBlock` CREATE-only | добавить goal в `ProjectionKind`/`PROJECTION_SPECIALIST`/findMany; отдельно — update-path в `processBlock` |

### Кластер E — каналы / вход (8 багов)

| # | Заголовок | Sev | Chain | Location | Корень | Минимальный фикс |
|---|-----------|-----|-------|----------|--------|------------------|
| 1 | Типизированные сущности встречи не персистятся при отсутствии AGE (двойная запись откатывает create) | high | **да** | `graph.service.ts:497-516,911-945` | то же, что кластер A — общая транзакция Postgres+cypher | вынести `runCypherMergeNode` из транзакции (best-effort); обновить docstring/code-pitfalls |
| 2 | Мост `ingestMeeting` проглатывает ВСЕ ошибки и возвращает null — провал невидим в статусе встречи | high | **да** | `analyze.worker.ts:378-415`, `meeting.adapter.ts:87-95` | `.catch(()=>null)` → реджект не попадает в ветку `failed`, `failureReason` не пишется | убрать молчаливый `return null`; писать `failureReason='ingest=...'`; опц. вынести в ретраемый BullMQ-job |
| 5 | `SegmentBuilder` не распознаёт free_note: текст уходит в LLM как JSON-обёртка (деградация извлечения) | medium | нет | `segment-builder.service.ts:78-94`, `conversational-ingest.adapter.ts:49-54` | `tryGetFullText` читает строго `payload.fullText`; free_note имеет `text` → `buildFallback` → `JSON.stringify(payload)` | ветка `kind==='free_note'` → `[{text: payload.text}]`; НЕ менять форму payload (дедуп по checksum) |
| 7 | Telegram free_note: tenant резолвится по самому раннему Membership — мульти-Org привяжет к не той компании | low | нет | `telegram-bot.adapter.ts:281-294`, `schema.prisma:6144-6174` | `findFirst orderBy joinedAt asc`; `ChannelBinding` без `orgId` | исключать `demo_observer`, tie-break `{joinedAt},{id}`; хранить выбор в `ChannelBinding.preferences` |
| 8 | Владелец Org не получает Person — дамп владельца всегда идёт legacy-путём (без Document/provenance) | medium | нет | `orgs.service.ts:74-117`, `dump.service.ts:80-144` | `createForOwner` создаёт Membership(owner) без `personId` и без `Person.create` | создавать Person владельца в `createForOwner` + `personId` в Membership; backfill для существующих |
| 9 | Канал meeting не доходит до core в prod: `ingestMeeting` зовётся только из analyze, а analyze не наступает (B1) | high | **да** | `analyze.worker.ts:378`, `transcribe.worker.ts:139-143,311` | единственный prod-вызов моста за `ai_ready`; transcribe зациклен | чинить B1 (transcribe/Vox); + опц. fallback-reconciler `ingestMeeting` по готовому `Transcript.turns` |
| 10 | Per-source Telegram ingest (`bot`) webhook не регистрируется при `TELEGRAM_PROXY_ENABLED=true` | high | **да** | `telegram.service.ts:67-96`, `env.schema.ts:915-916` | `registerWebhook` зовёт `setWebhook` напрямую; прокси отвергает | продуктово-доковый фикс (статус «требует ручной регистрации»); опц. `proxyAdmin.upsertBot` |
| 27 | `GET /me/promises` отдаёт hard-403 (`no_person`) членам Org без user-линкованной Person | high | **да** | `commitments.service.ts:44-62`, `my-promises.controller.ts:58-68` | `resolveSelfPerson` бросает `no_person`; `Person.userId` не гарантирован | в `list()` ловить `no_person` → `{items:[]}`; опц. lazy-линковка Person по Membership |

### Кластер F — код ↔ схема (6 багов)

| # | Заголовок | Sev | Chain | Location | Корень | Минимальный фикс |
|---|-----------|-----|-------|----------|--------|------------------|
| 6 | Типизированные сущности группы Б из free_note теряются (AGE-merge в обязательной транзакции) | high | **да** | `graph.service.ts:497-516,911-945` | дубль кластера A для free_note-канала | установить AGE + вынести cypher из транзакции; опц. флаг `GRAPH_AGE_ENABLED` |
| 29 | projection-rebuild падает целиком: `skillTrait.findMany({tenantId})` внутри `Promise.all` | high | **да** | `projection-rebuilder.service.ts:204-210` | дубль #17/#21/#25 (модель без `tenantId`) | `where:{ profile:{ tenantId } }` + `Promise.allSettled` |
| 30 | `DataClassAuditSnapshotCron.snapshotVersionDrift`: raw SQL читает `insights/decisions.dataClassAudit` — колонки нет в схеме | low | нет | `dataclass-audit-snapshot.cron.ts:113-126`, `schema.prisma:5475,5598` | поле `dataClassAudit` есть только у 6 моделей; код впереди схемы | переписать UNION на 6 моделей с реальной колонкой (или удалить ветки); поднять лог debug→warn |
| 31 | `DataClassAuditSnapshotCron`: 7 из 13 kind'ов не имеют `dataClassAudit` — present-ratio молча skip | low | нет | `dataclass-audit-snapshot.cron.ts:27-41,83-97` | `PROJECTIONS` включает insight/decision/skill_trait/idea/... без колонки | сократить `PROJECTIONS` до 6 моделей с `dataClassAudit` |
| 32* | GraphService: каждая операция cypher падает без AGE (см. кластер A) | high | **да** | `graph.service.ts:546-592` | (см. #32 выше) | (см. кластер A) |
| 33* | Откат типизированных сущностей (Postgres+AGE в одной транзакции, см. кластер A) | high | **да** | `graph.service.ts:497-516,911-945` | (см. #33 выше) | (см. кластер A) |

\* #32/#33 проходят и по кластеру A, и по «код↔схема» (raw SQL к расширению, которого нет в проде) — это один корневой класс AGE.

### Кластер G — флаги / пороги (4 бага)

| # | Заголовок | Sev | Chain | Location | Корень | Минимальный фикс |
|---|-----------|-----|-------|----------|--------|------------------|
| 18 | block-linker гейтится статическим ENV `LINKER_MIN_BLOCKS` (default 50); AdminSetting (seed=3) воркером не читается | high | **да** | `block-linker.worker.ts:122-133`, `typed-config.service.ts:729` | `this.get('LINKER_MIN_BLOCKS')` — статический ENV, не `getDynamic`; default ENV=50 ≠ seed=3 | снизить ENV-default до 3; перевести чтение на `getDynamic('knowledge.linkerMinBlocks',...)` |
| 23 | `BlockLinkerWorker` читает `linkerMinBlocks` из ENV, игнорируя AdminSetting — config-drift, default рассинхрон | medium | **да** | `block-linker.worker.ts:123`, `seed-admin-settings.ts:228`, `env.schema.ts:515` | то же, что #18 (мёртвая крутилка) | `getDynamic` + выровнять ENV/seed defaults; класс — все `knowledge.*` orphaned |
| 34 | AdminSetting-оверрайды порогов knowledge-core не читаются воркерами — getter использует `this.get()` вместо `resolveSync()` | high | **да** | `typed-config.service.ts:716-757,2199-2227` | getter `knowledgeCore` читает все поля через приватный `this.get(ENV)`, минуя `cacheMap`(AdminSetting) | перевести каждое поле на `resolveSync('knowledge.*','ENV',default)`; выровнять seed/env defaults |
| 35 | block-linker SKIP при `canonicalCount<50` — на малом тенанте граф связей не строится | high | **да** | `block-linker.worker.ts:122-133`, `env.schema.ts:515` | дубль #18 (жёсткий гейт критической массы из ENV) | ENV `LINKER_MIN_BLOCKS=3` для теста; долгосрочно — `getDynamic` |
| 36 | theme-clusterer гейтит Theme: жёсткий порог 100 блоков (ENV), нет admin-override | medium | **да** | `theme-clusterer.cron.ts:151,180`, `env.schema.ts:557,562` | `THEME_CLUSTERING_MIN_BLOCKS=100` из `this.get`; admin-ключи объявлены, но не потребляются | ENV `THEME_CLUSTERING_MIN_BLOCKS=5`, `THEME_CLUSTER_MIN_SIZE=2`; или `getDynamic`/убрать мёртвые ключи |
| 37 | entity-graph-builder: пороги ≥3 co-mention + confidence ≥0.75 оставляют граф сущностей пустым на малом тенанте | medium | **да** | `entity-graph-builder.cron.ts:66-102`, `entity-graph.service.ts:209-217` | `HAVING COUNT(*)>=3` + confidence-gate + фильтр `status='canonical'`; статический ENV | ENV `ENTITY_GRAPH_MIN_COMENTIONS=1` (узкий blast radius); `LINK_MIN_CONFIDENCE` трогать отдельно (общий с block-linker) |
| 38 | projection-rebuild падает целиком: `skillTrait.findMany({tenantId})` — `PrismaClientValidationError` на каждый `idea_block.updated` | high | **да** | `projection-rebuilder.service.ts:204-210`, `schema.prisma:7147-7197` | дубль #17/#21/#25/#29 (модель без `tenantId`) | `where:{ profile:{ tenantId } }`; unit-тест на `Promise.all` |

### Кластер H — терминал (2 бага)

| # | Заголовок | Sev | Chain | Location | Корень | Минимальный фикс |
|---|-----------|-----|-------|----------|--------|------------------|
| 28 | PromiseKeeper: при сбое update `commitmentStatus` probe уже ушёл, блок остаётся `open` — теор. дубль followup-probe | low | нет | `specialist-3-9-promise-keeper.service.ts:240-283` | probe-then-update без отката; защищён dedup-гейтом (contentHash) + суточным интервалом | оптимистичный порядок: `updateMany where:{status:'open'}` → если count=0 skip → потом probe; unit-тест на throw |
| 16* | (см. кластер C) | — | — | — | — | — |

### Кластер I — док-дрейф (1 баг)

| # | Заголовок | Sev | Chain | Location | Корень | Минимальный фикс |
|---|-----------|-----|-------|----------|--------|------------------|
| 4 | CLAUDE.md/README описывают несуществующий worker-процесс (`workers/main.ts`, `bun run worker:dev`) — воркеры IN-PROCESS | low | нет | `CLAUDE.md:57,71`, `README.md:45`, `app.module.ts:339` | воркеры переведены in-process (`WorkersModule` в `AppModule`); доки/комментарии устарели | чисто документация: убрать `worker:dev`/`workers/main.ts`, заменить на in-process |

---

## 6. Проверено и НЕ баг (5 опровержений, для строгости)

| # | Заявка | Вердикт | Почему |
|---|--------|---------|--------|
| R1 | Устаревшие docstring'и «consumer не подписан / отдельный worker-процесс» — это баг | **не баг** | мост встреча→граф реально рабочий: producer `ingest.service.ts:208`, consumer `block-ingest.worker.ts:126-146` (живой Worker), in-process `app.module.ts:339`. Комментарии вводят в заблуждение, но не функциональный дефект (= баг #4, severity low) |
| R2 | SourceType `chat` без producer — рантайм-баг | **не баг (gap покрытия)** | `chat` объявлен в enum (`schema.prisma:212`), но ни один код не создаёт `Source(type='chat')`/RawEvent; заглушка под внутренний мессенджер «Кора-Чат» (только анализ). `chat-v2` — dialog/retrieval-слой, RawEvent не создаёт |
| R3 | Cypher-инъекция в `removeNode/getNeighbors/findPath` | **опровергнуто** | `escapeString` экранирует И backslash, И кавычку (`cypher-builder.ts:104-106`, spec подтверждает); тело Cypher в dollar-quote `$cypher$...$cypher$`; в `id/tenantId` идут только cuid из БД и валидированный org-id, свободный текст в cypher не инлайнится |
| R4 | pgvector raw SQL (`::vector(1536)`, `<=>`) — баг | **не баг** | extension `vector` + HNSW заведены (`postgres-init.sql:9,66-79`), задекларированы в схеме (`schema.prisma:9,17,3067`); оба pgvector-пути в try/catch с graceful fallback. Прод подтверждает, что vector установлен (в отличие от AGE) |
| R5 | `KNOWLEDGE_CORE_V2_AGENTS_ENABLED=false` — дефект | **не баг (намеренный флаг)** | master-флаг для A/B v2-слоя против legacy; legacy-цепочка (tasks-extract/chapters + meeting-report-fast, default true) продолжает наполнять UI. Задокументировано (`env.schema.ts:576-585`, `decisions-log.md:254`). Влияет лишь на `meeting-analyze-v2.cron`, к основному обрыву отношения не имеет |

---

## 7. Статус после `git pull` (что merge затронул / не затронул)

- **Критический путь — НЕ затронут.** Merge не трогал Vox/transcribe (B1), specialist-routing (B2), draft→canonical (B3), projection skillTrait (B4), AGE/graph (B5), пороги (B6), `ingestMeeting` swallow (B7). Все блокеры §1 актуальны на `dev@1c0214e4`.
- **Баг #7 / #8 / #27 (no_person) — частично затронут, баг открыт.** Merge добавил РУЧНУЮ привязку Person через раздел «Команда» (`persons.service.ts` `linkUserId`). Но корневые потребители НЕ изменены: `commitments.service.ts` (403 `no_person`), legacy-путь dump'а, `createForOwner` без Person. Автолинковки нет — `GET /me/promises` всё ещё может вернуть 403, дамп владельца всё ещё идёт legacy-путём.
- **AGE-корень уточнён глубже.** Прод-формулировка «AGE не установлен» неполна: рантайм-пул Prisma (`prisma.service.ts:43`) не делает `LOAD age`/`search_path=ag_catalog`, поэтому `cypher()` не резолвится ДАЖЕ при установленном расширении. Фикс — `ALTER ROLE app SET search_path=ag_catalog,...` (+ опц. квалификация `ag_catalog.cypher` + kill-switch `GRAPH_AGE_ENABLED`).
- **Машинный гард уточнён.** tsc СТРУКТУРНО слеп к лишним ключам вложенного `where`/`data` в Prisma (generic `Subset<T,Args>`) — поэтому `skillTrait.tenantId` и `insight.create({dataClassAudit})` проходят typecheck, но падают в рантайме. Эмпирически: свежий `prisma generate` + `tsc --noEmit` = 0 ошибок. **«Добавить typecheck» НЕ помогает.** Реальный гард — интеграционные тесты против реального Postgres + конвенция аннотировать литералы `Prisma.XxxWhereInput`/`CreateInput`.
- `chat` (R2) — по-прежнему gap покрытия, не регресс merge.

---

## 8. Рекомендованный порядок починки

### Критический путь → МТЗ №1 (живой конвейер встреча→граф→терминал)

Чинить **серией**, в порядке движения данных. Каждый узел сам по себе обнуляет результат — поэтому фиксы идут блоком, а не по одному:

1. **B1 — Vox/transcribe** (баги #3, #9; finding #1). Поднять poll до 180×5с через `VOX_POLL_*` ENV; per-track идемпотентность (`@@unique([transcriptId,livekitIdentity])` + upsert); сохранять `taskId` до poll; не уходить в merge при неполном наборе треков. **Разблокирует весь верхний тракт.**
2. **B7 — ingestMeeting swallow** (баг #2). Убрать `.catch(()=>null)`; писать `meeting.failureReason`; опц. метрика `ingest_failed`. Делает провал моста видимым.
3. **B5 — AGE/search_path** (баги #11, #12, #22, #32, #33; finding #3). `ALTER ROLE app SET search_path=ag_catalog,...` + флаг `GRAPH_AGE_ENABLED` (kill-switch, no-op для всех cypher) + вынести `runCypherMergeNode` из транзакции `upsertEntity`/`upsertDecision`/`addEdge` (чинит ВЕСЬ класс). + наблюдаемость (#13).
4. **B2 — specialist-routing** (баги #15, #19). ОДИН dispatcher-Worker на `core.specialist-routing` с `switch(job.name)` + Map<jobName,handler>; неизвестный job → throw; машинный гард «ровно один Worker на очереди». Чинить весь класс (14 воркеров).
5. **B3 — draft→canonical** (баги #16, #24). Перенести `router.dispatch` в `markCanonical` (после `status:'canonical'`); убрать dispatch из block-ingest; гард canonical в специалистах оставить.
6. **B4 — projection skillTrait** (баги #17, #21, #25, #29, #38). One-line: `where:{ profile:{ tenantId } }` + `Promise.allSettled`. Один фикс закрывает 5 дублей.
7. **B6 — пороги графа** (баги #18, #23, #34, #35, #36, #37). Немедленно: ENV `LINKER_MIN_BLOCKS=3`, `THEME_CLUSTERING_MIN_BLOCKS=5`, `THEME_CLUSTER_MIN_SIZE=2`, `ENTITY_GRAPH_MIN_COMENTIONS=1`. Системно (правило «крутилки в AdminSetting»): перевести getter `knowledgeCore` на `resolveSync`/`getDynamic`, выровнять ENV/seed defaults.

> **Машинный гард для B4/F:** не полагаться на «добавить typecheck» (tsc слеп к лишним ключам Prisma `where`). Гард = интеграционные тесты против реального Postgres + конвенция аннотировать литералы `Prisma.XxxWhereInput`/`CreateInput`.

> Подробные фазы/контракт — отдельное **МТЗ №1** в `plans/tz/` (создаётся по этому аудиту).

### Backlog → МТЗ №2 (остаток вне критического пути)

Баги, которые не блокируют конвейер, но снижают качество/наблюдаемость:

- **Каналы:** #5 (free_note JSON-обёртка в LLM), #7 (мульти-Org tenant resolve), #8 (Person владельца — фикс `createForOwner` + backfill), #10 (per-source Telegram при proxy), #27 (403 `no_person` → `{items:[]}`).
- **Терминал:** #26 (Goal в rebuild-карте + update-path), #28 (PromiseKeeper probe-then-update, оптимистичный порядок).
- **Код↔схема (наблюдаемость):** #30, #31 (DataClassAuditSnapshotCron — сократить `PROJECTIONS` до 6 моделей, переписать `snapshotVersionDrift`).
- **Латентное/мёртвый код:** #20 (`linkPersonEntity` — `findExactByLowerName` + разрулить dead-code).
- **Документация:** #4 (CLAUDE.md/README — убрать `worker:dev`/`workers/main.ts`, заменить на in-process).
- **Provider smoke (finding #6, вне 38 confirmed):** ложная тревога мониторинга — `max_output_tokens` 8→24, Ollama `no-key` исключить из набора, привести алерт-payload к `SystemMessagePayloadSchema` (иначе мониторинг не доставит алерт даже при реальном отказе).
- **room-messages 403 not_participant (finding #7):** non-owner регистрированный участник заходит как guest (Participant с `userId=null`); единый хелпер `ensurePersonForUser` + Participant с `userId` при join.
