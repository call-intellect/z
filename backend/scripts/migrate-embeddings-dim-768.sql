-- Миграция размерности embedding-колонок: vector(1536) → vector(768).
--
-- TZ plans/tz/2026-06-30-embeddinggemma-768-migration.md.
-- Сгенерировано автоматически через pg_attribute (25 колонок, public-схема, relkind='r').
--
-- Эффекты:
--   * Все существующие эмбеддинги обнуляются (USING NULL) — pgvector не кастит
--     между размерностями. Семантический поиск работает в degraded-режиме
--     (vector=NULL → KNN-skip, fallback на BM25/tsvector) до завершения backfill.
--   * HNSW-индексы НЕ трогаем — pgvector сам пересчитает их при следующем
--     VACUUM/ANALYZE. Содержимое индекса остаётся консистентным с колонкой
--     (после ALTER TYPE индекс пересканируется автоматически).
--
-- Применение (через docker exec — никаких прямых bun/CD в проде):
--   docker compose exec backend psql "$DATABASE_URL" -f scripts/migrate-embeddings-dim-768.sql
--
-- После: ОБЯЗАТЕЛЬНО запустить backfill (тоже через apply-prod-deploy STEPS):
--   docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update
--   → прогонит backfill-embeddings-gemma-768.ts (phase='backfill', skipBootstrap:true).
--
-- Rollback (если что-то пошло не так):
--   * Только в обратную сторону — vector(768) → vector(1536). Все текущие
--     768-вектора обнулятся; старых 1536 уже нет (мы их переписали).
--   * Реальный rollback без потерь невозможен без смены модели обратно на
--     text-embedding-3-small + пересчёта всех эмбеддингов через OpenAI-proxy.

ALTER TABLE public."Entity" ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE public."Goal" ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE public."HelpfulnessTrait" ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE public."IdeaBlock" ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE public."Issue" ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE public."MeetingTranscriptChunk" ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE public."PromptFeedback" ALTER COLUMN "inputEmbedding" TYPE vector(768) USING NULL;
ALTER TABLE public."PromptRule" ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE public."Theme" ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE public.decisions ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE public.idea_clusters ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE public.ideas ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE public.insights ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE public.instructions ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE public.person_knowledge_category_embeddings ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE public.policies ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE public.practice_skills ALTER COLUMN "triggerEmbedding" TYPE vector(768) USING NULL;
ALTER TABLE public.probe_events ALTER COLUMN "questionEmbedding" TYPE vector(768) USING NULL;
ALTER TABLE public.process_templates ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE public.processes ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE public.regulations ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE public.role_principles ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE public.skill_trait_concepts ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE public.skill_traits ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE public.subject_memory ALTER COLUMN embedding TYPE vector(768) USING NULL;