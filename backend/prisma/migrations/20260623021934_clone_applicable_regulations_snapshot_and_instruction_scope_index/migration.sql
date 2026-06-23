-- AlterTable
ALTER TABLE "executable_personas" ADD COLUMN     "applicableRegulationsSnapshot" JSONB;

-- CreateIndex
CREATE INDEX "instructions_tenantId_scope_idx" ON "instructions"("tenantId", "scope");
