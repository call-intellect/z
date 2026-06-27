-- AlterTable
ALTER TABLE "decisions" ADD COLUMN     "actionExtractedAt" TIMESTAMP(3),
ADD COLUMN     "impliesAction" BOOLEAN NOT NULL DEFAULT false;

