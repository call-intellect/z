-- ChatBox (2026-06-19): убрать приём вебхуков, оставить только суточный забор по AccessToken.
--   1) нормализуем legacy syncMode (hourly/realtime) → daily (поведения за ними нет).
--   2) дропаем webhook-колонки (приёмник вебхуков и реестр webhookSecret удалены из кода).
-- Внешние вебхуки на стороне ChatBox снимает backfill-chatbox-unregister-webhooks.ts.

UPDATE "ChatboxIntegration" SET "syncMode" = 'daily' WHERE "syncMode" <> 'daily';

-- AlterTable
ALTER TABLE "ChatboxIntegration" DROP COLUMN "webhookExternalId",
DROP COLUMN "webhookSecret";
