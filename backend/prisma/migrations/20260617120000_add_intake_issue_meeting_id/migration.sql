-- AlterTable
ALTER TABLE "IntakeIssue" ADD COLUMN     "meetingId" TEXT;

-- CreateIndex
CREATE INDEX "IntakeIssue_meetingId_idx" ON "IntakeIssue"("meetingId");
