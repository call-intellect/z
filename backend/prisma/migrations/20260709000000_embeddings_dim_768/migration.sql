SET search_path TO public;

-- Все эмбеддинг-колонки мигрируются с vector(1536) на vector(768) под модель
-- embeddinggemma (llm.korateam.ru). Раньше дефолтная модель была
-- text-embedding-3-small (1536), но мы переехали на 768 (TZ 2026-06-30).
--
-- USINGS NULL — pgvector не кастит между размерностями, существующие вектора
-- обнуляются. В dev-окружениях эмбеддингов ещё нет (миграция применяется до
-- любых сидов); в проде это backfill-скриптом
-- (scripts/backfill-embeddings-gemma-768.ts, фаза 'backfill' в
-- apply-prod-deploy.ts). HNSW-индексы пересчитываются автоматически на
-- следующем VACUUM/ANALYZE.
--
-- Сгенерировано из scripts/migrate-embeddings-dim-768.sql (27 колонок,
-- public-схема, relkind='r'); SourceEpisode/IntakeIssue добавлены вручную.

ALTER TABLE "Entity" ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE "Goal" ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE "HelpfulnessTrait" ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE "IdeaBlock" ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE "IntakeIssue" ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE "Issue" ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE "MeetingTranscriptChunk" ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE "PromptFeedback" ALTER COLUMN "inputEmbedding" TYPE vector(768) USING NULL;
ALTER TABLE "PromptRule" ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE "SourceEpisode" ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE "Theme" ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE decisions ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE idea_clusters ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE ideas ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE insights ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE instructions ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE person_knowledge_category_embeddings ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE policies ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE practice_skills ALTER COLUMN "triggerEmbedding" TYPE vector(768) USING NULL;
ALTER TABLE probe_events ALTER COLUMN "questionEmbedding" TYPE vector(768) USING NULL;
ALTER TABLE process_templates ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE processes ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE regulations ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE role_principles ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE skill_trait_concepts ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE skill_traits ALTER COLUMN embedding TYPE vector(768) USING NULL;
ALTER TABLE subject_memory ALTER COLUMN embedding TYPE vector(768) USING NULL;
