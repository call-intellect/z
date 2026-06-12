-- ТЗ 2026-06-11-report-to-graph-phase2, Фаза 1 (миграция, файл 2/2).
-- Поле провенанса НА УРОВНЕ блока: 'transcript' | 'report' | NULL(=transcript).
-- Детерминированный machine-guard источника для hallucination-гардов
-- block-distill (ГАРД B: транскрипт побеждает report при дедупе) и block-ingest
-- (ГАРД A: cap confidence у report-блоков). Nullable, backfill НЕ нужен:
-- исторические блоки (NULL) трактуются кодом как 'transcript'.
ALTER TABLE "IdeaBlock" ADD COLUMN "primarySource" VARCHAR(16);
