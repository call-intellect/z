SET search_path = public;

-- AlterTable
ALTER TABLE "ChatboxChat" ADD COLUMN     "title" TEXT;

-- Backfill from raw client name
UPDATE "ChatboxChat"
SET "title" = raw->'client'->>'name'
WHERE raw->'client'->>'name' IS NOT NULL;
