-- AlterTable
ALTER TABLE "processes" ADD COLUMN     "dataClassAudit" JSONB;

-- AlterTable
ALTER TABLE "regulations" ADD COLUMN     "dataClassAudit" JSONB;

-- AlterTable
ALTER TABLE "policies" ADD COLUMN     "dataClassAudit" JSONB;

-- AlterTable
ALTER TABLE "ideas" ADD COLUMN     "dataClassAudit" JSONB;

