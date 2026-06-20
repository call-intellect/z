-- AlterTable
ALTER TABLE "Issue" ADD COLUMN     "previewQuote" TEXT,
ADD COLUMN     "previewSourceRef" JSONB;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "previewSourceRef" JSONB;

-- AlterTable
ALTER TABLE "decisions" ADD COLUMN     "previewQuote" TEXT,
ADD COLUMN     "previewSourceRef" JSONB;

-- AlterTable
ALTER TABLE "regulations" ADD COLUMN     "previewQuote" TEXT,
ADD COLUMN     "previewSourceRef" JSONB;
