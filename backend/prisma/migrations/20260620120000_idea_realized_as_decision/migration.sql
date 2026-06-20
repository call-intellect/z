-- ТЗ idea-vs-decision (2026-06-20, форма 5a): связь idea --realized_as--> decision.
-- Идея повышается в решение при акте принятия/сверке; не дубль, а переход.
-- Источник: plans/tz/2026-06-20-idea-vs-decision-disambiguation.md (Ф5)

-- AlterTable
ALTER TABLE "ideas" ADD COLUMN     "realizedAsDecisionId" TEXT;

-- CreateIndex
CREATE INDEX "ideas_tenantId_realizedAsDecisionId_idx" ON "ideas"("tenantId", "realizedAsDecisionId");

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_realizedAsDecisionId_fkey" FOREIGN KEY ("realizedAsDecisionId") REFERENCES "decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
