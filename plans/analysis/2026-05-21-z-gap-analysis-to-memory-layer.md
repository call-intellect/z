---
status: draft
created: 2026-05-21
owner: Сергей
type: analysis
tags: [архитектура, gap-анализ, миграция, memory-layer, knowledge-core]
related: [2026-05-21-ontology-process-regulation.md]
---

# Gap-анализ: Z → 10-слойная memory-layer архитектура

Спутник к [2026-05-21-ontology-process-regulation.md](2026-05-21-ontology-process-regulation.md) (там — целевая архитектура и онтология). Здесь — что **уже есть в текущем коде Z** и что нужно сделать, чтобы прийти к целевой архитектуре.

**Глубина анализа:** средняя — пройдено `second-brain/02_architecture/*`, Prisma-схема (1775 строк, ~60 моделей), структура `knowledge-core` модуля (3 controller'а + 17 services + 14 workers/cron'ов).

**Ключевой вывод (TL;DR):** Z **уже на 40–50%** соответствует целевой архитектуре. Самые сильные стороны — слой ingest, слой extraction, provenance, LLM-router, event-driven асинхронность, retention/152-ФЗ. Самые большие пробелы — полноценный графовый слой (нет Apache AGE / Neo4j), bi-temporal layer, ABAC на уровне фактов, query planner LLM, агентный слой (клоны, narrator-ы, CuratorAgent), MCP / Telegram bot.

---

## 1. Сводная карта по 10 слоям

| # | Слой целевой архитектуры | Что есть в Z | Готовность | Главный gap |
|---|---|---|---|---|
| 1 | **Ingestion** | `Source`, `RawEvent`, `IngestService`, адаптеры meeting/telegram/phone/email/web-form, BullMQ `core.raw-events`, idempotencyKey sha256, inline / S3 fallback | 🟢 **75%** | Нет адаптеров для CRM (Bitrix24, amoCRM), task-tracker (Jira/YouTrack/Yandex Tracker), wiki (Notion/Yandex Wiki), Git, файлохранилищ, 1С |
| 2 | **Extraction** | `BlockExtractionService` (LLM с JSON Schema strict), 14 типов `SignalType`, `BlockExtraction.prompt` | 🟢 **60%** | Нет явного извлечения 4 типов (entity/relation/event/decision+reasoning) как отдельных задач. Decision слит в `signalType=decision`. Нет DSPy/LangExtract — самописный пайплайн |
| 3 | **Storage (hybrid 4-в-1)** | pgvector (HNSW cosine, 1536-dim), Postgres relations, ts_vector BM25 | 🟡 **35%** | **Нет графового слоя** (только узлы + связи в Postgres, графовых обходов через Cypher нет). **Нет bi-temporal layer**. **Нет TimescaleDB / эпизодического хранилища как отдельной системы** |
| 4 | **Entity resolution** | `entity-resolver.worker`+`cron`, `EntityMerge` (KNN cosine 0.88 + LLM-arbiter с metadata + recentMentions[]), findOrCreate Entity | 🟢 **65%** | Нет fuzzy matching (Levenshtein/Jaro-Winkler) — только cosine+LLM. Нет доменных правил («одна почта = один человек») |
| 5 | **Ontology management** | Жёстко зашитые enum'ы: 7 EntityType, 14 SignalType, 7 IdeaBlockLinkType, 6 EntityLinkType, 12 ThemeBranch | 🔴 **15%** | **Нет версионирования**. **Нет агента, предлагающего новые типы**. **Нет типов `Process` / `Regulation` / `Role` / `Decision`-как-сущности / `Document` / `Event`-как-сущности**. **Нет различия атомарные/процессные/нормативные** |
| 6 | **Memory consolidation** | `block-distill.worker`, `reframing.cron` (нощной), `theme-clusterer.cron`, `entity-graph-builder.cron`, `dynamicScore` decay | 🟢 **70%** | Нет явного **conflict detection** (поиск противоречий «март: X / апрель: not X»). Компрессия в семантические выводы — частично через Theme |
| 7 | **Permissions** | RBAC (Casbin-совместимый), `TenantGuard`, `policies/policy.csv`, `SuperAdminAccessLog` | 🟡 **40%** | **Нет ABAC на уровне фактов** — записано как architectural decision «все member'ы Org видят весь knowledge-core». **Нет audit trail на каждый knowledge-запрос** (есть только для super_admin) |
| 8 | **Query layer** | `POST /knowledge/search` (hybrid cosine+BM25), `GET /knowledge/graph/neighbors` (BFS на SQL), `GET /knowledge/blocks/:id/links`, `GET /knowledge/themes` | 🟡 **35%** | **Нет query planner LLM** (запросы фиксированы по endpoint'ам). **Нет Cypher / графовых обходов** через AGE. **Нет temporal walk**. **Нет narrative-сборки** ответа из нескольких источников |
| 9 | **Agent layer** | `card-rollup-v2.worker` (5 промптов), `strategic-alignment.worker` (Goals), `summary-extractor-v2`, `meeting-analyze-v2.worker`, `director-dashboard.service` | 🟡 **30%** | **Нет клонов сотрудников** (нет per-user subgraph, нет стилистических профилей). **Нет CuratorAgent**. **Нет Process narrator / Decision archaeologist / Onboarding agent / Opportunity scout / RegulationAgent / RoleProfileAgent** |
| 10 | **Interfaces** | REST API + Swagger, Knowledge search UI, Z-Admin + Org-Admin страницы, Director dashboard, Goals UI | 🟡 **35%** | **Нет MCP-сервера**. **Нет Telegram-бота** (как канала доставки — адаптер для ингеста есть). **Нет графовой визуализации**. **Нет process timeline UI**. **Нет ленты вопросов** |

**Легенда готовности:**
- 🟢 60%+ — большая часть есть, нужны доработки
- 🟡 30–60% — фундамент есть, надо много достраивать
- 🔴 <30% — почти с нуля

**Средневзвешенная готовность ≈ 42%.**

---

## 2. Архитектурные принципы поверх — где мы стоим

| Принцип | Статус в Z | Комментарий |
|---|---|---|
| **Two-tier extraction** (сырое отдельно от извлечённого) | ✅ **есть** | `RawEvent` иммутабельный (S3 fallback >10 MiB), `IdeaBlock` регенерируемый. **Сильная сторона Z.** |
| **Memory is state, not service** (всё из одного event log) | 🟡 **частично** | Event log есть (`core.raw-events`), но обновляются только Postgres-таблицы. После добавления графа + temporal + episodic надо проверить, что все четыре хранилища обновляются из одного потока |
| **Provenance everywhere** | ✅ **есть** | `IdeaBlockEvidence` хранит `rawEventId, sourceTimestamp, quote, startMs, endMs`. **Очень сильная сторона Z** |
| **Eventual consistency** | ✅ **есть** | BullMQ + дебаунсы + асинхронные воркеры. **Сильная сторона Z** |

3 принципа из 4 уже работают — это редкость для систем в зачаточной стадии, и это огромная фора.

---

## 3. Детально по слоям — что есть, что меняем, что добавляем

### Слой 1. Ingestion — 🟢 75%

**Что есть:**
- `backend/src/modules/ingest/` — `IngestService.ingest({tenantId, sourceId, ...})`.
- `Source` (типы: meeting, chat, phone_call, bot, email, web_form, external), `RawEvent` (иммутабельный, idempotencyKey sha256).
- Адаптеры: `meeting.adapter.ts`, `telegram/*`, `phone-call/mango.*`, `email/email-fetch.*`, `web-form/dump.*`.
- Очередь: `core.raw-events` (BullMQ).
- Хранение payload: inline до 10 MiB, иначе S3 (`raw-events/<tenantId>/<idempotencyKey>.json`).
- Шифрование секретов источников: `CryptoService` (AES-256-GCM на `CRYPTO_MASTER_KEY`).
- Авторизация для внешних: `IngestTokenGuard` (Bearer + timingSafeEqual) или `ApiKey.scope='ingest'`.

**Что добавляем (новые адаптеры):**
- CRM: **Bitrix24**, **amoCRM** (webhooks + bulk import).
- Task-tracker: **Jira**, **YouTrack**, **Yandex Tracker** (webhooks + REST polling).
- Workspace/wiki: **Notion**, **Confluence**, **Yandex Wiki** (REST + webhooks где есть).
- Git: **GitLab**, **Yandex Cloud Git**, **GitHub** (push events + PR/issue).
- Файлы: **Yandex 360**, **Google Drive**, **MS SharePoint**.
- 1С: REST интеграция, batch sync.
- MS Teams: webhooks + bulk.
- Slack: events API.

**Что НЕ меняем:** ядро `IngestService`, `Source`, `RawEvent`, провенанс, очередь.

**Решение по технологиям:** буфер на BullMQ оставляем (Kafka / RabbitMQ — на потом, когда упрёмся в throughput).

---

### Слой 2. Extraction — 🟢 60%

**Что есть:**
- `BlockExtractionService` — LLM-вызов через `LlmRouterService` (`taskType='block-ingest'`, JSON Schema strict).
- Промпт: `prompts/block-ingest.prompt.ts` — извлекает `IdeaBlock` с полями `name, criticalQuestion, trustedAnswer, signalType, entities[], confidence`.
- 14 `SignalType`: `fact, pain, feature_request, objection, churn_risk, idea, risk, commitment, decision, mood, drift, competitor_move, metric_change, knowledge_gap`.
- `SegmentBuilder` — скользящие окна ≤2000 токенов.
- `KnowledgeEmbedding` — батч-эмбеддинги `text-embedding-3-small` (1536-dim).
- Идемпотентность: `block-ingest.worker` с `jobId='raw_<rawEventId>'`.

**Что меняем:**
- **Разделить на 4 явных задачи extraction**, как в целевой архитектуре:
  1. `entity-extraction` — сущности (Person, Process, Project, Document, Decision, Tool, ...).
  2. `relation-extraction` — типизированные отношения (initiated, decided, depends_on, blocked_by, supersedes, references, ...).
  3. `event-extraction` — события с timestamp.
  4. `decision-extraction` — решения + обоснования (это самое ценное).
- `IdeaBlock` остаётся как **единица семантического содержания**, но `Entity`-извлечение становится first-class задачей, а не side-effect.

**Что НЕ меняем:** JSON Schema strict, LLM-router, идемпотентность, провенанс через `IdeaBlockEvidence`.

**Опционально:** интеграция DSPy / LangExtract — отдельная задача, не блокер.

---

### Слой 3. Storage — 🟡 35% (самый большой gap)

**Что есть:**
- **Vector store:** ✅ pgvector с HNSW индексами (cosine) на `IdeaBlock.embedding`, `Entity.embedding`, `Theme.embedding`.
- **Реляционка:** ✅ Postgres + Prisma, ER-связи между `IdeaBlock` / `Entity` / `Theme` / `Card`.
- **BM25:** ✅ generated column `IdeaBlock.search_tsv` + GIN.

**Что добавляем:**
- **Knowledge graph через Apache AGE.** Решение зафиксировано в основном документе (см. раздел 7 «Решённые вопросы»). AGE — расширение PostgreSQL → нет второго кластера, transactional consistency между фактами и графом.
  - Узлы: `IdeaBlock`, `Entity` (+ новые типы — раздел 4 этого доку), `Inquiry`.
  - Рёбра: `IdeaBlockLink`, `EntityLink` (типы уже определены — оставляем) + новые типы для процессов/регламентов.
  - Cypher-запросы поверх AGE.
- **Bi-temporal layer.** Добавить `valid_from`, `valid_to` к `IdeaBlock` и `Entity` (и новым типам). Сейчас есть только `createdAt`/`updatedAt`. Использовать паттерн Graphiti или своя реализация.
- **Episodic store (TimescaleDB).** `RawEvent` уже time-ordered, но нет специализированных гипер-таблиц для timeseries. Решение: TimescaleDB hypertable для `RawEvent`, для `AiUsageLog`, для нового `Inquiry`-lifecycle лога.

**Что НЕ меняем:** pgvector + HNSW (работает отлично), embedding-провайдер.

**Альтернатива:** не лезть в TimescaleDB на первом шаге — Postgres с partitioning по месяцу справится. Решить позже.

---

### Слой 4. Entity resolution — 🟢 65%

**Что есть:**
- `entity-resolver.worker` (consumer `core.entity-resolver`, concurrency=1).
- `entity-resolver.cron` (каждые 5 минут — ищет пары и enqueue'ит, лимит 50 пар/тик).
- `EntityMerge.findCandidates` — KNN cosine top-5 entities того же type, > `ENTITY_MERGE_THRESHOLD=0.88`.
- `EntityMerge.judgeMerge` — LLM `entity-merge-arbiter` с metadata + recentMentions[].
- При merge: перенос `IdeaBlockEntity` на canonical, `Entity.mergedIntoId` указывает на canonical, skip P2002.

**Что добавляем:**
- **Fuzzy matching** (Levenshtein, Jaro-Winkler) как дополнительный сигнал перед LLM — поднимает recall и снижает LLM-калькуляцию.
- **Доменные правила** в `EntityResolutionService`:
  - Person: одна корпоративная почта = один человек (детерминированно).
  - Person: совпадающий phone normalized = один человек.
  - Document: совпадающий URL = один документ.
  - Project: совпадающий external_id из task-tracker = один проект.
- Эти правила запускаются ПЕРЕД LLM-arbiter и могут возвращать verdict без LLM.

**Что НЕ меняем:** общую структуру worker + cron, метаданные Entity.

---

### Слой 5. Ontology management — 🔴 15% (самый большой архитектурный gap)

**Что есть:**
- Жёстко зашитые enum'ы в Prisma-схеме (`EntityType`, `SignalType`, `IdeaBlockLinkType`, `EntityLinkType`, `ThemeBranch`). Меняются миграцией БД.
- Никакого версионирования онтологии.
- Никакого механизма «LLM нашёл новый тип, человек подтверждает».

**Что добавляем:**
- **Динамическая онтология.** Все типы Entity/Link/Signal — НЕ enum'ы, а строки + отдельная таблица `OntologyType`:
  ```
  OntologyType {
    id, tenantId?, category (entity_type | link_type | signal_type | role_type | process_type | ...),
    name, displayName, description, version Int @default(1),
    status (draft | active | deprecated | merged_into),
    mergedIntoId? → OntologyType,
    properties Json?,
    createdBy (system | user | curator_agent),
    createdAt, updatedAt
  }
  ```
- `tenantId=null` для глобальных дефолтов, `tenantId=...` для override на Org (как `LlmTaskRoute`).
- **`CuratorAgent`** (он же делает ленту вопросов — см. основной документ, раздел 5) предлагает новые типы через `Inquiry` режима `ontology_expansion`.
- **Версионирование.** Изменения типов через `version++` + связь со старой версией. При изменении схемы конкретной сущности — старые узлы остаются на старой версии, новые на новой, отдельный backfill-агент мигрирует.

**Что добавляем в саму онтологию (новые типы):**

| Тип | Класс | Назначение |
|---|---|---|
| `Process` | процессный | Типизированная последовательность шагов |
| `Regulation` | нормативный | Declared-форма процесса/роли |
| `Role` | нормативный | Декларация роли (вакансия, должностная) |
| `Decision` | атомарный | Уже есть как `signalType=decision`, но стоит сделать отдельным типом Entity |
| `Document` | атомарный | Отдельный тип, не путать с `RawEvent` (RawEvent — это «приход документа в систему», Document — это сущность документа) |
| `Event` | атомарный | Событие во времени с участниками |
| `Tool` | атомарный | Инструмент/станок/программа (для производственных процессов) |
| `Inquiry` | системный | Артефакт CuratorAgent (вопрос пользователю) |

Часть из этого пересекается с текущими `SignalType` — это значит, что `SignalType` остаётся как **тэг семантики IdeaBlock**, а Entity-типы расширяются.

**Что НЕ меняем сразу:** жёсткие enum'ы можно оставить для базовых типов (миграция в строки — большая работа, окупится через 6+ месяцев). Можно начать с гибрида: для новых типов — динамика, для существующих — enum'ы.

---

### Слой 6. Memory consolidation — 🟢 70%

**Что есть:**
- `block-distill.worker` — KNN cosine top-5 + LLM-judge `block-distill` (merge | distinct).
- `reframing.cron` (раз в сутки, 3:00):
  - архивация слабых связей confidence<0.5 старше 7 дней;
  - `dynamicScore` decay (для canonical-блоков старше 90 дней);
  - LLM `reframing` — split/merge/themeShifts;
  - `reflectOnThemes` — split/merge/archive Theme'ов.
- `theme-clusterer.cron` (каждый час в :15) — KNN-greedy union-find, threshold=0.78, minSize=3.
- `entity-graph-builder.cron` (раз в час) — co-mentioned pairs, min 3.
- `dynamicScore` на `IdeaBlock` — затухает со временем без обновлений.

**Что добавляем:**
- **Conflict detection.** Новый воркер (или расширение `reframing.cron`): искать `IdeaBlock`-ы с противоположными `trustedAnswer` для одних сущностей, эмитить `Inquiry(type=conflict_resolution)`.
- **Compression of old episodes.** При merge нескольких IdeaBlock в семантическую тему — старые evidence остаются (provenance), но в UI/чате показывается только consolidated узел.

**Что НЕ меняем:** структуру workers/cron'ов, дебаунсы, идемпотентность.

---

### Слой 7. Permissions — 🟡 40%

**Что есть:**
- RBAC (Casbin-compatible): `owner | admin | manager | super_admin`.
- `policies/policy.csv` — права по ResourceType: `block, entity, theme, source, goal, person, meeting, ...`.
- `TenantGuard` — извлекает `tenantId` из `X-Org-Id` / `:orgId`.
- `SuperAdminAccessLog` — audit для super_admin доступа.
- `Org.visibilityMode: open|strict` — частичная поддержка скрытия от manager.

**Architectural decision (из knowledge-core.md):** «Все member'ы Org (включая manager:strict) получают `read` на block/entity/theme — knowledge-core это shared knowledge внутри Org, без per-user owner'а.»

**Что меняем (большое):**
- **Это решение НАДО ПЕРЕСМОТРЕТЬ для целевой архитектуры.** ABAC на уровне фактов — обязателен. Маша не должна видеть конкретику обсуждений Пети на конфиденциальной встрече.
- Новая таблица `FactAcl`:
  ```
  FactAcl {
    id, factId (IdeaBlock | Entity | Inquiry | ...), factType,
    subjectType (user | role | membership | public),
    subjectId,
    permission (read | write | delete),
    grantedBy, grantedAt, expiresAt?
  }
  ```
- На уровне query layer: каждый запрос фильтрует граф по ACL спрашивающего.
- **Audit trail на каждый knowledge-запрос** (`KnowledgeAccessLog`) — кто, что спросил, что получил. Это и compliance, и публичная история запросов (как у Viven).

**Что НЕ меняем:** RBAC engine, `TenantGuard`, политики на уровне «admin может править онтологию», `SuperAdminAccessLog`.

---

### Слой 8. Query layer — 🟡 35%

**Что есть:**
- `POST /api/v1/knowledge/search` — hybrid cosine (0.7) + BM25 (0.3), top-10.
- `GET /api/v1/knowledge/blocks/:id` — деталка + evidence + entities.
- `GET /api/v1/knowledge/blocks/:id/links` — outgoing+incoming links.
- `GET /api/v1/knowledge/entities` / `:id` / `:id/links`.
- `GET /api/v1/knowledge/graph/neighbors?nodeType=&id=&depth=1..3` — BFS на SQL, max 100 nodes.
- `GET /api/v1/knowledge/themes` / `:id`.
- `POST /api/v1/knowledge/themes/:id/save-as-card`.
- `chat-v2.service.ts` + `chat-v2-retrieval.service.ts` — в работе (на смену старого chat поверх `MeetingTranscriptChunk`).

**Что добавляем:**
- **Query planner LLM.** Один endpoint `POST /api/v1/knowledge/ask` принимает естественноязычный вопрос, LLM-планировщик решает mix:
  - Cypher-запрос к графу (через AGE).
  - Vector search.
  - Temporal walk (на сущность в момент Y).
  - BM25 search.
- **Cypher через Apache AGE.** Замена SQL recursive в `/graph/neighbors` на нативный графовый обход.
- **Temporal walk.** Запросы вида `как менялось состояние X с момента Y по момент Z`.
- **Narrative composition.** Сборка ответа из нескольких ретривов через LLM с обязательной ссылкой на provenance.

**Что НЕ меняем:** существующие endpoints (оставляем как low-level API), hybrid cosine+BM25, провенанс в ответах.

---

### Слой 9. Agent layer — 🟡 30%

**Что есть (специализированные агенты):**
- `card-rollup-v2.worker` — rollup карточки CRM (5 промптов по `Card.kind`).
- `strategic-alignment.worker` + `strategic-alignment.cron` — оценка `Goal ↔ Theme` alignment.
- `summary-extractor-v2.service` — Summary 2.0 поверх блоков.
- `meeting-analyze-v2.worker` + cron — Tasks / Chapters / Summary 2.0.
- `tasks-extractor-v2.service`, `chapters-extractor-v2.service`.
- `director-dashboard.service` (Phase 8).

**Что добавляем (новые агенты — это самый творческий пласт):**

| Агент | Что делает | Приоритет |
|---|---|---|
| **CuratorAgent** | Лента вопросов (см. основной документ, раздел 5) | P0 — первая фича после графа |
| **EmployeeClone** | Клон сотрудника (системный промпт из стилистического профиля + read-only к subgraph + эпизодическая память агента) | P1 |
| **ProcessNarrator** | Рассказывает, как развивался проект/процесс | P1 |
| **DecisionArchaeologist** | Восстанавливает логику решения с указанием источников | P1 |
| **OnboardingAgent** | Вводит нового человека в роль через subgraph предшественника | P2 |
| **OpportunityScout** | Находит свободные связи («два отдела решают похожее независимо») | P2 |
| **RegulationAgent** | Собирает черновики регламентов, сравнивает Declared vs Observed | P2 |
| **RoleProfileAgent** | Карта сотрудника: Declared vs Observed role | P2 |

**Что добавляем для инфраструктуры агентов:**
- **`StyleProfile`** — модель: per-user экстракт манеры, тона, лексики из всей переписки/транскриптов. Обновляется фоновым воркером раз в сутки. Хранится как embedding + текстовая выжимка.
- **`AgentEpisodicMemory`** — модель: что у конкретного агента спрашивали, что он отвечал. Использует episodic store слоя 3.
- **`AgentSubgraphLens`** — query layer expression «всё, к чему прикасался user X» (фильтр по графу).

**Что НЕ меняем:** существующие агенты (card-rollup, strategic-alignment) — они укладываются в новую модель как «специализированные».

---

### Слой 10. Interfaces — 🟡 35%

**Что есть:**
- REST API + Swagger (`/api/docs`).
- Web UI: ЛК встреч, Knowledge search, Z-Admin (8 страниц), Org-Admin (4 страницы), Director dashboard, Goals, Settings (sources/retention/billing).
- LiveKit React Components для встреч.
- Email-канал (через `email-fetch.cron`).
- Telegram-адаптер для ingest (читает, не пишет).

**Что добавляем:**
- **MCP-сервер** — внешние LLM-агенты (Claude / GPT / локальные) подключаются как клиенты, дёргают knowledge через стандартизованный протокол.
- **Telegram-бот как канал доставки** (не только ingest): ask the company brain, получать дайджест Inquiry.
- **Slack-bot** — аналогично, для команд на Slack.
- **Graph view** — визуализация графа для аналитиков (cytoscape.js / d3).
- **Process timeline** — для PM, показывает развитие процесса/проекта во времени.
- **Inquiry feed UI** — лента вопросов CuratorAgent (3 вида: «сейчас», «дайджест», «история»).

**Что НЕ меняем:** REST API формат, Swagger, existing pages.

---

## 4. Новые сущности онтологии — детально

Это расширение из основного документа (раздел 4.1 + 5). Здесь — конкретика по моделям.

### 4.1. Entity types (новые)

Добавить к существующим `client | person | project | product | topic | location | custom`:

```
+ process
+ regulation
+ role
+ decision      # был signalType, делаем отдельной Entity
+ document      # отдельный тип
+ event         # отдельный тип
+ tool
```

Сделать через миграцию `EntityType` enum → string (динамическая онтология) — см. слой 5. Тогда добавление типов — INSERT в `OntologyType`, не миграция БД.

### 4.2. Связи (relation types) — новые

К существующим `IdeaBlockLinkType` (develops | contradicts | causes | consequences_of | shares_topic | shares_entity | question_answered_by) и `EntityLinkType` (works_at | belongs_to | part_of | opposes | depends_on | mentions_with) добавить:

**Для процессов и регламентов:**
- `regulates` — Regulation → Process
- `participates_in` — Person → Process (с указанием Role)
- `produces` — Process → Document
- `has_step` — Process → Process (под-процесс)
- `succeeds` — Process step → Process step
- `executes_role` — Person → Role
- `described_by` — Role → RoleDescription

**Для CuratorAgent (Inquiry):**
- `inquires_about` — Inquiry → IdeaBlock/Entity
- `answered_by` — Inquiry → IdeaBlock (ответ как новый факт)
- `supersedes` — Inquiry → Inquiry (новый вопрос отменяет старый)

### 4.3. `Inquiry` модель

```
model Inquiry {
  id           String              @id @default(cuid())
  tenantId     String
  type         InquiryType         // entity_resolution | conflict_resolution | ontology_expansion |
                                   // process_draft | role_drift | provenance_gap
  status       InquiryStatus       // draft | asked | answered | dismissed | superseded
  text         String              @db.Text
  rationale    String              @db.Text   // "почему спрашиваю"
  options      Json?               // варианты ответа
  defaultOption String?
  addressing   InquiryAddressing   // open | targeted | owner
  addressedTo  String?             // userId или roleId
  impact       Decimal(4,3)        // приоритет (0..1)
  embedding    Unsupported("vector(1536)")?

  // Provenance
  triggeredByEvent  String?       // RawEvent / consolidation event
  relatedFacts      Json          // [{ factId, factType }]

  // Lifecycle
  createdBy         String         // 'curator_agent' | userId
  answerId          String?        // ID нового IdeaBlock или Entity, если есть
  answeredByUserId  String?
  answeredAt        DateTime?
  dismissedReason   String?
  supersededById    String?

  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  @@index([tenantId, status, impact])
  @@index([tenantId, type, status])
  @@index([addressedTo, status])
}
```

### 4.4. Declared vs Observed — материализация

Не два разных типа — а **два состояния одного типа** Entity, плюс агент-арбитр:

```
Process {
  declaredVersion: ProcessRegulation?    # ссылка на текущий Declared
  observedSnapshot: Json?                # последний observed snapshot
  observedUpdatedAt: DateTime?
  driftScore: Decimal(4,3)?              # diff Declared vs Observed (0..1)
}

Role {
  declaredById: String?                  # RoleDescription
  observedActivity: Json?                # агрегат активности
  driftScore: Decimal(4,3)?
}
```

Diff вычисляется агентом по запросу. Кешируется в `driftScore` + полный `Inquiry` отчёт.

---

## 5. Mapping модулей backend — что переиспользуем

### Переиспользуем полностью (без изменений):

| Модуль | Зачем |
|---|---|
| `accounts/`, `auth/`, `users/` | Аутентификация остаётся |
| `orgs/`, `rbac/` | Multi-tenancy остаётся (расширим ABAC внутри) |
| `core-queue/`, `ingest/` | Ядро ingest pipeline |
| `embeddings/`, `search/` | Существующая search-инфра |
| `audit/`, `api-keys/`, `api-access` | Audit и API-keys |
| `mail/` | Email-уведомления |
| `health/` | Health checks |
| `ai/` (LlmRouter) | LLM-маршрутизация — мощный механизм, переиспользуем как есть |
| `entitlements/` | Tier-модель |
| `retention/`, `security/` | 152-ФЗ + retention — критично, оставляем как есть |

### Расширяем (добавляем функциональность):

| Модуль | Что расширяем |
|---|---|
| `knowledge-core/` | Добавляем графовые сервисы (AGE), `CuratorAgent`, новые типы Entity, динамическая онтология |
| `ingest/adapters/` | +Bitrix24, +Jira/YouTrack/Tracker, +Notion/Wiki, +Git, +Drive, +1С |
| `rbac/` | +ABAC на уровне фактов, `FactAcl` |
| `dashboard/` | +Graph view widgets, +Inquiry feed widget |
| `sources/` | +UI для новых типов источников |
| `chat/` | Заменяем старый на `chat-v2` (уже в работе) поверх IdeaBlock |

### Переиспользуем с переименованием/рефакторингом:

| Модуль / класс | Сейчас | После |
|---|---|---|
| `card-rollup-v2.worker` | Rollup карточки CRM | Один из «specialized agents» в слое 9. Имя оставить. |
| `strategic-alignment.worker` | Goals × Themes alignment | Тоже specialized agent (продолжает работать) |
| `MeetingTranscriptChunk` | @deprecated | Удалить после `chat-v2` (Фаза 6) |
| `chat-v1` (старый) | Работает на MeetingTranscriptChunk | Удалить после `chat-v2` |
| Старый `card-rollup.worker` | Параллельно v2 | Удалить после переключения |
| Старый `tasks-extract.worker` / `chapters.worker` | Параллельно v2 | Удалить после переключения |

### Можно подумать о выкидывании:

| Модуль | Причина сомнений |
|---|---|
| `meetings/`, `participants/`, `recordings/`, `livekit/`, `room-messages/`, `transcripts` | Это специфика встреч. В memory-layer они остаются как **один из источников ingest** + бизнес-функция «AI-встречи», но если позиционирование уходит в memory layer, встречи — лишь один Source. Не выкидываем, но фокус продукта меняется. |
| `webhooks/`, `webhooks-out/`, `destinations/`, `integrations-crossmark/`, `exports/`, `public-api/`, `quotas/`, `shares/`, `templates/`, `tags/`, `tasks/`, `cards/`, `chapters/`, `highlights/` | Специфика «AI-встреч в Crossmark». Оставляем — это рабочие фичи. Просто становится «одной из вертикалей» поверх общего memory-layer. |

**Вывод:** **ничего выкидывать на старте миграции не надо.** Все 45 модулей либо переиспользуются как есть, либо расширяются, либо помечены deprecated с известным сроком замены.

---

## 6. Сильные стороны Z, которые надо сохранить любой ценой

Это то, что для нового продукта построить с нуля стоит месяцев. Z уже это имеет.

1. **Two-tier extraction** (RawEvent → IdeaBlock).
2. **Provenance everywhere** (IdeaBlockEvidence с rawEventId/quote/startMs/endMs/sourceTimestamp).
3. **LlmRouterService** — admin-editable LlmTaskRoute с фильтром по dataClass, A/B-экспериментами, fallback-цепочками, экспериментными группами в `AiUsageLog`.
4. **`LlmModelPrice`** — версионируемая прайс-карта для cost tracking.
5. **152-ФЗ + retention** — per-Org политики, personal-data deletion с idempotent eraseEntity.
6. **Eventual consistency через BullMQ** — все воркеры идемпотентны, дебаунсы через jobId.
7. **`SuperAdminAccessLog`** — audit trail для super_admin (фундамент для общего audit на knowledge-запросы).
8. **Entitlements (tier'ы)** — заготовка для коммерциализации.
9. **Goal + StrategicAlignment** — это **уже Declared vs Observed для целей** (Goal — declared, Theme — observed source, alignment-snapshot — diff). Тот же паттерн расширяем на Process и Role.
10. **AES-256-GCM (CryptoService)** — шифрование конфигов источников.

---

## 7. Roadmap миграции — гипотеза

Подразумевает **постепенный путь, без big-bang переписывания**. Каждая фаза — самостоятельная польза + не ломает текущий продукт встреч.

### Фаза α (фундамент): добавляем графовый и temporal слои

- Установить Apache AGE на Postgres.
- Создать графовое отображение поверх `IdeaBlock` + `Entity` + `IdeaBlockLink` + `EntityLink`. Двойная запись: Postgres + AGE.
- Добавить `valid_from` / `valid_to` к `IdeaBlock` и `Entity`.
- Расширить `/knowledge/graph/neighbors` на Cypher через AGE.
- **Не ломаем:** существующий код продолжает работать через Postgres-таблицы.

### Фаза β: ABAC и audit trail на knowledge-запросы

- `FactAcl` модель.
- `KnowledgeAccessLog`.
- Query layer фильтрует по ACL.
- Default policy: `all_members_read` (как сейчас) → можно постепенно ужесточать per-Org.

### Фаза γ: новые типы Entity + динамическая онтология

- `OntologyType` модель.
- Расширить extraction-промпты на новые типы: `Process`, `Regulation`, `Role`, `Decision`, `Document`, `Event`, `Tool`.
- Backfill: реклассифицировать существующие `signalType=decision` → отдельные `Entity(type=decision)`.

### Фаза δ: CuratorAgent + Inquiry

- `Inquiry` модель.
- `CuratorAgent` — основной агент (6 режимов).
- API endpoints для ленты вопросов.
- UI ленты в web + Telegram-bot канал.

### Фаза ε: новые ingest-адаптеры

- Bitrix24, amoCRM, Jira/YouTrack/Tracker, Notion, Yandex Wiki, Git, Drive.
- Каждый адаптер — отдельная подзадача, делается параллельно с другими фазами.

### Фаза ζ: специализированные агенты

- ProcessNarrator, DecisionArchaeologist, RegulationAgent, RoleProfileAgent.
- EmployeeClone (требует `StyleProfile` extraction).
- OnboardingAgent, OpportunityScout.

### Фаза η: query planner LLM + MCP

- `POST /knowledge/ask` с LLM-планировщиком.
- MCP-сервер для внешних агентов.

**Этот порядок — гипотеза.** Реальный roadmap будет уточняться после обсуждения owner-модели регламентов, сценариев запросов и приоритетов бизнеса.

---

## 8. Открытые вопросы (с учётом gap-анализа)

1. ~~**Позиционирование продукта.**~~ **Решено** (2026-05-21): Z — память компании, встречи — первая вертикаль. Синхронизация документов и UI-копирайта проведена. Источник правды — `06_marketing/positioning.md`.
2. ~~**Параллельная разработка vs миграция.**~~ **Решено** (2026-05-21): выбран вариант (а) — эволюция. Постепенное добавление слоёв по 7 фазам roadmap, без переписывания с нуля и без жёсткого pivot.
3. **Bi-temporal layer.** Делаем сами или используем Graphiti? Если Graphiti — оценить, насколько он tenant-aware (мы multi-tenant).
4. **TimescaleDB.** Реально нужно или Postgres-partitioning достаточно для эпизодического слоя на старте?
5. **ABAC default policy.** Стартуем с `all_members_read` (текущее поведение) или сразу ужесточаем (роли видят только свой scope)? Это сильно влияет на UX onboarding-а.
6. **MCP-сервер: какой стандарт?** Anthropic MCP — единственный live стандарт, но он специфичен под Claude. Делаем универсально или MCP only?

---

## 9. Следующие шаги

1. Обсудить с пользователем сводную карту (раздел 1) — корректно ли я оценил готовность.
2. Зафиксировать **позиционирование** (memory layer как главное, встречи как один из источников).
3. Ответить на 3 открытых вопроса из основного документа (границы процесса, owner регламента, сценарии запросов).
4. Уточнить roadmap (фазы α–η) — какая последовательность важнее с продуктовой точки зрения.
5. Когда roadmap утвердится — первую фазу (α: AGE + bi-temporal) выносить в `plans/tz/` отдельным ТЗ.
