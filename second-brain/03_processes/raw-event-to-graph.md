---
name: raw-event-to-graph
title: Превращение сырого события в граф знаний
trigger_type: event
status_overall: implemented
last_audited: 2026-05-29
owners_human:
  - инженер knowledge-core
  - продакт «памяти компании»
related_plans:
  - plans/tz/2026-05-10-knowledge-core-tz.md
  - plans/tz/2026-05-21-sba-alpha-3-layer2-ontology-extension.md
  - plans/tz/2026-05-21-second-brain-agents-umbrella.md
related_projects:
  - 01_projects/ingest-and-sources.md
  - 02_architecture/knowledge-core.md
  - 01_projects/workers-queues.md
  - 01_projects/ai-jobs.md
---

# Превращение сырого события в граф знаний

> **Как читать этот файл:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Номера шагов между разделами 3 и 5 синхронизированы.

## 1. О чём это (бытовой рассказ)

В платформу постоянно прилетают наблюдения из разных источников: транскрипт встречи, заметка из Telegram-бота, документ из загрузки, активити трекера, дамп мысли через «Concierge», письмо из почты. Все они выглядят по-разному, но дальше с ними должно произойти одно и то же — содержимое должно превратиться в **атомарные факты** (один факт = одно утверждение), привязаться к **сущностям** (клиент Ромашка, проект Альфа, сотрудник Иванов) и стать частью **графа знаний** компании.

Этот процесс — как фабрика по разделке сырья. На входе любое наблюдение (текст, реплики, файл). На выходе:
- несколько «идейных блоков» (`IdeaBlock`) — каждый со своей цитатой-доказательством и таймкодом, если был источник медиа;
- набор сущностей в графе — клиенты, проекты, продукты, люди, регламенты, решения, метрики, инструменты;
- автоматические связи между блоками (один блок развивает мысль другого, противоречит ему, отвечает на его вопрос);
- маршрутизация по «специалистам Слоя 3» — каждый специалист подхватывает свой тип сигнала (решения, регламенты, инсайты, идеи, навыки).

Цель — чтобы через месяц-два в платформе была живая карта того, что компания знает, делает, обсуждает и куда движется. Без этого процесса все остальные продуктовые штуки (отчёт COO, клон должности, реестр решений, радар проблем) работать не могут — у них просто не было бы пищи.

В проде это **полностью работает** — pipeline стабилен с Фазы 4. Часть тонкостей (extra-метки, axis-классификатор, кластеризация Entity по embedding'у) включена по умолчанию, часть требует накопления данных (см. ENV-гейты в разделе 8).

## 2. Что запускает (триггер)

- **Тип:** событие.
- **Кто или что инициирует:** любой адаптер источника создаёт запись `RawEvent` и публикует job в очередь графа.
- **Технический источник сигнала:** `IngestService.ingest(...)` → `core.raw-events` (см. `backend/src/modules/ingest/ingest.service.ts:208`). Адаптеры:
  - `MeetingIngestAdapter.ingestMeeting(meetingId)` — встречи (после `AnalyzeWorker.catch`);
  - `DocumentIngestAdapter` — очередь `core.document-uploaded`;
  - `TextIngestAdapter` — очередь `core.dump-created` (Concierge / web-form);
  - `TrackerAdapter` — события трекера (с `signalTypeHint`);
  - `EmailFetchService` — IMAP-cron;
  - `TelegramAdapterService` — webhook Telegram-бота;
  - `MangoService` — webhook телефонии.

## 3. Шаги процесса (общий список)

1. **Адаптер источника принимает сырьё** (транскрипт встречи / текст заметки / распарсенный PDF / activity трекера / тело письма) и собирает канонический `payload`.
2. **`IngestService.ingest(...)` создаёт `RawEvent`** — с идемпотентным ключом, чтобы повторная подача того же события не породила дубль; крупные payload уезжают в S3.
3. **Воркер «block-ingest» забирает событие, режет на сегменты** (скользящее окно ≤2000 токенов) и одним LLM-вызовом извлекает атомарные блоки + типизированные сущности группы Б.
4. **Каждый блок сохраняется как `IdeaBlock`** в статусе `draft`, со своим эмбеддингом, с цитатой-свидетельством (`IdeaBlockEvidence`) и таймкодами, а упомянутые сущности (клиенты / проекты / люди / продукты / документы) сохраняются как `Entity` с привязкой `IdeaBlockEntity`.
5. **Каждый блок попадает в `core.block-distill`** (с задержкой 30 секунд) — там работает арбитр-дедуп: KNN среди уже канонических блоков того же тенанта + LLM-судья «слить или оставить отдельно».
6. **Если арбитр сказал «отдельный» — блок становится `canonical`** и ставится в очередь `core.block-linker`, где LLM строит типизированные связи с другими каноническими блоками (развивает / противоречит / приводит к / отвечает на вопрос и т.д.).
7. **Раз в 5 минут крон-скан ищет пары похожих сущностей** (cosine > 0.88, тот же `type`) и ставит их в `core.entity-resolver`, где другой LLM-арбитр решает «это одна и та же сущность или нет»; на слияние — переносит упоминания на канонический объект.
8. **Параллельно с distill каждый блок диспатчится в специалистов Слоя 3** через `core.specialist-routing` по статическому mapping'у (signalType → специалист): решения, регламенты, инсайты, идеи, навыки, project-customer, knowledge-clone.
9. **`RawEvent.processingStatus` переходит в `ingested`** — событие переработано; при ошибке — `failed` с текстом ошибки, BullMQ ретрайнет до 5 раз.

## 4. Что получается на выходе

- **Графу знаний компании:** новые `IdeaBlock`-и (атомарные факты), `Entity`-узлы, `IdeaBlockEvidence` (цитаты), `IdeaBlockEntity` (упоминания), `IdeaBlockLink` (связи), Decision/Regulation/Policy/Metric/Tool — типизированные сущности группы Б через `GraphService.upsertEntity`.
- **Специалистам Слоя 3:** jobs в `core.specialist-routing` под их `jobName` (3-1-regulations, 3-3-decisions, 3-4-project-customer, 3-5-insights, 3-6-ideas, 3-2-knowledge-clone, 3-7-skill).
- **Где это видно:**
  - `/knowledge/blocks/:id` — деталка блока с evidence и упомянутыми сущностями;
  - `/knowledge/entities/:id` — сущность + блоки, в которых она упоминается;
  - `/knowledge/search` — гибридный поиск (cosine 0.7 + BM25 0.3);
  - `/knowledge/graph/neighbors` — обход графа на 1–3 шага;
  - `/admin/platform/workers` — состояние очередей и retry упавших job'ов.

## 5. Технический разрез (по шагам)

> Номера шагов синхронизированы с разделом 3.

| # | Шаг (бытовой) | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Адаптер собирает payload | Каждый адаптер формирует канонический `payload` (`MeetingIngestAdapter` — transcript+turns+roomChat; `DocumentIngestAdapter` — parsedText; `TextIngestAdapter` — готовый dump; `TrackerAdapter` — issue/event с `signalTypeHint`) и вызывает `IngestService.ingest(...)` | `backend/src/modules/ingest/adapters/meeting.adapter.ts:62`, `adapters/document/document.adapter.ts:54`, `adapters/text/text.adapter.ts:84`, `adapters/tracker/tracker.adapter.ts`, `adapters/email/email-fetch.service.ts`, `adapters/telegram/telegram.service.ts`, `adapters/phone-call/mango.service.ts` | вызов сервиса (без HTTP) | — | ✅ |
| 2 | Создание `RawEvent` | Идемпотентный ключ `sha256(sourceId + ':' + (sourceExternalId ?? payloadChecksum) + ':' + occurredAtIso)`; payload >10 MiB уезжает в S3; quota `ingest_bytes_per_month`; `processingStatus='received'`; enqueue в `core.raw-events` с `jobId=raw_<rawEventId>` | `backend/src/modules/ingest/ingest.service.ts:81`, `ingest.service.ts:188`, `core-queue.service.ts:108` | `core.raw-events` | `RawEvent`, `Source` (lazy upsert) | ✅ |
| 3 | Сегментирование + LLM-извлечение | `BlockIngestWorker` загружает payload (inline/S3); `SegmentBuilder.buildSegments` режет окнами `BLOCK_INGEST_WINDOW_SEGMENTS=5` по `BLOCK_INGEST_MAX_TOKENS_PER_SEGMENT=2000`; один LLM-вызов `block-ingest` (JSON Schema strict) возвращает `blocks[]` + типизированные группы Б (processes/decisions/regulations/policies/tools/metrics); если в payload `signalTypeHint` — переопределяет signalType первого блока или создаёт синтетический блок | `backend/src/modules/knowledge-core/workers/block-ingest.worker.ts:122,149,172`, `services/segment-builder.service.ts`, `services/block-extraction.service.ts:1`, `prompts/block-ingest.prompt.ts` | consumer `core.raw-events`, concurrency=2 | — (промежуточное) | ✅ |
| 4 | Persist `IdeaBlock` + Evidence + Entity | Батч-эмбеддинг (text-embedding-3-small, 1536-dim); транзакция: `IdeaBlock`(status=draft) + `$executeRawUnsafe vector(1536)` для embedding; `IdeaBlockEvidence` с quote+startMs+endMs; `propertySpans[mentionedEntity]`; **сущности — вне транзакции** через `EntityResolutionService.findOrCreateEntity` + `IdeaBlockEntity` (skip P2002); типизированные группы Б — через `GraphService.upsertEntity` (двойная запись в Postgres + AGE) | `backend/src/modules/knowledge-core/workers/block-ingest.worker.ts:220,232,708,843`, `services/entity-resolution.service.ts`, `common/graph/graph.service.ts` | consumer `core.raw-events` | `IdeaBlock`, `IdeaBlockEvidence`, `IdeaBlockEntity`, `Entity`, `Process`, `Regulation`, `Policy`, `Tool`, `Metric`, `Decision` (вкл. fallback Decision для signalType=decision без LLM-decisions[]) | ✅ |
| 5 | Distill (KNN-арбитр merge/distinct) | `enqueueBlockDistill(blockId)` с delay=`DISTILL_DEBOUNCE_MS=30000`, jobId=`block_distill_<blockId>`; `BlockDistillWorker` берёт top-`DISTILL_KNN_TOP_K=5` cosine-кандидатов того же tenant'а с порогом `DISTILL_MERGE_THRESHOLD=0.92`; LLM `block-distill` → `merge` или `distinct`; на merge — транзакция переноса evidence + entity-mention'ов на canonical, weighted-avg confidence, tags union | `backend/src/modules/knowledge-core/workers/block-distill.worker.ts:122,142,200`, `services/block-merge.service.ts` | `core.block-distill`, concurrency=2 | `IdeaBlock.status` (canonical / merged_into), `IdeaBlock.mergedIntoId`, `IdeaBlockEvidence.blockId` (перенос), `IdeaBlockEntity.blockId` (перенос) | ✅ |
| 6 | Link (типизированные связи блоков) | `enqueueBlockLinker(canonicalId)`; гейт `LINKER_MIN_BLOCKS=50` (count canonical в Org) — пока меньше, jobs skip с логом; `BlockLinkService.findLinkCandidates` берёт top-`LINK_KNN_TOP_K=10`; LLM `block-linker` → 7 типов связи или `none`; `upsert IdeaBlockLink` при confidence ≥ `LINK_MIN_CONFIDENCE=0.75`; `relationType='contradicts'` с confidence ≥ 0.85 эскалируется в `ConflictService.report` | `backend/src/modules/knowledge-core/workers/block-linker.worker.ts:91,113,135`, `services/block-link.service.ts` | `core.block-linker`, concurrency=2 | `IdeaBlockLink`, `ConflictItem` (опц.) | ✅ |
| 7 | Entity-resolver (дедупликация сущностей) | `EntityResolverCron.sweep` каждые `*/5 * * * *` сканирует SQL-парами одинакового `type` и `(1 - embedding <=> embedding) > ENTITY_MERGE_THRESHOLD=0.88` (лимит 50 пар/тик на всю систему), enqueue в `core.entity-resolver`; `EntityResolverWorker` (concurrency=1) делает KNN + LLM `entity-merge-arbiter` + транзакционный merge с переносом IdeaBlockEntity (skip P2002) | `backend/src/modules/knowledge-core/workers/entity-resolver.cron.ts:39,107`, `workers/entity-resolver.worker.ts:97,178`, `services/entity-merge.service.ts` | `*/5 * * * *` + `core.entity-resolver` | `Entity.mergedIntoId`, `Entity.aliases`, `Entity.mentionsCount`, `IdeaBlockEntity.entityId` (перенос) | ✅ |
| 8 | Specialist routing | `RouterService.dispatch(block)` после persist'а — статический mapping signalType → специалист (`ROUTER_MAX_SPECIALISTS_PER_BLOCK=4` приоритет: decisions > regulations > insights > ideas > skill > project-customer > knowledge-clone); enqueue в `core.specialist-routing` с jobName и jobId=`<specialistName>_<blockId>`; параллельно `AxisClassifier.classify` пишет axis-метки | `backend/src/modules/knowledge-core/workers/block-ingest.worker.ts:547`, `services/router.service.ts`, `services/axis-classifier.service.ts` | `core.specialist-routing` | jobs (без БД-записи здесь); см. отдельные процессы специалистов | ✅ |
| 9 | Финализация RawEvent | На успехе — `processingStatus='ingested'`, `processedAt=now`, `processingError=null`; на ошибке — `processingStatus='failed'`, текст в `processingError` (4000 chars), BullMQ retry: 5 attempts, exponential 5s/10s/20s/40s | `backend/src/modules/knowledge-core/workers/block-ingest.worker.ts:521,589`, `modules/core-queue/queues.ts:192` | — | `RawEvent.processingStatus`, `RawEvent.processedAt`, `RawEvent.processingError` | ✅ |

### 5.1 Структуры данных, через которые проходит процесс

```
Source (lazy upsert per tenant × type × name)
  ↓
RawEvent { tenantId, sourceId, sourceType, sourceExternalId, payload | payloadS3Key,
           payloadChecksum, idempotencyKey, processingStatus, dataClass, occurredAt }
  ↓ block-ingest
IdeaBlock { name, criticalQuestion, trustedAnswer, signalType (19 значений),
            confidence, dataClass, status (draft → canonical | merged_into),
            embedding vector(1536), propertySpans, roleRelevant, roleId,
            commitmentStatus, commitmentDueDate, commitmentRecipientPersonId }
  + IdeaBlockEvidence { blockId, rawEventId, quote, startMs, endMs, sourceType, sourceTimestamp }
  + IdeaBlockEntity { blockId, entityId, mentionContext, role (subject|object|mentioned) }
  + Entity { tenantId, type (12 EntityType), canonicalName, aliases[], embedding,
             mergedIntoId, mentionsCount }
  + Process / Regulation / Policy / Metric / Tool / Decision (группа Б, через GraphService)
  ↓ block-distill (30s debounce)
IdeaBlock.status = canonical | merged_into (+ mergedIntoId)
  ↓ block-linker (после canonical)
IdeaBlockLink { fromBlockId, toBlockId, relationType (7 типов),
                confidence, explanation, createdBy='linker', status='active' }
  + ConflictItem (опц. при contradicts ≥0.85)
  ↓ specialist-routing (параллельно с distill)
SpecialistRoutingJob { blockId, tenantId, signalType, specialistName }
```

### 5.2 LLM-вызовы внутри процесса

| Шаг | taskType | Primary | Secondary | Tertiary | Где промпт |
|---|---|---|---|---|---|
| 3 | `block-ingest` | DeepSeek V4-flash | OpenAI gpt-5.4-mini (через proxy) | Ollama qwen3.5:9b | `backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts` |
| 5 | `block-distill` | DeepSeek V4-flash | OpenAI gpt-5.4-nano | Ollama qwen3.5:9b | `backend/src/modules/knowledge-core/prompts/block-distill.prompt.ts` |
| 6 | `block-linker` | DeepSeek V4-flash | OpenAI gpt-5.4-nano | Ollama qwen3.5:9b | `backend/src/modules/knowledge-core/prompts/block-linker.prompt.ts` |
| 7 | `entity-merge-arbiter` | DeepSeek V4-flash | OpenAI gpt-5.4-mini | Ollama qwen3.5:9b | `backend/src/modules/knowledge-core/prompts/entity-merge-arbiter.prompt.ts` |

Маршруты задаются сидерами `backend/scripts/seed-llm-task-routes-default.ts:155,165,175,195` и `backend/scripts/seed-llm-task-routes-knowledge-core.ts:66,75,84`. Эмбеддинги — `text-embedding-3-small` (1536-dim) через `KnowledgeEmbeddingService`.

## 6. Точки отказа и наблюдаемость

**Prometheus метрики:**
- `core_block_ingest_total{tenant_top, status}` — кол-во прохождений block-ingest;
- `core_router_dispatched_total{specialist, signal_type}`, `core_router_fan_out`, `core_router_trimmed_total` — router;
- `core_extraction_entity_total{type}`, `core_extraction_confidence{type}` — группа Б;
- `core_entity_resolution_dedup_total{type, action}` — created / merged для Entity;
- `core_specialist_pipeline_duration_seconds{type}` — каждый специалист.

**BullMQ очереди** (видно в `/admin/platform/workers`):
- `core.raw-events`, `core.block-distill`, `core.block-linker`, `core.entity-resolver`, `core.specialist-routing`.

**Логи** (pino, контекст `trace`): `IngestService`, `BlockIngestWorker`, `BlockDistillWorker`, `BlockLinkerWorker`, `EntityResolverWorker`, `EntityResolverCronService`, `RouterService`.

**Известные грабли** (см. [[02_architecture/code-pitfalls]]):
- `IdeaBlockEntity` имеет composite PK `(blockId, entityId)` — при `mergeInto` / `entity-resolver merge` обработка по одному с try/skip P2002 (см. `block-distill.worker.ts:251`, `entity-resolver.worker.ts:244`).
- Сущности создаются **вне транзакции** блока — если упадёт, блок остаётся без mentions; восстанавливается при следующем upsert.
- pgvector `::text` возвращает строку `[0.1,0.2,...]` — парсится через `parseVector(...)` (см. `theme-clusterer.cron.ts:360`).
- `WorkerOrgGate` может полностью отключить block-ingest / block-distill / block-linker / entity-resolver per-Org из админки — тогда jobs throw'аются и BullMQ retry'ит до победного.

**Кнопки админки:** `/admin/platform/workers` — повтор упавших jobs; `/admin/org/.../knowledge` (Фаза 7) — reprocessRawEvent с suffix к jobId.

## 7. Связанные процессы

- [[meeting-post-processing]] — порождает RawEvent через `MeetingIngestAdapter` (Шаг 6 там = Шаг 1-2 здесь).
- [[telegram-inbox-ingestion]] / [[tracker-to-knowledge]] / [[signup-and-onboarding-wizard]] — другие источники RawEvent.
- [[theme-clustering]] — отдельный сладж графа, потребляет canonical-блоки этого процесса.
- [[card-rollup-v2]] — потребляет `IdeaBlockLink` + сущности (через `Specialist34ProjectCustomerWorker`).
- [[reframing-cycle]] — ночная гигиена слабых связей и `dynamicScore` блоков, созданных этим процессом.
- [[specialist-3-5-insights]], [[specialist-3-6-ideas]], [[specialist-gamma-1-skill-clone]] — потребляют jobs из `core.specialist-routing`, который наполняется на Шаге 8.

## 8. Расхождения «задумано vs реализовано»

**Заложено в ТЗ, реализовано:**
- ✅ pipeline `RawEvent → IdeaBlock → Entity → IdeaBlockLink` целиком работает в проде (Фазы 1–3 ТЗ knowledge-core).
- ✅ Дедупликация Entity через KNN + LLM-арбитр — Фаза 4 ТЗ.

**Реализовано иначе, чем намекает ТЗ:**
- **`EntityResolverCron` использует hard-coded `'*/5 * * * *'`** в декораторе `@Cron`, а ENV `ENTITY_RESOLVER_CRON` читается только «для логов как ожидаемая частота» (`entity-resolver.cron.ts:17`). Если нужно изменить частоту — придётся переписать на `SchedulerRegistry` или пересобрать сервис.
- **Сущности персистятся вне транзакции `IdeaBlock`** (`block-ingest.worker.ts:788`) — сознательное архитектурное отступление: `$executeRawUnsafe` для embedding не уживается с interactive-tx без увеличения statement_timeout. Если linkEntity упадёт — блок останется без mention'ов, восстановится при следующем upsert.

**Реализовано, но в ТЗ не описано:**
- **`signalTypeHint` в payload** — `TrackerAdapter` проставляет явный `signalType` в payload, `BlockIngestWorker` либо переопределяет signalType первого LLM-блока, либо создаёт синтетический блок (`block-ingest.worker.ts:622,646,670`).
- **Fallback Decision-create для блоков `signalType='decision'`**, по которым LLM не вернул отдельную запись в `decisions[]` (`block-ingest.worker.ts:482`). Идемпотентно через `sourceIdeaBlockId`.
- **`role_relevant` + `roleHint` + `EntityResolutionService.resolveRoleByHint`** (`block-ingest.worker.ts:236`) — Фаза 0b расширение для клона должности γ-1.
- **`AxisClassifier.classify`** запускается параллельно с router-dispatch'ем (`block-ingest.worker.ts:567`) — пишет axis-метки `(tenantId, blockId, axis, label)` с unique-constraint'ом.
- **`KC-Temporal W1.4` propertySpans** для UI-плеера (`block-ingest.worker.ts:914`) — таймкоды mention'ов сущностей.
- **`KC-Temporal W1.1` validFrom** в `IdeaBlock` ставится из `event.occurredAt`, только если `BITEMPORAL_ENABLED=true` (`block-ingest.worker.ts:728`).
- **`FactSupersedeService` после canonical** — запускается, только если `BITEMPORAL_ENABLED && BITEMPORAL_SUPERSEDE_ENABLED` (`block-distill.worker.ts:181`).
- **`EventEmitter 'idea_block.updated'`** в block-distill и entity-resolver — для `ProjectionRebuilderService` (KC-Temporal W3.5).
- **`SPECIALISTS_COMBINED_ENABLED` flag** (ТЗ 2026-05-25 llm-architecture §3) — параллельный Variant Б+ через `core.specialists-combined`, один LLM-вызов на все 8 типов сущностей встречи. На 2026-05-29 не описан в module-map.

**Гейты, которые задерживают доходимость до конечного результата:**
- `LINKER_MIN_BLOCKS=50` — пока в Org меньше 50 canonical блоков, `block-linker` skip'ает с логом «канонических блоков меньше порога — skip» (`block-linker.worker.ts:113`). Связей не будет до накопления.
- `EntityResolverCronService.TICK_LIMIT=50` — за один тик скан-енкью обходит не более 50 пар по всем Org'ам.
- `WorkerOrgGate` — owner Org через админку может выключить `block-ingest`, `block-distill`, `block-linker`, `entity-resolver` целиком.

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-29 | Карточка создана | этот документ |
| 2026-05-25 | KC-Temporal W1.4 propertySpans + W3.5 emit `idea_block.updated` | [[02_architecture/knowledge-core]] |
| 2026-05-25 | SBA α-3 router + axis-classifier | [[02_architecture/knowledge-core]] §SBA α-3 |
| 2026-05-22 | SBA α-2 расширение SignalType до 19 значений | [[02_architecture/knowledge-core]] §SBA α-2 |
| 2026-05-21 | Группа Б (Process/Regulation/Policy/Tool/Metric/Decision) через GraphService | plans/tz/2026-05-10-knowledge-core-tz.md |
| 2026-05-10 | Pipeline `RawEvent → IdeaBlock → Entity` запущен (Фаза 1-2) | plans/tz/2026-05-10-knowledge-core-tz.md |
