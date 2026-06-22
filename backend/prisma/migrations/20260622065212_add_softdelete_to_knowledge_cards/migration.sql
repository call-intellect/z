-- AlterTable
ALTER TABLE "decisions" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;

-- AlterTable
ALTER TABLE "instructions" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;

-- AlterTable
ALTER TABLE "policies" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;

-- AlterTable
ALTER TABLE "processes" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;

-- AlterTable
ALTER TABLE "regulations" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;

-- CreateIndex
CREATE INDEX "decisions_tenantId_deletedAt_idx" ON "decisions"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "instructions_tenantId_deletedAt_idx" ON "instructions"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "policies_tenantId_deletedAt_idx" ON "policies"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "processes_tenantId_deletedAt_idx" ON "processes"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "regulations_tenantId_deletedAt_idx" ON "regulations"("tenantId", "deletedAt");
