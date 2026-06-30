/**
 * Бэкфилл всех vector-колонок эмбеддингами embeddinggemma (768 dim).
 *
 * Контекст:
 *   Миграция vector(1536) → vector(768) (Prisma migration embeddings-vector-768)
 *   обнуляет все существующие эмбеддинги — нужны новые вектора через нового
 *   провайдера (LocalEmbeddingService → EMBEDDING_FALLBACK_LOCAL_URL).
 *
 *   Скрипт идемпотентен: фильтр `WHERE embedding IS NULL` + cursor-пагинация.
 *   Повторный прогон = no-op.
 *
 * Покрытие:
 *   26 таблиц с vector(N) — knowledge-core (IdeaBlock, Entity, Theme,
 *   SourceEpisode, Decision, Insight, Idea, IdeaCluster, Process, ProcessTemplate,
 *   Regulation, Instruction, Policy, SkillTrait, SkillTraitConcept, SubjectMemory,
 *   RolePrinciple, PracticeSkill, Issue, HelpfulnessTrait, Goal,
 *   MeetingTranscriptChunk, PersonKnowledgeCategoryEmbedding) +
 *   prompt-feedback (PromptRule, PromptFeedback, ProbeEvent).
 *
 *   Таблицы без очевидного текстового поля (ProbeEvent, PromptFeedback) — skip,
 *   чтобы не городить костыли; их эмбеддинги обновятся естественным путём при
 *   следующих ingest-воркерах.
 *
 * Запуск:
 *   bun run scripts/backfill-embeddings-gemma-768.ts --dry-run
 *   bun run scripts/backfill-embeddings-gemma-768.ts
 *   bun run scripts/backfill-embeddings-gemma-768.ts --only=IdeaBlock,Entity
 *   bun run scripts/backfill-embeddings-gemma-768.ts --batch=50
 *
 * NB: phase 'backfill', skipBootstrap:true (нужно только при апгрейде после
 *     миграции vector(1536)→vector(768)).
 */

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { EmbeddingFallbackService } from '../src/modules/embeddings/services/embedding-fallback.service';

const EMBEDDING_DIM = 768;
const MODEL_VERSION = 'gemma-768';

interface Spec {
  table: string;
  column: string;
  textFields: string[];
  hasTenantId: boolean;
  versionColumn?: string;
  skip?: boolean;
}

const SPECS: Spec[] = [
  { table: 'MeetingTranscriptChunk', column: 'embedding', textFields: ['text'], hasTenantId: false },
  {
    table: 'SourceEpisode',
    column: 'embedding',
    textFields: ['title', 'summary'],
    hasTenantId: true,
    versionColumn: 'embeddingModelVersion',
  },
  { table: 'IdeaBlock', column: 'embedding', textFields: ['trustedAnswer', 'criticalQuestion'], hasTenantId: true },
  { table: 'Entity', column: 'embedding', textFields: ['canonicalName', 'aliases'], hasTenantId: true },
  { table: 'Theme', column: 'embedding', textFields: ['name', 'description', 'summary'], hasTenantId: true },
  { table: 'Goal', column: 'embedding', textFields: ['name', 'description'], hasTenantId: true },
  {
    table: 'PersonKnowledgeCategoryEmbedding',
    column: 'embedding',
    textFields: ['categoryName'],
    hasTenantId: false,
  },
  { table: 'Process', column: 'embedding', textFields: ['name', 'description'], hasTenantId: true },
  { table: 'ProcessTemplate', column: 'embedding', textFields: ['name', 'summary'], hasTenantId: true },
  { table: 'Regulation', column: 'embedding', textFields: ['statement', 'name'], hasTenantId: true },
  { table: 'Instruction', column: 'embedding', textFields: ['statement', 'name'], hasTenantId: true },
  { table: 'Policy', column: 'embedding', textFields: ['name', 'contentMd'], hasTenantId: true },
  { table: 'Decision', column: 'embedding', textFields: ['statement', 'rationale'], hasTenantId: true },
  { table: 'Insight', column: 'embedding', textFields: ['statement'], hasTenantId: true },
  { table: 'Idea', column: 'embedding', textFields: ['statement'], hasTenantId: true },
  { table: 'IdeaCluster', column: 'embedding', textFields: ['name', 'description'], hasTenantId: true },
  { table: 'ProbeEvent', column: 'questionEmbedding', textFields: [], hasTenantId: false, skip: true },
  { table: 'SkillTrait', column: 'embedding', textFields: ['statement'], hasTenantId: false },
  { table: 'SkillTraitConcept', column: 'embedding', textFields: ['canonicalName', 'description'], hasTenantId: true },
  { table: 'SubjectMemory', column: 'embedding', textFields: ['contextText', 'ruleText'], hasTenantId: true },
  { table: 'RolePrinciple', column: 'embedding', textFields: ['situation', 'statement'], hasTenantId: false },
  { table: 'PracticeSkill', column: 'embedding', textFields: ['trigger'], hasTenantId: true },
  { table: 'Issue', column: 'embedding', textFields: ['description', 'identifier'], hasTenantId: true },
  { table: 'HelpfulnessTrait', column: 'embedding', textFields: ['topicHint'], hasTenantId: false },
  { table: 'PromptFeedback', column: 'inputEmbedding', textFields: [], hasTenantId: true, skip: true },
  { table: 'PromptRule', column: 'embedding', textFields: ['rule'], hasTenantId: true },
];

interface RunArgs {
  dryRun: boolean;
  onlyTables: Set<string> | null;
  batchSize: number;
}

interface RowBase {
  id: string;
  tenantId: string | null;
  text: string | null;
}

interface BackfillPrisma {
  $queryRawUnsafe<T = unknown>(sql: string, ...params: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...params: unknown[]): Promise<unknown>;
}

interface BackfillEmbeddings {
  embed(texts: string[]): Promise<number[][]>;
}

interface Stats {
  scanned: number;
  embedded: number;
  skippedEmpty: number;
  errors: number;
}

function parseArgs(): RunArgs {
  const argv = process.argv;
  let dryRun = false;
  let onlyTables: Set<string> | null = null;
  let batchSize = 100;
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg.startsWith('--only=')) {
      onlyTables = new Set(arg.slice('--only='.length).split(',').map((s) => s.trim()));
    } else if (arg.startsWith('--batch=')) {
      batchSize = Math.max(1, Number(arg.slice('--batch='.length)) || 100);
    }
  }
  return { dryRun, onlyTables, batchSize };
}

function buildSelect(spec: Spec): string {
  const selectText = spec.textFields.length
    ? `CONCAT_WS(E'\\n\\n', ${spec.textFields.map((f) => `"${f}"::text`).join(', ')})`
    : `''::text`;
  return `SELECT "id"${spec.hasTenantId ? ', "tenantId"' : ''}, ${selectText} AS text
          FROM "${spec.table}"
         WHERE "${spec.column}" IS NULL`;
}

function buildUpdateSql(spec: Spec, hasVersion: boolean): string {
  const set: string[] = [`"${spec.column}" = $1::vector(${EMBEDDING_DIM})`];
  let paramIdx = 2;
  if (hasVersion && spec.versionColumn) {
    set.push(`"${spec.versionColumn}" = $${paramIdx}`);
    paramIdx += 1;
  }
  const where = ['"id" = $' + paramIdx];
  if (spec.hasTenantId) {
    paramIdx += 1;
    where.push(`"tenantId" = $${paramIdx}`);
  }
  return `UPDATE "${spec.table}" SET ${set.join(', ')} WHERE ${where.join(' AND ')}`;
}

export async function backfillTable(
  prisma: BackfillPrisma,
  embeddings: BackfillEmbeddings,
  spec: Spec,
  opts: { dryRun: boolean; batchSize: number },
): Promise<Stats> {
  const stats: Stats = { scanned: 0, embedded: 0, skippedEmpty: 0, errors: 0 };
  if (spec.skip) return stats;

  let cursor = '';
  const hasVersion = Boolean(spec.versionColumn);
  const updateSql = buildUpdateSql(spec, hasVersion);

  while (true) {
    const rows = await prisma.$queryRawUnsafe<RowBase[]>(
      `${buildSelect(spec)} AND "id" > $1 ORDER BY "id" ASC LIMIT ${opts.batchSize}`,
      cursor,
    );
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]?.id ?? cursor;

    for (const row of rows) {
      stats.scanned += 1;
      const text = (row.text ?? '').trim();
      if (text.length === 0) {
        stats.skippedEmpty += 1;
        continue;
      }
      if (opts.dryRun) {
        stats.embedded += 1;
        continue;
      }
      try {
        const vectors = await embeddings.embed([text]);
        const vector = vectors[0];
        if (!vector || vector.length === 0) {
          stats.errors += 1;
          console.warn(`[backfill] ${spec.table}.${spec.column} id=${row.id}: пустой embedding`);
          continue;
        }
        const params: unknown[] = [`[${vector.join(',')}]`];
        if (hasVersion) params.push(MODEL_VERSION);
        params.push(row.id);
        if (spec.hasTenantId) params.push(row.tenantId);
        await prisma.$executeRawUnsafe(updateSql, ...params);
        stats.embedded += 1;
      } catch (err) {
        stats.errors += 1;
        console.warn(
          `[backfill] ${spec.table}.${spec.column} id=${row.id}: ошибка — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (rows.length < opts.batchSize) break;
  }

  return stats;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  const embeddings = app.get(EmbeddingFallbackService);

  console.log(
    `[backfill] start (dryRun=${args.dryRun}, dim=${EMBEDDING_DIM}, model=${MODEL_VERSION}, batch=${args.batchSize})`,
  );

  const total: Stats = { scanned: 0, embedded: 0, skippedEmpty: 0, errors: 0 };
  for (const spec of SPECS) {
    if (args.onlyTables && !args.onlyTables.has(spec.table)) continue;
    if (spec.skip) {
      console.log(`[backfill] skip ${spec.table}.${spec.column} (нет текстового поля в строке)`);
      continue;
    }
    console.log(`[backfill] ${spec.table}.${spec.column}…`);
    const stats = await backfillTable(
      prisma as unknown as BackfillPrisma,
      embeddings as unknown as BackfillEmbeddings,
      spec,
      { dryRun: args.dryRun, batchSize: args.batchSize },
    );
    console.log(`[backfill] ${spec.table}.${spec.column}: ${JSON.stringify(stats)}`);
    total.scanned += stats.scanned;
    total.embedded += stats.embedded;
    total.skippedEmpty += stats.skippedEmpty;
    total.errors += stats.errors;
  }

  console.log(`[backfill] TOTAL: ${JSON.stringify(total)}`);
  await app.close();
}

if (process.argv[1] && process.argv[1].includes('backfill-embeddings-gemma-768')) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[backfill] fatal', err);
      process.exit(1);
    });
}