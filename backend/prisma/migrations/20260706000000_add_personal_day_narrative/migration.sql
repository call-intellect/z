SET search_path TO "public";

-- AlterTable
ALTER TABLE "Issue" ADD COLUMN     "methodCapturedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "personal_day_narrative" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "dateLocal" VARCHAR(10) NOT NULL,
    "bodyMarkdown" TEXT,
    "metricsJson" JSONB NOT NULL,
    "sourcesJson" JSONB NOT NULL,
    "llmTaskRouteId" TEXT,
    "shortSummary" TEXT,
    "verdictJson" JSONB,
    "letterJson" JSONB,
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personal_day_narrative_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "personal_day_narrative_tenantId_personId_dateLocal_idx" ON "personal_day_narrative"("tenantId", "personId", "dateLocal");

-- CreateIndex
CREATE UNIQUE INDEX "personal_day_narrative_tenantId_personId_dateLocal_key" ON "personal_day_narrative"("tenantId", "personId", "dateLocal");

-- AddForeignKey
ALTER TABLE "personal_day_narrative" ADD CONSTRAINT "personal_day_narrative_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_day_narrative" ADD CONSTRAINT "personal_day_narrative_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
