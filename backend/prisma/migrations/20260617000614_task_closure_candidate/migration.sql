-- CreateTable
CREATE TABLE "TaskClosureCandidate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "sourceBlockId" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "matchSimilarity" DECIMAL(4,3),
    "confidence" DECIMAL(4,3),
    "rationale" TEXT,
    "evidenceQuote" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskClosureCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskClosureCandidate_tenantId_status_idx" ON "TaskClosureCandidate"("tenantId", "status");

-- CreateIndex
CREATE INDEX "TaskClosureCandidate_issueId_idx" ON "TaskClosureCandidate"("issueId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskClosureCandidate_tenantId_issueId_sourceBlockId_key" ON "TaskClosureCandidate"("tenantId", "issueId", "sourceBlockId");
