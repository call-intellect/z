-- ТЗ-F (2026-06-05) — Цели: ответственный (ownerPersonId) + кэш числа блоков
-- (cachedBlocksCount). Полностью аддитивно, без data-loss.

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "ownerPersonId" TEXT,
ADD COLUMN     "cachedBlocksCount" INTEGER;

-- CreateIndex
CREATE INDEX "Goal_tenantId_ownerPersonId_idx" ON "Goal"("tenantId", "ownerPersonId");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
