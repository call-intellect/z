-- AlterTable
ALTER TABLE "company_profiles" ADD COLUMN     "summaryJson" JSONB,
ADD COLUMN     "summaryPinned" BOOLEAN NOT NULL DEFAULT false;
