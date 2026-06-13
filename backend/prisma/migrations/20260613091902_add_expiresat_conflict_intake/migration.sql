-- AlterTable
ALTER TABLE "ConflictItem" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "IntakeIssue" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ConflictItem_tenantId_status_expiresAt_idx" ON "ConflictItem"("tenantId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "IntakeIssue_tenantId_status_expiresAt_idx" ON "IntakeIssue"("tenantId", "status", "expiresAt");
