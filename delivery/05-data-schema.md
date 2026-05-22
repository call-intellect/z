# 05 — Схемы данных

Этот документ описывает все хранилища системы, их структуру и связи. Машиночитаемые SQL-миграции — в `schemas/postgres.sql`. Cypher-схема графа — в `schemas/graph-schema.cypher`. Конфигурация векторных индексов — в `schemas/vector-indexes.md`.

## Принципы

1. **Atomic commits:** все связанные изменения в одной транзакции (PostgreSQL outbox для Kafka).
2. **Soft-delete как default:** удаления через `deleted_at`. Hard-delete — только compliance-flow.
3. **JSONB для гибких полей:** часто меняющиеся метаданные хранятся в JSONB с GIN-индексом.
4. **Time-series — партиционирование по дням** для крупных таблиц (raw_events, agent_actions, metrics_timeseries).
5. **Row-level security** включён на всех таблицах с `data_class`.
6. **Внешние ключи везде, где можно** — для консистентности. ON DELETE для cascade определяется явно.
7. **Имена таблиц/колонок — snake_case на английском.** Это код, не UI.
8. **UUID v7 (timestamp-prefixed)** для primary keys — даёт сортировку по времени без отдельной колонки.

---

## 1. PostgreSQL — основной OLTP

### 1.1 Системные

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";       -- pgvector
CREATE EXTENSION IF NOT EXISTS "pg_trgm";       -- триграммный поиск
CREATE EXTENSION IF NOT EXISTS "btree_gin";

CREATE TYPE confirmation_enum AS ENUM ('proposed', 'analyzed', 'confirmed', 'locked', 'archived');
CREATE TYPE data_class_enum AS ENUM ('public', 'internal', 'sensitive', 'private');
CREATE TYPE importance_enum AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE emotion_enum AS ENUM ('positive', 'neutral', 'negative', 'mixed');
CREATE TYPE signal_type_enum AS ENUM (
    'client_pain', 'feature_request', 'objection', 'churn_risk',
    'idea', 'risk', 'commitment', 'decision', 'mood',
    'drift', 'competitor_move', 'metric_change', 'knowledge_gap'
);
CREATE TYPE goal_type_enum AS ENUM ('north_star', 'quarterly', 'monthly', 'anti_goal', 'positioning');
CREATE TYPE goal_status_enum AS ENUM ('active', 'paused', 'achieved', 'abandoned');
CREATE TYPE theme_status_enum AS ENUM ('emerging', 'active', 'declining', 'archived');
CREATE TYPE risk_status_enum AS ENUM ('emerging', 'active', 'mitigated', 'realized', 'archived');
CREATE TYPE idea_status_enum AS ENUM ('proposed', 'considering', 'accepted', 'rejected', 'implemented', 'archived');
CREATE TYPE commitment_status_enum AS ENUM ('mentioned', 'acknowledged', 'mentioned_done', 'forgotten');
```

### 1.2 Идентичность и роли

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    keycloak_id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    email TEXT UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
    locale TEXT NOT NULL DEFAULT 'ru',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    name TEXT NOT NULL,
    parent_id UUID REFERENCES departments(id),
    head_user_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE TABLE user_department (
    user_id UUID REFERENCES users(id),
    department_id UUID REFERENCES departments(id),
    role_in_dept TEXT,  -- лидер / член / советник
    PRIMARY KEY (user_id, department_id)
);

-- Роли — конфигурация для OpenFGA, локальное зеркало
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    code TEXT NOT NULL UNIQUE,  -- 'cmo', 'cso', custom-X
    display_name TEXT NOT NULL,
    functional BOOLEAN NOT NULL DEFAULT TRUE,  -- если кастомная
    hierarchical_level SMALLINT,                -- 0..4
    description TEXT,
    is_preset BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE user_roles (
    user_id UUID REFERENCES users(id),
    role_id UUID REFERENCES roles(id),
    scope JSONB,  -- ограничение по department/project/team
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by UUID REFERENCES users(id),
    PRIMARY KEY (user_id, role_id)
);
```

### 1.3 Источники и сырая память

```sql
CREATE TABLE sources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    code TEXT NOT NULL,
    source_class TEXT NOT NULL,  -- chat/email/crm/...
    display_name TEXT NOT NULL,
    config JSONB NOT NULL,  -- секреты — только id записи в OpenBao
    default_data_class data_class_enum NOT NULL DEFAULT 'internal',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE raw_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    idempotency_key TEXT NOT NULL UNIQUE,
    source_id UUID NOT NULL REFERENCES sources(id),
    external_id TEXT,
    occurred_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    author_ref JSONB NOT NULL,           -- {"type":"person","user_id":"...","display_name":"..."}
    channel_ref JSONB,
    content_type TEXT NOT NULL,          -- text/audio/video/file/structured
    body_text TEXT,                      -- inline для коротких
    minio_key TEXT,                      -- ссылка на бинарь
    body_sha256 TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    data_class data_class_enum NOT NULL DEFAULT 'internal',
    visibility_tags TEXT[] DEFAULT '{}',
    parent_event_id UUID REFERENCES raw_events(id),  -- для transcription
    deleted_at TIMESTAMPTZ
) PARTITION BY RANGE (received_at);

CREATE INDEX raw_events_occurred_at ON raw_events (occurred_at DESC);
CREATE INDEX raw_events_source_id ON raw_events (source_id);
CREATE INDEX raw_events_metadata ON raw_events USING GIN (metadata);
```

Партиционирование `raw_events` по месяцам (через `pg_partman` или вручную через DDL триггеры).

### 1.4 Сигналы

```sql
CREATE TABLE signals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    raw_event_id UUID NOT NULL REFERENCES raw_events(id),
    signal_type signal_type_enum NOT NULL,
    text TEXT NOT NULL,
    confidence FLOAT NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    importance importance_enum NOT NULL DEFAULT 'medium',
    emotion emotion_enum,
    confirmation confirmation_enum NOT NULL DEFAULT 'analyzed',
    confirmation_history JSONB NOT NULL DEFAULT '[]',
    theme_id UUID REFERENCES themes(id),
    data_class data_class_enum NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX signals_theme_id ON signals (theme_id);
CREATE INDEX signals_signal_type ON signals (signal_type);
CREATE INDEX signals_created_at ON signals (created_at DESC);

CREATE TABLE signal_evidence (
    signal_id UUID REFERENCES signals(id) ON DELETE CASCADE,
    raw_event_id UUID REFERENCES raw_events(id) ON DELETE CASCADE,
    offset_start INT,
    offset_end INT,
    snippet TEXT,
    PRIMARY KEY (signal_id, raw_event_id)
);

CREATE TABLE signal_mentions (
    signal_id UUID REFERENCES signals(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,  -- person/client/project/...
    entity_id UUID NOT NULL,
    PRIMARY KEY (signal_id, entity_type, entity_id)
);

-- Эмбеддинги
CREATE TABLE signal_embeddings (
    signal_id UUID PRIMARY KEY REFERENCES signals(id) ON DELETE CASCADE,
    embedding vector(1024) NOT NULL,
    model TEXT NOT NULL,            -- 'bge-m3'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX signal_embeddings_hnsw
    ON signal_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
```

### 1.5 Темы и ветки

```sql
CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    code TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_custom BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE themes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    title TEXT NOT NULL,
    description TEXT,
    branch_id UUID NOT NULL REFERENCES branches(id),
    secondary_branches UUID[] DEFAULT '{}',
    weight FLOAT NOT NULL DEFAULT 0,
    status theme_status_enum NOT NULL DEFAULT 'emerging',
    confirmation confirmation_enum NOT NULL DEFAULT 'analyzed',
    confirmation_history JSONB NOT NULL DEFAULT '[]',
    embedding vector(1024),
    last_signal_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX themes_branch_id ON themes (branch_id);
CREATE INDEX themes_weight ON themes (weight DESC) WHERE status = 'active';
CREATE INDEX themes_embedding_hnsw
    ON themes
    USING hnsw (embedding vector_cosine_ops);

CREATE TABLE theme_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    theme_id UUID NOT NULL REFERENCES themes(id),
    snapshot JSONB NOT NULL,
    changed_by UUID REFERENCES users(id),
    change_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX theme_versions_theme_id ON theme_versions (theme_id, created_at DESC);

CREATE TABLE theme_score_components (
    theme_id UUID PRIMARY KEY REFERENCES themes(id) ON DELETE CASCADE,
    components JSONB NOT NULL,  -- {freq:..., diversity:..., ...}
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE source_weights (
    source_type TEXT PRIMARY KEY,
    weight FLOAT NOT NULL,
    description TEXT
);
```

### 1.6 Цели, идеи, риски, решения

```sql
CREATE TABLE goals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    type goal_type_enum NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    target_metrics JSONB,
    horizon_start DATE,
    horizon_end DATE,
    status goal_status_enum NOT NULL DEFAULT 'active',
    confirmation confirmation_enum NOT NULL DEFAULT 'analyzed',
    confirmation_history JSONB NOT NULL DEFAULT '[]',
    data_class data_class_enum NOT NULL DEFAULT 'internal',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ideas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    title TEXT NOT NULL,
    description TEXT,
    source_type TEXT NOT NULL,
    source_event_id UUID REFERENCES raw_events(id),
    estimated_effect TEXT,
    estimated_complexity TEXT,
    estimated_risk TEXT,
    rating FLOAT,
    status idea_status_enum NOT NULL DEFAULT 'proposed',
    related_themes UUID[] DEFAULT '{}',
    related_goals UUID[] DEFAULT '{}',
    confirmation confirmation_enum NOT NULL DEFAULT 'analyzed',
    confirmation_history JSONB NOT NULL DEFAULT '[]',
    data_class data_class_enum NOT NULL DEFAULT 'internal',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE risks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    title TEXT NOT NULL,
    description TEXT,
    risk_type TEXT,
    likelihood TEXT,
    impact TEXT,
    status risk_status_enum NOT NULL DEFAULT 'emerging',
    related_themes UUID[] DEFAULT '{}',
    related_signals UUID[] DEFAULT '{}',
    mitigation_decisions UUID[] DEFAULT '{}',
    confirmation confirmation_enum NOT NULL DEFAULT 'analyzed',
    confirmation_history JSONB NOT NULL DEFAULT '[]',
    data_class data_class_enum NOT NULL DEFAULT 'sensitive',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    title TEXT NOT NULL,
    description TEXT,
    rationale TEXT,
    alternatives_considered TEXT,
    consequences_predicted TEXT,
    consequences_actual TEXT,
    consequences_evaluated_at TIMESTAMPTZ,
    related_signals UUID[] DEFAULT '{}',
    related_themes UUID[] DEFAULT '{}',
    related_goals UUID[] DEFAULT '{}',
    related_ideas UUID[] DEFAULT '{}',
    related_risks UUID[] DEFAULT '{}',
    decided_by UUID REFERENCES users(id),
    decided_at TIMESTAMPTZ,
    confirmation confirmation_enum NOT NULL DEFAULT 'analyzed',
    confirmation_history JSONB NOT NULL DEFAULT '[]',
    data_class data_class_enum NOT NULL DEFAULT 'internal',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE commitments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    text TEXT NOT NULL,
    person_id UUID REFERENCES users(id),
    client_id UUID,
    deadline DATE,
    source_event_id UUID NOT NULL REFERENCES raw_events(id),
    status commitment_status_enum NOT NULL DEFAULT 'mentioned',
    data_class data_class_enum NOT NULL DEFAULT 'internal',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE open_questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    title TEXT NOT NULL,
    context TEXT,
    blocks_themes UUID[] DEFAULT '{}',
    blocks_decisions UUID[] DEFAULT '{}',
    priority TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    answer TEXT,
    answer_decision_id UUID REFERENCES decisions(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    answered_at TIMESTAMPTZ
);
```

### 1.7 Метрики и аналитика

```sql
CREATE TABLE metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    code TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    unit TEXT,
    source_id UUID REFERENCES sources(id),
    direction TEXT,  -- higher_better/lower_better/neutral
    description TEXT
);

CREATE TABLE metrics_timeseries (
    metric_id UUID NOT NULL REFERENCES metrics(id),
    bucket_at TIMESTAMPTZ NOT NULL,
    value FLOAT NOT NULL,
    dimensions JSONB,
    PRIMARY KEY (metric_id, bucket_at, dimensions)
) PARTITION BY RANGE (bucket_at);

CREATE TABLE metric_anomalies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    metric_id UUID REFERENCES metrics(id),
    detected_at TIMESTAMPTZ NOT NULL,
    delta FLOAT,
    direction TEXT,
    explanation TEXT,
    related_decisions UUID[]
);

CREATE TABLE alignment_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    score FLOAT NOT NULL,
    submetrics JSONB NOT NULL,
    breakdown JSONB,
    computed_at TIMESTAMPTZ NOT NULL
);
```

### 1.8 Настроение команды

```sql
CREATE TABLE mood_consents (
    user_id UUID PRIMARY KEY REFERENCES users(id),
    user_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
    user_opt_in_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

CREATE TABLE mood_active_responses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    user_id UUID NOT NULL REFERENCES users(id),
    answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    mood_score SMALLINT NOT NULL CHECK (mood_score BETWEEN 1 AND 5),
    workload_score SMALLINT CHECK (workload_score BETWEEN 1 AND 5),
    purpose_score SMALLINT CHECK (purpose_score BETWEEN 1 AND 5),
    support_score SMALLINT CHECK (support_score BETWEEN 1 AND 5),
    blocker_text TEXT,
    extra_text TEXT
);

CREATE INDEX mood_active_user_at ON mood_active_responses (user_id, answered_at DESC);

CREATE TABLE mood_aggregates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    department_id UUID REFERENCES departments(id),
    bucket_date DATE NOT NULL,
    avg_mood FLOAT,
    avg_workload FLOAT,
    avg_purpose FLOAT,
    avg_support FLOAT,
    sample_size INT NOT NULL,
    UNIQUE (department_id, bucket_date)
);
```

### 1.9 База знаний

```sql
CREATE TABLE knowledge_articles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    title TEXT NOT NULL,
    body_md TEXT NOT NULL,
    branch_id UUID REFERENCES branches(id),
    author_id UUID REFERENCES users(id),
    is_ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
    confirmation confirmation_enum NOT NULL DEFAULT 'analyzed',
    confirmation_history JSONB NOT NULL DEFAULT '[]',
    data_class data_class_enum NOT NULL DEFAULT 'internal',
    embedding vector(1024),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE article_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    article_id UUID NOT NULL REFERENCES knowledge_articles(id),
    snapshot JSONB NOT NULL,
    changed_by UUID REFERENCES users(id),
    change_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE article_mentions (
    article_id UUID REFERENCES knowledge_articles(id) ON DELETE CASCADE,
    mentioned_type TEXT NOT NULL,
    mentioned_id UUID NOT NULL,
    PRIMARY KEY (article_id, mentioned_type, mentioned_id)
);
```

### 1.10 Чат и сессии

```sql
CREATE TABLE chat_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    user_id UUID NOT NULL REFERENCES users(id),
    title TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,  -- user/agent/system
    content TEXT NOT NULL,
    voice BOOLEAN NOT NULL DEFAULT FALSE,
    evidence JSONB,                 -- список источников
    agent_id TEXT,                  -- кто из M-38 ответил
    cost_tokens INT,
    cost_rub DECIMAL(10,4),
    latency_ms INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX chat_messages_session ON chat_messages (session_id, created_at);
```

### 1.11 Audit и agent actions

```sql
CREATE TABLE agent_actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    agent_id TEXT NOT NULL,             -- 'supervisor', 'cmo_agent', 'm14_reframer'
    tool_called TEXT,
    inputs_hash TEXT,
    outputs_hash TEXT,
    outputs_summary TEXT,
    duration_ms INT,
    cost_tokens_input INT,
    cost_tokens_output INT,
    cost_rub DECIMAL(10,4),
    confidence_self FLOAT,
    related_entity_type TEXT,
    related_entity_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

CREATE INDEX agent_actions_entity ON agent_actions (related_entity_type, related_entity_id);
CREATE INDEX agent_actions_agent_at ON agent_actions (agent_id, created_at DESC);

CREATE TABLE access_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    user_id UUID REFERENCES users(id),
    action TEXT NOT NULL,            -- read/write/delete
    target_type TEXT NOT NULL,
    target_id UUID,
    allowed BOOLEAN NOT NULL,
    denial_reason TEXT,
    request_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);
```

### 1.12 Outbox для Kafka

```sql
CREATE TABLE outbox_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    topic TEXT NOT NULL,
    key TEXT NOT NULL,
    payload JSONB NOT NULL,
    headers JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
);

CREATE INDEX outbox_unpublished ON outbox_events (created_at) WHERE published_at IS NULL;
```

Outbox-publisher (отдельный сервис) опрашивает таблицу, публикует в Kafka, помечает `published_at`.

### 1.13 Row-level security

Базовый шаблон для всех таблиц с `data_class`:

```sql
ALTER TABLE signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY signals_select ON signals
    FOR SELECT USING (
        data_class = 'public'
        OR (data_class = 'internal' AND current_setting('app.user_role')::text != 'guest')
        OR (data_class = 'sensitive' AND current_setting('app.user_clearance')::int >= 2)
        OR (data_class = 'private' AND current_setting('app.user_clearance')::int >= 3)
    );
```

Точная политика — через OpenFGA проверку перед запросом + RLS как defense in depth. См. [08-security-privacy.md](08-security-privacy.md).

---

## 2. FalkorDB — граф знаний

Один keyspace на тенант: `tenant_<tenant_id>`.

### Узлы

```cypher
// Все узлы наследуют общие поля
(node {
    id: 'uuid',
    type: 'theme'|'signal'|'goal'|'idea'|'risk'|'decision'|'person'|'client'|'department'|'project'|'document'|'metric'|'branch',
    tenant_id: 'uuid',
    title: 'string',
    data_class: 'public'|'internal'|'sensitive'|'private',
    created_at: timestamp,
    updated_at: timestamp,
    valid_from: timestamp,
    valid_to: timestamp | null
})
```

Графовые аналоги хранят минимум полей — детальные данные остаются в PostgreSQL. Узел в графе — это «ID + тип + временная валидность».

### Рёбра

```cypher
(a)-[r:RELATION_TYPE {
    relation_type: 'подтверждает'|'противоречит'|'мешает'|'помогает'|'вызывает'|
                   'относится_к_цели'|'упоминает_человека'|'упоминает_клиента'|
                   'повторяет'|'стратегическое_расхождение'|'ранний_симптом_риска'|
                   'новая_сторона_старой_проблемы'|'общий_корень_нескольких_проблем',
    confidence: 0.85,
    explanation: 'string',
    status: 'предложена_AI'|'подтверждена_человеком'|'отклонена_человеком'|'архивирована',
    evidence_signals: ['signal_id', ...],
    valid_from: timestamp,
    valid_to: timestamp | null,
    created_by: 'agent_id_or_user_id',
    created_at: timestamp,
    confirmed_by_user_id: 'uuid' | null
}]->(b)
```

### Индексы

```cypher
CREATE INDEX FOR (n) ON (n.id);
CREATE INDEX FOR (n) ON (n.type, n.tenant_id);
CREATE INDEX FOR ()-[r]-() ON (r.relation_type);
CREATE INDEX FOR ()-[r]-() ON (r.valid_from);
```

### Graphiti поверх

Graphiti управляет:
- Edge versioning (новый edge → ставит `valid_to` старому).
- Schema evolution (выводит entity types и relation types из текста, складывает в `learned_ontology`).
- Provenance trail.

Graphiti конфигурируется на тенант через `GraphitiClient(tenant_id=..., backend=FalkorDB(...))`.

---

## 3. pgvector — векторные индексы

| Таблица | Колонка | Размерность | Index type | Параметры |
|---|---|---|---|---|
| `signal_embeddings` | `embedding` | 1024 (bge-m3) | HNSW | m=16, ef_construction=64 |
| `themes` | `embedding` | 1024 | HNSW | m=16, ef_construction=64 |
| `knowledge_articles` | `embedding` | 1024 | HNSW | m=16, ef_construction=64 |

Дистанция: cosine (`vector_cosine_ops`).

При поиске:
- `ef_search = 100` (баланс точности/латентности).
- Топ-50 кандидатов для KNN, далее cross-encoder rerank до 10.

Переиндексация:
- Раз в неделю — fresh-rebuild с `CREATE INDEX CONCURRENTLY` (заменяет, не блокирует).
- При смене модели эмбеддера — миграция всех эмбеддингов через batch-job.

---

## 4. Meilisearch — полнотекстовый поиск

Один index на тип сущности на тенант:
- `signals_<tenant>` — поле `text`, фильтры по `signal_type`, `data_class`.
- `themes_<tenant>` — поля `title`, `description`.
- `knowledge_<tenant>` — поля `title`, `body_md`.
- `decisions_<tenant>` — поля `title`, `description`, `rationale`.
- `raw_events_<tenant>` — поле `body_text` (только для коротких).

Настройки:
- `searchableAttributes`: указанные выше.
- `filterableAttributes`: `data_class`, `signal_type`, `created_at`, `theme_id`.
- `stopWords`: русский базовый список.
- `synonyms`: настраиваются админом (например, «клиент» = «заказчик»).
- `typoTolerance`: enabled.

Индексация — через Kafka consumer (топик `*.changed`), bulk batch каждые 5 секунд.

---

## 5. MinIO — объектное хранилище

Buckets:

| Bucket | Что хранит | Lifecycle |
|---|---|---|
| `raw` | Бинарные первоисточники: аудио, видео, файлы | 7 лет (152-ФЗ), затем archive |
| `transcripts` | Транскрипции аудио/видео | соответствует raw |
| `exports` | Экспорты данных пользователей | 30 дней |
| `backups` | Бэкапы PostgreSQL/FalkorDB (Restic) | 30 ежедневных + 12 месячных + 5 годовых |
| `attachments` | Вложения в чате, скриншоты | 1 год |

Encryption-at-rest: SSE-S3 с ключами в OpenBao.

Path convention:
- `raw/<tenant>/<year>/<month>/<day>/<event_id>/<filename>`.
- `backups/<tenant>/<service>/<date>/<file>`.

---

## 6. Valkey (Redis-fork) — кэш

Используется для:
- Кэш ответов LLM (key: `llm:<sha256(prompt+model+params)>`, TTL 24 ч).
- Semantic cache (key: `semcache:<hash(embedding_query)>`, TTL 7 дней).
- Pub/Sub для streaming чата (channel: `chat:<session_id>`).
- Rate-limit (key: `ratelimit:<user_id>:<endpoint>:<minute>`).
- Lock-сервис для cron-задач (`SET ... NX EX`).

Без обязательного persistence (RDB-snapshot раз в час, для ускорения восстановления).

---

## 7. Temporal — workflow state

Backed by PostgreSQL (отдельная схема `temporal_<tenant>`). Не хранит бизнес-данные — только состояние workflow.

Ретеншн истории workflow: 90 дней, далее archive в MinIO `temporal-archive/`.

---

## 8. Кросс-БД консистентность

### Outbox pattern

Все события для Kafka создаются через `outbox_events` в той же транзакции, что и бизнес-изменение. Отдельный publisher гарантирует at-least-once delivery в Kafka.

### Event-sourcing для критичных сущностей

Темы, решения, цели — версионируются полным snapshot в PostgreSQL. Дополнительно дублируются в Graphiti для time-travel в графе.

### Idempotency keys

Все потребители Kafka должны быть идемпотентны: проверка `agent_actions.inputs_hash` перед обработкой.

### Eventual consistency между PostgreSQL и FalkorDB

При расхождении (например, тема в PostgreSQL, но нет узла в FalkorDB):
- Фоновая задача `consistency_check` каждые 6 часов.
- При расхождении — алерт + автоматическое создание недостающих узлов в FalkorDB из PostgreSQL.
- PostgreSQL — source of truth.

### Eventual consistency PostgreSQL и Meilisearch

- Опоздание индексации — до 5 секунд.
- Раз в сутки — full reindex проверка.

---

## 9. Миграции

- **Alembic** для PostgreSQL — все DDL через миграции.
- **CI/CD** запускает миграции автоматически при деплое.
- **Запрет на ручной DDL в production.**
- **FalkorDB** — обновление схемы через `MIGRATE` команды в Cypher, версионирование через таблицу `migrations` в самом графе.
- **Откат миграций** — поддерживается для PostgreSQL. FalkorDB-миграции — только forward (новый граф рядом + переименование).

---

## 10. Backup и restore

См. [11-deployment.md](11-deployment.md), раздел Backup.

- **PostgreSQL:** WAL archiving + базовый бэкап раз в сутки через `pg_basebackup` + Restic.
- **FalkorDB:** snapshot RDB раз в час + AOF + Restic.
- **MinIO:** репликация на secondary MinIO + Restic snapshot объектов раз в сутки.
- **Восстановление до момента T:** PostgreSQL PITR + FalkorDB через time-travel запрос на момент T.

---

## 11. Шаблоны JSONB полей

### `confirmation_history`

```json
[
  {"at": "2026-05-08T10:00:00Z", "from": null, "to": "proposed", "actor": "agent:m05_analyzer", "reason": "первичный анализ"},
  {"at": "2026-05-08T11:00:00Z", "from": "proposed", "to": "analyzed", "actor": "agent:m13_consolidator", "reason": "повторился в 3 источниках"},
  {"at": "2026-05-09T14:00:00Z", "from": "analyzed", "to": "confirmed", "actor": "user:01H...", "reason": "это действительно про CPM"}
]
```

### `author_ref`

```json
{
  "type": "person",
  "user_id": "01H...",
  "external_id": "user@company.ru",
  "display_name": "Иван Петров"
}
```

или для систем:

```json
{
  "type": "system",
  "source_id": "01H...",
  "system_name": "amocrm.deal.update"
}
```

### `channel_ref`

```json
{
  "type": "slack_channel",
  "external_id": "C01ABC",
  "name": "marketing",
  "is_private": false
}
```

---

## 12. Наименования и conventions

- Таблицы — `snake_case`, множественное число (`signals`, `themes`).
- Колонки — `snake_case`.
- Индексы — `<table>_<columns>[_partial]` (`themes_branch_id`, `signals_theme_id`).
- Foreign keys — `<table>_<column>_fkey` (default Postgres).
- Enums — `<concept>_enum`.
- Партиционирование — `RANGE (created_at)` по месяцам, имена партиций `<table>_<yyyy_mm>`.
