-- TZ-1 Фаза 5 (daily-value-engine) — месячный снимок «что Кора сделала за
-- месяц» (value-recap) для дельты к прошлому месяцу, идемпотентности и
-- фиксации openedAt. Все изменения аддитивны (CREATE TABLE + CREATE INDEX +
-- ADD FK), без потери данных. migrate deploy идемпотентен (новая таблица). См.
-- plans/tz/2026-06-08-agents-daily-value-engine.md (Ф5).
--
-- payloadJson хранит твёрдые счётчики «снятой рутины» + soft-слой «команда
-- лучше» (с плашкой «оценка» + знаменателем). Запрещённых метрик (₽, было→стало,
-- medianHoursToAnswer, roiScore/alignment как KPI) в payload НЕТ — гарантия в
-- коде (ValueRecapService) + unit-тест.

-- CreateTable
CREATE TABLE "value_recap_snapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodYm" VARCHAR(7) NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "value_recap_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "value_recap_snapshot_tenantId_periodYm_key" ON "value_recap_snapshot"("tenantId", "periodYm");

-- CreateIndex
CREATE INDEX "value_recap_snapshot_tenantId_createdAt_idx" ON "value_recap_snapshot"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "value_recap_snapshot" ADD CONSTRAINT "value_recap_snapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
