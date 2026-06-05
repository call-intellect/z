-- Реконсиляция существующих БД до текущей схемы: Ф0 identity-фундамент участника
-- (коммит 158a33d8) на проде применился частично прошлым `db push` — enum
-- `ParticipantInvitationStatus` и/или тип колонки `Participant.invitationStatus`
-- разъехались со схемой → 500 на `POST /meetings` и result-эндпоинте.
--
-- Эта миграция приводит `Participant` к текущей schema.prisma. ИДЕМПОТЕНТНА:
-- на свежей БД 0_init уже создал всё корректно → каждый шаг становится no-op,
-- поэтому миграция безопасна и для чистого `migrate deploy`, и для baseline'нутой
-- существующей БД.
--
-- Затрагивает ТОЛЬКО объекты из schema.prisma. Объекты postgres-init.sql
-- (GIN/HNSW/trgm-индексы, generated-колонки *_search_tsv) НЕ трогаются — их держит
-- отдельный шаг apply-postgres-init.

-- 1. enum-тип (если отсутствует).
DO $$ BEGIN
  CREATE TYPE "ParticipantInvitationStatus" AS ENUM ('none', 'invited', 'joined');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Колонки Ф0 (если отсутствуют).
ALTER TABLE "Participant" ADD COLUMN IF NOT EXISTS "invitationStatus" "ParticipantInvitationStatus" NOT NULL DEFAULT 'none';
ALTER TABLE "Participant" ADD COLUMN IF NOT EXISTS "inviteToken" TEXT;
ALTER TABLE "Participant" ADD COLUMN IF NOT EXISTS "invitedAt" TIMESTAMP(3);
ALTER TABLE "Participant" ADD COLUMN IF NOT EXISTS "deviceCount" INTEGER NOT NULL DEFAULT 1;

-- 3. Привести тип invitationStatus к enum, если колонка существовала как другой
--    тип (например text после частичного db push). enum→text→enum для уже-enum
--    колонки безопасно и идемпотентно.
ALTER TABLE "Participant" ALTER COLUMN "invitationStatus" DROP DEFAULT;
ALTER TABLE "Participant" ALTER COLUMN "invitationStatus" TYPE "ParticipantInvitationStatus"
  USING "invitationStatus"::text::"ParticipantInvitationStatus";
ALTER TABLE "Participant" ALTER COLUMN "invitationStatus" SET DEFAULT 'none';

-- 4. Unique-индекс inviteToken.
CREATE UNIQUE INDEX IF NOT EXISTS "Participant_inviteToken_key" ON "Participant"("inviteToken");
