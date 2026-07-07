-- AlterTable
ALTER TABLE "llm_providers" ADD COLUMN     "defaultModelKey" VARCHAR(120),
ADD COLUMN     "proxyPath" VARCHAR(120),
ADD COLUMN     "timeoutMs" INTEGER,
ADD COLUMN     "useProxy" BOOLEAN NOT NULL DEFAULT false;

