-- AGE-трап (memory project-age-search-path-ddl-trap): на базе с Apache AGE
-- безымянные CREATE TABLE/TYPE из предыдущей миграции уходят в схему ag_catalog
-- (она первой в search_path роли), а бэкенд/Prisma читают public.* → ошибки
-- "relation does not exist". Здесь идемпотентно переносим Bitrix-объекты в public.
-- На базе БЕЗ AGE (или если уже в public) — IF EXISTS-проверки просто пропускают.

DO $$
DECLARE
  t text;
  ty text;
BEGIN
  -- таблицы
  FOREACH t IN ARRAY ARRAY[
    'BitrixUser','BitrixDialog','BitrixDialogSession','BitrixMessage',
    'BitrixContact','BitrixCompany','BitrixDeal'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'ag_catalog' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE ag_catalog.%I SET SCHEMA public', t);
    END IF;
  END LOOP;

  -- enum-типы
  FOREACH ty IN ARRAY ARRAY[
    'BitrixLinkMode','BitrixDialogType','BitrixDialogAnalysisStatus'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_type pt
      JOIN pg_namespace pn ON pn.oid = pt.typnamespace
      WHERE pn.nspname = 'ag_catalog' AND pt.typname = ty
    ) THEN
      EXECUTE format('ALTER TYPE ag_catalog.%I SET SCHEMA public', ty);
    END IF;
  END LOOP;
END $$;
