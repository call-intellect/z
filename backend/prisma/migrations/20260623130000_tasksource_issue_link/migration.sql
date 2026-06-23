-- AlterTable
ALTER TABLE "TaskSource" ALTER COLUMN "taskId" DROP NOT NULL,
ADD COLUMN     "issueId" TEXT;

-- AddForeignKey
ALTER TABLE "TaskSource" ADD CONSTRAINT "TaskSource_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "TaskSource_issueId_sourceType_sourceRefId_key" ON "TaskSource"("issueId", "sourceType", "sourceRefId");

-- CreateIndex
CREATE INDEX "TaskSource_tenantId_issueId_idx" ON "TaskSource"("tenantId", "issueId");
