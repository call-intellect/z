-- CreateTable
CREATE TABLE "IssueProgressUpdate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorType" TEXT NOT NULL DEFAULT 'human',
    "health" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "doneText" TEXT,
    "nextText" TEXT,
    "draftState" TEXT,
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidenceQuote" TEXT,
    "confidence" DECIMAL(4,3),
    "previewQuote" TEXT,
    "previewSourceRef" JSONB,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "IssueProgressUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IssueProgressUpdate_tenantId_issueId_createdAt_idx" ON "IssueProgressUpdate"("tenantId", "issueId", "createdAt");

-- CreateIndex
CREATE INDEX "IssueProgressUpdate_issueId_createdAt_idx" ON "IssueProgressUpdate"("issueId", "createdAt");

-- CreateIndex
CREATE INDEX "IssueProgressUpdate_tenantId_draftState_idx" ON "IssueProgressUpdate"("tenantId", "draftState");

-- AddForeignKey
ALTER TABLE "IssueProgressUpdate" ADD CONSTRAINT "IssueProgressUpdate_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
