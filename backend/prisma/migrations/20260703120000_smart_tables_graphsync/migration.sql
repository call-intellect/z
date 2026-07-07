-- Smart tables: graphSync channel + deterministic source-object dedup key + draft pool (TTL)
ALTER TABLE "Table" ADD COLUMN "graphSync" JSONB;

ALTER TABLE "TableRow" ADD COLUMN "sourceObjectType" TEXT;
ALTER TABLE "TableRow" ADD COLUMN "sourceObjectId" TEXT;
ALTER TABLE "TableRow" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "TableRow" ADD COLUMN "draftExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "TableRow_tableId_sourceObjectType_sourceObjectId_key" ON "TableRow"("tableId", "sourceObjectType", "sourceObjectId");
