# Архитектура «Второго мозга компании» — черновик

> Зафиксированные архитектурные мысли по возможной реализации «второго мозга компании» в Z.
> Источник: голосовая фиксация 2026-05-20, после многоэтапного исследования рынка ([second-brain/06_marketing/second-brain-approach-research.md](../../second-brain/06_marketing/second-brain-approach-research.md)).
> Статус: **черновик-набросок, не ТЗ**. До формализации в ТЗ — обсуждение, ревью каждого слоя, валидация компонентов на нагрузку и стоимость.

---

## Базовый принцип

Архитектура **event-sourced**: event log как единый источник истины, все хранилища — это проекции этого лога. Это даёт правильную развязку слоёв и возможность перепроцессировать данные при изменении онтологии или LLM.

Дальше по слоям сверху вниз.

---

## 1. Ingestion (приём данных из источников)

**Коннекторы к корпоративным системам клиента:**

- **Почта:** Exchange, Mail.ru Corporate, Yandex Mail Business.
- **Мессенджеры:** Slack, MS Teams, корпоративный Telegram, VK Teams/MAX.
- **Workspace:** Notion, Confluence, Yandex Wiki, МойОфис.
- **CRM:** Bitrix24, amoCRM.
- **Таск-трекеры:** Jira, YouTrack, Yandex Tracker, Kaiten.
- **Файлохранилища:** Google Drive, Yandex 360, MS SharePoint.
- **Записи встреч:** Zoom, Контур.Толк, Яндекс Телемост.
- **1С:** документооборот и кадры.
- **Git:** GitHub, GitLab, Gitea.
- **Корпоративные БД через CDC:** Debezium.

**Режимы работы коннектора:**
- Bulk import (initial).
- Incremental updates через webhooks или polling.

**Pipeline:** валидация → дедупликация на уровне id источника → событие `SourceIngested` в Event Log.

**Технологии:**
- Python workers + Pydantic для валидации.
- Airbyte как база для коннекторов, где он покрывает источник.
- RabbitMQ как промежуточный буфер для коннекторов без надёжной гарантии delivery.

---

## 2. Event Log (Source of Truth)

Центральный append-only лог. Все изменения в системе — события.

**Типы событий:**
`SourceIngested`, `RawStored`, `EntityExtracted`, `RelationExtracted`, `DecisionExtracted`, `EventOccurred`, `OntologyEvolved`, `ProjectionUpdated`, `QueryExecuted`, `PermissionChanged` и так далее.

**Технологии:**
- **Apache Kafka** или **Redpanda** (более простая в эксплуатации, Kafka-совместимая).
- **Schema Registry** (Confluent Schema Registry или Karapace) для типизации событий через Avro/Protobuf.
- Партиционирование по `tenant_id`, чтобы один клиент не мешал другому.

**Retention:**
- Бесконечный для бизнес-событий.
- 90 дней для технических.

**Инвариант:** Event Log — единственное место, которое нельзя терять. Все остальные хранилища пересобираются из него.

---

## 3. Raw Object Storage

Хранилище сырых файлов: расшифровок встреч, оригиналов писем, документов, экспортов из CRM. Каждый сырой объект получает UUID, сохраняется как файл с метаданными.

**Технология:**
- **MinIO** для self-hosted (S3-совместимый, open-source).
- Либо **Object Storage** в Yandex Cloud / VK Cloud.

**Характеристики:**
- Шифрование at rest (KMS).
- Versioning.
- Lifecycle policies для архивирования старых объектов в холодное хранилище.

---

## 4. Extraction Pipeline

Многостадийный LLM-обработчик. Каждая стадия — отдельный worker, читающий события определённого типа из Event Log и пишущий новые события обратно.

### Стадия 1: Preprocessing
- Очистка, чанкирование длинных документов, language detection.
- Конвертация форматов: PDF/DOCX → текст через `pypdf` и `python-docx`.
- Аудио → текст через локальный Whisper или GigaChat ASR.

### Стадия 2: Entity Extraction
Извлечение типизированных сущностей: **Person, Project, Decision, Document, Event, Technology, Organization, Customer, Vendor, Product**.

Использую **DSPy** для управляемой структурированной экстракции — он автоматически оптимизирует промпты под gold-стандарт примеры.

### Стадия 3: Relation Extraction
Извлечение типизированных отношений: `decided_by`, `participated_in`, `depends_on`, `blocked_by`, `references`, `supersedes`, `mentions`, `owns`.

Это сложнее, чем entity extraction — нужен контекст более широкого окна.

### Стадия 4: Event Extraction
Особый тип сущности с временной меткой и участниками: встречи, инциденты, релизы, изменения статусов сделок.

### Стадия 5: Decision Extraction
Отдельная стадия для решений с расширенной схемой:
- Что решили.
- Кто.
- На основании чего.
- Какие альтернативы рассматривались.
- Последствия.

Это самый ценный extracted тип для бизнес-кейсов.

### Стадия 6: Quality validation
LLM-as-judge проверяет извлечённое:
- Соответствует ли онтологии.
- Есть ли provenance.
- Нет ли противоречий с существующим состоянием графа.

**Provenance triple:** каждый извлечённый факт несёт ID источника + позиция (chunk index, character range) + timestamp + extraction model version.

---

## 5. LLM Gateway (Multi-tier Routing)

Слой абстракции между всем приложением и LLM-провайдерами.

**Технология:** **LiteLLM** как ядро, кастомные роутеры поверх.

**Конфигурация по типу задачи:**

### Tier 0 — локальные модели на GPU клиента
- Эмбеддинги (BGE-M3 multilingual или intfloat/multilingual-e5-large).
- Классификация, простой NER.
- Запускается через vLLM или TGI.
- **Никогда не уходит из контура клиента.**

### Tier 1 — российские модели
- **GigaChat Pro**, **YandexGPT 5 Pro** для массовой extraction.
- Через их официальный API с self-hosted прокси.

### Tier 2 — западные модели
- **Claude Sonnet 4.6**, **GPT-5** для сложного reasoning, synthesis narratives, decision archaeology.
- Доступ через OpenRouter или прокси в дружественных юрисдикциях.

### Anonymization layer перед Tier 2
- Имена/компании/контакты заменяются на токены через NER + словарь.
- Ответ де-анонимизируется обратно.
- **Обязательно для 152-ФЗ** (закон о персональных данных).

### Прочее
- Fallback chains.
- Rate limiting per tenant.
- Cost tracking по каждому запросу с разбивкой по моделям.
- Кэширование на уровне промптов через Redis.

---

## 6. Storage Layer (Projections)

Все хранилища — проекции Event Log. Любое можно сжечь и пересобрать.

### (a) Knowledge Graph — центральный view
- **Технология:** **Neo4j Community Edition** (бесплатна для self-hosted, мощный Cypher) или **Memgraph** (быстрее на real-time, in-memory).
- Узлы — типизированные сущности с атрибутами в формате JSON.
- Рёбра — типизированные отношения с weights, `valid_from`/`valid_to`, `source_event_id`.
- Индексы по type, по name, по дате.
- **Graph algorithms:** PageRank для важности сущностей, community detection для кластеров отделов/проектов.

### (b) Vector Store
- **Qdrant** (российский open-source, активно используется в РФ).
- Эмбеддинги контента через локальные модели Tier 0.
- **Hybrid search** — vector + BM25 через Qdrant native, или через OpenSearch рядом.
- Каждый эмбеддинг привязан ID к узлу в графе.

### (c) Temporal Layer
- Bi-temporal реализация поверх Neo4j через свойства на рёбрах (`valid_from`, `valid_to`, `recorded_at`).
- Для сложных temporal queries — отдельная проекция через **Graphiti** (open-source, поверх Neo4j).
- Поддержка «as of» queries: «состояние графа на 15 марта».

### (d) Episodic Store
- **TimescaleDB** поверх PostgreSQL.
- Hypertables для событий с участниками, типом, длительностью.
- Быстрые time-range queries: «все встречи проекта Х за квартал», «все инциденты, в которых участвовала Маша».

### (e) Document Store
- PostgreSQL с JSONB для гибких атрибутов.
- Здесь живёт всё, что не граф и не вектор: исходные сообщения, метаданные источников, пользовательские настройки.

### (f) Audit Log
- Отдельный append-only store запросов и доступов.
- **ClickHouse** для быстрой аналитики или TimescaleDB.

---

## 7. Ontology & Entity Resolution

### Онтология компании — версионируемая схема

**Базовый набор типов сущностей:**
Person, Process, Decision, Project, Document, Event, Technology, Customer, Vendor, Product, Goal, Risk, Metric.

**Типов отношений:** около 40 базовых.

**Хранение:** YAML в Git-репозитории, версионируется, изменения логируются как события `OntologyEvolved` в Event Log.

### Эволюция онтологии

Фоновый процесс:
1. Анализирует extracted entities.
2. Находит частые паттерны, не покрытые онтологией.
3. Предлагает новые типы.
4. Человек подтверждает.
5. Онтология версионируется, проекции пересобираются из Event Log с новой схемой.

### Entity Resolution — гибрид трёх подходов

1. **LLM** (семантическое сопоставление контекста, например Tier 1 модель).
2. **Fuzzy matching** — Levenshtein, Jaro-Winkler, Soundex для русского.
3. **Доменные правила** — одна корпоративная почта = один человек; один ИНН = одна организация.

Канонические формы и алиасы хранятся в графе как `aliases: []` атрибут узла.

### Расширенная идентификация людей

- **Face recognition** по аватарам и фото в источниках (если есть).
- **Голосовая идентификация** в расшифровках встреч (через `pyannote-audio`).

---

## 8. Memory Consolidation (Heartbeat)

Фоновые процессы по расписанию. Оркестрируются через **Prefect** или **Temporal** (workflow engine).

### Daily
- Дедупликация фактов в графе.
- Поиск противоречий через LLM (Tier 2 на семплах, Tier 1 на массе).
- Пересборка важности узлов (PageRank).
- Update edge weights based on frequency.

### Weekly
- **Компрессия эпизодов в семантические выводы** — LLM читает кластер эпизодов и пишет в граф derived sentence:
  > «На основании последних 30 встреч проекта X — основные блокеры это Y и Z.»

### Monthly
- **Ontology suggestions** — LLM анализирует accumulated extraction, предлагает новые типы сущностей и отношений.

---

## 9. Permissions (ABAC — Attribute-Based Access Control)

Каждый факт (узел или ребро в графе) имеет атрибуты доступа:
- `sensitivity_level`: public / internal / confidential / secret.
- `audience`: список ролей и/или конкретных людей.
- `owner`: создатель факта.

### Technical

- **Open Policy Agent (OPA)** для policy-as-code.
- Политики на **Rego**, версионируются в Git.
- Каждый запрос проходит через OPA, который решает, какие узлы и рёбра возвращать.
- Это **post-query filtering** — медленнее, чем pre-query, но единственный надёжный способ для графов.

### Tenant isolation

- На уровне Event Log partitioning и database schemas в PostgreSQL/Neo4j (logical isolation).
- **Physical separation** для крупных клиентов с особыми требованиями.

### Personal subgraphs

Формируются автоматически. Для каждого человека — view «что этот человек создал/видел/принимал». Используется при создании клона.

### Audit trail

Все запросы — в отдельную таблицу ClickHouse: who, what query, what returned, when. Доступ к audit log есть у владельца данных и у admin клиента.

---

## 10. Query Layer (Graph-RAG+)

Универсальный слой запросов. Принимает natural language вопрос → возвращает structured response с provenance.

### Query planner
LLM (Tier 2 для сложных, Tier 1 для типовых) переводит NL-запрос в execution plan, состоящий из примитивных операций:
- `cypher_query`
- `vector_search`
- `temporal_walk`
- `full_text_search`
- `multi_hop_traverse`

### Hybrid retrieval стратегии

- **Graph-first:** вытащить узлы по типу/атрибутам → расширить через relations → отфильтровать.
- **Vector-first:** семантический поиск → grounding через граф (привязка к сущностям) → expand.
- **Temporal walk:** реконструировать narrative по времени, проходя по событиям и решениям.
- **Multi-hop reasoning:** цепочки relations глубиной 2-4 (A → B → C → ?).

### Reranking
- Cross-encoder (например, `BAAI/bge-reranker-v2-m3`) для precision на топ-100 результатах.
- Потом LLM-as-judge на топ-20.

### Response synthesis
Tier 2 LLM собирает финальный ответ с inline citations к источникам (provenance).

---

## 11. Agent Layer

Универсальный agent substrate + специализированные агенты.

### Базовый agent class — инструменты
- `query_graph(cypher)`
- `query_vector(text, filter)`
- `get_temporal(entity, time_range)`
- `get_episodic(time_range, participants)`
- `generate(prompt, context)`

### Память агента
- **Working** (in-context).
- **Session** (per-conversation).
- **Long-term** (persists in own subgraph).

### Специализированные агенты

#### Employee Clone — самый ценный
Конструктор:
1. **Stylistic profile** — LLM анализирует переписки человека, извлекает tone, lexicon, typical phrasings, common topics, decision-making patterns.
2. **Personal subgraph** — все узлы/рёбра, где человек — actor или participant.
3. **Voice (опционально)** — если есть достаточно аудио — fine-tuned TTS через ElevenLabs или локальный аналог.
4. **System prompt:**
   > «Ты — цифровая модель [Имя]. Твой стиль: [profile]. Ты отвечаешь на вопросы коллег от её имени, на основании знаний из твоего subgraph. Если не знаешь — говоришь честно.»

Когда коллега спрашивает клона — query идёт через personal subgraph + stylistic profile генератора. **Provenance остаётся** (можно посмотреть, из каких источников клон сделал вывод).

#### Process Narrator
Восстанавливает narrative проекта/процесса через temporal walk + synthesis. Используется для:
- Onboarding.
- Аудита.
- Quarterly reviews.

#### Decision Archaeologist
«Как мы пришли к решению X». Восстанавливает chain через decision links, отвечает с цитированием всех источников.

#### Onboarding Agent
Для нового человека на роль — генерирует learning curriculum на основе subgraph предшественника.

#### Discovery Agent
Ищет неочевидные связи через graph algorithms:
- Два отдела решают похожие задачи независимо.
- Дублирующиеся процессы.
- Opportunity-gaps.

#### Compliance Agent
Forensic queries — «кто, когда, что делал с данными клиента X».

### Agent orchestration
- **MCP-compatible interfaces** для всех агентов (это становится стандартом).
- Tools registry с описанием возможностей.
- Agent-to-agent communication через message bus.

---

## Связь с исследованием рынка

См. [second-brain/06_marketing/second-brain-approach-research.md](../../second-brain/06_marketing/second-brain-approach-research.md) — раздел 14 (стратегические выводы).

Архитектура соответствует ключевым рекомендациям исследования:
- **Bitemporal модель фактов** (Storage Layer пункт c, через Graphiti).
- **Permission-aware retrieval как gate, не feature** (раздел 9 ABAC через OPA).
- **MCP-first** (раздел 11 Agent orchestration).
- **Distill-слой с дня 1** (Extraction Pipeline, не «складываем сырьё и потом разберёмся»).
- **Multi-tier LLM routing с anonymization** (раздел 5, обязательно для 152-ФЗ).
- **Self-host stack для РФ** (MinIO, Qdrant, Neo4j, ClickHouse — всё open-source, всё может стоять в контуре клиента).

---

## Что не зафиксировано в этом черновике (нужно добавить отдельно)

Этот документ — слой архитектуры. Сознательно вынесено за скобки:

- **Финансовая модель** — стоимость stack на одного клиента (Mem0/Graphiti LLM-token cost, инфра ClickHouse+Neo4j+Qdrant+TimescaleDB+PostgreSQL+MinIO).
- **Pricing-модель продукта** — metered vs flat per-user (см. урок из branch-8-usecases — Mem.ai застрял на flat-pricing).
- **Onboarding-флоу** — как клиент начинает использовать («запитка» Event Log из исторических данных vs incremental).
- **Сравнение Mem0 OSS + Graphiti vs кастомная реализация на этой архитектуре** — что взять как фундамент, что строить с нуля.
- **Roadmap по фазам** — что в MVP-0, что в MVP-1, что отложено.
- **Команда и компетенции** — кто это всё может построить, какие роли нужны.
- **Юридические аспекты ABAC** — кто имеет право на personal subgraph (трудовой договор, согласие сотрудника, ФЗ-152 особенности).
- **Этика employee clone** — особенно после ухода человека (см. [project_z_infra_and_ai] из memory + кейс из branch-8 про employer-owned clones).

---

## Открытые архитектурные вопросы

1. **Event Log retention vs стоимость** — «бесконечный для бизнес-событий» означает терабайты у крупного клиента через 2-3 года. Стратегия compaction/snapshotting?
2. **Pre-query vs post-query фильтрация в графе** — OPA даёт post-query, но это дорого на больших графах. Можно ли часть permissions «зашить» в Cypher (label-based)?
3. **Entity resolution в условиях множественных tenants** — алиасы одной персоны (Иван Петров в почте и Vanya в Slack) внутри одного клиента — ок; но что если два клиента ссылаются на одну и ту же внешнюю персону (общий вендор)? Делить или нет?
4. **Ontology evolution conflict resolution** — что если две предложенные эволюции конфликтуют (например, два варианта типа `Customer` с разной структурой)?
5. **Graphiti vs custom bi-temporal layer** — где граница, когда Graphiti перестаёт быть достаточным.
6. **Anonymization layer накладные** — на больших объёмах токенизация имён через NER + словарь стоит дорого. Альтернативы (например, FPE — Format Preserving Encryption)?
7. **Employee Clone «после ухода»** — сколько хранить personal subgraph? Что показывать спрашивающим, если согласие отозвано?

---

## Следующие шаги (если решим идти)

1. **Декомпозиция на фазы** — какие слои строятся в первом MVP. Кандидат на MVP-0: слои 1, 2, 3, 4 (только preprocessing + entity extraction), 5 (только Tier 0 и Tier 1), 6 (только a, b, e), 10 (только graph-first retrieval).
2. **PoC одного слоя** — например, Extraction Pipeline на 1-2 источниках (расшифровки встреч Z + email-канал), чтобы оценить cost/quality перед коммитом к полной архитектуре.
3. **Cost-modeling на 1 встречу 60 мин** — сколько LLM-токенов уходит через все 6 стадий extraction.
4. **Сравнительный анализ Mem0 OSS + Graphiti vs. эта архитектура** — что взять готовое, что строить с нуля. Возможно, кастомная архитектура — оверкилл для MVP, и стоит начать с Mem0 OSS + Graphiti (рекомендация из branch-6).
5. **ТЗ на MVP-0** — после фазирования и PoC.

---

_Зафиксировано: 2026-05-20. Источник: голосовая фиксация архитектурного видения._
