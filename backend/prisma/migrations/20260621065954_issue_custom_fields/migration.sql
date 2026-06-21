-- CreateTable
CREATE TABLE "IssueFieldDef" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" VARCHAR(100) NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "order" DECIMAL(20,10) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueFieldDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueFieldValue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "IssueFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IssueFieldDef_tenantId_projectId_order_idx" ON "IssueFieldDef"("tenantId", "projectId", "order");

-- CreateIndex
CREATE INDEX "IssueFieldValue_tenantId_fieldId_idx" ON "IssueFieldValue"("tenantId", "fieldId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueFieldValue_issueId_fieldId_key" ON "IssueFieldValue"("issueId", "fieldId");

-- AddForeignKey
ALTER TABLE "IssueFieldValue" ADD CONSTRAINT "IssueFieldValue_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
