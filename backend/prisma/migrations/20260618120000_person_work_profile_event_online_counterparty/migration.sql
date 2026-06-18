-- calendar-master (2026-06-18) Ф4/Ф5/Ф6 — единая миграция полей:
--   Person: рабочий профиль (workStartHour/workEndHour/workingDays) — Ф4.
--   Event:  online (формат: видеокомната только при true) — Ф6;
--           counterparty (контрагент/клиент, НЕ место) — Ф5.
-- Все изменения безопасные: ADD COLUMN nullable / с DEFAULT, без потери данных.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "counterparty" VARCHAR(300),
ADD COLUMN     "online" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "persons" ADD COLUMN     "workEndHour" INTEGER,
ADD COLUMN     "workStartHour" INTEGER,
ADD COLUMN     "workingDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
