-- CreateTable
CREATE TABLE "monthly_operations_digests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodYm" VARCHAR(7) NOT NULL,
    "bodyMarkdown" TEXT NOT NULL,
    "metricsJson" JSONB NOT NULL,
    "sourcesJson" JSONB NOT NULL,
    "llmTaskRouteId" TEXT,
    "verdictJson" JSONB,
    "letterJson" JSONB,
    "goalAlignmentMonthJson" JSONB,
    "weekTrendJson" JSONB,
    "shortSummary" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "externalSource" TEXT,

    CONSTRAINT "monthly_operations_digests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "monthly_operations_digests_tenantId_periodYm_idx" ON "monthly_operations_digests"("tenantId", "periodYm");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_operations_digests_tenantId_periodYm_key" ON "monthly_operations_digests"("tenantId", "periodYm");

-- AddForeignKey
ALTER TABLE "monthly_operations_digests" ADD CONSTRAINT "monthly_operations_digests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
