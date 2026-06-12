-- ТЗ plans/tz/2026-06-11-clone-persona-method-layer.md, Фаза Э1.1 (clone_method_layer).
-- Аддитивная backward-compatible миграция (новые таблицы + колонка с default,
-- существующие строки и старый код не затрагиваются):
--   - enum SkillTraitLayer + колонка skill_traits.layer (NOT NULL DEFAULT 'skill') —
--     дискриминатор слоя черты для persona-compile v2 (skill/value/motivation/process_marker);
--   - таблица role_principles — Reflection-слой: синтезированные принципы процесса должности;
--   - таблица clone_query_logs — журнал запросов к клону (Этап 0), видимый владельцу Org.
-- HNSW-индекс на role_principles.embedding — НЕ здесь, а в backend/scripts/postgres-init.sql
-- (pgvector-индексы по конвенции проекта живут вне prisma-миграций).

-- CreateEnum
CREATE TYPE "SkillTraitLayer" AS ENUM ('skill', 'value', 'motivation', 'process_marker');

-- CreateEnum
CREATE TYPE "RolePrincipleStatus" AS ENUM ('active', 'superseded', 'archived');

-- AlterTable
ALTER TABLE "skill_traits" ADD COLUMN     "layer" "SkillTraitLayer" NOT NULL DEFAULT 'skill';

-- CreateTable
CREATE TABLE "role_principles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "situation" VARCHAR(200) NOT NULL,
    "statement" TEXT NOT NULL,
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "observationCount" INTEGER NOT NULL DEFAULT 0,
    "confidence" "SkillConfidence" NOT NULL,
    "embedding" vector(1536),
    "status" "RolePrincipleStatus" NOT NULL DEFAULT 'active',
    "supersededById" TEXT,
    "lastSynthesizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_principles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clone_query_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cloneScope" "PersonaScope" NOT NULL,
    "cloneTargetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionPreview" VARCHAR(200) NOT NULL,
    "questionHash" VARCHAR(64) NOT NULL,
    "answeredGrounded" BOOLEAN NOT NULL,
    "refusalReason" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clone_query_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "skill_traits_profileId_layer_status_idx" ON "skill_traits"("profileId", "layer", "status");

-- CreateIndex
CREATE INDEX "role_principles_tenantId_roleId_status_idx" ON "role_principles"("tenantId", "roleId", "status");

-- CreateIndex
CREATE INDEX "role_principles_tenantId_situation_idx" ON "role_principles"("tenantId", "situation");

-- CreateIndex
CREATE INDEX "clone_query_logs_tenantId_cloneTargetId_createdAt_idx" ON "clone_query_logs"("tenantId", "cloneTargetId", "createdAt");

-- CreateIndex
CREATE INDEX "clone_query_logs_tenantId_createdAt_idx" ON "clone_query_logs"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "role_principles" ADD CONSTRAINT "role_principles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clone_query_logs" ADD CONSTRAINT "clone_query_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
