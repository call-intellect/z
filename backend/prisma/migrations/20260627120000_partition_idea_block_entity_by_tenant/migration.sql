-- ════════════════════════════════════════════════════════════════════════════
-- Ф1 — HASH-партиционирование IdeaBlock и Entity по tenantId (64 партиции)
--       + составной PK (id, tenantId) + перевод всех входящих FK на (fk, tenantId).
--
-- AUTHORED WITHOUT LOCAL DB — миграция написана без доступа к локальной БД.
--   Требует прогона на staging / пустом проде ДО выката (нет авто-диффа Prisma).
--   Прод почти пуст → swap-перенос данных тривиален.
--
-- PG15+ column-list SET NULL НЕ используется намеренно: для SetNull-FK выбран
--   паттерн nullable-компаньон (<rel>TenantId String?), оба поля nullable →
--   стандартный ON DELETE SET NULL по составному ключу валиден на любом PG13+.
--
-- HNSW / партиционные vector-индексы здесь НЕ создаются — они в
--   backend/scripts/postgres-init.sql (идемпотентно, IF NOT EXISTS).
--
-- Идемпотентность: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS,
--   партиции CREATE TABLE IF NOT EXISTS, swap-перенос guard'ится наличием
--   секционирования родителя.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- ШАГ 1. Добавить недостающие tenantId / nullable-компаньоны детям + backfill.
-- ─────────────────────────────────────────────────────────────────────────

-- 1a. Cascade-дети БЕЗ собственного tenantId — добавить (с backfill из родителя).
ALTER TABLE "IdeaBlockEvidence" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "IdeaBlockAccess"   ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "IdeaBlockEntity"   ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "ThemeIdeaBlock"    ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "ThemeEntity"       ADD COLUMN IF NOT EXISTS "tenantId" TEXT;

UPDATE "IdeaBlockEvidence" c SET "tenantId" = p."tenantId"
  FROM "IdeaBlock" p WHERE c."blockId" = p."id" AND c."tenantId" IS NULL;
UPDATE "IdeaBlockAccess" c SET "tenantId" = p."tenantId"
  FROM "IdeaBlock" p WHERE c."blockId" = p."id" AND c."tenantId" IS NULL;
UPDATE "IdeaBlockEntity" c SET "tenantId" = p."tenantId"
  FROM "IdeaBlock" p WHERE c."blockId" = p."id" AND c."tenantId" IS NULL;
UPDATE "ThemeIdeaBlock" c SET "tenantId" = p."tenantId"
  FROM "IdeaBlock" p WHERE c."blockId" = p."id" AND c."tenantId" IS NULL;
UPDATE "ThemeEntity" c SET "tenantId" = p."tenantId"
  FROM "Entity" p WHERE c."entityId" = p."id" AND c."tenantId" IS NULL;

ALTER TABLE "IdeaBlockEvidence" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "IdeaBlockAccess"   ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "IdeaBlockEntity"   ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "ThemeIdeaBlock"    ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "ThemeEntity"       ALTER COLUMN "tenantId" SET NOT NULL;

-- 1b. SetNull / self-FK дети — nullable-компаньон <rel>TenantId + backfill из цели.
ALTER TABLE "IdeaBlock" ADD COLUMN IF NOT EXISTS "mergedIntoTenantId"   TEXT;
ALTER TABLE "IdeaBlock" ADD COLUMN IF NOT EXISTS "supersededByTenantId" TEXT;
ALTER TABLE "Entity"    ADD COLUMN IF NOT EXISTS "mergedIntoTenantId"   TEXT;
ALTER TABLE "Card"        ADD COLUMN IF NOT EXISTS "entityTenantId"           TEXT;
ALTER TABLE "Goal"        ADD COLUMN IF NOT EXISTS "entityTenantId"           TEXT;
ALTER TABLE "roles"       ADD COLUMN IF NOT EXISTS "entityTenantId"           TEXT;
ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "entityTenantId"           TEXT;
ALTER TABLE "documents"   ADD COLUMN IF NOT EXISTS "entityTenantId"           TEXT;
ALTER TABLE "persons"     ADD COLUMN IF NOT EXISTS "entityTenantId"           TEXT;
ALTER TABLE "decisions"   ADD COLUMN IF NOT EXISTS "sourceIdeaBlockTenantId"  TEXT;

UPDATE "IdeaBlock" c SET "mergedIntoTenantId" = p."tenantId"
  FROM "IdeaBlock" p WHERE c."mergedIntoId" = p."id" AND c."mergedIntoTenantId" IS NULL;
UPDATE "IdeaBlock" c SET "supersededByTenantId" = p."tenantId"
  FROM "IdeaBlock" p WHERE c."supersededById" = p."id" AND c."supersededByTenantId" IS NULL;
UPDATE "Entity" c SET "mergedIntoTenantId" = p."tenantId"
  FROM "Entity" p WHERE c."mergedIntoId" = p."id" AND c."mergedIntoTenantId" IS NULL;
UPDATE "Card" c SET "entityTenantId" = p."tenantId"
  FROM "Entity" p WHERE c."entityId" = p."id" AND c."entityTenantId" IS NULL;
UPDATE "Goal" c SET "entityTenantId" = p."tenantId"
  FROM "Entity" p WHERE c."entityId" = p."id" AND c."entityTenantId" IS NULL;
UPDATE "roles" c SET "entityTenantId" = p."tenantId"
  FROM "Entity" p WHERE c."entityId" = p."id" AND c."entityTenantId" IS NULL;
UPDATE "departments" c SET "entityTenantId" = p."tenantId"
  FROM "Entity" p WHERE c."entityId" = p."id" AND c."entityTenantId" IS NULL;
UPDATE "documents" c SET "entityTenantId" = p."tenantId"
  FROM "Entity" p WHERE c."entityId" = p."id" AND c."entityTenantId" IS NULL;
UPDATE "persons" c SET "entityTenantId" = p."tenantId"
  FROM "Entity" p WHERE c."entityId" = p."id" AND c."entityTenantId" IS NULL;
UPDATE "decisions" c SET "sourceIdeaBlockTenantId" = p."tenantId"
  FROM "IdeaBlock" p WHERE c."sourceIdeaBlockId" = p."id" AND c."sourceIdeaBlockTenantId" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- ШАГ 2. Снять ВСЕ входящие FK на IdeaBlock и Entity (catalog-driven, по имени
--        целевой таблицы — устойчиво к расхождению имён constraint'ов).
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN
    SELECT con.conrelid::regclass AS child_table, con.conname AS constraint_name
    FROM pg_constraint con
    JOIN pg_class ref ON ref.oid = con.confrelid
    WHERE con.contype = 'f'
      AND ref.relname IN ('IdeaBlock', 'Entity')
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I',
                   fk.child_table, fk.constraint_name);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- ШАГ 3. Снять составные PK/unique детей, которые должны включить tenantId.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "IdeaBlockEntity" DROP CONSTRAINT IF EXISTS "IdeaBlockEntity_pkey";
ALTER TABLE "IdeaBlockAccess" DROP CONSTRAINT IF EXISTS "IdeaBlockAccess_pkey";
ALTER TABLE "ThemeIdeaBlock"  DROP CONSTRAINT IF EXISTS "ThemeIdeaBlock_pkey";
ALTER TABLE "ThemeEntity"     DROP CONSTRAINT IF EXISTS "ThemeEntity_pkey";
DROP INDEX IF EXISTS "IdeaBlockLink_fromBlockId_toBlockId_relationType_key";

-- 1:1 entityId-unique индексы детей пересоздаются на (entityId, tenantId) /
--   (entityId, entityTenantId) — Prisma определяет 1:1 по двухполевому ключу.
DROP INDEX IF EXISTS "Vendor_entityId_key";
DROP INDEX IF EXISTS "Customer_entityId_key";
DROP INDEX IF EXISTS "Event_entityId_key";
DROP INDEX IF EXISTS "Market_entityId_key";
DROP INDEX IF EXISTS "OrgUnit_entityId_key";
DROP INDEX IF EXISTS "Goal_entityId_key";
DROP INDEX IF EXISTS "roles_entityId_key";
DROP INDEX IF EXISTS "departments_entityId_key";
DROP INDEX IF EXISTS "documents_entityId_key";
DROP INDEX IF EXISTS "decisions_sourceIdeaBlockId_key";

-- ─────────────────────────────────────────────────────────────────────────
-- ШАГ 4. Пересоздать IdeaBlock как PARTITION BY HASH (tenantId) + составной PK.
--        Паттерн: rename → create partitioned parent (LIKE для точного набора
--        колонок) → 64 партиции → INSERT…SELECT → drop старой.
--        Guard: пропустить, если IdeaBlock уже секционирован (повторный прогон).
-- ─────────────────────────────────────────────────────────────────────────
-- INCLUDING GENERATED сохраняет GENERATED-выражение search_tsv; INSERT идёт
--   по явному списку колонок БЕЗ generated (их Postgres вычисляет сам).
DO $$
DECLARE
  cols text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_partitioned_table pt
    JOIN pg_class c ON c.oid = pt.partrelid
    WHERE c.relname = 'IdeaBlock'
  ) THEN
    ALTER TABLE "IdeaBlock" RENAME TO "IdeaBlock_old";
    -- RENAME TABLE не переименовывает индекс pkey → освобождаем имя "IdeaBlock_pkey"
    --   под составной PK новой таблицы (входящие FK уже сняты в ШАГ 2).
    EXECUTE 'ALTER TABLE "IdeaBlock_old" DROP CONSTRAINT IF EXISTS "IdeaBlock_pkey"';

    EXECUTE 'CREATE TABLE "IdeaBlock" (LIKE "IdeaBlock_old" INCLUDING DEFAULTS INCLUDING GENERATED) PARTITION BY HASH ("tenantId")';

    FOR i IN 0..63 LOOP
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS "IdeaBlock_p%s" PARTITION OF "IdeaBlock" FOR VALUES WITH (MODULUS 64, REMAINDER %s)',
        i, i);
    END LOOP;

    EXECUTE 'ALTER TABLE "IdeaBlock" ADD CONSTRAINT "IdeaBlock_pkey" PRIMARY KEY ("id", "tenantId")';

    SELECT string_agg(format('%I', column_name), ', ')
      INTO cols
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'IdeaBlock_old'
        AND is_generated <> 'ALWAYS';
    EXECUTE format('INSERT INTO "IdeaBlock" (%s) SELECT %s FROM "IdeaBlock_old"', cols, cols);

    EXECUTE 'DROP TABLE "IdeaBlock_old"';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- ШАГ 5. Пересоздать Entity как PARTITION BY HASH (tenantId) + составной PK.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  cols text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_partitioned_table pt
    JOIN pg_class c ON c.oid = pt.partrelid
    WHERE c.relname = 'Entity'
  ) THEN
    ALTER TABLE "Entity" RENAME TO "Entity_old";
    -- RENAME TABLE не переименовывает индекс pkey → освобождаем имя "Entity_pkey"
    --   под составной PK новой таблицы (входящие FK уже сняты в ШАГ 2).
    EXECUTE 'ALTER TABLE "Entity_old" DROP CONSTRAINT IF EXISTS "Entity_pkey"';

    EXECUTE 'CREATE TABLE "Entity" (LIKE "Entity_old" INCLUDING DEFAULTS INCLUDING GENERATED) PARTITION BY HASH ("tenantId")';

    FOR i IN 0..63 LOOP
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS "Entity_p%s" PARTITION OF "Entity" FOR VALUES WITH (MODULUS 64, REMAINDER %s)',
        i, i);
    END LOOP;

    EXECUTE 'ALTER TABLE "Entity" ADD CONSTRAINT "Entity_pkey" PRIMARY KEY ("id", "tenantId")';

    SELECT string_agg(format('%I', column_name), ', ')
      INTO cols
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Entity_old'
        AND is_generated <> 'ALWAYS';
    EXECUTE format('INSERT INTO "Entity" (%s) SELECT %s FROM "Entity_old"', cols, cols);

    EXECUTE 'DROP TABLE "Entity_old"';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- ШАГ 6. Пересоздать b-tree индексы IdeaBlock / Entity на партиционированном
--        родителе (создаются на родителе → распространяются на все партиции).
--        HNSW / vector / strong-id partial-unique — в postgres-init.sql.
-- ─────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "IdeaBlock_tenantId_status_idx" ON "IdeaBlock"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "IdeaBlock_tenantId_signalType_idx" ON "IdeaBlock"("tenantId", "signalType");
CREATE INDEX IF NOT EXISTS "IdeaBlock_tenantId_mergedIntoId_idx" ON "IdeaBlock"("tenantId", "mergedIntoId");
CREATE INDEX IF NOT EXISTS "IdeaBlock_tenantId_roleRelevant_roleId_idx" ON "IdeaBlock"("tenantId", "roleRelevant", "roleId");
CREATE INDEX IF NOT EXISTS "IdeaBlock_tenantId_signalType_commitmentStatus_commitmentDu_idx" ON "IdeaBlock"("tenantId", "signalType", "commitmentStatus", "commitmentDueDate");
CREATE INDEX IF NOT EXISTS "IdeaBlock_tenantId_signalType_commitmentStatus_idx" ON "IdeaBlock"("tenantId", "signalType", "commitmentStatus");
CREATE INDEX IF NOT EXISTS "IdeaBlock_tenantId_validUntil_idx" ON "IdeaBlock"("tenantId", "validUntil");
CREATE INDEX IF NOT EXISTS "IdeaBlock_tenantId_signalType_validUntil_idx" ON "IdeaBlock"("tenantId", "signalType", "validUntil");
CREATE INDEX IF NOT EXISTS "IdeaBlock_tenantId_commitmentAuthorPersonId_idx" ON "IdeaBlock"("tenantId", "commitmentAuthorPersonId");
CREATE INDEX IF NOT EXISTS "IdeaBlock_tenantId_signalType_commitmentAuthorPersonId_comm_idx" ON "IdeaBlock"("tenantId", "signalType", "commitmentAuthorPersonId", "commitmentDueDate");

CREATE INDEX IF NOT EXISTS "Entity_tenantId_type_idx" ON "Entity"("tenantId", "type");
CREATE INDEX IF NOT EXISTS "Entity_tenantId_mergedIntoId_idx" ON "Entity"("tenantId", "mergedIntoId");
CREATE INDEX IF NOT EXISTS "Entity_tenantId_canonicalName_idx" ON "Entity"("tenantId", "canonicalName");

-- ─────────────────────────────────────────────────────────────────────────
-- ШАГ 7. Пересоздать составные PK / unique детей с tenantId.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "IdeaBlockEntity" ADD CONSTRAINT "IdeaBlockEntity_pkey" PRIMARY KEY ("blockId", "entityId", "tenantId");
ALTER TABLE "IdeaBlockAccess" ADD CONSTRAINT "IdeaBlockAccess_pkey" PRIMARY KEY ("blockId", "groupId", "tenantId");
ALTER TABLE "ThemeIdeaBlock"  ADD CONSTRAINT "ThemeIdeaBlock_pkey"  PRIMARY KEY ("themeId", "blockId", "tenantId");
ALTER TABLE "ThemeEntity"     ADD CONSTRAINT "ThemeEntity_pkey"     PRIMARY KEY ("themeId", "entityId", "tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "IdeaBlockLink_fromBlockId_toBlockId_relationType_tenantId_key"
  ON "IdeaBlockLink"("fromBlockId", "toBlockId", "relationType", "tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "Vendor_entityId_tenantId_key"   ON "Vendor"("entityId", "tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_entityId_tenantId_key" ON "Customer"("entityId", "tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "Event_entityId_tenantId_key"    ON "Event"("entityId", "tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "Market_entityId_tenantId_key"   ON "Market"("entityId", "tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "OrgUnit_entityId_tenantId_key"  ON "OrgUnit"("entityId", "tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "Goal_entityId_entityTenantId_key"        ON "Goal"("entityId", "entityTenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "roles_entityId_entityTenantId_key"       ON "roles"("entityId", "entityTenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "departments_entityId_entityTenantId_key" ON "departments"("entityId", "entityTenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "documents_entityId_entityTenantId_key"   ON "documents"("entityId", "entityTenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "decisions_sourceIdeaBlockId_sourceIdeaBlockTenantId_key"
  ON "decisions"("sourceIdeaBlockId", "sourceIdeaBlockTenantId");

-- ─────────────────────────────────────────────────────────────────────────
-- ШАГ 8. Индексы по новым tenantId-колонкам детей (для FK / фильтров).
-- ─────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "IdeaBlockEvidence_tenantId_idx" ON "IdeaBlockEvidence"("tenantId");
CREATE INDEX IF NOT EXISTS "IdeaBlockAccess_tenantId_idx"   ON "IdeaBlockAccess"("tenantId");
CREATE INDEX IF NOT EXISTS "IdeaBlockEntity_tenantId_idx"   ON "IdeaBlockEntity"("tenantId");
CREATE INDEX IF NOT EXISTS "ThemeIdeaBlock_tenantId_idx"    ON "ThemeIdeaBlock"("tenantId");
CREATE INDEX IF NOT EXISTS "ThemeEntity_tenantId_idx"       ON "ThemeEntity"("tenantId");

-- ─────────────────────────────────────────────────────────────────────────
-- ШАГ 9. Пересоздать ВСЕ входящие FK как составные (fk, tenantId) → (id, tenantId).
-- ─────────────────────────────────────────────────────────────────────────

-- 9a. Cascade-FK на IdeaBlock (переиспользуют обязательный tenantId ребёнка).
ALTER TABLE "IdeaBlockAxisLabel" ADD CONSTRAINT "IdeaBlockAxisLabel_blockId_tenantId_fkey"
  FOREIGN KEY ("blockId", "tenantId") REFERENCES "IdeaBlock"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IdeaBlockEvidence" ADD CONSTRAINT "IdeaBlockEvidence_blockId_tenantId_fkey"
  FOREIGN KEY ("blockId", "tenantId") REFERENCES "IdeaBlock"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IdeaBlockAccess" ADD CONSTRAINT "IdeaBlockAccess_blockId_tenantId_fkey"
  FOREIGN KEY ("blockId", "tenantId") REFERENCES "IdeaBlock"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IdeaBlockEntity" ADD CONSTRAINT "IdeaBlockEntity_blockId_tenantId_fkey"
  FOREIGN KEY ("blockId", "tenantId") REFERENCES "IdeaBlock"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IdeaBlockLink" ADD CONSTRAINT "IdeaBlockLink_fromBlockId_tenantId_fkey"
  FOREIGN KEY ("fromBlockId", "tenantId") REFERENCES "IdeaBlock"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IdeaBlockLink" ADD CONSTRAINT "IdeaBlockLink_toBlockId_tenantId_fkey"
  FOREIGN KEY ("toBlockId", "tenantId") REFERENCES "IdeaBlock"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ThemeIdeaBlock" ADD CONSTRAINT "ThemeIdeaBlock_blockId_tenantId_fkey"
  FOREIGN KEY ("blockId", "tenantId") REFERENCES "IdeaBlock"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- 9b. SetNull / self-FK на IdeaBlock (nullable-компаньон).
ALTER TABLE "IdeaBlock" ADD CONSTRAINT "IdeaBlock_mergedIntoId_mergedIntoTenantId_fkey"
  FOREIGN KEY ("mergedIntoId", "mergedIntoTenantId") REFERENCES "IdeaBlock"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IdeaBlock" ADD CONSTRAINT "IdeaBlock_supersededById_supersededByTenantId_fkey"
  FOREIGN KEY ("supersededById", "supersededByTenantId") REFERENCES "IdeaBlock"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_sourceIdeaBlockId_sourceIdeaBlockTenantId_fkey"
  FOREIGN KEY ("sourceIdeaBlockId", "sourceIdeaBlockTenantId") REFERENCES "IdeaBlock"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- 9c. Cascade-FK на Entity (переиспользуют обязательный tenantId ребёнка).
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_entityId_tenantId_fkey"
  FOREIGN KEY ("entityId", "tenantId") REFERENCES "Entity"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_entityId_tenantId_fkey"
  FOREIGN KEY ("entityId", "tenantId") REFERENCES "Entity"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Event" ADD CONSTRAINT "Event_entityId_tenantId_fkey"
  FOREIGN KEY ("entityId", "tenantId") REFERENCES "Entity"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Market" ADD CONSTRAINT "Market_entityId_tenantId_fkey"
  FOREIGN KEY ("entityId", "tenantId") REFERENCES "Entity"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_entityId_tenantId_fkey"
  FOREIGN KEY ("entityId", "tenantId") REFERENCES "Entity"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IdeaBlockEntity" ADD CONSTRAINT "IdeaBlockEntity_entityId_tenantId_fkey"
  FOREIGN KEY ("entityId", "tenantId") REFERENCES "Entity"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ThemeEntity" ADD CONSTRAINT "ThemeEntity_entityId_tenantId_fkey"
  FOREIGN KEY ("entityId", "tenantId") REFERENCES "Entity"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_risk_snapshot" ADD CONSTRAINT "customer_risk_snapshot_customerEntityId_tenantId_fkey"
  FOREIGN KEY ("customerEntityId", "tenantId") REFERENCES "Entity"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- 9d. SetNull / self-FK на Entity (nullable-компаньон).
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_mergedIntoId_mergedIntoTenantId_fkey"
  FOREIGN KEY ("mergedIntoId", "mergedIntoTenantId") REFERENCES "Entity"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Card" ADD CONSTRAINT "Card_entityId_entityTenantId_fkey"
  FOREIGN KEY ("entityId", "entityTenantId") REFERENCES "Entity"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_entityId_entityTenantId_fkey"
  FOREIGN KEY ("entityId", "entityTenantId") REFERENCES "Entity"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "roles" ADD CONSTRAINT "roles_entityId_entityTenantId_fkey"
  FOREIGN KEY ("entityId", "entityTenantId") REFERENCES "Entity"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "departments" ADD CONSTRAINT "departments_entityId_entityTenantId_fkey"
  FOREIGN KEY ("entityId", "entityTenantId") REFERENCES "Entity"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_entityId_entityTenantId_fkey"
  FOREIGN KEY ("entityId", "entityTenantId") REFERENCES "Entity"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "persons" ADD CONSTRAINT "persons_entityId_entityTenantId_fkey"
  FOREIGN KEY ("entityId", "entityTenantId") REFERENCES "Entity"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- ШАГ 10. Org-FK для детей, получивших собственный tenantId (Cascade на Org).
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "IdeaBlockEvidence" ADD CONSTRAINT "IdeaBlockEvidence_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IdeaBlockAccess" ADD CONSTRAINT "IdeaBlockAccess_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IdeaBlockEntity" ADD CONSTRAINT "IdeaBlockEntity_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ThemeIdeaBlock" ADD CONSTRAINT "ThemeIdeaBlock_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ThemeEntity" ADD CONSTRAINT "ThemeEntity_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- ШАГ 11. Восстановить ИСХОДЯЩИЕ FK самих IdeaBlock / Entity (LIKE их не
--         копирует; пересоздание родителя в ШАГ 4/5 их сбросило). Self-merge /
--         supersede-FK восстановлены составными в ШАГ 9b/9d.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "IdeaBlock" ADD CONSTRAINT "IdeaBlock_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IdeaBlock" ADD CONSTRAINT "IdeaBlock_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IdeaBlock" ADD CONSTRAINT "IdeaBlock_commitmentRecipientPersonId_fkey"
  FOREIGN KEY ("commitmentRecipientPersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IdeaBlock" ADD CONSTRAINT "IdeaBlock_commitmentAuthorPersonId_fkey"
  FOREIGN KEY ("commitmentAuthorPersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Entity" ADD CONSTRAINT "Entity_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
