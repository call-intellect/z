-- CreateEnum
CREATE TYPE "ThemeOrigin" AS ENUM ('auto', 'user');

-- CreateEnum
CREATE TYPE "ThemeVisibility" AS ENUM ('personal', 'team');

-- CreateEnum
CREATE TYPE "ThemeLinkOrigin" AS ENUM ('clustered', 'autofill', 'manual');

-- CreateEnum
CREATE TYPE "ThemeExclusionKind" AS ENUM ('block', 'entity');

-- AlterTable
ALTER TABLE "Theme" ADD COLUMN     "origin" "ThemeOrigin" NOT NULL DEFAULT 'auto',
ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "visibility" "ThemeVisibility" NOT NULL DEFAULT 'team';

-- AlterTable
ALTER TABLE "ThemeIdeaBlock" ADD COLUMN     "addedVia" "ThemeLinkOrigin" NOT NULL DEFAULT 'clustered',
ADD COLUMN     "score" DECIMAL(4,3),
ADD COLUMN     "reason" TEXT;

-- CreateTable
CREATE TABLE "ThemeExclusion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "kind" "ThemeExclusionKind" NOT NULL,
    "blockId" TEXT,
    "entityId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThemeExclusion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ThemeExclusion_tenantId_themeId_idx" ON "ThemeExclusion"("tenantId", "themeId");

-- CreateIndex
CREATE UNIQUE INDEX "ThemeExclusion_themeId_kind_blockId_entityId_key" ON "ThemeExclusion"("themeId", "kind", "blockId", "entityId");

-- CreateIndex
CREATE INDEX "Theme_tenantId_origin_createdByUserId_idx" ON "Theme"("tenantId", "origin", "createdByUserId");

-- AddForeignKey
ALTER TABLE "Theme" ADD CONSTRAINT "Theme_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemeExclusion" ADD CONSTRAINT "ThemeExclusion_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "Theme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemeExclusion" ADD CONSTRAINT "ThemeExclusion_blockId_tenantId_fkey" FOREIGN KEY ("blockId", "tenantId") REFERENCES "IdeaBlock"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemeExclusion" ADD CONSTRAINT "ThemeExclusion_entityId_tenantId_fkey" FOREIGN KEY ("entityId", "tenantId") REFERENCES "Entity"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemeExclusion" ADD CONSTRAINT "ThemeExclusion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
