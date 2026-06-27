-- ════════════════════════════════════════════════════════════════════════════
-- Ф2 — Слой источника: SourceEpisode / SourceParticipant / SourceEntity.
--
-- AUTHORED WITHOUT LOCAL DB — миграция написана без доступа к локальной БД.
--   Требует прогона на staging / пустом проде ДО выката (нет авто-диффа Prisma).
--
-- SourceEpisode создаётся СРАЗУ HASH-партиционированной по tenantId (64 партиции),
--   составной PK (id, tenantId) — новая таблица, данных нет, swap не нужен.
-- SourceParticipant / SourceEntity — обычные таблицы, составные PK.
--
-- HNSW на SourceEpisode.embedding здесь НЕ создаётся — он в
--   backend/scripts/postgres-init.sql (идемпотентно, IF NOT EXISTS).
--
-- Идемпотентность: CREATE TABLE IF NOT EXISTS, партиции IF NOT EXISTS,
--   индексы CREATE INDEX IF NOT EXISTS, FK — guard через DROP CONSTRAINT IF EXISTS
--   перед ADD CONSTRAINT.
--
-- Имена таблиц: RawEvent → "RawEvent" (без @@map), Person → "persons" (@@map),
--   Entity → "Entity" (без @@map), Org → "Org" (без @@map).
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- ШАГ 1. SourceEpisode — PARTITION BY HASH (tenantId), составной PK (id, tenantId).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SourceEpisode" (
  "id"                    TEXT         NOT NULL,
  "tenantId"              TEXT         NOT NULL,
  "rawEventId"            TEXT         NOT NULL,
  "kind"                  VARCHAR(16)  NOT NULL,
  "title"                 TEXT         NOT NULL,
  "occurredAt"            TIMESTAMP(3) NOT NULL,
  "summary"              TEXT,
  "embedding"             vector(1536),
  "embeddingModelVersion" VARCHAR(40),
  "branch"                "ThemeBranch",
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("id", "tenantId")
) PARTITION BY HASH ("tenantId");

DO $$
BEGIN
  FOR i IN 0..63 LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS "SourceEpisode_p%s" PARTITION OF "SourceEpisode" FOR VALUES WITH (MODULUS 64, REMAINDER %s)',
      i, i);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "SourceEpisode_rawEventId_tenantId_key"
  ON "SourceEpisode"("rawEventId", "tenantId");
CREATE INDEX IF NOT EXISTS "SourceEpisode_tenantId_occurredAt_idx"
  ON "SourceEpisode"("tenantId", "occurredAt");
CREATE INDEX IF NOT EXISTS "SourceEpisode_tenantId_kind_occurredAt_idx"
  ON "SourceEpisode"("tenantId", "kind", "occurredAt");

ALTER TABLE "SourceEpisode" DROP CONSTRAINT IF EXISTS "SourceEpisode_tenantId_fkey";
ALTER TABLE "SourceEpisode" ADD CONSTRAINT "SourceEpisode_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceEpisode" DROP CONSTRAINT IF EXISTS "SourceEpisode_rawEventId_fkey";
ALTER TABLE "SourceEpisode" ADD CONSTRAINT "SourceEpisode_rawEventId_fkey"
  FOREIGN KEY ("rawEventId") REFERENCES "RawEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- ШАГ 2. SourceParticipant — обычная таблица, составной PK (rawEventId, personId).
--        FK на Person — простой (Person PK простой), таблица "persons".
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SourceParticipant" (
  "rawEventId"    TEXT          NOT NULL,
  "personId"      TEXT          NOT NULL,
  "tenantId"      TEXT          NOT NULL,
  "role"          VARCHAR(16)   NOT NULL,
  "speakingShare" DECIMAL(4, 3),
  "createdAt"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("rawEventId", "personId")
);

CREATE INDEX IF NOT EXISTS "SourceParticipant_tenantId_personId_createdAt_idx"
  ON "SourceParticipant"("tenantId", "personId", "createdAt");

ALTER TABLE "SourceParticipant" DROP CONSTRAINT IF EXISTS "SourceParticipant_tenantId_fkey";
ALTER TABLE "SourceParticipant" ADD CONSTRAINT "SourceParticipant_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceParticipant" DROP CONSTRAINT IF EXISTS "SourceParticipant_rawEventId_fkey";
ALTER TABLE "SourceParticipant" ADD CONSTRAINT "SourceParticipant_rawEventId_fkey"
  FOREIGN KEY ("rawEventId") REFERENCES "RawEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceParticipant" DROP CONSTRAINT IF EXISTS "SourceParticipant_personId_fkey";
ALTER TABLE "SourceParticipant" ADD CONSTRAINT "SourceParticipant_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- ШАГ 3. SourceEntity — обычная таблица, составной PK (rawEventId, entityId).
--        FK на Entity — составной (entityId, tenantId), Entity PK составной.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SourceEntity" (
  "rawEventId"    TEXT         NOT NULL,
  "entityId"      TEXT         NOT NULL,
  "tenantId"      TEXT         NOT NULL,
  "mentionsCount" INTEGER      NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("rawEventId", "entityId")
);

CREATE INDEX IF NOT EXISTS "SourceEntity_tenantId_entityId_createdAt_idx"
  ON "SourceEntity"("tenantId", "entityId", "createdAt");

ALTER TABLE "SourceEntity" DROP CONSTRAINT IF EXISTS "SourceEntity_tenantId_fkey";
ALTER TABLE "SourceEntity" ADD CONSTRAINT "SourceEntity_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceEntity" DROP CONSTRAINT IF EXISTS "SourceEntity_rawEventId_fkey";
ALTER TABLE "SourceEntity" ADD CONSTRAINT "SourceEntity_rawEventId_fkey"
  FOREIGN KEY ("rawEventId") REFERENCES "RawEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceEntity" DROP CONSTRAINT IF EXISTS "SourceEntity_entityId_tenantId_fkey";
ALTER TABLE "SourceEntity" ADD CONSTRAINT "SourceEntity_entityId_tenantId_fkey"
  FOREIGN KEY ("entityId", "tenantId") REFERENCES "Entity"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
