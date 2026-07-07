-- Clone regulations router (variant B): pre-computed rule summaries cache.
CREATE TABLE "rule_summaries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "ruleId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sourceHash" VARCHAR(40) NOT NULL,
    "model" VARCHAR(120),
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rule_summaries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rule_summaries_tenantId_kind_ruleId_key" ON "rule_summaries"("tenantId", "kind", "ruleId");

CREATE INDEX "rule_summaries_tenantId_kind_idx" ON "rule_summaries"("tenantId", "kind");

ALTER TABLE "rule_summaries" ADD CONSTRAINT "rule_summaries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
