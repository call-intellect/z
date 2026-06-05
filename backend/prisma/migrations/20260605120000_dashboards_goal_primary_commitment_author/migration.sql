-- ТЗ-B/D (2026-06-05) — пакет дашбордов: главная цель компании (компас Вектора)
-- + автор обещания (план-факт по людям). Полностью аддитивно, без data-loss.

-- AlterTable
ALTER TABLE "IdeaBlock" ADD COLUMN     "commitmentAuthorPersonId" TEXT;

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "isPrimary" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "IdeaBlock_tenantId_commitmentAuthorPersonId_idx" ON "IdeaBlock"("tenantId", "commitmentAuthorPersonId");

-- CreateIndex
CREATE INDEX "IdeaBlock_tenantId_signalType_commitmentAuthorPersonId_comm_idx" ON "IdeaBlock"("tenantId", "signalType", "commitmentAuthorPersonId", "commitmentDueDate");

-- CreateIndex
CREATE INDEX "Goal_tenantId_isPrimary_idx" ON "Goal"("tenantId", "isPrimary");

-- AddForeignKey
ALTER TABLE "IdeaBlock" ADD CONSTRAINT "IdeaBlock_commitmentAuthorPersonId_fkey" FOREIGN KEY ("commitmentAuthorPersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
