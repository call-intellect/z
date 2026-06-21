-- CreateTable
CREATE TABLE "IssueWorklog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "description" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueWorklog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IssueWorklog_tenantId_issueId_startedAt_idx" ON "IssueWorklog"("tenantId", "issueId", "startedAt");

-- CreateIndex
CREATE INDEX "IssueWorklog_userId_startedAt_idx" ON "IssueWorklog"("userId", "startedAt");

-- AddForeignKey
ALTER TABLE "IssueWorklog" ADD CONSTRAINT "IssueWorklog_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
