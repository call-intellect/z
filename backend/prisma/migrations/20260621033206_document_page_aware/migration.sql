-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "pageCount" INTEGER,
ADD COLUMN     "pageOffsets" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
