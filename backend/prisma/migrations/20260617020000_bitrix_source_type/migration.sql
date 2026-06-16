-- Bitrix24-источник Ф4 (ТЗ 2026-06-17-bitrix24-source-sync): значение `bitrix`
-- в enum SourceType — мост Bitrix-диалогов (сессия-сутки) в knowledge-core через
-- IngestService (RawEvent.sourceType='bitrix', Source.type='bitrix').
--
-- AGE-трап: фиксируем search_path, чтобы любой DDL шёл в public, а не ag_catalog.
-- ALTER TYPE существующего enum'а от схемы не зависит, но держим единый паттерн.
SET search_path TO "public";

-- Идемпотентно: повторный deploy не упадёт, если значение уже есть.
ALTER TYPE "SourceType" ADD VALUE IF NOT EXISTS 'bitrix';
