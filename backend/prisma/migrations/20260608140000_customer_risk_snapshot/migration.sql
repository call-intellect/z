-- TZ-1 Фаза 1 (daily-value-engine) — дневной снимок риска клиента.
-- Все изменения аддитивны (CREATE TABLE + CREATE INDEX + ADD FK), без потери
-- данных. migrate deploy идемпотентен (новая таблица). См.
-- plans/tz/2026-06-08-agents-daily-value-engine.md (Ф1).

-- CreateTable
CREATE TABLE "customer_risk_snapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerEntityId" TEXT NOT NULL,
    "dateLocal" VARCHAR(10) NOT NULL,
    "signalCounts" JSONB NOT NULL,
    "windowDays" INTEGER NOT NULL DEFAULT 14,
    "riskScore" DECIMAL(8,4) NOT NULL,
    "riskLevel" VARCHAR(16) NOT NULL,
    "topBlockIdsJson" JSONB NOT NULL,
    "responsiblePersonId" TEXT,
    "deliveredManagerAt" TIMESTAMP(3),
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_risk_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_risk_snapshot_tenantId_customerEntityId_dateLocal_key" ON "customer_risk_snapshot"("tenantId", "customerEntityId", "dateLocal");

-- CreateIndex
CREATE INDEX "customer_risk_snapshot_tenantId_riskLevel_snapshotAt_idx" ON "customer_risk_snapshot"("tenantId", "riskLevel", "snapshotAt" DESC);

-- CreateIndex
CREATE INDEX "customer_risk_snapshot_tenantId_responsiblePersonId_idx" ON "customer_risk_snapshot"("tenantId", "responsiblePersonId");

-- AddForeignKey
ALTER TABLE "customer_risk_snapshot" ADD CONSTRAINT "customer_risk_snapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_risk_snapshot" ADD CONSTRAINT "customer_risk_snapshot_customerEntityId_fkey" FOREIGN KEY ("customerEntityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_risk_snapshot" ADD CONSTRAINT "customer_risk_snapshot_responsiblePersonId_fkey" FOREIGN KEY ("responsiblePersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
