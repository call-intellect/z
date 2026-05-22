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
