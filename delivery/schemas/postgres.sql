-- =================================================================
-- Второй мозг для компаний — основная схема PostgreSQL
-- Версия: 1.0
-- Дата: 2026-05-10
-- =================================================================
-- Полное описание моделей и обоснования — в delivery/05-data-schema.md
-- Это reference-схема для миграций. Применять через Alembic.
-- =================================================================

-- =================================================================
-- Расширения
-- =================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- UUID v7 (для timestamp-prefixed PK)
CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid AS $$
DECLARE
    v_time double precision := extract(epoch from clock_timestamp()) * 1000;
    v_unix_ts_ms bytea;
    v_uuid_bytes bytea;
BEGIN
    v_unix_ts_ms := substring(int8send(v_time::bigint) FROM 3);
    v_uuid_bytes := v_unix_ts_ms || gen_random_bytes(10);
    -- Set version (7) and variant (10)
    v_uuid_bytes := set_byte(v_uuid_bytes, 6, (b'0111' || get_byte(v_uuid_bytes, 6)::bit(4))::bit(8)::int);
    v_uuid_bytes := set_byte(v_uuid_bytes, 8, (b'10'   || get_byte(v_uuid_bytes, 8)::bit(6))::bit(8)::int);
    RETURN encode(v_uuid_bytes, 'hex')::uuid;
END $$ LANGUAGE plpgsql;

-- =================================================================
-- ENUM типы
-- =================================================================
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

-- =================================================================
-- 1. Идентичность и роли
-- =================================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    keycloak_id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,             -- PII
    email TEXT UNIQUE,                      -- PII
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
    locale TEXT NOT NULL DEFAULT 'ru',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX users_keycloak_id ON users (keycloak_id);

CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    name TEXT NOT NULL,
    parent_id UUID REFERENCES departments(id),
    head_user_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE TABLE user_department (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
    role_in_dept TEXT,
    PRIMARY KEY (user_id, department_id)
);

CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    code TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    functional BOOLEAN NOT NULL DEFAULT TRUE,
    hierarchical_level SMALLINT,
    description TEXT,
    is_preset BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE user_roles (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id),
    scope JSONB,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by UUID REFERENCES users(id),
    PRIMARY KEY (user_id, role_id)
);

-- =================================================================
-- 2. Источники и сырая память
-- =================================================================
CREATE TABLE sources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    code TEXT NOT NULL,
    source_class TEXT NOT NULL,
    display_name TEXT NOT NULL,
    config JSONB NOT NULL,
    default_data_class data_class_enum NOT NULL DEFAULT 'internal',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE raw_events (
    id UUID NOT NULL DEFAULT uuid_generate_v7(),
    idempotency_key TEXT NOT NULL UNIQUE,
    source_id UUID NOT NULL REFERENCES sources(id),
    external_id TEXT,
    occurred_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    author_ref JSONB NOT NULL,
    channel_ref JSONB,
    content_type TEXT NOT NULL,
    body_text TEXT,
    minio_key TEXT,
    body_sha256 TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    data_class data_class_enum NOT NULL DEFAULT 'internal',
    visibility_tags TEXT[] DEFAULT '{}',
    parent_event_id UUID,
    deleted_at TIMESTAMPTZ,
    PRIMARY KEY (id, received_at)
) PARTITION BY RANGE (received_at);

CREATE INDEX raw_events_occurred_at ON raw_events (occurred_at DESC);
CREATE INDEX raw_events_source_id ON raw_events (source_id);
CREATE INDEX raw_events_metadata ON raw_events USING GIN (metadata);
-- Партиции создаются через pg_partman или вручную

-- =================================================================
-- 3. Темы и ветки
-- =================================================================
CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    code TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_custom BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INT NOT NULL DEFAULT 0
);

-- Дефолтные 12 веток
INSERT INTO branches (code, display_name, sort_order, is_custom) VALUES
    ('strategy',     'Стратегия и видение',         1, false),
    ('customers',    'Клиенты и аудитория',         2, false),
    ('sales',        'Продажи',                     3, false),
    ('marketing',    'Маркетинг и позиционирование',4, false),
    ('product',      'Продукт',                     5, false),
    ('operations',   'Операции и процессы',         6, false),
    ('team',         'Команда и культура',          7, false),
    ('finance',      'Финансы',                     8, false),
    ('tech',         'Технологии и инфраструктура', 9, false),
    ('production',   'Производство и доставка',    10, false),
    ('partnerships', 'Партнёрства',                11, false),
    ('legal',        'Юридика и комплаенс',        12, false);

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
CREATE INDEX themes_embedding_hnsw ON themes USING hnsw (embedding vector_cosine_ops);

CREATE TABLE theme_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    theme_id UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    snapshot JSONB NOT NULL,
    changed_by UUID REFERENCES users(id),
    change_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX theme_versions_theme_id ON theme_versions (theme_id, created_at DESC);

CREATE TABLE theme_score_components (
    theme_id UUID PRIMARY KEY REFERENCES themes(id) ON DELETE CASCADE,
    components JSONB NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE source_weights (
    source_type TEXT PRIMARY KEY,
    weight FLOAT NOT NULL,
    description TEXT
);

INSERT INTO source_weights VALUES
    ('paying_client_metric',    1.0, 'Платящий клиент с метрикой'),
    ('paying_client',           0.8, 'Платящий клиент'),
    ('lead',                    0.5, 'Лид/потенциальный клиент'),
    ('clevel_employee',         0.7, 'Сотрудник C-level'),
    ('middle_employee',         0.5, 'Сотрудник middle'),
    ('junior_employee',         0.3, 'Сотрудник junior'),
    ('external_expert',         0.4, 'Внешний эксперт'),
    ('metric',                  0.6, 'Метрика'),
    ('external_source',         0.3, 'RSS/конкуренты'),
    ('anonymous',               0.2, 'Анонимный');

-- =================================================================
-- 4. Сигналы
-- =================================================================
CREATE TABLE signals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    raw_event_id UUID NOT NULL,
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
    raw_event_id UUID,
    offset_start INT,
    offset_end INT,
    snippet TEXT,
    PRIMARY KEY (signal_id, raw_event_id)
);

CREATE TABLE signal_mentions (
    signal_id UUID REFERENCES signals(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    PRIMARY KEY (signal_id, entity_type, entity_id)
);

CREATE TABLE signal_embeddings (
    signal_id UUID PRIMARY KEY REFERENCES signals(id) ON DELETE CASCADE,
    embedding vector(1024) NOT NULL,
    model TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX signal_embeddings_hnsw
    ON signal_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- =================================================================
-- 5. Цели, идеи, риски, решения
-- =================================================================
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
    source_event_id UUID,
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
    source_event_id UUID NOT NULL,
    status commitment_status_enum NOT NULL DEFAULT 'mentioned',
    data_class data_class_enum NOT NULL DEFAULT 'internal',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX commitments_person_status ON commitments (person_id, status);

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

-- =================================================================
-- 6. Метрики
-- =================================================================
CREATE TABLE metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    code TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    unit TEXT,
    source_id UUID REFERENCES sources(id),
    direction TEXT,
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

-- =================================================================
-- 7. Mood (M-19)
-- =================================================================
CREATE TABLE mood_consents (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    user_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
    user_opt_in_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

CREATE TABLE mood_active_responses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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

-- =================================================================
-- 8. База знаний
-- =================================================================
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
CREATE INDEX knowledge_articles_embedding_hnsw
    ON knowledge_articles USING hnsw (embedding vector_cosine_ops);

CREATE TABLE article_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    article_id UUID NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
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

-- =================================================================
-- 9. Чат
-- =================================================================
CREATE TABLE chat_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    voice BOOLEAN NOT NULL DEFAULT FALSE,
    evidence JSONB,
    agent_id TEXT,
    cost_tokens INT,
    cost_rub DECIMAL(10,4),
    latency_ms INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX chat_messages_session ON chat_messages (session_id, created_at);

-- =================================================================
-- 10. Audit и agent actions
-- =================================================================
CREATE TABLE agent_actions (
    id UUID NOT NULL DEFAULT uuid_generate_v7(),
    agent_id TEXT NOT NULL,
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX agent_actions_entity ON agent_actions (related_entity_type, related_entity_id);
CREATE INDEX agent_actions_agent_at ON agent_actions (agent_id, created_at DESC);

CREATE TABLE access_audit_log (
    id UUID NOT NULL DEFAULT uuid_generate_v7(),
    user_id UUID REFERENCES users(id),
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id UUID,
    allowed BOOLEAN NOT NULL,
    denial_reason TEXT,
    request_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- =================================================================
-- 11. Outbox
-- =================================================================
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

-- =================================================================
-- 12. Forget requests (compliance)
-- =================================================================
CREATE TABLE forget_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    target_type TEXT NOT NULL,             -- 'user' | 'client' | 'person'
    target_id UUID NOT NULL,
    requested_by UUID REFERENCES users(id),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deadline TIMESTAMPTZ NOT NULL,
    export_completed_at TIMESTAMPTZ,
    delete_completed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending'
);

-- =================================================================
-- 13. Row-level security (пример для signals)
-- =================================================================
ALTER TABLE signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY signals_select ON signals
    FOR SELECT USING (
        data_class = 'public'
        OR (data_class = 'internal' AND current_setting('app.user_clearance', true)::int >= 1)
        OR (data_class = 'sensitive' AND current_setting('app.user_clearance', true)::int >= 2)
        OR (data_class = 'private' AND current_setting('app.user_clearance', true)::int >= 3)
    );

-- Для всех таблиц с data_class — повторить.
-- Точная политика — через OpenFGA + RLS как defense in depth.

-- =================================================================
-- Конец основной схемы
-- =================================================================
