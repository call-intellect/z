-- Bitrix24-источник Ф4b (ТЗ 2026-06-17): дельта-синк CRM по DATE_MODIFY +
-- посуточный дайджест изменений. Только аддитив.
--
-- AGE-трап: фиксируем search_path, чтобы DDL шёл в public (а не ag_catalog).
SET search_path TO "public";

-- AlterTable — курсоры дельты/дайджеста на интеграции.
ALTER TABLE "BitrixIntegration" ADD COLUMN     "lastCrmSyncAt" TIMESTAMP(3),
ADD COLUMN     "lastCrmDigestAt" TIMESTAMP(3);

-- AlterTable — DATE_MODIFY на CRM-зеркалах.
ALTER TABLE "BitrixContact" ADD COLUMN     "modifiedAt" TIMESTAMP(3);
ALTER TABLE "BitrixCompany" ADD COLUMN     "modifiedAt" TIMESTAMP(3);
ALTER TABLE "BitrixDeal" ADD COLUMN     "modifiedAt" TIMESTAMP(3);
ALTER TABLE "BitrixLead" ADD COLUMN     "modifiedAt" TIMESTAMP(3);

-- CreateIndex — выборка изменений за день для дайджеста.
CREATE INDEX "BitrixContact_tenantId_modifiedAt_idx" ON "BitrixContact"("tenantId", "modifiedAt");
CREATE INDEX "BitrixCompany_tenantId_modifiedAt_idx" ON "BitrixCompany"("tenantId", "modifiedAt");
CREATE INDEX "BitrixDeal_tenantId_modifiedAt_idx" ON "BitrixDeal"("tenantId", "modifiedAt");
CREATE INDEX "BitrixLead_tenantId_modifiedAt_idx" ON "BitrixLead"("tenantId", "modifiedAt");
