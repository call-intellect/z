-- Bitrix24-источник: синк IM-чатов + CRM (ТЗ plans/tz/2026-06-17-bitrix24-source-sync.md, Ф0).
-- Только аддитив. Out-of-band индексы/колонки из postgres-init.sql (HNSW/GIN/tsvector)
-- НЕ трогаются — они вне schema.prisma по дизайну.

-- CreateEnum
CREATE TYPE "BitrixLinkMode" AS ENUM ('none', 'auto', 'manual');

-- CreateEnum
CREATE TYPE "BitrixDialogType" AS ENUM ('chat', 'private');

-- CreateEnum
CREATE TYPE "BitrixDialogAnalysisStatus" AS ENUM ('pending', 'analyzing', 'done', 'failed');

-- AlterTable
ALTER TABLE "BitrixIntegration" ADD COLUMN     "analysisEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastFullSyncAt" TIMESTAMP(3),
ADD COLUMN     "lastIncrementalSyncAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BitrixUser" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "position" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "linkedPersonId" TEXT,
    "linkMode" "BitrixLinkMode" NOT NULL DEFAULT 'none',
    "raw" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BitrixUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BitrixDialog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "type" "BitrixDialogType" NOT NULL DEFAULT 'chat',
    "title" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "raw" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BitrixDialog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BitrixDialogSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dialogId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "analysisStatus" "BitrixDialogAnalysisStatus" NOT NULL DEFAULT 'pending',
    "summary" TEXT,
    "rawEventId" TEXT,
    "analyzedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BitrixDialogSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BitrixMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dialogId" TEXT NOT NULL,
    "sessionId" TEXT,
    "externalId" TEXT NOT NULL,
    "authorExternalId" TEXT,
    "authorName" TEXT,
    "text" TEXT,
    "externalCreatedAt" TIMESTAMP(3) NOT NULL,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BitrixMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BitrixContact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "raw" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BitrixContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BitrixCompany" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT,
    "raw" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BitrixCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BitrixDeal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT,
    "stageId" TEXT,
    "raw" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BitrixDeal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BitrixUser_tenantId_linkedPersonId_idx" ON "BitrixUser"("tenantId", "linkedPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "BitrixUser_tenantId_externalId_key" ON "BitrixUser"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX "BitrixDialog_tenantId_lastMessageAt_idx" ON "BitrixDialog"("tenantId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "BitrixDialog_tenantId_externalId_key" ON "BitrixDialog"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX "BitrixDialogSession_tenantId_analysisStatus_idx" ON "BitrixDialogSession"("tenantId", "analysisStatus");

-- CreateIndex
CREATE UNIQUE INDEX "BitrixDialogSession_tenantId_dialogId_seq_key" ON "BitrixDialogSession"("tenantId", "dialogId", "seq");

-- CreateIndex
CREATE INDEX "BitrixMessage_tenantId_dialogId_externalCreatedAt_idx" ON "BitrixMessage"("tenantId", "dialogId", "externalCreatedAt");

-- CreateIndex
CREATE INDEX "BitrixMessage_tenantId_sessionId_idx" ON "BitrixMessage"("tenantId", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "BitrixMessage_tenantId_externalId_key" ON "BitrixMessage"("tenantId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "BitrixContact_tenantId_externalId_key" ON "BitrixContact"("tenantId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "BitrixCompany_tenantId_externalId_key" ON "BitrixCompany"("tenantId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "BitrixDeal_tenantId_externalId_key" ON "BitrixDeal"("tenantId", "externalId");

-- AddForeignKey
ALTER TABLE "BitrixUser" ADD CONSTRAINT "BitrixUser_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BitrixDialog" ADD CONSTRAINT "BitrixDialog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BitrixDialogSession" ADD CONSTRAINT "BitrixDialogSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BitrixDialogSession" ADD CONSTRAINT "BitrixDialogSession_dialogId_fkey" FOREIGN KEY ("dialogId") REFERENCES "BitrixDialog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BitrixMessage" ADD CONSTRAINT "BitrixMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BitrixMessage" ADD CONSTRAINT "BitrixMessage_dialogId_fkey" FOREIGN KEY ("dialogId") REFERENCES "BitrixDialog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BitrixContact" ADD CONSTRAINT "BitrixContact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BitrixCompany" ADD CONSTRAINT "BitrixCompany_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BitrixDeal" ADD CONSTRAINT "BitrixDeal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
