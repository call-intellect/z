-- TZ-1 Фаза 5 (daily-value-engine) — оценка «помог ли ответ» на сообщениях
-- AI-чата (ChatV2Message). Нужно для честного helped-rate в месячной витрине
-- (value-recap). Все изменения аддитивны (ADD COLUMN nullable), без потери
-- данных, без дефолтов на существующих строках. migrate deploy идемпотентен
-- (IF NOT EXISTS). См. plans/tz/2026-06-08-agents-daily-value-engine.md (Ф5).
--
-- Эталон формы фидбека — AiResultFeedback (reaction/comment), но здесь оценка
-- хранится прямо на сообщении (1 пользователь = автор беседы, upsert по
-- (messageId, userId) обеспечивается на уровне сервиса проверкой владения).

-- AlterTable
ALTER TABLE "ChatV2Message" ADD COLUMN IF NOT EXISTS "helpful" VARCHAR(8);
ALTER TABLE "ChatV2Message" ADD COLUMN IF NOT EXISTS "helpfulAt" TIMESTAMP(3);
ALTER TABLE "ChatV2Message" ADD COLUMN IF NOT EXISTS "helpfulComment" TEXT;
