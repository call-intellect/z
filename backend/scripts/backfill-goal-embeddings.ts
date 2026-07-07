/**
 * Ф5 (TZ 2026-06-16 task-dedup) — backfill `Goal.embedding` для существующих
 * целей. Зеркало логики `GoalEmbedWorker`, но разовым проходом по всем целям
 * без вектора.
 *
 * Контекст:
 *   Внедрена колонка `Goal.embedding` (pgvector 1536) + HNSW-индекс
 *   (`goal_embedding_hnsw_cosine_idx`) для семантического дедупа целей
 *   (specialist-3-14 KNN вместо ILIKE по 2 словам). Новые/обновляемые цели
 *   заполняют вектор автоматически через `core.goal-embed`. Существующие цели
 *   нужно проиндексировать единоразово.
 *
 * Логика:
 *   1. Курсор-пагинация по `Goal` где `embedding IS NULL` (raw — Prisma не
 *      умеет фильтровать Unsupported("vector")).
 *   2. Для каждой цели: text = `name\n\ndescription`; embed
 *      (`EmbeddingFallbackService`) → raw UPDATE embedding + sha256(text).
 *
 * Идемпотентность:
 *   Берём только цели с `embedding IS NULL` → повторный прогон пропускает уже
 *   посчитанные (no-op). На чистом старте (нет целей) — no-op.
 *
 * Запуск (после деплоя Ф5):
 *   bun run scripts/backfill-goal-embeddings.ts --dry-run
 *   bun run scripts/backfill-goal-embeddings.ts
 *
 * NB: phase 'backfill', skipBootstrap:true (нужно только при апгрейде).
 */

import { createHash } from 'node:crypto';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { EmbeddingFallbackService } from '../src/modules/embeddings/services/embedding-fallback.service';

interface RunArgs {
  dryRun: boolean;
}

export interface BackfillGoalEmbeddingsStats {
  scanned: number;
  embedded: number;
  skippedEmpty: number;
  errors: number;
}

/** Минимальная форма prisma, нужная backfill'у (для тестируемости). */
export interface BackfillPrisma {
  $queryRawUnsafe<T = unknown>(sql: string, ...params: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...params: unknown[]): Promise<unknown>;
}

/** Минимальная форма embeddings-провайдера. */
export interface BackfillEmbeddings {
  embed(texts: string[]): Promise<number[][]>;
}

function parseArgs(): RunArgs {
  return { dryRun: process.argv.includes('--dry-run') };
}

function buildText(name: string, description: string | null): string {
  const desc = (description ?? '').trim();
  const t = (name ?? '').trim();
  if (t.length === 0 && desc.length === 0) return '';
  if (desc.length === 0) return t;
  if (t.length === 0) return desc;
  return `${t}\n\n${desc}`;
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Чистое ядро backfill'а (тестируемое). Идемпотентность: выборка строго по
 * `embedding IS NULL` → повторный прогон пропускает уже посчитанные (no-op).
 */
export async function backfillGoalEmbeddings(
  prisma: BackfillPrisma,
  embeddings: BackfillEmbeddings,
  opts: { dryRun: boolean },
): Promise<BackfillGoalEmbeddingsStats> {
  const stats: BackfillGoalEmbeddingsStats = {
    scanned: 0,
    embedded: 0,
    skippedEmpty: 0,
    errors: 0,
  };

  const BATCH = 100;
  // Курсор по id: успешный UPDATE убирает строку из `embedding IS NULL`, но
  // цели без текста (skippedEmpty) останутся NULL и без курсора зациклили бы
  // выборку. Поэтому пагинируем по `id > cursor` — каждый батч строго новый.
  let cursor = '';
   
  while (true) {
    const rows = await prisma.$queryRawUnsafe<
      Array<{ id: string; tenantId: string; name: string; description: string | null }>
    >(
      `SELECT "id", "tenantId", "name", "description"
         FROM "Goal"
        WHERE "embedding" IS NULL
          AND "id" > $1
        ORDER BY "id" ASC
        LIMIT ${BATCH}`,
      cursor,
    );
    if (rows.length === 0) break;
    const last = rows[rows.length - 1];
    if (!last) break;
    cursor = last.id;

    for (const g of rows) {
      stats.scanned += 1;
      const text = buildText(g.name, g.description);
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
          console.warn(`[backfill-goal-embeddings] goalId=${g.id}: пустой embedding`);
          continue;
        }
        await prisma.$executeRawUnsafe(
          'UPDATE "Goal" SET embedding = $1::vector(768), "embeddingHash" = $2 WHERE id = $3 AND "tenantId" = $4',
          `[${vector.join(',')}]`,
          sha256Hex(text),
          g.id,
          g.tenantId,
        );
        stats.embedded += 1;
      } catch (err) {
        stats.errors += 1;
        console.warn(
          `[backfill-goal-embeddings] goalId=${g.id}: ошибка — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (rows.length < BATCH) break;
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
    `[backfill-goal-embeddings] start (dryRun=${args.dryRun}) — идемпотентно: только embedding IS NULL`,
  );
  const stats = await backfillGoalEmbeddings(
    prisma as unknown as BackfillPrisma,
    embeddings as unknown as BackfillEmbeddings,
    { dryRun: args.dryRun },
  );
  console.log('[backfill-goal-embeddings] done', stats);
  await app.close();
}

// Запуск как CLI (а не импорт из spec): только когда файл — главный модуль.
if (process.argv[1] && process.argv[1].includes('backfill-goal-embeddings')) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[backfill-goal-embeddings] fatal', err);
      process.exit(1);
    });
}
