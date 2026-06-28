-- AlterTable
ALTER TABLE "Issue" ADD COLUMN "conversationId" TEXT;

-- AlterTable
ALTER TABLE "IssueComment" ADD COLUMN "messageId" TEXT;

-- AlterTable
ALTER TABLE "IssueAttachment" ADD COLUMN "messageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Issue_conversationId_key" ON "Issue"("conversationId");

-- CreateIndex
CREATE INDEX "IssueComment_messageId_idx" ON "IssueComment"("messageId");

-- CreateIndex
CREATE INDEX "IssueAttachment_messageId_idx" ON "IssueAttachment"("messageId");
