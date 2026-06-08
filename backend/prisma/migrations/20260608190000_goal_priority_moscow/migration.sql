-- ТЗ-2 Ф6.A (daily-value-dashboards) — MoSCoW-приоритет целей + снимок здоровья портфеля.
-- Все изменения аддитивны (CREATE TYPE + ADD COLUMN nullable + CREATE TABLE),
-- без потери данных. migrate deploy идемпотентен (новый enum/колонка/таблица).
-- См. plans/tz/2026-06-08-* (ТЗ-2 Ф6.A).

-- CreateEnum
CREATE TYPE "GoalPriority" AS ENUM ('must', 'should', 'could', 'wont');

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN "priority" "GoalPriority";

-- CreateTable
CREATE TABLE "portfolio_health_snapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dateLocal" VARCHAR(10) NOT NULL,
    "healthScore" INTEGER NOT NULL,
    "byStatusJson" JSONB NOT NULL,
    "byPriorityJson" JSONB NOT NULL,
    "goalsCount" INTEGER NOT NULL DEFAULT 0,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_health_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_health_snapshot_tenantId_dateLocal_key" ON "portfolio_health_snapshot"("tenantId", "dateLocal");

-- CreateIndex
CREATE INDEX "portfolio_health_snapshot_tenantId_snapshotAt_idx" ON "portfolio_health_snapshot"("tenantId", "snapshotAt" DESC);

-- AddForeignKey
ALTER TABLE "portfolio_health_snapshot" ADD CONSTRAINT "portfolio_health_snapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
