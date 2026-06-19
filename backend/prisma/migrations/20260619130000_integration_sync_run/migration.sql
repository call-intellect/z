-- IntegrationSyncRun (2026-06-19): журнал прогонов источников Bitrix/ChatBox (sync + analyze).
-- Закрывает дыру наблюдаемости: детальный результат прогона ранее жил только в pino-stdout.
-- Источник правды: plans/tz/2026-06-19-integration-sync-observability.md

-- CreateTable
CREATE TABLE "IntegrationSyncRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" TEXT,
    "refId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "status" TEXT NOT NULL,
    "counts" JSONB,
    "error" TEXT,

    CONSTRAINT "IntegrationSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationSyncRun_tenantId_provider_startedAt_idx" ON "IntegrationSyncRun"("tenantId", "provider", "startedAt");

-- CreateIndex
CREATE INDEX "IntegrationSyncRun_provider_kind_status_startedAt_idx" ON "IntegrationSyncRun"("provider", "kind", "status", "startedAt");
