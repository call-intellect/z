-- TZ-1 Фаза 3.A (daily-value-engine) — накопительный синтез блокеров.
-- Все изменения аддитивны (CREATE TABLE + CREATE INDEX + ADD FK), без потери
-- данных. migrate deploy идемпотентен (новая таблица). См.
-- plans/tz/2026-06-08-agents-daily-value-engine.md (Ф3.A).

-- CreateTable
CREATE TABLE "blocker_synthesis" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clusterKey" TEXT NOT NULL,
    "representativeText" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "firstSeenDateLocal" VARCHAR(10) NOT NULL,
    "lastSeenDateLocal" VARCHAR(10) NOT NULL,
    "daysOpen" INTEGER NOT NULL DEFAULT 0,
    "businessImpactScore" DECIMAL(8,4) NOT NULL,
    "relatedBlockIdsJson" JSONB NOT NULL,
    "linkedInsightId" TEXT,
    "responsiblePersonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blocker_synthesis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "blocker_synthesis_tenantId_clusterKey_key" ON "blocker_synthesis"("tenantId", "clusterKey");

-- CreateIndex
CREATE INDEX "blocker_synthesis_tenantId_status_lastSeenDateLocal_idx" ON "blocker_synthesis"("tenantId", "status", "lastSeenDateLocal");

-- AddForeignKey
ALTER TABLE "blocker_synthesis" ADD CONSTRAINT "blocker_synthesis_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocker_synthesis" ADD CONSTRAINT "blocker_synthesis_responsiblePersonId_fkey" FOREIGN KEY ("responsiblePersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
