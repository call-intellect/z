-- ТЗ commitment-social-layer-cleanup, Ф6 — снос надзорного слоя обещаний.
-- Колонки commitmentStatus + askedAt/escalatedAt (отметки «Хранителя обещаний», В3);
-- таблица promise_network_snapshots (граф «перегруза»). Поля-факты
-- commitmentDueDate/Author/Recipient и enum SignalType.commitment_status — НЕ трогаются (В1/В4).

-- DropIndex
DROP INDEX IF EXISTS "IdeaBlock_tenantId_signalType_commitmentStatus_commitmentDu_idx";

-- DropIndex
DROP INDEX IF EXISTS "IdeaBlock_tenantId_signalType_commitmentStatus_idx";

-- DropTable
DROP TABLE IF EXISTS "promise_network_snapshots";

-- AlterTable
ALTER TABLE "IdeaBlock" DROP COLUMN IF EXISTS "commitmentStatus",
DROP COLUMN IF EXISTS "commitmentAskedAt",
DROP COLUMN IF EXISTS "commitmentEscalatedAt";
