-- TZ-1 Фаза 3.B (daily-value-engine) — контролёр внедрения решений.
-- Аддитивные nullable/default-колонки на "decisions" — без потери данных,
-- безопасны при migrate deploy (новые поля). См.
-- plans/tz/2026-06-08-agents-daily-value-engine.md (Ф3.B).

-- AlterTable
ALTER TABLE "decisions" ADD COLUMN "linkedTaskCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "decisions" ADD COLUMN "implementationStatus" VARCHAR(24);
ALTER TABLE "decisions" ADD COLUMN "implementationCheckedAt" TIMESTAMP(3);
