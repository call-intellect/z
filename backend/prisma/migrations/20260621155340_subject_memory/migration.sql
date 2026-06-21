-- CreateEnum
CREATE TYPE "SubjectMemoryKind" AS ENUM ('term', 'disambiguation', 'preference');

-- CreateEnum
CREATE TYPE "SubjectMemoryStatus" AS ENUM ('shadow', 'canary', 'active', 'superseded', 'rolled_back', 'disabled');

-- CreateTable
CREATE TABLE "subject_memory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "SubjectMemoryKind" NOT NULL,
    "contextText" TEXT NOT NULL,
    "ruleText" TEXT NOT NULL,
    "embedding" vector(1536),
    "status" "SubjectMemoryStatus" NOT NULL DEFAULT 'shadow',
    "confirmCount" INTEGER NOT NULL DEFAULT 0,
    "refuteCount" INTEGER NOT NULL DEFAULT 0,
    "confidence" DECIMAL(4,3) NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "supersededById" TEXT,
    "sourceProbeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "staleAfter" TIMESTAMP(3),
    "lastAppliedAt" TIMESTAMP(3),
    "appliedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subject_memory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subject_memory_tenantId_kind_status_idx" ON "subject_memory"("tenantId", "kind", "status");

-- CreateIndex
CREATE INDEX "subject_memory_tenantId_status_occurredAt_idx" ON "subject_memory"("tenantId", "status", "occurredAt");

-- AddForeignKey
ALTER TABLE "subject_memory" ADD CONSTRAINT "subject_memory_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "subject_memory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_memory" ADD CONSTRAINT "subject_memory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
