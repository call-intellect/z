-- AlterTable
ALTER TABLE "daily_operations_digests" ADD COLUMN     "verdictJson" JSONB;
ALTER TABLE "daily_operations_digests" ADD COLUMN     "letterJson" JSONB;
ALTER TABLE "daily_operations_digests" ADD COLUMN     "goalAlignmentDayJson" JSONB;
