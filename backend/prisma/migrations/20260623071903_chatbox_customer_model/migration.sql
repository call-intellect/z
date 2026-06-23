SET search_path = public;

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('active', 'inactive', 'churned');

-- AlterTable
ALTER TABLE "ChatboxCustomer" ADD COLUMN     "linkedCustomerId" TEXT;

-- AlterTable
ALTER TABLE "ChatboxChannelClient" ADD COLUMN     "linkedContactEntityId" TEXT;

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "inn" VARCHAR(20),
    "email" VARCHAR(320),
    "phone" VARCHAR(40),
    "source" VARCHAR(40),
    "externalCrmId" VARCHAR(120),
    "responsiblePersonId" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_entityId_key" ON "Customer"("entityId");

-- CreateIndex
CREATE INDEX "Customer_tenantId_status_idx" ON "Customer"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Customer_tenantId_externalCrmId_idx" ON "Customer"("tenantId", "externalCrmId");

-- CreateIndex
CREATE INDEX "Customer_tenantId_responsiblePersonId_idx" ON "Customer"("tenantId", "responsiblePersonId");

-- CreateIndex
CREATE INDEX "Customer_tenantId_deletedAt_idx" ON "Customer"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "ChatboxCustomer_tenantId_linkedCustomerId_idx" ON "ChatboxCustomer"("tenantId", "linkedCustomerId");

-- CreateIndex
CREATE INDEX "ChatboxChannelClient_tenantId_linkedContactEntityId_idx" ON "ChatboxChannelClient"("tenantId", "linkedContactEntityId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_responsiblePersonId_fkey" FOREIGN KEY ("responsiblePersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatboxCustomer" ADD CONSTRAINT "ChatboxCustomer_linkedCustomerId_fkey" FOREIGN KEY ("linkedCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

