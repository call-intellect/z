-- AlterTable
ALTER TABLE "llm_providers" ADD COLUMN     "billingMode" VARCHAR(20) NOT NULL DEFAULT 'per_token',
ADD COLUMN     "subscriptionMonthlyCostUsd" DECIMAL(10,2),
ADD COLUMN     "subscriptionStartedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "llm_provider_subscription_charges" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "providerName" VARCHAR(60) NOT NULL,
    "chargeDate" DATE NOT NULL,
    "amountUsd" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_provider_subscription_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "llm_provider_subscription_charges_chargeDate_idx" ON "llm_provider_subscription_charges"("chargeDate");

-- CreateIndex
CREATE UNIQUE INDEX "llm_provider_subscription_charges_providerId_chargeDate_key" ON "llm_provider_subscription_charges"("providerId", "chargeDate");

-- AddForeignKey
ALTER TABLE "llm_provider_subscription_charges" ADD CONSTRAINT "llm_provider_subscription_charges_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "llm_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
