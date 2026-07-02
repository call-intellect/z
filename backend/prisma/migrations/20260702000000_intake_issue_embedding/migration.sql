-- AlterTable
ALTER TABLE "IntakeIssue" ADD COLUMN     "embedding" vector(1536),
ADD COLUMN     "embeddingHash" TEXT;
