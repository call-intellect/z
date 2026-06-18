-- AlterTable
ALTER TABLE "Issue" ADD COLUMN     "closureReviewAt" TIMESTAMP(3),
ADD COLUMN     "closureReviewReason" TEXT,
ADD COLUMN     "closureReviewState" VARCHAR(24);

-- CreateIndex
CREATE INDEX "Issue_tenantId_closureReviewState_idx" ON "Issue"("tenantId", "closureReviewState");
