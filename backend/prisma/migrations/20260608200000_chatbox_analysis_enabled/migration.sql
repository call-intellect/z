-- ChatBox-интеграция: per-integration тумблер AI-анализа переписок.
-- По умолчанию ВЫКЛ: синк зеркалит чаты, но LLM-summary + мост в knowledge-core
-- не запускаются, пока владелец явно не включит анализ в настройках интеграции.

-- AlterTable
ALTER TABLE "ChatboxIntegration" ADD COLUMN "analysisEnabled" BOOLEAN NOT NULL DEFAULT false;
