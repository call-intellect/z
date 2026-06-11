-- CreateTable
CREATE TABLE "SupportDraftOutcome" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "draftCommentId" TEXT,
    "taskType" TEXT NOT NULL DEFAULT 'support-clone-draft',
    "draftText" TEXT NOT NULL,
    "finalText" TEXT,
    "outcome" TEXT NOT NULL,
    "editType" TEXT,
    "cloneConfidence" DECIMAL(4,3),
    "groundednessScore" DECIMAL(4,3),
    "promotedToContour" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportDraftOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportDraftOutcome_tenantId_taskType_createdAt_idx" ON "SupportDraftOutcome"("tenantId", "taskType", "createdAt");

-- CreateIndex
CREATE INDEX "SupportDraftOutcome_tenantId_issueId_idx" ON "SupportDraftOutcome"("tenantId", "issueId");

