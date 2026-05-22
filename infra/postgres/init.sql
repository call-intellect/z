-- Z — первичная инициализация БД (выполняется при первом старте контейнера
-- postgres на чистом volume; postgres-image автоматически прогоняет любые
-- файлы из /docker-entrypoint-initdb.d).
--
-- Цели:
--   1. Включить pgvector и Apache AGE как extensions.
--   2. Создать AGE-граф `z_graph` — единое graph-namespace для всех
--      бизнес-связей Z (см. plans/tz/2026-05-21-phase-0a-data-model-and-graph-infra.md §5.2).
--
-- Идемпотентность: CREATE EXTENSION IF NOT EXISTS + проверка наличия графа
-- через ag_catalog.ag_graph. Повторный запуск безопасен.
--
-- Этот файл — bootstrap при первом запуске Docker-volume. На prod (Yandex
-- Managed PostgreSQL) аналогичные команды выполняет backend/scripts/postgres-init.sql,
-- который запускается отдельно через `bun run apply-postgres-init`.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS age;

LOAD 'age';
SET search_path = ag_catalog, "$user", public;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ag_catalog.ag_graph WHERE name = 'z_graph'
  ) THEN
    PERFORM ag_catalog.create_graph('z_graph');
  END IF;
END $$;
