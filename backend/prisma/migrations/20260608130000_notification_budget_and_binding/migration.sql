-- TZ-1 Фаза 0 (daily-value-engine) — дневной бюджет уведомлений + кампания
-- привязки канала. Все изменения аддитивны (ADD COLUMN / CREATE TABLE), без
-- потери данных. См. plans/tz/2026-06-08-agents-daily-value-engine.md.

-- AlterTable
ALTER TABLE "persons" ADD COLUMN     "channelBindingCampaignState" VARCHAR(20),
ADD COLUMN     "channelBindingInvitedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "priorityTier" INTEGER DEFAULT 2;

-- CreateTable
CREATE TABLE "notification_budget_ledger" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "dateLocal" VARCHAR(10) NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "byTrigger" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_budget_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_budget_ledger_tenantId_dateLocal_idx" ON "notification_budget_ledger"("tenantId", "dateLocal");

-- CreateIndex
CREATE UNIQUE INDEX "notification_budget_ledger_tenantId_personId_dateLocal_key" ON "notification_budget_ledger"("tenantId", "personId", "dateLocal");

-- AddForeignKey
ALTER TABLE "notification_budget_ledger" ADD CONSTRAINT "notification_budget_ledger_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_budget_ledger" ADD CONSTRAINT "notification_budget_ledger_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
