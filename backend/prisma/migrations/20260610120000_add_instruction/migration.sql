-- CreateTable
CREATE TABLE "instructions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "contentMd" TEXT NOT NULL,
    "status" "ProcessStatus" NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "confidence" DOUBLE PRECISION,
    "forRole" VARCHAR(120),
    "entityId" TEXT,
    "statement" TEXT,
    "scope" VARCHAR(120),
    "ownerPersonId" TEXT,
    "supersedesId" TEXT,
    "currentVersionId" TEXT,
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "personSubjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dataClass" "DataClass" NOT NULL DEFAULT 'internal',
    "dataClassAudit" JSONB,
    "embedding" vector(1536),
    "lastConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instructions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "instructions_entityId_key" ON "instructions"("entityId");

-- CreateIndex
CREATE INDEX "instructions_tenantId_status_idx" ON "instructions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "instructions_tenantId_forRole_idx" ON "instructions"("tenantId", "forRole");

-- CreateIndex
CREATE INDEX "instructions_tenantId_ownerPersonId_idx" ON "instructions"("tenantId", "ownerPersonId");

-- CreateIndex
CREATE INDEX "instructions_currentVersionId_idx" ON "instructions"("currentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "instructions_tenantId_name_key" ON "instructions"("tenantId", "name");

-- AddForeignKey
ALTER TABLE "instructions" ADD CONSTRAINT "instructions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructions" ADD CONSTRAINT "instructions_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructions" ADD CONSTRAINT "instructions_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "instructions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructions" ADD CONSTRAINT "instructions_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "CardVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
