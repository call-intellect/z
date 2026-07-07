SET search_path TO "public";

-- CreateTable
CREATE TABLE "task_solutions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "taskDescription" TEXT NOT NULL,
    "solutionMd" TEXT NOT NULL,
    "ownerPersonId" TEXT NOT NULL,
    "personSubjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceIssueId" TEXT NOT NULL,
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skillTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ProcessStatus" NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "currentVersionId" TEXT,
    "confidence" DOUBLE PRECISION,
    "promotedToInstructionId" TEXT,
    "repeatGroupKey" VARCHAR(120),
    "candidateInstruction" BOOLEAN NOT NULL DEFAULT false,
    "previewQuote" TEXT,
    "previewSourceRef" JSONB,
    "dataClass" "DataClass" NOT NULL DEFAULT 'internal',
    "dataClassAudit" JSONB,
    "embedding" vector(1536),
    "lastConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "task_solutions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_solutions_tenantId_sourceIssueId_key" ON "task_solutions"("tenantId", "sourceIssueId");

-- CreateIndex
CREATE INDEX "task_solutions_tenantId_status_idx" ON "task_solutions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "task_solutions_tenantId_ownerPersonId_idx" ON "task_solutions"("tenantId", "ownerPersonId");

-- CreateIndex
CREATE INDEX "task_solutions_tenantId_repeatGroupKey_idx" ON "task_solutions"("tenantId", "repeatGroupKey");

-- CreateIndex
CREATE INDEX "task_solutions_currentVersionId_idx" ON "task_solutions"("currentVersionId");

-- CreateIndex
CREATE INDEX "task_solutions_tenantId_deletedAt_idx" ON "task_solutions"("tenantId", "deletedAt");

-- AddForeignKey
ALTER TABLE "task_solutions" ADD CONSTRAINT "task_solutions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_solutions" ADD CONSTRAINT "task_solutions_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_solutions" ADD CONSTRAINT "task_solutions_sourceIssueId_fkey" FOREIGN KEY ("sourceIssueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_solutions" ADD CONSTRAINT "task_solutions_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "CardVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
