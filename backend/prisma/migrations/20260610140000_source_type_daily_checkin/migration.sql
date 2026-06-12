-- ТЗ 2026-06-10-daily-checkin-to-graph-bridge, Фаза 1.
-- Новое значение enum SourceType для моста чек-ин → knowledge-core
-- (CheckinIngestService). Значение НЕ используется в этой же миграции
-- (ADD VALUE нельзя комбинировать с использованием значения в одной
-- транзакции) — потребители только в runtime-коде. `IF NOT EXISTS` делает
-- повторный прогон no-op (idempotent guard).
ALTER TYPE "SourceType" ADD VALUE IF NOT EXISTS 'daily_checkin';
