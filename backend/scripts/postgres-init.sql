-- Z — postgres init script.
-- Запускать ОДНОКРАТНО на свежем инстансе ДО первого `prisma db push`.
-- Также используется prisma db push повторно после: HNSW-индекс на pgvector
-- Prisma не умеет описать сам, поэтому он создаётся отдельным DDL.

-- 1. pgvector extension (требуется для MeetingTranscriptChunk.embedding).
--    На Yandex Cloud Managed PostgreSQL — доступно из коробки.
CREATE EXTENSION IF NOT EXISTS vector;

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
