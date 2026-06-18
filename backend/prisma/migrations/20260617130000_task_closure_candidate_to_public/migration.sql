-- AGE search_path trap: на базе с Apache AGE сырой CREATE TABLE без схемы
-- (миграция 20260617000614_task_closure_candidate) создаёт таблицу в ag_catalog,
-- а Prisma/бэк читают public."TaskClosureCandidate" → "relation does not exist".
-- Переносим в public идемпотентно: no-op, если таблица уже в public.
ALTER TABLE IF EXISTS ag_catalog."TaskClosureCandidate" SET SCHEMA public;
