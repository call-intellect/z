-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "embedding" vector(1536),
ADD COLUMN     "embeddingHash" TEXT;
