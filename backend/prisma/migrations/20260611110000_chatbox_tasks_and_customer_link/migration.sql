-- ТЗ 2026-06-11-chatbox-memory-finishing-and-tasks-from-chat, Ф1 + Ф5.
-- Опасное изменение core-таблицы Task: только nullable-добавление, без DROP,
-- meetingId НЕ удаляем (становится nullable). Backfill существующих Task →
-- sourceType='meeting' выполняет backfill-task-source-type.ts (apply-prod-deploy STEPS).
-- Все шаги idempotent-guarded (IF NOT EXISTS / IF EXISTS) — повторный прогон no-op.

-- 1) Task: источник теперь не только встреча.
ALTER TABLE "Task" ALTER COLUMN "meetingId" DROP NOT NULL;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "sourceType" TEXT NOT NULL DEFAULT 'meeting';
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "sourceChatSessionId" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "sourceChatId" TEXT;
CREATE INDEX IF NOT EXISTS "Task_tenantId_sourceType_idx" ON "Task"("tenantId", "sourceType");
CREATE INDEX IF NOT EXISTS "Task_sourceChatSessionId_idx" ON "Task"("sourceChatSessionId");

-- 2) TaskSource — дополнительные источники задачи (межисточниковый дедуп).
CREATE TABLE IF NOT EXISTS "TaskSource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceRefId" TEXT NOT NULL,
    "chatId" TEXT,
    "quote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskSource_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TaskSource_taskId_sourceType_sourceRefId_key"
    ON "TaskSource"("taskId", "sourceType", "sourceRefId");
CREATE INDEX IF NOT EXISTS "TaskSource_tenantId_sourceType_sourceRefId_idx"
    ON "TaskSource"("tenantId", "sourceType", "sourceRefId");
DO $$ BEGIN
    ALTER TABLE "TaskSource" ADD CONSTRAINT "TaskSource_taskId_fkey"
        FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) ChatboxCustomer / ChatboxChannelClient — связка клиента с Person (Ф1).
ALTER TABLE "ChatboxCustomer" ADD COLUMN IF NOT EXISTS "linkedPersonId" TEXT;
ALTER TABLE "ChatboxCustomer" ADD COLUMN IF NOT EXISTS "linkMode" "ChatboxMemberLinkMode" NOT NULL DEFAULT 'none';
CREATE INDEX IF NOT EXISTS "ChatboxCustomer_tenantId_linkedPersonId_idx"
    ON "ChatboxCustomer"("tenantId", "linkedPersonId");
ALTER TABLE "ChatboxChannelClient" ADD COLUMN IF NOT EXISTS "linkedPersonId" TEXT;
ALTER TABLE "ChatboxChannelClient" ADD COLUMN IF NOT EXISTS "linkMode" "ChatboxMemberLinkMode" NOT NULL DEFAULT 'none';
CREATE INDEX IF NOT EXISTS "ChatboxChannelClient_tenantId_linkedPersonId_idx"
    ON "ChatboxChannelClient"("tenantId", "linkedPersonId");
