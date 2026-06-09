-- TZ-1 Фаза 2 (daily-value-engine) — идемпотентный персональный дневной бриф
-- «Твой день». Все изменения аддитивны (CREATE TABLE + CREATE INDEX + ADD FK),
-- без потери данных. migrate deploy идемпотентен (новая таблица). См.
-- plans/tz/2026-06-08-agents-daily-value-engine.md (Ф2).

-- CreateTable
CREATE TABLE "personal_daily_brief" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "dateLocal" VARCHAR(10) NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personal_daily_brief_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "personal_daily_brief_tenantId_personId_dateLocal_key" ON "personal_daily_brief"("tenantId", "personId", "dateLocal");

-- CreateIndex
CREATE INDEX "personal_daily_brief_tenantId_dateLocal_idx" ON "personal_daily_brief"("tenantId", "dateLocal");

-- AddForeignKey
ALTER TABLE "personal_daily_brief" ADD CONSTRAINT "personal_daily_brief_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_daily_brief" ADD CONSTRAINT "personal_daily_brief_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
