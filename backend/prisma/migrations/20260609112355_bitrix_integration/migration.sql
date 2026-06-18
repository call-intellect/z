-- CreateEnum
CREATE TYPE "BitrixIntegrationStatus" AS ENUM ('pending', 'connected', 'error', 'disconnected');

-- CreateTable
CREATE TABLE "BitrixIntegration" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "tenantId" TEXT,
    "portalDomain" TEXT NOT NULL,
    "clientEndpoint" TEXT,
    "serverEndpoint" TEXT,
    "scope" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "applicationTokenEnc" TEXT,
    "accessExpiresAt" TIMESTAMP(3),
    "status" "BitrixIntegrationStatus" NOT NULL DEFAULT 'pending',
    "lastError" TEXT,
    "lastConnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BitrixIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BitrixIntegration_memberId_key" ON "BitrixIntegration"("memberId");

-- CreateIndex
CREATE INDEX "BitrixIntegration_tenantId_idx" ON "BitrixIntegration"("tenantId");

-- CreateIndex
CREATE INDEX "BitrixIntegration_status_idx" ON "BitrixIntegration"("status");

-- AddForeignKey
ALTER TABLE "BitrixIntegration" ADD CONSTRAINT "BitrixIntegration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

