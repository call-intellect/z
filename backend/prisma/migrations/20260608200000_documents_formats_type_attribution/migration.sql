-- ТЗ-4 Ф1 (manual-document-upload) — форматы, смысловой тип, привязки, хэш. Аддитивно.

-- AlterEnum (новые форматы DocumentKind)
ALTER TYPE "DocumentKind" ADD VALUE 'xlsx';
ALTER TYPE "DocumentKind" ADD VALUE 'pptx';
ALTER TYPE "DocumentKind" ADD VALUE 'html';
ALTER TYPE "DocumentKind" ADD VALUE 'rtf';
ALTER TYPE "DocumentKind" ADD VALUE 'odt';
ALTER TYPE "DocumentKind" ADD VALUE 'csv';

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('regulation', 'policy', 'instruction', 'process', 'job_description', 'other');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN "docType" "DocumentType";
ALTER TABLE "documents" ADD COLUMN "attachedThemeId" TEXT;
ALTER TABLE "documents" ADD COLUMN "attachedProjectId" TEXT;
ALTER TABLE "documents" ADD COLUMN "contentHash" TEXT;
ALTER TABLE "documents" ADD COLUMN "suggestedDocType" "DocumentType";
ALTER TABLE "documents" ADD COLUMN "suggestedThemeId" TEXT;
ALTER TABLE "documents" ADD COLUMN "importBatchId" TEXT;

-- CreateIndex
CREATE INDEX "documents_tenantId_docType_idx" ON "documents"("tenantId", "docType");
CREATE INDEX "documents_tenantId_contentHash_idx" ON "documents"("tenantId", "contentHash");
CREATE INDEX "documents_tenantId_attachedThemeId_idx" ON "documents"("tenantId", "attachedThemeId");
CREATE INDEX "documents_importBatchId_idx" ON "documents"("importBatchId");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_attachedThemeId_fkey" FOREIGN KEY ("attachedThemeId") REFERENCES "Theme"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_attachedProjectId_fkey" FOREIGN KEY ("attachedProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
