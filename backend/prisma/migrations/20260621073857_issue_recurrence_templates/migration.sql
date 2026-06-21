-- CreateTable
CREATE TABLE "IssueRecurrence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "templateIssueId" TEXT,
    "rrule" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueRecurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IssueRecurrence_tenantId_enabled_nextRunAt_idx" ON "IssueRecurrence"("tenantId", "enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "IssueTemplate_tenantId_projectId_idx" ON "IssueTemplate"("tenantId", "projectId");
