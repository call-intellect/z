-- AlterTable
ALTER TABLE "weekly_operations_digests" ADD COLUMN     "verdictJson" JSONB;
ALTER TABLE "weekly_operations_digests" ADD COLUMN     "letterJson" JSONB;
ALTER TABLE "weekly_operations_digests" ADD COLUMN     "goalAlignmentWeekJson" JSONB;
ALTER TABLE "weekly_operations_digests" ADD COLUMN     "dayTrendJson" JSONB;
