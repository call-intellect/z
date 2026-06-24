-- CreateTable
CREATE TABLE "EntityAlias" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "personId" TEXT,
    "entityId" TEXT,
    "roleHint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntityAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntityAlias_tenantId_personId_idx" ON "EntityAlias"("tenantId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "EntityAlias_tenantId_alias_key" ON "EntityAlias"("tenantId", "alias");

-- AddForeignKey
ALTER TABLE "EntityAlias" ADD CONSTRAINT "EntityAlias_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
