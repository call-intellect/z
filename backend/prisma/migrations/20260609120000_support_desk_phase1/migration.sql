-- AlterEnum
ALTER TYPE "KnowledgeGroupKind" ADD VALUE 'support';

-- AlterTable
ALTER TABLE "Issue" ADD COLUMN     "firstRespondedAt" TIMESTAMP(3),
ADD COLUMN     "firstResponseDueAt" TIMESTAMP(3),
ADD COLUMN     "resolutionDueAt" TIMESTAMP(3),
ADD COLUMN     "slaBreachedAt" TIMESTAMP(3),
ADD COLUMN     "supportCustomerContact" VARCHAR(320),
ADD COLUMN     "supportCustomerOrgId" TEXT,
ADD COLUMN     "supportCustomerUserId" TEXT;

-- AlterTable
ALTER TABLE "IssueComment" ADD COLUMN     "authorType" TEXT NOT NULL DEFAULT 'human',
ADD COLUMN     "cloneConfidence" DECIMAL(4,3),
ADD COLUMN     "draftState" TEXT,
ADD COLUMN     "groundednessScore" DECIMAL(4,3);

-- CreateTable
CREATE TABLE "SupportSlaPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "firstResponseMins" INTEGER NOT NULL DEFAULT 60,
    "resolutionMins" INTEGER NOT NULL DEFAULT 480,
    "businessHoursOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportSlaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueRating" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "ratedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportSlaPolicy_tenantId_key" ON "SupportSlaPolicy"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueRating_issueId_key" ON "IssueRating"("issueId");

-- CreateIndex
CREATE INDEX "IssueRating_tenantId_createdAt_idx" ON "IssueRating"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Issue_tenantId_supportCustomerUserId_idx" ON "Issue"("tenantId", "supportCustomerUserId");

-- CreateIndex
CREATE INDEX "Issue_tenantId_firstResponseDueAt_idx" ON "Issue"("tenantId", "firstResponseDueAt");

