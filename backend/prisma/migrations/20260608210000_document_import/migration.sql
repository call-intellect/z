-- ТЗ-4 Ф7 (manual-document-upload-and-import) — batch-импорт ZIP-архива в N
-- Document'ов. Все изменения аддитивны (CREATE TYPE + CREATE TABLE + CREATE
-- INDEX + ADD FK), без потери данных. migrate deploy идемпотентен (новые типы
-- и таблица). См. plans/tz/2026-06-08-*manual-document-upload-and-import.

-- CreateEnum
CREATE TYPE "DocumentImportSource" AS ENUM ('upload_zip', 'notion', 'confluence');

-- CreateEnum
CREATE TYPE "DocumentImportStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "document_import" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" "DocumentImportSource" NOT NULL,
    "status" "DocumentImportStatus" NOT NULL DEFAULT 'pending',
    "totalFiles" INTEGER NOT NULL DEFAULT 0,
    "doneFiles" INTEGER NOT NULL DEFAULT 0,
    "failedFiles" INTEGER NOT NULL DEFAULT 0,
    "errorLog" JSONB,
    "createdById" TEXT NOT NULL,
    "attachedThemeId" TEXT,
    "attachedProjectId" TEXT,
    "docType" "DocumentType",
    "zipS3Key" VARCHAR(500),
    "zipInline" BYTEA,
    "zipSize" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_import_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_import_tenantId_status_idx" ON "document_import"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "document_import" ADD CONSTRAINT "document_import_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
