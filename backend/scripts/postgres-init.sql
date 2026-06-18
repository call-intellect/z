-- Z — postgres init script.
-- Запускать ОДНОКРАТНО на свежем инстансе ДО первого `prisma db push`.
-- Также используется prisma db push повторно после: HNSW-индекс на pgvector
-- Prisma не умеет описать сам, поэтому он создаётся отдельным DDL.

-- 1. pgvector extension (требуется для MeetingTranscriptChunk.embedding и
--    knowledge-core IdeaBlock/Entity.embedding).
--    На Yandex Cloud Managed PostgreSQL — доступно из коробки.
CREATE EXTENSION IF NOT EXISTS vector;

-- 1b. Apache AGE — графовая инфраструктура Фазы 0 (см.
--    plans/tz/2026-05-21-phase-0a-data-model-and-graph-infra.md §5).
--    На Yandex Cloud Managed PostgreSQL 16 — доступно как managed extension
--    (включается в настройках кластера: shared_preload_libraries = 'age').
--    Локально в dev — через composite-образ (infra/postgres/Dockerfile).
CREATE EXTENSION IF NOT EXISTS age;
LOAD 'age';
SET search_path = ag_catalog, "$user", public;

-- 1c. Граф z_graph — единое graph-namespace для всех бизнес-связей Z.
--     Идемпотентно: повторный create_graph падает, поэтому ловим через
--     проверку ag_catalog.ag_graph.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ag_catalog.ag_graph WHERE name = 'z_graph'
  ) THEN
    PERFORM ag_catalog.create_graph('z_graph');
  END IF;
END $$;

-- 1d. МТЗ «разблокировка конвейера» Ф5 — закрепить ag_catalog в search_path
--     РОЛИ приложения (а не session-local). Строки 17-18 выше ставят
--     search_path только для текущего короткоживущего клиента apply-postgres-init,
--     соединение которого закрывается — рантайм-пул Prisma этих настроек НЕ видит
--     и неквалифицированный cypher()/agtype не резолвится (Postgres 42883).
--     ALTER ROLE прописывает search_path на КАЖДОЕ новое соединение этой роли,
--     поэтому рантайм-пул резолвит cypher() без дополнительных LOAD/SET.
--     CURRENT_USER = пользователь из DATABASE_URL (роль может менять свой
--     search_path). Идемпотентно — повторный ALTER ROLE просто перезаписывает.
--     На проде AGE предзагружен (shared_preload_libraries='age'), поэтому
--     достаточно search_path; LOAD 'age' на каждое соединение не нужен.
ALTER ROLE CURRENT_USER SET search_path = ag_catalog, "$user", public;

-- 2. HNSW-индекс на эмбеддингах для cross-meeting search и AI-чата по архиву.
--    Прогон ИДЕМПОТЕНТНЫЙ — IF NOT EXISTS защищает от повторного выполнения.
--    Запускать ПОСЛЕ `prisma db push` (когда таблица уже существует).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'MeetingTranscriptChunk'
  ) THEN
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS meeting_transcript_chunk_embedding_hnsw
      ON "MeetingTranscriptChunk"
      USING hnsw (embedding vector_cosine_ops)
    $sql$;
  END IF;
END $$;

-- 3. knowledge-core (Фаза 2) — pgvector HNSW indexes (cosine).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'IdeaBlock'
  ) THEN
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "IdeaBlock_embedding_hnsw_cosine_idx"
      ON "IdeaBlock" USING hnsw (embedding vector_cosine_ops)
      WHERE embedding IS NOT NULL
    $sql$;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Entity'
  ) THEN
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "Entity_embedding_hnsw_cosine_idx"
      ON "Entity" USING hnsw (embedding vector_cosine_ops)
      WHERE embedding IS NOT NULL
    $sql$;
  END IF;
END $$;

-- 3c. Фаза E — partial unique на MeetingReport: запрет двух pending/running
--     отчётов с одним и тем же `promptTemplateId` в рамках одной встречи.
--     Prisma `@@unique` не поддерживает WHERE-условие, поэтому индекс
--     создаётся вручную здесь. Идемпотентно через `IF NOT EXISTS`.
--     См. plans/tz/2026-05-21-phase-E-multi-report-per-meeting.md §4.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'MeetingReport'
  ) THEN
    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS meeting_report_pending_unique
      ON "MeetingReport" ("meetingId", "promptTemplateId")
      WHERE status IN ('pending', 'running')
    $sql$;
  END IF;
END $$;

-- 3c-bis. ТЗ-B (2026-06-05) — одна "главная цель" (isPrimary) на tenant.
--     Prisma `@@unique` не поддерживает WHERE-условие, поэтому partial
--     unique создаётся вручную. Идемпотентно через `IF NOT EXISTS`.
--     См. plans/tz/2026-06-05-goal-vector-compass.md §Контракт-first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Goal'
  ) THEN
    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS goal_primary_unique
      ON "Goal" ("tenantId")
      WHERE "isPrimary" = true
    $sql$;
  END IF;
END $$;

-- 3d. SBA α-3 (2026-05-21) — индексы для новых моделей категории A.
--     Vendor и Event embedding не имеют (граф знаний даёт его через Entity,
--     а Entity уже проиндексирован HNSW в шаге 3). Здесь — только полезные
--     B-Tree / GIN на массивах для частых query-фильтров.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Event'
  ) THEN
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "Event_participantsPersonIds_gin_idx"
      ON "Event" USING gin ("participantsPersonIds")
    $sql$;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Vendor'
  ) THEN
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "Vendor_contractIds_gin_idx"
      ON "Vendor" USING gin ("contractIds")
    $sql$;
    -- Уникальный частичный индекс на inn — чтобы избежать дублей юр.лиц
    -- внутри одного tenantId. Allow NULL (несколько Vendor могут не иметь ИНН).
    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS "Vendor_tenantId_inn_unique_idx"
      ON "Vendor" ("tenantId", "inn")
      WHERE "inn" IS NOT NULL AND "deletedAt" IS NULL
    $sql$;
  END IF;
END $$;

-- 4. ts_vector для гибридного поиска IdeaBlock (search API Шаг 5 Фазы 2).
--    Колонка GENERATED ALWAYS — авто-обновление при INSERT/UPDATE.
--    Веса: name=A, criticalQuestion=B, trustedAnswer=C.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'IdeaBlock'
  ) THEN
    EXECUTE $sql$
      ALTER TABLE "IdeaBlock"
        ADD COLUMN IF NOT EXISTS "search_tsv" tsvector
        GENERATED ALWAYS AS (
          setweight(to_tsvector('russian', coalesce("name",'')), 'A') ||
          setweight(to_tsvector('russian', coalesce("criticalQuestion",'')), 'B') ||
          setweight(to_tsvector('russian', coalesce("trustedAnswer",'')), 'C')
        ) STORED
    $sql$;
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "IdeaBlock_search_tsv_gin_idx"
      ON "IdeaBlock" USING gin ("search_tsv")
    $sql$;
  END IF;
END $$;

-- 5. SBA β-3 — Decisions Registry (Specialist 3.3).
--    a) HNSW индекс на embedding для KNN cosine dedupe + supersede-detect.
--    b) tsvector для гибридного поиска (statement + rationale + actualOutcomes).
--    c) GIN на массивах affectsEntityIds / decidedByPersonIds / sourceBlockIds —
--       для частых reverse-фильтров «какие решения касались Project X».
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'decisions'
  ) THEN
    -- (a) HNSW на embedding (cosine distance).
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "decisions_embedding_hnsw_cosine_idx"
      ON "decisions" USING hnsw (embedding vector_cosine_ops)
      WHERE embedding IS NOT NULL
    $sql$;

    -- (b) tsvector на statement/rationale/actualOutcomes (русский словарь).
    EXECUTE $sql$
      ALTER TABLE "decisions"
        ADD COLUMN IF NOT EXISTS "decision_search_tsv" tsvector
        GENERATED ALWAYS AS (
          setweight(to_tsvector('russian', coalesce("statement",'')), 'A') ||
          setweight(to_tsvector('russian', coalesce("rationale",'')), 'B') ||
          setweight(to_tsvector('russian', coalesce("actualOutcomes",'')), 'C')
        ) STORED
    $sql$;
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "decisions_search_tsv_gin_idx"
      ON "decisions" USING gin ("decision_search_tsv")
    $sql$;

    -- (c) GIN на массивах — для reverse-lookup'ов и hasSome-фильтров.
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "decisions_affectsEntityIds_gin_idx"
      ON "decisions" USING gin ("affectsEntityIds")
    $sql$;
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "decisions_decidedByPersonIds_gin_idx"
      ON "decisions" USING gin ("decidedByPersonIds")
    $sql$;
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "decisions_sourceBlockIds_gin_idx"
      ON "decisions" USING gin ("sourceBlockIds")
    $sql$;
  END IF;
END $$;

-- 6. SBA β-4 — Insights Radar (Specialist 3.5).
--    a) HNSW индекс на embedding для KNN-кластеризации повторов (cosine).
--    b) tsvector для полнотекста по statement + mitigationPlan.
--    c) GIN на массивах affectedEntityIds / relatedDecisionIds / sourceBlockIds —
--       для reverse-lookup'ов «какие сигналы касались Project X».
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'insights'
  ) THEN
    -- (a) HNSW на embedding (cosine distance).
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "insights_embedding_hnsw_cosine_idx"
      ON "insights" USING hnsw (embedding vector_cosine_ops)
      WHERE embedding IS NOT NULL
    $sql$;

    -- (b) tsvector на statement/mitigationPlan (русский словарь).
    EXECUTE $sql$
      ALTER TABLE "insights"
        ADD COLUMN IF NOT EXISTS "insight_search_tsv" tsvector
        GENERATED ALWAYS AS (
          setweight(to_tsvector('russian', coalesce("statement",'')), 'A') ||
          setweight(to_tsvector('russian', coalesce("mitigationPlan",'')), 'B')
        ) STORED
    $sql$;
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "insights_search_tsv_gin_idx"
      ON "insights" USING gin ("insight_search_tsv")
    $sql$;

    -- (c) GIN на массивах — для reverse-lookup'ов и hasSome-фильтров.
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "insights_affectedEntityIds_gin_idx"
      ON "insights" USING gin ("affectedEntityIds")
    $sql$;
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "insights_relatedDecisionIds_gin_idx"
      ON "insights" USING gin ("relatedDecisionIds")
    $sql$;
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "insights_sourceBlockIds_gin_idx"
      ON "insights" USING gin ("sourceBlockIds")
    $sql$;
  END IF;
END $$;

-- 7. SBA β-5 — Ideas Collector (Specialist 3.6) + Layer 6 Probe-Agent.
--    a) HNSW на Idea.embedding (KNN cosine дедуп идей).
--    b) HNSW на IdeaCluster.embedding (KNN cosine merge кластеров).
--    c) GIN на массивах sourceBlockIds / personSubjectIds (reverse-lookup).
--    d) GIN на IdeaCluster.ideaIds.
--    e) Уникальный индекс по contentHash в рамках tenant для probe_events
--       (dedup hard-fence — на случай race в Redis).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ideas'
  ) THEN
    -- (a) HNSW на embedding.
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "ideas_embedding_hnsw_cosine_idx"
      ON "ideas" USING hnsw (embedding vector_cosine_ops)
      WHERE embedding IS NOT NULL
    $sql$;
    -- (c) GIN на массивах.
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "ideas_sourceBlockIds_gin_idx"
      ON "ideas" USING gin ("sourceBlockIds")
    $sql$;
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "ideas_personSubjectIds_gin_idx"
      ON "ideas" USING gin ("personSubjectIds")
    $sql$;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'idea_clusters'
  ) THEN
    -- (b) HNSW на embedding кластера.
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "idea_clusters_embedding_hnsw_cosine_idx"
      ON "idea_clusters" USING hnsw (embedding vector_cosine_ops)
      WHERE embedding IS NOT NULL
    $sql$;
    -- (d) GIN на массиве ideaIds.
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "idea_clusters_ideaIds_gin_idx"
      ON "idea_clusters" USING gin ("ideaIds")
    $sql$;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'probe_events'
  ) THEN
    -- (e) Composite-index по (tenantId, status, createdAt) для admin-queue.
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "probe_events_tenant_status_created_idx"
      ON "probe_events" ("tenantId", "status", "createdAt" DESC)
    $sql$;
    -- Ф4 (2026-06-17) — HNSW на questionEmbedding для семантического дедупа probe.
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "idx_probeevent_qembed_hnsw"
      ON "probe_events" USING hnsw ("questionEmbedding" vector_cosine_ops)
      WHERE "questionEmbedding" IS NOT NULL
    $sql$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- SBA γ-1 — Specialist 3.7 (SkillProfile + ExecutablePersona).
--    a) HNSW индекс на SkillTrait.embedding для KNN-merge активных traits.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'skill_traits'
  ) THEN
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "skill_traits_embedding_hnsw_cosine_idx"
      ON "skill_traits" USING hnsw (embedding vector_cosine_ops)
      WHERE embedding IS NOT NULL
    $sql$;
    -- GIN на sourceBlockIds — для retrieval в Clone API (по blockId).
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "skill_traits_sourceBlockIds_gin_idx"
      ON "skill_traits" USING gin ("sourceBlockIds")
    $sql$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ТЗ 2026-05-25 clone-reliability-hardening, Фаза 2 — Смысловые блоки навыка.
--    HNSW индекс на skill_trait_concepts.embedding для быстрого
--    findOrCreateConcept (top-1 по cosine) и cron-нормализатора.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'skill_trait_concepts'
  ) THEN
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "skill_trait_concepts_embedding_hnsw_idx"
      ON "skill_trait_concepts" USING hnsw (embedding vector_cosine_ops)
      WHERE embedding IS NOT NULL
    $sql$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TZ clone-method (2026-06-11) — RolePrinciple (Reflection-слой принципов роли).
--    HNSW индекс на role_principles.embedding (cosine) для KNN-дедупа при
--    синтезе принципов и ретрива «похожих принципов» в persona-compile v2.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'role_principles'
  ) THEN
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "role_principles_embedding_hnsw_cosine_idx"
      ON "role_principles" USING hnsw (embedding vector_cosine_ops)
      WHERE embedding IS NOT NULL
    $sql$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ТЗ 2026-05-25 clone-reliability-hardening, Фаза 4 — Семантический индекс
--    категорий профиля знаний (Person.knowledgeProfile.categories[]).
--    HNSW индекс на person_knowledge_category_embeddings.embedding для
--    запроса «кто разбирается в X» через cosine-distance.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'person_knowledge_category_embeddings'
  ) THEN
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS person_knowledge_category_embeddings_embedding_hnsw_idx
      ON person_knowledge_category_embeddings USING hnsw (embedding vector_cosine_ops)
      WHERE embedding IS NOT NULL
    $sql$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Wave 2 — Specialist 3.8 (HelpfulnessTrait).
--   HNSW индекс на HelpfulnessTrait.embedding для KNN-merge через cosine.
--   Без индекса worker делает seq-scan; HNSW обеспечивает O(log n) recall
--   на >10к записей. KNN merge порог в коде: cosine_distance < 0.15.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'HelpfulnessTrait'
  ) THEN
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS helpfulness_trait_embedding_hnsw
      ON "HelpfulnessTrait"
      USING hnsw (embedding vector_cosine_ops)
    $sql$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tracker Phase 3 (Sprint 6, 2026-05-24) — Issue.embedding.
--   HNSW индекс (cosine) для KNN «похожие задачи» в GET /tracker/issues/:id/similar
--   + issue-goal-suggest LLM (KNN по embedding среди закрытых задач с goalId).
--   Без индекса — seq-scan по всем Issue в tenant'е. С индексом — O(log n).
--   Порог cosine_distance < 0.18 (≈ cosine_similarity ≥ 0.82) — из ТЗ Phase 3.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Issue'
  ) THEN
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "Issue_embedding_hnsw_cosine_idx"
      ON "Issue" USING hnsw (embedding vector_cosine_ops)
      WHERE embedding IS NOT NULL
    $sql$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Ф5 (TZ 2026-06-16 task-dedup) — Goal.embedding.
--   HNSW индекс (cosine) для семантического дедупа целей (specialist-3-14):
--   KNN по Goal.embedding вместо ILIKE по 2 словам. Заполняется goal-embed.worker.
--   WHERE embedding IS NOT NULL — у ручных/нестроенных целей вектора нет.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Goal' AND column_name = 'embedding'
  ) THEN
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "goal_embedding_hnsw_cosine_idx"
      ON "Goal" USING hnsw (embedding vector_cosine_ops)
      WHERE embedding IS NOT NULL
    $sql$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- KC-Temporal W3.4 (2026-05-25) — Strong IDs (выделенные идентификаторы)
-- на Entity. Дедуп внутри Org через ИНН / ОГРН / email / домен БЕЗ LLM.
-- Prisma `@@unique` не поддерживает WHERE-условие; full-unique нельзя —
-- большинство сущностей этих полей не имеют. Partial unique со скоупом
-- (tenantId, type, <strong_field>) даёт целевую защиту от дублей.
-- Запускать ПОСЛЕ `prisma db push` (когда колонки уже добавлены в "Entity").
-- См. plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md §W3.4.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Entity' AND column_name = 'inn'
  ) THEN
    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS "Entity_strong_inn_uniq"
        ON "Entity" ("tenantId", "type", "inn") WHERE "inn" IS NOT NULL
    $sql$;
    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS "Entity_strong_ogrn_uniq"
        ON "Entity" ("tenantId", "type", "ogrn") WHERE "ogrn" IS NOT NULL
    $sql$;
    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS "Entity_strong_email_uniq"
        ON "Entity" ("tenantId", "type", "email") WHERE "email" IS NOT NULL
    $sql$;
    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS "Entity_strong_domain_uniq"
        ON "Entity" ("tenantId", "type", "domain") WHERE "domain" IS NOT NULL
    $sql$;
    -- Phone уникальным не делаем — один номер может принадлежать нескольким
    -- контактам (общий ресепшн, семейный номер и т.п.). Lookup-индекс
    -- (не unique) для быстрого resolve по phone.
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "Entity_strong_phone_idx"
        ON "Entity" ("tenantId", "type", "phone") WHERE "phone" IS NOT NULL
    $sql$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- KC-Temporal W3.1 (2026-05-25) — rich edges на EntityLink.
--   `sourceBlockIds` хранит IdeaBlock-источники, на основе которых LLM
--   построил ребро. GIN-индекс ускоряет reverse-lookup «какие рёбра
--   поддерживает этот блок» (для UI и для backfill при удалении блока).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'EntityLink'
  ) THEN
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "EntityLink_sourceBlockIds_gin_idx"
      ON "EntityLink" USING gin ("sourceBlockIds")
    $sql$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- β-9 (2026-05-25) — глобальный Telegram-бот.
--   Один глобальный канал per kind (запись с tenantId IS NULL).
--   Postgres трактует NULL != NULL, поэтому обычный @@unique([tenantId, kind])
--   из Prisma не защищает от нескольких глобальных строк с одинаковым kind.
--   Partial unique index решает это декларативно: уникальность вычисляется
--   только для строк, где tenantId IS NULL.
--   Запускать ПОСЛЕ `prisma db push` (когда таблица "channels" уже существует).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'channels'
  ) THEN
    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS "channels_global_unique"
      ON "channels" ("kind")
      WHERE "tenantId" IS NULL
    $sql$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- audit С17 (2026-05-29) — pg_trgm индекс на Cycle.name для поиска спринтов.
--   sprints.service.ts использует `name: { contains: q, mode: 'insensitive' }`
--   для фильтра «по названию». На больших объёмах (>10к циклов) seq-scan
--   замедляется. GIN trigram index делает substring-поиск O(log N).
--   pg_trgm есть на Yandex Managed PostgreSQL по умолчанию.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Cycle'
  ) THEN
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "Cycle_name_trgm_idx"
      ON "Cycle" USING gin ("name" gin_trgm_ops)
    $sql$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Agents v2 Фаза B1 (2026-05-30) — AutoRule extract (shadow mode).
--   HNSW индексы на vector(1536):
--     a) PromptFeedback.inputEmbedding — KNN-группировка похожих контекстов
--        в autorule-extractor.service. Cosine distance.
--     b) PromptRule.embedding — KNN-дедуп правил (≥0.90 cosine = дубль).
--   См. plans/tz/2026-05-29-agents-v2-umbrella.md §B1.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'PromptFeedback'
  ) THEN
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "PromptFeedback_inputEmbedding_hnsw_cosine_idx"
      ON "PromptFeedback" USING hnsw ("inputEmbedding" vector_cosine_ops)
      WHERE "inputEmbedding" IS NOT NULL
    $sql$;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'PromptRule'
  ) THEN
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "PromptRule_embedding_hnsw_cosine_idx"
      ON "PromptRule" USING hnsw ("embedding" vector_cosine_ops)
      WHERE "embedding" IS NOT NULL
    $sql$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Agents v2 Фаза C1 (2026-05-30) — PracticeSkill (выполняемые навыки клонов).
--   HNSW индекс на practice_skills.triggerEmbedding (vector_cosine_ops) для:
--     a) KNN retrieval в clone-respond (cosine ≥ knnRetrievalThreshold, 0.78).
--     b) KNN dedup при extraction (cosine ≥ knnDedupThreshold, 0.85).
--   Без HNSW — seq-scan по всем skills в Org. С индексом — O(log n).
--   См. plans/tz/2026-05-29-agents-v2-umbrella.md §C1.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'practice_skills'
  ) THEN
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "practice_skills_triggerEmbedding_hnsw_idx"
      ON "practice_skills" USING hnsw ("triggerEmbedding" vector_cosine_ops)
      WHERE "triggerEmbedding" IS NOT NULL
    $sql$;
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────
-- Smart Tables: GIN-индекс на TableRow.cells для быстрого фильтра
-- по JSONB полям (см. plans/tz/2026-05-31-smart-tables.md Фаза 0).
-- jsonb_path_ops быстрее jsonb_ops при @> / @? операторах, но не
-- поддерживает ?, ?| — для наших фильтров достаточно path_ops.
-- ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'TableRow'
  ) THEN
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS table_row_cells_gin
        ON "TableRow"
        USING GIN (cells jsonb_path_ops)
    $sql$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Goals OKR v2 (2026-06-02): провенанс целей — поиск по блокам-источникам
-- (KNN-dedup в специалисте 3-14). GIN-индекс на массиве Goal.sourceBlockIds —
-- reverse-lookup «какие цели добыты из этого блока».
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Goal'
  ) THEN
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "Goal_sourceBlockIds_gin"
      ON "Goal" USING GIN ("sourceBlockIds")
    $sql$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Instruction — first-class «Инструкция» (Волна 6 A10, single-role руководство).
--   HNSW индекс на instructions.embedding (vector_cosine_ops) для KNN cosine
--   dedupe + supersede-detect (зеркало regulations/decisions card-эмбеддингов).
--   Без HNSW — seq-scan по всем инструкциям Org; с индексом — O(log n).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'instructions'
  ) THEN
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "instructions_embedding_hnsw_cosine_idx"
      ON "instructions" USING hnsw (embedding vector_cosine_ops)
      WHERE embedding IS NOT NULL
    $sql$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Person dedup (ТЗ 2026-06-10 meeting-stuck-and-team-roster Ф2): частичный
-- уникальный индекс по активному email внутри tenant — чтобы на один email в
-- одной Org нельзя было завести две активные карточки (источник дублей в
-- разделе «Команда»). NULL/'' email не учитываются (несколько карточек без
-- email допустимы).
--   SELF-SKIP: schema-фаза apply-prod-deploy идёт РАНЬШЕ backfill-фазы (Ф3
--   слияния дублей). Если на момент прогона активные дубли ещё есть — уникальный
--   индекс не встанет (ошибка), поэтому считаем группы-дубли и при >0 пишем
--   RAISE NOTICE и пропускаем; индекс встанет на СЛЕДУЮЩЕМ прогоне postgres-init
--   уже после backfill. Идемпотентно (CREATE UNIQUE INDEX IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  dup_groups integer := 0;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'persons'
  ) THEN
    EXECUTE $sql$
      SELECT count(*) FROM (
        SELECT 1
        FROM "persons"
        WHERE "deletedAt" IS NULL AND "email" IS NOT NULL AND "email" <> ''
        GROUP BY "tenantId", lower("email")
        HAVING count(*) > 1
      ) d
    $sql$ INTO dup_groups;

    IF dup_groups > 0 THEN
      RAISE NOTICE 'persons_tenant_email_active_uniq: % email-групп с активными дублями — индекс пропущен (backfill Ф3 сольёт, индекс встанет на следующем прогоне postgres-init)', dup_groups;
    ELSE
      EXECUTE $sql$
        CREATE UNIQUE INDEX IF NOT EXISTS "persons_tenant_email_active_uniq"
          ON "persons" ("tenantId", lower("email"))
          WHERE "deletedAt" IS NULL AND "email" <> ''
      $sql$;
    END IF;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- K1 (Волна 3, Б7) — гонка дублей ConflictItem на одну пару.
--   ConflictService.report делал findFirst-or-create без @@unique, поэтому два
--   конкурента (cron + handler в одном процессе) создавали два открытых
--   ConflictItem на одну пару. @@unique с status невозможен (full-unique
--   запретил бы и закрытые повторы той же пары), поэтому partial-unique по
--   ОТКРЫТЫМ конфликтам. Prisma `@@unique` не умеет WHERE. Идемпотентно.
--   report ловит P2002 → re-find открытого (см. conflict.service.ts report).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ConflictItem'
  ) THEN
    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_conflict_open"
      ON "ConflictItem" ("tenantId", "resourceType", "existingId", "newId")
      WHERE "status" = 'open'
    $sql$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- K1 (Волна 3, Б18) — дубль singleton closed-группы KnowledgeGroup (refId=NULL).
--   @@unique([tenantId, kind, refId]) НЕ защищает синглтоны: в PostgreSQL NULL
--   distinct, поэтому несколько leadership/council/support групп с refId=NULL
--   проходят. Partial-unique по (tenantId, kind) ТОЛЬКО для refId IS NULL
--   (department/personal с refId — под штатным @@unique). NULLS NOT DISTINCT не
--   нужен: refId не входит в колонки индекса. Prisma `@@unique` не умеет WHERE.
--   ensureGroup ловит P2002 → re-find (см. block-access-deriver.service.ts).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'KnowledgeGroup'
  ) THEN
    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_knowledge_group_singleton"
      ON "KnowledgeGroup" ("tenantId", "kind")
      WHERE "refId" IS NULL
    $sql$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- K1+K11 (Волна 3, Б24) — гонка версий + ДВЕ active role-персоны.
--   @@unique([profileId, scope, scopeRefId, version]) НЕ защищает role-scope:
--   profileId=NULL для роли → NULL distinct в PG, дубли версий проходят. Плюс
--   гонка nextVersion плодит две active. Два partial-unique:
--     (a) uq_executable_persona_role_version — уникальность ВЕРСИИ роли;
--     (b) uq_executable_persona_role_active  — РОВНО одна active на роль.
--   Prisma `@@unique` не умеет WHERE. Таблица @@map('executable_personas').
--   createRolePersonaWithRetry ловит P2002 → retry с пересчётом (см.
--   executable-persona-build.service.ts).
--   SELF-SKIP для (b): schema-фаза идёт раньше backfill; если уже есть роль с
--   ≥2 active (тот самый баг) — уникальный индекс не встанет. Считаем такие
--   группы, при >0 RAISE NOTICE и пропускаем (a) ставим всегда; индекс (b)
--   встанет на следующем прогоне после ручной/cron-нормализации (cron сам
--   супер-седит лишние active при следующей пересборке роли).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  dup_active integer := 0;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'executable_personas'
  ) THEN
    -- (a) уникальность версии роли — ставим всегда (дубли версий редки и их
    --     ловит retry; если исторический дубль есть — IF NOT EXISTS не создаст,
    --     ошибку логируем отдельным NOTICE).
    BEGIN
      EXECUTE $sql$
        CREATE UNIQUE INDEX IF NOT EXISTS "uq_executable_persona_role_version"
        ON "executable_personas" ("scope", "scopeRefId", "version")
        WHERE "scope" = 'role'
      $sql$;
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'uq_executable_persona_role_version: исторические дубли версий — индекс пропущен, встанет после нормализации';
    END;

    -- (b) ровно одна active role-персона — self-skip при существующих дублях.
    EXECUTE $sql$
      SELECT count(*) FROM (
        SELECT 1
        FROM "executable_personas"
        WHERE "scope" = 'role' AND "status" = 'active'
        GROUP BY "scopeRefId"
        HAVING count(*) > 1
      ) d
    $sql$ INTO dup_active;

    IF dup_active > 0 THEN
      RAISE NOTICE 'uq_executable_persona_role_active: % ролей с ≥2 active — индекс пропущен (cron-пересборка нормализует, индекс встанет на следующем прогоне postgres-init)', dup_active;
    ELSE
      EXECUTE $sql$
        CREATE UNIQUE INDEX IF NOT EXISTS "uq_executable_persona_role_active"
        ON "executable_personas" ("scope", "scopeRefId")
        WHERE "status" = 'active' AND "scope" = 'role'
      $sql$;
    END IF;
  END IF;
END $$;
