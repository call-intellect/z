-- ТЗ 2026-06-11-report-to-graph-phase2, Фаза 1 (миграция, файл 1/2).
-- Новое значение enum SourceType для вторичного источника графа
-- «отчёт встречи → граф» (ReportIngestAdapter). Значение НЕ используется в
-- этой же миграции (ADD VALUE нельзя комбинировать с использованием значения
-- в одной транзакции PostgreSQL) — потребители только в runtime-коде.
-- `IF NOT EXISTS` делает повторный прогон no-op (idempotent guard).
-- ВАЖНО: колонка IdeaBlock.primarySource добавляется ОТДЕЛЬНЫМ файлом
-- (20260611140000_idea_block_primary_source) — ADD VALUE изолирован.
ALTER TYPE "SourceType" ADD VALUE IF NOT EXISTS 'meeting_report';
