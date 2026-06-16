-- AlterTable
ALTER TABLE "IntakeIssue" ADD COLUMN     "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
