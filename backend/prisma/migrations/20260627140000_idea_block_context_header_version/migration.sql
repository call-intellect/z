-- ════════════════════════════════════════════════════════════════════════════
-- Ф7 — Contextual-header v2: флаг версии header, которым сэмбеден блок.
--
-- AUTHORED WITHOUT LOCAL DB — миграция написана без доступа к локальной БД.
--   Требует прогона на staging / пустом проде ДО выката (нет авто-диффа Prisma).
--
-- IdeaBlock HASH-партиционирован по tenantId (Ф1): ADD COLUMN на родителе
--   распространяется на все партиции автоматически. NULL = блок сэмбеден
--   старым header (≠ CONTEXT_HEADER_VERSION) → попадёт в backfill ре-эмбеддинга
--   (backfill-context-header-reembed.ts).
--
-- Идемпотентность: ADD COLUMN IF NOT EXISTS.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "IdeaBlock" ADD COLUMN IF NOT EXISTS "contextHeaderVersion" VARCHAR(16);
