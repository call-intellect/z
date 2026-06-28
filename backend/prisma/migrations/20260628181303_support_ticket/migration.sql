-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "customerOrgId" TEXT,
    "customerUserId" TEXT,
    "customerContact" VARCHAR(320),
    "firstResponseDueAt" TIMESTAMP(3),
    "resolutionDueAt" TIMESTAMP(3),
    "firstRespondedAt" TIMESTAMP(3),
    "slaBreachedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_conversationId_key" ON "SupportTicket"("conversationId");

-- CreateIndex
CREATE INDEX "SupportTicket_tenantId_status_idx" ON "SupportTicket"("tenantId", "status");

-- CreateIndex
CREATE INDEX "SupportTicket_tenantId_firstResponseDueAt_idx" ON "SupportTicket"("tenantId", "firstResponseDueAt");

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable SupportDraftOutcome (no live data: rename issueId->conversationId, draftCommentId->draftMessageId)
DROP INDEX "SupportDraftOutcome_tenantId_issueId_idx";
ALTER TABLE "SupportDraftOutcome" RENAME COLUMN "issueId" TO "conversationId";
ALTER TABLE "SupportDraftOutcome" RENAME COLUMN "draftCommentId" TO "draftMessageId";
CREATE INDEX "SupportDraftOutcome_tenantId_conversationId_idx" ON "SupportDraftOutcome"("tenantId", "conversationId");

-- AlterTable IssueRating (ticket CSAT moves to conversationId; issueId nullable for compat)
ALTER TABLE "IssueRating" ALTER COLUMN "issueId" DROP NOT NULL;
ALTER TABLE "IssueRating" ADD COLUMN "conversationId" TEXT;
CREATE UNIQUE INDEX "IssueRating_conversationId_key" ON "IssueRating"("conversationId");
