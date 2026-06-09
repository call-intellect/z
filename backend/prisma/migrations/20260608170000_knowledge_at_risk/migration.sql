-- TZ-1 Фаза 4.C (daily-value-engine) — знание-под-риском × уход человека.
-- Все изменения аддитивны (CREATE TABLE + CREATE INDEX + ADD FK), без потери
-- данных. migrate deploy идемпотентен (новая таблица). См.
-- plans/tz/2026-06-08-agents-daily-value-engine.md (Ф4.C).

-- CreateTable
CREATE TABLE "knowledge_at_risk_snapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categoryName" TEXT NOT NULL,
    "soleExpertPersonId" TEXT,
    "busFactorLevel" VARCHAR(16) NOT NULL,
    "personRiskLevel" VARCHAR(16),
    "combinedSeverity" VARCHAR(16) NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_at_risk_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_at_risk_snapshot_tenantId_combinedSeverity_snapsh_idx" ON "knowledge_at_risk_snapshot"("tenantId", "combinedSeverity", "snapshotAt");

-- AddForeignKey
ALTER TABLE "knowledge_at_risk_snapshot" ADD CONSTRAINT "knowledge_at_risk_snapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_at_risk_snapshot" ADD CONSTRAINT "knowledge_at_risk_snapshot_soleExpertPersonId_fkey" FOREIGN KEY ("soleExpertPersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
