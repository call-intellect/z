-- Bitrix24-источник Ф3.5 (ТЗ 2026-06-17, пересмотр): накопительное саммари
-- (rollingSummary) на диалоге/чате + зеркала CRM-лидов и заметок. Только аддитив;
-- out-of-band HNSW/GIN/tsvector из postgres-init.sql НЕ трогаются.
--
-- AGE-трап: на базе с Apache AGE безымянные CREATE уходят в ag_catalog. Чтобы
-- объекты сразу легли в public — фиксируем search_path на время миграции.
SET search_path TO "public";

-- AlterTable
ALTER TABLE "BitrixDialog" ADD COLUMN     "rollingSummary" TEXT,
ADD COLUMN     "rollingSummaryAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ChatboxChat" ADD COLUMN     "rollingSummary" TEXT,
ADD COLUMN     "rollingSummaryAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BitrixLead" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT,
    "name" TEXT,
    "statusId" TEXT,
    "raw" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BitrixLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BitrixCrmNote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "authorId" TEXT,
    "text" TEXT,
    "occurredAt" TIMESTAMP(3),
    "raw" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BitrixCrmNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BitrixLead_tenantId_externalId_key" ON "BitrixLead"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX "BitrixCrmNote_tenantId_occurredAt_idx" ON "BitrixCrmNote"("tenantId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "BitrixCrmNote_tenantId_kind_externalId_key" ON "BitrixCrmNote"("tenantId", "kind", "externalId");

-- AddForeignKey
ALTER TABLE "BitrixLead" ADD CONSTRAINT "BitrixLead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BitrixCrmNote" ADD CONSTRAINT "BitrixCrmNote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
