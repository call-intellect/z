-- AlterTable
ALTER TABLE "daily_check_ins" ADD COLUMN     "ideasJson" JSONB,
ADD COLUMN     "notDoneJson" JSONB,
ADD COLUMN     "reportCompleteness" VARCHAR(8);
